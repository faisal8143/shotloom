import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { findMedia } from "../lib/fal-result.ts";
import { buildInput, chooseEndpoint } from "../lib/plan.ts";
import { estimate, formatUsd, perSecond } from "../lib/pricing.ts";
import { groupByDay, newProject, newShot, placeFinishedTake } from "../lib/project.ts";
import { durationField, durationOptions, resolutionField, resolutionLabel } from "../lib/quick-settings.ts";
import { parseOpenApi } from "../lib/schema.ts";
import { editRun, toolBlocker, toolCost, upscaleRun } from "../lib/tools.ts";
import type { Take } from "../lib/types.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

test("finds videos and images in fal results", () => {
  assert.deepEqual(findMedia({ video: { url: "https://v3.fal.media/a.mp4" }, seed: 1 }), { videoUrl: "https://v3.fal.media/a.mp4" });
  assert.deepEqual(findMedia({ images: [{ url: "https://v3.fal.media/b.png", content_type: "image/png" }], description: "" }), { imageUrl: "https://v3.fal.media/b.png" });
  assert.deepEqual(findMedia({ video: { url: "https://x/c.mp4" }, thumbnail: { url: "https://x/c.jpg" } }), { videoUrl: "https://x/c.mp4" });
  assert.deepEqual(findMedia({ nothing: true }), {});
});

test("image mode: Nano Banana text vs edit, FLUX gets a size from the project aspect", () => {
  const nb = parseOpenApi(fixture("nano-banana"), "google/nano-banana-2.1");
  const nbe = parseOpenApi(fixture("nano-banana-edit"), "google/nano-banana-2.1/edit");
  assert.equal(chooseEndpoint(newShot({ modelKey: "nano-banana-21" })).endpoint, "google/nano-banana-2.1");
  assert.equal(chooseEndpoint(newShot({ modelKey: "nano-banana-21", references: ["data:x"] })).endpoint, "google/nano-banana-2.1/edit");
  const edit = buildInput(nbe, newProject("x"), newShot({ modelKey: "nano-banana-21", prompt: "make it night", references: ["data:x"] }));
  assert.deepEqual(edit.input.image_urls, ["data:x"]);
  assert.equal(edit.input.aspect_ratio, "16:9");
  assert.deepEqual(resolutionField(nb)?.options, ["1K", "2K", "4K"]);
  assert.equal(resolutionLabel("2K"), "2K");

  const fs = parseOpenApi(fixture("flux-schnell"), "fal-ai/flux/schnell");
  const p = { ...newProject("x"), aspect: "9:16" as const };
  const flux = buildInput(fs, p, newShot({ modelKey: "flux-schnell", prompt: "a fox" }));
  assert.equal(flux.input.image_size, "portrait_16_9");
  assert.deepEqual(flux.errors, []);
});

test("MiniMax H3 Max: 1-15 s durations, HD+/FHD labels, no false 'required' error", () => {
  const h3 = parseOpenApi(fixture("h3-max"), "minimax/h3-max/text-to-video");
  assert.deepEqual(durationOptions(durationField(h3)!).slice(0, 3), [1, 2, 3]);
  assert.equal(durationOptions(durationField(h3)!).at(-1), 15);
  assert.equal(resolutionLabel("768P"), "HD+ 768p");
  assert.equal(resolutionLabel("1080P"), "FHD 1080p");
  const built = buildInput(h3, newProject("x"), newShot({ modelKey: "h3-max", prompt: "rain" }));
  assert.deepEqual(built.errors, []);
});

test("cost estimates follow model, duration, resolution and audio", () => {
  const before = new Date("2026-10-20");
  const after = new Date("2026-12-01");
  assert.equal(estimate("ltx-free", "video", {}, 2), 0);
  assert.equal(estimate("veo31-fast", "video", { duration: "8s", resolution: "720p", generate_audio: true }, 1)!.toFixed(2), "1.20");
  assert.equal(estimate("veo31-fast", "video", { duration: "4s", resolution: "4k", generate_audio: false }, 2)!.toFixed(2), "2.40");
  assert.equal(estimate("veo31-lite", "video", { duration: "8s", resolution: "1080p" }, 1)!.toFixed(2), "0.64");
  assert.equal(estimate("kling3-pro", "video", { duration: "5", generate_audio: false }, 1)!.toFixed(2), "0.56");
  assert.equal(perSecond("h3-max", { resolution: "1080P" }, before), 0.104);
  assert.equal(perSecond("h3-max", { resolution: "1080P" }, after), 0.16);
  assert.equal(perSecond("flux3-max", { resolution: "720p" }, after), 0.17);
  assert.ok(Math.abs(perSecond("seedance2", { resolution: "720p" })! - 0.3024) < 0.01, "Seedance 720p ≈ $0.30/s");
  assert.equal(estimate("nano-banana-21", "image", { resolution: "1K" }, 3)!.toFixed(2), "0.12");
  assert.equal(estimate("custom", "video", {}, 1), undefined);
  assert.equal(formatUsd(0), "Free");
  assert.equal(formatUsd(0.004), "< $0.01");
  assert.equal(formatUsd(1.2), "≈ $1.20");
});

test("tools: inputs, prices and limits", () => {
  const up = upscaleRun("https://v3.fal.media/a.mp4", "1080p", "p");
  assert.equal(up.endpoint, "fal-ai/bytedance-upscaler/upscale/video");
  assert.deepEqual(up.input, { video_url: "https://v3.fal.media/a.mp4", target_resolution: "1080p", enhancement_preset: "aigc", enhancement_tier: "standard" });
  assert.equal(toolCost("upscale", 8, "4k").toFixed(3), "0.230");
  assert.equal(editRun("u", "make it night").input.prompt, "make it night in @Video1.");
  assert.equal(toolBlocker("edit", { duration: 2, width: 1280, height: 720 }), "Edit works on clips 3–15 seconds long.");
  assert.match(toolBlocker("edit", { duration: 5, width: 704, height: 512 })!, /720p/);
  assert.equal(toolBlocker("edit", { duration: 5, width: 1920, height: 1080 }), undefined);
});

test("an upscaled copy replaces its source in the scene", () => {
  const take = (id: string): Take => ({ id, createdAt: 1, endpoint: "e", modelName: "m", prompt: "p", params: {}, status: "done", videoUrl: "https://x/" + id });
  const p = newProject("x");
  p.shots = [newShot({ id: "s1", takes: [take("a"), take("b")] }), newShot({ id: "s2", replaceTakeId: "a", takes: [take("a4k")] })];
  p.scene = ["a", "b"];
  assert.deepEqual(placeFinishedTake(p, "s2", "a4k").scene, ["a4k", "b"]);
});

test("groups media by day like Flow", () => {
  const now = new Date(2026, 9, 28, 14, 0);
  const at = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();
  const item = (t: number) => ({ shot: newShot(), take: { id: String(t), createdAt: t, endpoint: "", modelName: "", prompt: "", params: {}, status: "done" as const } });
  const groups = groupByDay([item(at(28, 13)), item(at(28, 9)), item(at(27)), item(at(20))], now);
  assert.deepEqual(groups.map((g) => [g.label, g.items.length]), [["Today", 2], ["Yesterday", 1], ["Oct 20", 1]]);
});
