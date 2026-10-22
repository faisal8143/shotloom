// Free generation path: Hugging Face Spaces (Gradio).
//
// A Space exposes its own API at https://<slug>.hf.space/gradio_api/info, which
// lists each named endpoint and its parameters in call order. That is enough to
// drive ANY Gradio video Space the same way the fal path is driven by fal's
// OpenAPI document - no per-Space code.
//
// Endpoints are written as "hf:<owner>/<space>:<api_name>", e.g.
//   hf:Lightricks/ltx-video-distilled:/text_to_video
// The api_name may be left empty and is then chosen from the Space's own list.
import type { Field, FieldKind, ModelSchema } from "./schema.ts";

export const HF_PREFIX = "hf:";

export interface HfTarget {
  space: string;
  api: string;
}

export function isHfEndpoint(endpoint: string): boolean {
  return endpoint.startsWith(HF_PREFIX);
}

export function hfEndpoint(space: string, api = ""): string {
  return `${HF_PREFIX}${space}:${api}`;
}

const SPACE_RE = /^[A-Za-z0-9][\w.-]{0,95}\/[A-Za-z0-9][\w.-]{0,95}$/;

export function isValidSpace(id: string): boolean {
  return SPACE_RE.test(id) && !id.includes("..");
}

export function parseHfEndpoint(endpoint: string): HfTarget | null {
  if (!isHfEndpoint(endpoint)) return null;
  const rest = endpoint.slice(HF_PREFIX.length);
  const cut = rest.indexOf(":");
  const space = (cut === -1 ? rest : rest.slice(0, cut)).trim();
  const api = cut === -1 ? "" : rest.slice(cut + 1).trim();
  if (!isValidSpace(space)) return null;
  if (api && !/^\/[\w./-]{1,120}$/.test(api)) return null;
  return { space, api };
}

/** "Lightricks/ltx-video-distilled" -> "lightricks-ltx-video-distilled" */
export function spaceSlug(space: string): string {
  return space.toLowerCase().replace(/[._]/g, "-").replace("/", "-");
}

/** Base URL of a Space. SHOTLOOM_HF_BASE points the tests at a mock Space. */
export function spaceBase(space: string, override?: string): string {
  const base = (override ?? "").replace(/\/+$/, "");
  if (base) return base;
  return `https://${spaceSlug(space)}.hf.space`;
}

// ---------------------------------------------------------------------------
// /gradio_api/info  ->  ModelSchema

type Json = Record<string, any>;

const HIDE = /^(input_video_filepath|ui_frames_to_use|mode|task|api_name|request|profile|oauth_token)$/;
const CORE = /(duration|num_frames|seconds|length|resolution|fps)/;

