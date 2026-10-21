import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildInput, chooseEndpoint } from "../lib/plan.ts";
import { endImageField, parseOpenApi, referenceImagesField, startImageField } from "../lib/schema.ts";
import type { Project, Shot } from "../lib/types.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

const seedance = parseOpenApi(fixture("seedance-i2v"), "bytedance/seedance-2.0/image-to-video");
const veo = parseOpenApi(fixture("veo-fast"), "fal-ai/veo3.1/fast");
const kling = parseOpenApi(fixture("kling-i2v"), "fal-ai/kling-video/v3/pro/image-to-video");
const ref = parseOpenApi(fixture("veo-ref"), "fal-ai/veo3.1/reference-to-video");

const project: Project = { id: "p", name: "Test", aspect: "16:9", look: "", shots: [], createdAt: 0, updatedAt: 0 };
const shot = (over: Partial<Shot> = {}): Shot => ({
  id: "s",
  title: "",
  prompt: "A lighthouse in a storm",
  modelKey: "seedance2",
  params: {},
  camera: {},
  references: [],
  takes: [],
  ...over,
});

test("parses fields in fal's declared order and hides internal ones", () => {
  assert.deepEqual(
    seedance.fields.map((f) => f.name),
    ["prompt", "image_url", "end_image_url", "resolution", "duration", "aspect_ratio", "generate_audio", "bitrate_mode", "codec", "seed"],
  );
});

test("resolves enums through allOf/$ref and keeps defaults", () => {
  const ar = seedance.fields.find((f) => f.name === "aspect_ratio")!;
  assert.equal(ar.kind, "enum");
  assert.deepEqual(ar.options, ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
  assert.equal(ar.default, "auto");
  assert.equal(ar.core, true);
});

test("nullable anyOf fields become their real type", () => {
  const seed = seedance.fields.find((f) => f.name === "seed")!;
  assert.equal(seed.kind, "integer");
  assert.equal(seed.min, 0);
  const end = seedance.fields.find((f) => f.name === "end_image_url")!;
  assert.equal(end.kind, "image");
  assert.equal(end.role, "end");
});

test("finds start/end/reference image fields across naming styles", () => {
  assert.equal(startImageField(seedance)?.name, "image_url");
  assert.equal(endImageField(seedance)?.name, "end_image_url");
  assert.equal(startImageField(kling)?.name, "start_image_url");
  assert.equal(endImageField(kling)?.name, "end_image_url");
  assert.equal(referenceImagesField(ref)?.name, "image_urls");
  assert.equal(startImageField(veo), undefined);
  assert.equal(kling.fields.find((f) => f.name === "elements")?.kind, "unknown");
});

test("chooses the endpoint from what the shot has", () => {
  assert.equal(chooseEndpoint(shot()).endpoint, "bytedance/seedance-2.0/text-to-video");
  assert.equal(chooseEndpoint(shot({ startFrame: "data:x" })).endpoint, "bytedance/seedance-2.0/image-to-video");
  assert.equal(chooseEndpoint(shot({ modelKey: "veo31", references: ["data:a"] })).endpoint, "fal-ai/veo3.1/reference-to-video");
  assert.match(chooseEndpoint(shot({ modelKey: "ltx2-fast", startFrame: "data:x" })).error ?? "", /start from a frame/);
  assert.equal(chooseEndpoint(shot({ modelKey: "custom", customEndpoint: "https://fal.ai/models/fal-ai/foo/bar" })).endpoint, "fal-ai/foo/bar");
  assert.ok(chooseEndpoint(shot({ modelKey: "custom", customEndpoint: "../../etc" })).error);
});

test("builds the fal input: prompt + camera + look, frames, project aspect", () => {
  const p = { ...project, look: "cinematic, 35mm film" };
  const s = shot({
    startFrame: "data:start",
    endFrame: "data:end",
    camera: { size: "close-up", move: "slow dolly-in", light: "golden hour sunlight" },
    params: { duration: "10", seed: 7 },
  });
  const built = buildInput(seedance, p, s);
  assert.deepEqual(built.errors, []);
  assert.equal(
    built.input.prompt,
    "A lighthouse in a storm. Close-up, slow dolly-in. Lighting: golden hour sunlight. Style: cinematic, 35mm film.",
  );
  assert.equal(built.input.image_url, "data:start");
  assert.equal(built.input.end_image_url, "data:end");
  assert.equal(built.input.duration, "10");
  assert.equal(built.input.seed, 7);
  // with a start frame, Seedance can infer the aspect itself ("auto"), so we don't force one
  assert.equal("aspect_ratio" in built.input, false);
  // defaults are left to fal
  assert.equal("resolution" in built.input, false);
});

test("applies the project aspect when the model offers it, skips it when it doesn't", () => {
  assert.equal(buildInput(veo, project, shot({ modelKey: "veo31-fast" })).input.aspect_ratio, "16:9");
  const square = buildInput(veo, { ...project, aspect: "1:1" }, shot({ modelKey: "veo31-fast" }));
  assert.equal("aspect_ratio" in square.input, false);
});

test("reports what's missing instead of sending a broken request", () => {
  assert.deepEqual(buildInput(seedance, project, shot({ prompt: " " })).errors, [
    "Write a prompt for this shot.",
    "This model needs a start frame.",
  ]);
  const r = buildInput(ref, project, shot({ modelKey: "veo31" }));
  assert.deepEqual(r.errors, ["Add at least one ingredient image."]);
  const ok = buildInput(ref, project, shot({ modelKey: "veo31", references: ["data:a", "data:b"] }));
  assert.deepEqual(ok.input.image_urls, ["data:a", "data:b"]);
});

test("drops an enum value the new model doesn't offer (e.g. after switching models)", () => {
  const built = buildInput(veo, project, shot({ modelKey: "veo31-fast", params: { duration: "10" } }));
  assert.equal("duration" in built.input, false);
  assert.match(built.notes[0], /isn't offered/);
});
