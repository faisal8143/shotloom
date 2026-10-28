import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseGradioInfo } from "../lib/hf.ts";
import { buildInput } from "../lib/plan.ts";
import { newProject, newShot } from "../lib/project.ts";
import { durationField, durationLabel, durationOptions, quickParams, resolutionField, resolutionLabel } from "../lib/quick-settings.ts";
import { parseOpenApi } from "../lib/schema.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const veo = parseOpenApi(fixture("veo-fast"), "fal-ai/veo3.1/fast");
const seedance = parseOpenApi(fixture("seedance-i2v"), "bytedance/seedance-2.0/image-to-video");
const space = parseGradioInfo(fixture("space-ltx-info"), "Lightricks/ltx-video-distilled", "/text_to_video");

test("finds duration and resolution whatever the model calls them", () => {
  assert.deepEqual(durationOptions(durationField(veo)!), ["4s", "6s", "8s"]);
  assert.deepEqual(resolutionField(veo)!.options, ["720p", "1080p", "4k"]);
  assert.equal(durationOptions(durationField(seedance)!)[0], "auto");
  const d = durationField(space)!;
  assert.equal(d.name, "duration_ui");
  assert.deepEqual(durationOptions(d), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(resolutionField(space), undefined);
});

test("labels read like Flow", () => {
  assert.equal(durationLabel("8s"), "8s");
  assert.equal(durationLabel("10"), "10s");
  assert.equal(durationLabel(4), "4s");
  assert.equal(durationLabel("auto"), "Auto");
  assert.equal(resolutionLabel("720p"), "HD 720p");
  assert.equal(resolutionLabel("1080p"), "FHD 1080p");
  assert.equal(resolutionLabel("4k"), "4K");
});

test("only valid duration/resolution choices reach the model", () => {
  assert.deepEqual(quickParams(veo, { duration: "6s", resolution: "1080p", seed: 3 }), { duration: "6s", resolution: "1080p" });
  assert.deepEqual(quickParams(veo, { duration: "10", resolution: "480p" }), {}, "values from another model are dropped");
  const shot = newShot({ modelKey: "veo31-fast", prompt: "rain", params: quickParams(veo, { duration: "4s", resolution: "1080p" }) });
  const built = buildInput(veo, newProject("x"), shot);
  assert.equal(built.input.duration, "4s");
  assert.equal(built.input.resolution, "1080p");
});
