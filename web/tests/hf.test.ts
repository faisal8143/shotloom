import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  drainSse,
  findGradioVideo,
  hfAutoSize,
  hfEndpoint,
  isValidSpace,
  parseGradioInfo,
  parseHfEndpoint,
  pickSpaceApi,
  positionalArgs,
  progressLine,
  spaceSlug,
} from "../lib/hf.ts";

const info = JSON.parse(readFileSync(new URL("./fixtures/space-ltx-info.json", import.meta.url), "utf8"));
const SPACE = "Lightricks/ltx-video-distilled";

test("endpoint ids round-trip", () => {
  assert.equal(hfEndpoint(SPACE, "/text_to_video"), "hf:Lightricks/ltx-video-distilled:/text_to_video");
  assert.deepEqual(parseHfEndpoint("hf:Lightricks/ltx-video-distilled:/text_to_video"), {
    space: SPACE,
    api: "/text_to_video",
  });
  assert.deepEqual(parseHfEndpoint("hf:owner/space:"), { space: "owner/space", api: "" });
  assert.equal(parseHfEndpoint("fal-ai/veo3.1/fast"), null);
  assert.equal(parseHfEndpoint("hf:../etc/passwd:/x"), null);
  assert.equal(isValidSpace("owner/space"), true);
  assert.equal(isValidSpace("owner"), false);
  assert.equal(spaceSlug("Lightricks/LTX_Video.Distilled"), "lightricks-ltx-video-distilled");
});

test("picks the endpoint that returns a video", () => {
  assert.equal(pickSpaceApi(info, "text"), "/text_to_video");
  assert.equal(pickSpaceApi(info, "image"), "/image_to_video");
  // /handle_image_upload_for_dims returns a slider value, not a clip
  assert.notEqual(pickSpaceApi(info, ""), "/handle_image_upload_for_dims");
});

test("reads a Space's API into a model schema", () => {
  const schema = parseGradioInfo(info, SPACE, "/text_to_video");
  assert.equal(schema.provider, "hf");
  assert.equal(schema.apiName, "/text_to_video");
  assert.equal(schema.order?.length, 13, "every parameter keeps its position");

  const names = schema.fields.map((f) => f.name);
  assert.ok(!names.includes("mode"), "the task switch is driven by Shotloom, not the user");
  assert.ok(!names.includes("input_video_filepath"));
  assert.equal(schema.fixed?.mode, "text-to-video");

  const prompt = schema.fields.find((f) => f.name === "prompt");
  assert.equal(prompt?.kind, "prompt");
  assert.equal(schema.fields.find((f) => f.name === "negative_prompt")?.kind, "longtext");
  assert.equal(schema.fields.find((f) => f.name === "randomize_seed")?.kind, "boolean");
  assert.equal(schema.fields.find((f) => f.name === "seed_ui")?.kind, "integer");
  assert.equal(schema.fields.find((f) => f.name === "duration_ui")?.core, true);

  const image = schema.fields.find((f) => f.name === "input_image_filepath");
  assert.equal(image?.kind, "image");
  assert.equal(image?.role, "start");
  assert.equal(image?.label, "Input image", "gradio's placeholder label is not shown");
});

test("image endpoints are pinned to image-to-video and need a frame", () => {
  const schema = parseGradioInfo(info, SPACE, "/image_to_video");
  assert.equal(schema.fixed?.mode, "image-to-video");
  assert.equal(schema.fields.find((f) => f.name === "input_image_filepath")?.required, true);
});

test("builds the positional call Gradio expects", () => {
  const schema = parseGradioInfo(info, SPACE, "/text_to_video");
  const args = positionalArgs(schema, { prompt: "a courier in the rain", duration_ui: 4, width_ui: 768 });
  assert.equal(args.length, 13);
  assert.equal(args[0], "a courier in the rain");
  assert.equal(args[1], schema.defaults?.negative_prompt, "untouched parameters keep the Space's default");
  assert.equal(args[5], 768);
  assert.equal(args[6], "text-to-video", "the task switch is forced, not left at the Space's default");
  assert.equal(args[7], 4);
  assert.equal(args[12], true);
});

test("fits the frame to the project's aspect ratio", () => {
  const schema = parseGradioInfo(info, SPACE, "/text_to_video");
  const wide = hfAutoSize(schema, "16:9");
  assert.ok(wide.width_ui > wide.height_ui);
  assert.equal(wide.width_ui % 32, 0);
  assert.equal(wide.height_ui % 32, 0);
  assert.ok(wide.width_ui <= 768 && wide.height_ui >= 256, "stays inside the Space's own slider range");

  const tall = hfAutoSize(schema, "9:16");
  assert.ok(tall.height_ui > tall.width_ui);
});

test("reads the clip out of a finished event", () => {
  const payload = [
    {
      video: {
        path: "/tmp/gradio/abc/output_1.mp4",
        url: "https://lightricks-ltx-video-distilled.hf.space/gradio_api/file=/tmp/gradio/abc/output_1.mp4",
        orig_name: "output_1.mp4",
      },
      subtitles: null,
    },
    1011844879,
  ];
  assert.equal(
    findGradioVideo(payload, "https://x.hf.space"),
    "https://lightricks-ltx-video-distilled.hf.space/gradio_api/file=/tmp/gradio/abc/output_1.mp4",
  );
  // a Space that returns only a path still resolves, against its own origin
  assert.equal(
    findGradioVideo([{ video: { path: "/tmp/gradio/abc/out.mp4" } }], "https://x.hf.space"),
    "https://x.hf.space/gradio_api/file=/tmp/gradio/abc/out.mp4",
  );
  assert.equal(findGradioVideo([{ image: { path: "/tmp/gradio/a.png" } }], "https://x.hf.space"), undefined);
});

test("splits the event stream and keeps partial lines", () => {
  const { events, rest } = drainSse('event: generating\ndata: {"msg": "half way"}\n\nevent: comp');
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "generating");
  assert.equal(progressLine(events[0].data), "half way");
  assert.equal(rest, "event: comp");

  const second = drainSse(rest + "lete\ndata: [1]\n\n");
  assert.equal(second.events[0].event, "complete");
  assert.equal(second.events[0].data, "[1]");
});

test("turns queue updates into one readable line", () => {
  assert.equal(progressLine('{"rank": 2}'), "In the Space's queue, position 3.");
  assert.equal(progressLine("null"), undefined);
  assert.equal(progressLine(""), undefined);
});
