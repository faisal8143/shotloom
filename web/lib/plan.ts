// Decides which fal endpoint a shot uses and builds the exact input sent to it.
import { CUSTOM_KEY, findModel, isValidEndpoint, pickEndpoint, type Mode } from "./models.ts";
import { buildPrompt } from "./presets.ts";
import {
  endImageField,
  matchAspect,
  referenceImagesField,
  startImageField,
  type ModelSchema,
} from "./schema.ts";
import type { Project, Shot } from "./types.ts";

export interface EndpointChoice {
  endpoint?: string;
  mode?: Mode;
  modelName: string;
  imageField?: string;
  error?: string;
}

export function chooseEndpoint(shot: Shot): EndpointChoice {
  if (shot.modelKey === CUSTOM_KEY) {
    const id = (shot.customEndpoint ?? "").trim().replace(/^https?:\/\/fal\.ai\/models\//, "");
    if (!id) return { modelName: "Custom", error: "Paste a fal model endpoint, e.g. fal-ai/veo3.1/fast" };
    if (!isValidEndpoint(id)) return { modelName: "Custom", error: "That doesn't look like a fal endpoint ID." };
    return { endpoint: id, modelName: id.split("/").slice(-2).join("/") };
  }
  const model = findModel(shot.modelKey);
  if (!model) return { modelName: "?", error: "Unknown model" };
  const pick = pickEndpoint(model, { start: Boolean(shot.startFrame), references: shot.references.length > 0 });
  if ("error" in pick) return { modelName: model.name, error: pick.error };
  return {
    endpoint: pick.endpoint,
    mode: pick.mode,
    modelName: model.name,
    imageField: pick.mode === "image" ? model.imageField : undefined,
  };
}

/** Values Shotloom fills in for you (currently: the project's aspect ratio). */
export function autoValues(schema: ModelSchema | undefined, project: Project, shot: Shot): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!schema) return out;
  const ar = schema.fields.find((f) => f.name === "aspect_ratio");
  const match = matchAspect(ar, project.aspect);
  // with a start frame, models crop to it - let them infer unless the user chose
  if (match && !(shot.startFrame && ar?.options?.map(String).includes("auto"))) out.aspect_ratio = match;
  return out;
}

export interface BuiltInput {
  input: Record<string, unknown>;
  prompt: string;
  errors: string[];
  notes: string[];
}

export function buildInput(schema: ModelSchema, project: Project, shot: Shot): BuiltInput {
  const prompt = buildPrompt(shot.prompt, shot.camera, project.look);
  const input: Record<string, unknown> = {};
  const errors: string[] = [];
  const notes: string[] = [];
  const auto = autoValues(schema, project, shot);
  const start = startImageField(schema);
  const end = endImageField(schema);
  const refs = referenceImagesField(schema);

  for (const f of schema.fields) {
    if (f.kind === "prompt") {
      if (shot.prompt.trim()) input[f.name] = prompt;
      else if (f.required) errors.push("Write a prompt for this shot.");
      continue;
    }
    if (f.kind === "image") {
      const value = f === start ? shot.startFrame : f === end ? shot.endFrame : undefined;
      if (value) input[f.name] = value;
      else if (f.required) errors.push(f === end ? "This model needs an end frame." : "This model needs a start frame.");
      continue;
    }
    if (f.kind === "images") {
      if (f === refs && shot.references.length) input[f.name] = shot.references;
      else if (f.required) errors.push("Add at least one ingredient image.");
      continue;
    }
    if (f.kind === "video" || f.kind === "unknown") {
      const v = shot.params[f.name];
      if (v !== undefined && v !== "") input[f.name] = v;
      else if (f.required && f.default === undefined) errors.push(`Set "${f.label}" (in More settings).`);
      continue;
    }
    const v = shot.params[f.name] ?? auto[f.name];
    if (v !== undefined && v !== "") {
      if (f.kind === "enum" && f.options && !f.options.map(String).includes(String(v))) {
        notes.push(`${f.label} "${String(v)}" isn't offered by this model, so its default is used.`);
        continue;
      }
      input[f.name] = v;
    } else if (f.required && f.default === undefined) {
      errors.push(`Set "${f.label}".`);
    }
  }

  if (shot.startFrame && !start) notes.push("This model ignores the start frame.");
  if (shot.endFrame && !end) notes.push("This model ignores the end frame.");
  if (shot.references.length && !refs) notes.push("This model ignores ingredient images.");
  return { input, prompt, errors, notes };
}
