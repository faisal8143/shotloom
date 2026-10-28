// The few model settings the prompt box exposes (Flow-style): duration and resolution.
// Each model names and shapes these differently, so they're read from its schema.
import type { Field, ModelSchema } from "./schema.ts";

const NUMERIC = new Set(["enum", "integer", "number"]);

export function durationField(schema: ModelSchema | undefined): Field | undefined {
  return schema?.fields.find((f) => NUMERIC.has(f.kind) && /(^|_)(duration|seconds)(_|$)/i.test(f.name));
}

export function resolutionField(schema: ModelSchema | undefined): Field | undefined {
  return schema?.fields.find((f) => f.kind === "enum" && /^(resolution|video_resolution|quality)$/i.test(f.name) && f.options?.some((o) => /\d+p$|4k/i.test(String(o))));
}

/** Choices for a duration control, in the model's own value type. */
export function durationOptions(field: Field): (string | number)[] {
  if (field.kind === "enum") return field.options ?? [];
  const min = Math.max(1, Math.ceil(field.min ?? 1));
  const max = Math.floor(field.max ?? Math.max(min, 10));
  const out: number[] = [];
  for (let s = min; s <= max && out.length < 30; s++) out.push(s);
  return out;
}

export function durationLabel(v: unknown): string {
  if (v === "auto") return "Auto";
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? `${n}s` : String(v);
}

const RES_LABEL: Record<string, string> = {
  "480p": "SD",
  "540p": "SD",
  "720p": "HD",
  "768p": "HD+",
  "1080p": "FHD",
  "1440p": "2K",
  "2160p": "4K",
  "1k": "1K",
  "2k": "2K",
  "4k": "4K",
};

export function resolutionLabel(v: unknown): string {
  const key = String(v).toLowerCase();
  const short = RES_LABEL[key];
  if (!short) return String(v);
  return /p$/.test(key) ? `${short} ${key}` : short;
}

/** Keeps only the overrides the prompt box can show, and only valid ones. */
export function quickParams(schema: ModelSchema | undefined, params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of [durationField(schema), resolutionField(schema)]) {
    if (!f || params[f.name] === undefined) continue;
    const v = params[f.name];
    if (f.kind === "enum" ? f.options?.map(String).includes(String(v)) : typeof v === "number") out[f.name] = v;
  }
  return out;
}