function literalOptions(pythonType: string | undefined): (string | number)[] | undefined {
  if (!pythonType || !pythonType.startsWith("Literal[")) return undefined;
  const inner = pythonType.slice("Literal[".length, -1);
  const out: (string | number)[] = [];
  for (const raw of inner.split(",")) {
    const t = raw.trim();
    if (!t) continue;
    const m = /^['"](.*)['"]$/.exec(t);
    if (m) out.push(m[1]);
    else if (/^-?\d+(\.\d+)?$/.test(t)) out.push(Number(t));
  }
  return out.length ? out : undefined;
}

function label(param: Json, name: string): string {
  const given = typeof param.label === "string" ? param.label.trim() : "";
  // gradio uses placeholder labels like "image_n" for hidden state inputs
  const usable = given && !/^(image|video|state|param|input|output)_([a-z]|\d+)$/i.test(given);
  const text = usable ? given : name.replace(/_(ui|filepath|flag)$/, "").replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function kindOf(param: Json, name: string, pythonType: string | undefined): { kind: FieldKind; role?: "start" | "end" | "other" } {
  const component = String(param.component ?? "").toLowerCase();
  if (/^prompt$/.test(name) || (component === "textbox" && /^prompt$/i.test(String(param.label ?? "")))) {
    return { kind: "prompt" };
  }
  if (/negative_prompt/.test(name)) return { kind: "longtext" };
  if (component === "image" || /image.*(filepath|path|url)$|^input_image|^image$/.test(name)) {
    const role = /(^|_)(end|last|tail)(_|$)/.test(name) ? "end" : "start";
    return { kind: "image", role };
  }
  if (component === "video" || /video.*(filepath|path|url)$/.test(name)) return { kind: "video" };
  if (pythonType === "bool" || component === "checkbox") return { kind: "boolean" };
  if (pythonType === "int") return { kind: "integer" };
  if (pythonType === "float") return { kind: "number" };
  return { kind: "text" };
}

/** The mode a Space's own `mode`/`task` parameter should be pinned to. */
function modeFor(api: string): string | undefined {
  if (/image_to_video|i2v/i.test(api)) return "image-to-video";
  if (/video_to_video|v2v/i.test(api)) return "video-to-video";
  if (/text_to_video|t2v|generate_video|generate/i.test(api)) return "text-to-video";
  return undefined;
}

function returnsVideo(endpoint: Json): boolean {
  return (endpoint?.returns ?? []).some((r: Json) => {
    const t = `${r?.component ?? ""} ${r?.label ?? ""} ${r?.python_type?.type ?? ""}`.toLowerCase();
    return t.includes("video");
  });
}

/** Picks the endpoint of a Space that fits the mode we want. */
export function pickSpaceApi(info: Json, want: "text" | "image" | "" = ""): string | undefined {
  const named: Json = info?.named_endpoints ?? {};
  const names = Object.keys(named).filter((n) => returnsVideo(named[n]));
  if (!names.length) return undefined;
  const byWant =
    want === "image"
      ? names.find((n) => /image_to_video|i2v/i.test(n))
      : want === "text"
        ? names.find((n) => /text_to_video|t2v/i.test(n))
        : undefined;
  return byWant ?? names.find((n) => /text_to_video|t2v/i.test(n)) ?? names[0];
}

export function parseGradioInfo(info: Json, space: string, api: string): ModelSchema {
  const endpoint: Json | undefined = info?.named_endpoints?.[api];
  if (!endpoint) throw new Error(`That Space has no "${api}" endpoint.`);
  const params: Json[] = Array.isArray(endpoint.parameters) ? endpoint.parameters : [];
  if (!params.length) throw new Error("That Space's endpoint takes no parameters.");

  const order: string[] = [];
  const defaults: Record<string, unknown> = {};
  const fixed: Record<string, unknown> = {};
  const fields: Field[] = [];
  const pinned = modeFor(api);

  params.forEach((p, i) => {
    const name = String(p.parameter_name ?? p.label ?? `arg_${i}`);
    order.push(name);
    const def = p.parameter_has_default ? p.parameter_default : undefined;
    defaults[name] = def;

    const pythonType: string | undefined = p?.python_type?.type;
    const options = literalOptions(pythonType);
    if (HIDE.test(name)) {
      if (pinned && options?.map(String).includes(pinned)) fixed[name] = pinned;
      return;
    }
    const { kind, role } = kindOf(p, name, pythonType);
    const field: Field = {
      name,
      label: label(p, name),
      kind: options ? "enum" : kind,
      required: !p.parameter_has_default,
      default: def,
      options,
      description: typeof p?.python_type?.description === "string" ? p.python_type.description : undefined,
      role,
      core: CORE.test(name),
    };
    if (kind === "integer" || kind === "number") {
      const c = p.component_props ?? {};
      if (typeof c.minimum === "number") field.min = c.minimum;
      if (typeof c.maximum === "number") field.max = c.maximum;
    }
    fields.push(field);
  });

  return { endpoint: hfEndpoint(space, api), fields, provider: "hf", space, apiName: api, order, defaults, fixed };
}

/** Turns the studio's named input into the positional array Gradio expects. */
export function positionalArgs(schema: ModelSchema, input: Record<string, unknown>): unknown[] {
  const order = schema.order ?? schema.fields.map((f) => f.name);
  const defaults = schema.defaults ?? {};
  return order.map((name) => {
    if (schema.fixed && name in schema.fixed) return schema.fixed[name];
    if (name in input && input[name] !== undefined && input[name] !== "") return input[name];
    return defaults[name] ?? null;
  });
}

/** Width/height a Space should use for the project's aspect ratio. */
export function hfAutoSize(schema: ModelSchema, aspect: string): Record<string, number> {
  const w = schema.fields.find((f) => /^width/.test(f.name) && (f.kind === "integer" || f.kind === "number"));
  const h = schema.fields.find((f) => /^height/.test(f.name) && (f.kind === "integer" || f.kind === "number"));
  if (!w || !h) return {};
  const area = (Number(w.default) || 704) * (Number(h.default) || 512);
  const [aw, ah] = aspect.split(":").map(Number);
  if (!aw || !ah) return {};
  const ratio = aw / ah;
  const snap = (n: number, f: Field) => {
    const v = Math.round(n / 32) * 32;
    return Math.min(f.max ?? 1280, Math.max(f.min ?? 256, v));
  };
  return { [w.name]: snap(Math.sqrt(area * ratio), w), [h.name]: snap(Math.sqrt(area / ratio), h) };
}

/** Finds the generated clip in whatever shape a Space returns. */
export function findGradioVideo(data: unknown, base: string, depth = 0): string | undefined {
  if (data == null || depth > 5) return undefined;
  if (typeof data === "string") {
    if (/^https?:\/\//.test(data)) return /\.(mp4|webm|mov)(\?|$)/.test(data) ? data : undefined;
    return undefined;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findGradioVideo(item, base, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof data !== "object") return undefined;
  const obj = data as Json;
  if (typeof obj.url === "string" && /^https?:\/\//.test(obj.url)) return obj.url;
  if (typeof obj.path === "string" && /\.(mp4|webm|mov)$/.test(obj.path)) {
    return `${base}/gradio_api/file=${obj.path.replace(/^\/+/, "/")}`.replace("file=/", "file=/");
  }
  for (const v of Object.values(obj)) {
    const found = findGradioVideo(v, base, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export interface SseEvent {
  event: string;
  data: string;
}

/** Pulls whole "event:/data:" blocks out of a growing SSE buffer. */
export function drainSse(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length || event !== "message") events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

/** One readable line out of a Space's progress payload. */
export function progressLine(data: string): string | undefined {
  if (!data || data === "null") return undefined;
  try {
    const parsed = JSON.parse(data);
    if (typeof parsed === "string") return parsed.slice(0, 200);
    const msg = parsed?.msg ?? parsed?.message ?? parsed?.detail;
    if (typeof msg === "string") return msg.slice(0, 200);
    if (typeof parsed?.rank === "number") return `In the Space's queue, position ${parsed.rank + 1}.`;
    return undefined;
  } catch {
    return data.slice(0, 200);
  }
}
