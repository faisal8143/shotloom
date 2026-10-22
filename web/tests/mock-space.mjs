// A stand-in for a Hugging Face Space, so the free path can be exercised
// without spending anyone's GPU quota.
//
//   node tests/mock-space.mjs [port]
//
// It speaks the parts of the Gradio API Shotloom uses: /gradio_api/info,
// /upload, /call/<api> (returns an event id) and the SSE stream that follows.
// Calls it receives are appended to tests/mock/calls.json for assertions.
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const info = readFileSync(here("./fixtures/space-ltx-info.json"), "utf8");

// The two stand-in clips are generated on first run rather than committed.
// VP9, because headless Chromium has no H.264 decoder.
function clip(name, source) {
  const file = here(`./mock/${name}`);
  if (!existsSync(file)) {
    mkdirSync(here("./mock"), { recursive: true });
    try {
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", source,
        "-c:v", "libvpx-vp9", "-b:v", "300k", "-pix_fmt", "yuv420p", file]);
    } catch {
      throw new Error("tests/mock needs ffmpeg once to make its stand-in clips. Install ffmpeg and run again.");
    }
  }
  return readFileSync(file);
}

const clips = {
  "/tmp/gradio/mock/clip.webm": clip("clip.webm", "testsrc=size=704x512:rate=24:duration=2"),
  "/tmp/gradio/mock/clip2.webm": clip("clip2.webm", "color=c=teal:size=704x512:rate=24:duration=2"),
};
const calls = [];
let served = 0;
const jobs = new Map();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const body = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = decodeURIComponent(url.pathname);
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();

  if (path === "/gradio_api/info") {
    return res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(info);
  }

  if (path === "/gradio_api/upload") {
    await body(req);
    return res
      .writeHead(200, { ...cors, "Content-Type": "application/json" })
      .end(JSON.stringify(["/tmp/gradio/mock/frame.jpg"]));
  }

  // the clip itself
  if (path.startsWith("/gradio_api/file=")) {
    const file = path.slice("/gradio_api/file=".length);
    const bytes = clips[file];
    if (!bytes) return res.writeHead(404, cors).end("no such clip");
    return res.writeHead(200, { ...cors, "Content-Type": file.endsWith(".webm") ? "video/webm" : "video/mp4", "Content-Length": bytes.length }).end(bytes);
  }

  const call = /^\/gradio_api\/call\/([\w.-]+)(?:\/([\w-]+))?$/.exec(path);
  if (call) {
    const [, api, eventId] = call;
    if (req.method === "POST") {
      const sent = JSON.parse((await body(req)) || "{}");
      const id = "ev" + (++served);
      jobs.set(id, { api, data: sent.data });
      calls.push({ api, data: sent.data });
      writeFileSync(here("./mock/calls.json"), JSON.stringify(calls, null, 2));
      return res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ event_id: id }));
    }
    const job = jobs.get(eventId);
    if (!job) return res.writeHead(404, cors).end("unknown event");
    res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(`event: estimation\ndata: {"rank": 1}\n\n`);
    setTimeout(() => res.write(`event: generating\ndata: {"msg": "rendering"}\n\n`), 150);
    setTimeout(() => {
      // the second render (Extend) returns a different clip, so the film has two
      const file = served > 1 ? "/tmp/gradio/mock/clip2.webm" : "/tmp/gradio/mock/clip.webm";
      const payload = [{ video: { path: file, url: null }, subtitles: null }, 1234];
      res.write(`event: complete\ndata: ${JSON.stringify(payload)}\n\n`);
      res.end();
    }, 700);
    return;
  }

  res.writeHead(404, cors).end("not found");
});

const port = Number(process.argv[2] || 7860);
server.listen(port, () => console.log(`[mock space] http://127.0.0.1:${port}`));
