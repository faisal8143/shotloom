// Turns a fal.ai endpoint's OpenAPI document into a short list of form fields.
// This is what lets Shotloom drive ANY fal video model: the studio reads the
// model's own schema instead of hard-coding parameter names per model.

export type FieldKind =
  | "prompt"
  | "text"
  | "longtext"
  | "enum"
  | "boolean"
  | "integer"
  | "number"
  | "image"
  | "images"
  | "video"
  | "unknown";

export type ImageRole = "start" | "end" | "other";

export interface Field {
  name: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  description?: string;
  default?: unknown;
  options?: (string | number)[];
  min?: number;
  max?: number;
  /** only for kind === "image" */
  role?: ImageRole;
  /** shown in the main panel rather than under "More settings" */
  core?: boolean;
}

export interface ModelSchema {
  endpoint: string;
  fields: Field[];
  /** true when the real schema could not be loaded and a minimal guess is used */
  fallback?: boolean;
  /** "fal" (paid, queue API) or "hf" (free, a Hugging Face Space) */
  provider?: "fal" | "hf";
  // --- Hugging Face Spaces only ---
  /** owner/space the schema came from */
  space?: string;
  /** the Space endpoint the studio will call, e.g. "/text_to_video" */
  apiName?: string;
  /** parameter names in the order the Space expects them */
  order?: string[];
  /** each parameter's own default, used for anything the studio doesn't set */
  defaults?: Record<string, unknown>;
  /** values the studio pins (the Space's own task/mode switch) */
  fixed?: Record<string, unknown>;
}

type Json = Record<string, any>;

const CORE = new Set(["aspect_ratio", "duration", "resolution", "generate_audio", "num_frames"]);
const HIDDEN = new Set(["end_user_id", "sync_mode", "webhook_url", "enable_safety_checker"]);

function deref(doc: Json, node: any, depth = 0): any {
  if (!node || typeof node !== "object" || depth > 8) return node;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
    const target = node.$ref
      .slice(2)
      .split("/")
      .reduce((acc: any, key: string) => (acc ? acc[key.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), doc);
    // keep sibling keys such as default/description next to the $ref
    const { $ref: _ignored, ...rest } = node;
    return { ...deref(doc, target, depth + 1), ...rest };
  }
  return node;
}

/** Flattens allOf / anyOf / oneOf wrappers into one property description. */
function flatten(doc: Json, raw: any): Json {
  let prop: Json = deref(doc, raw) ?? {};
  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    const parts = prop[key];
    if (!Array.isArray(parts)) continue;
    const resolved = parts.map((p: any) => deref(doc, p)).filter((p: any) => p && p.type !== "null");
    const merged: Json = {};
    for (const p of resolved) {
      if (key !== "allOf" && Object.keys(merged).length) break; // first non-null option wins
      Object.assign(merged, flatten(doc, p));
    }
    const { [key]: _drop, ...rest } = prop;
    prop = { ...merged, ...rest };
  }
  return prop;
}

function humanize(name: string): string {
  const text = name.replace(/_url(s)?$/, "$1").replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function imageRole(name: string): ImageRole {
  if (/(^|_)(end|last|tail)(_|$)/.test(name)) return "end";
  if (/^(image_url|start_image_url|first_frame(_image)?_url|input_image_url|image)$/.test(name)) return "start";
  return "other";
}

export function toField(doc: Json, name: string, raw: any, required: boolean): Field | null {
  if (HIDDEN.has(name)) return null;
  const prop = flatten(doc, raw);
  const base = {
    name,
    label: humanize(name),
    required,
    description: typeof prop.description === "string" ? prop.description : undefined,
    default: prop.default,
    core: CORE.has(name),
  };

  if (name === "prompt") return { ...base, kind: "prompt" };
  if (Array.isArray(prop.enum) && prop.enum.length) {
    const options = (prop.enum as unknown[]).filter(
      (v): v is string | number => typeof v === "string" || typeof v === "number",
    );
    return { ...base, kind: "enum", options };
  }
  const type = Array.isArray(prop.type) ? prop.type.find((t: string) => t !== "null") : prop.type;
  if (type === "boolean") return { ...base, kind: "boolean" };
  if (type === "integer" || type === "number") {
    return {
      ...base,
      kind: type,
      min: prop.minimum ?? prop.exclusiveMinimum,
      max: prop.maximum ?? prop.exclusiveMaximum,
    };
  }
  if (type === "array") {
    const items = flatten(doc, prop.items);
    if (/image/.test(name) && (items.type === "string" || !items.type)) return { ...base, kind: "images" };
    return { ...base, kind: "unknown" };
  }
  if (type === "string" || (!type && !prop.properties)) {
    if (/(^|_)image(_url)?$/.test(name) || /image_url$/.test(name)) {
      return { ...base, kind: "image", role: imageRole(name) };
    }
    if (/video_url$/.test(name)) return { ...base, kind: "video" };
    if (/negative_prompt/.test(name)) return { ...base, kind: "longtext" };
    return { ...base, kind: "text" };
  }
  return { ...base, kind: "unknown" };
}

/** Finds the request-body schema of the endpoint's POST operation. */
function findInputSchema(doc: Json, endpoint: string): Json | null {
  const paths: Json = doc.paths ?? {};
  const wanted = "/" + endpoint.replace(/^\/+/, "");
  const candidates = [wanted, ...Object.keys(paths).filter((p) => p !== wanted && !p.includes("/requests/"))];
  for (const path of candidates) {
    const op = paths[path]?.post;
    const schema = op?.requestBody?.content?.["application/json"]?.schema;
    if (schema) return flatten(doc, schema);
  }
  return null;
}

export function parseOpenApi(doc: Json, endpoint: string): ModelSchema {
  const input = findInputSchema(doc, endpoint);
  if (!input || typeof input.properties !== "object") {
    throw new Error("No input schema found for " + endpoint);
  }
  const required = new Set<string>(Array.isArray(input.required) ? input.required : []);
  const order: string[] = Array.isArray(input["x-fal-order-properties"])
    ? input["x-fal-order-properties"]
    : Object.keys(input.properties);
  const names = [...order, ...Object.keys(input.properties).filter((n) => !order.includes(n))];
  const fields: Field[] = [];
  for (const name of names) {
    if (!(name in input.properties)) continue;
    const field = toField(doc, name, input.properties[name], required.has(name));
    if (field) fields.push(field);
  }
  return { endpoint, fields };
}

/** Minimal schema used when fal's OpenAPI document can't be reached. */
export function fallbackSchema(endpoint: string, imageField?: string): ModelSchema {
  const fields: Field[] = [{ name: "prompt", label: "Prompt", kind: "prompt", required: true }];
  if (imageField) {
    fields.push({ name: imageField, label: "Start frame", kind: "image", role: "start", required: true });
  }
  return { endpoint, fields, fallback: true };
}

// ---------------------------------------------------------------------------
// helpers used by the studio

export function startImageField(schema: ModelSchema): Field | undefined {
  const images = schema.fields.filter((f) => f.kind === "image");
  return images.find((f) => f.role === "start") ?? images.find((f) => f.role !== "end");
}

export function endImageField(schema: ModelSchema): Field | undefined {
  return schema.fields.find((f) => f.kind === "image" && f.role === "end");
}

export function referenceImagesField(schema: ModelSchema): Field | undefined {
  return schema.fields.find((f) => f.kind === "images");
}

/** Picks the enum option closest to the project's aspect ratio, if the model has that knob. */
export function matchAspect(field: Field | undefined, aspect: string): string | undefined {
  if (!field?.options) return undefined;
  const opts = field.options.map(String);
  return opts.includes(aspect) ? aspect : undefined;
}

/** Rough clip length in seconds from a duration-like parameter value. */
export function durationSeconds(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}
