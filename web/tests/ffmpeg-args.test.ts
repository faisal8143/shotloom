import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeArgs, parseProbe, signature } from "../lib/ffmpeg-args.ts";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("parses ffmpeg's stream description", () => {
  const log = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'in0.mp4':
  Duration: 00:00:08.04, start: 0.000000, bitrate: 2215 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 2082 kb/s, 24 fps, 24 tbr, 12288 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)`;
  assert.deepEqual(parseProbe(log), {
    duration: 8.04,
    vcodec: "h264",
    width: 1280,
    height: 720,
    fps: 24,
    pix: "yuv420p",
    acodec: "aac",
    rate: 48000,
    layout: "stereo",
  });
  assert.equal(parseProbe("  Stream #0:0: Video: vp9, yuv420p(tv), 640x360, 30 fps").acodec, undefined);
});

test("normalizes mixed clips and joins them (runs real ffmpeg)", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "shotloom-"));
  try {
    const run = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: dir });
    const probe = (f: string) =>
      parseProbe(spawnSync("ffmpeg", ["-hide_banner", "-i", f], { cwd: dir, encoding: "utf8" }).stderr);
    // a 720p clip with sound, and a 1080p 30fps clip without sound
    run(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24:duration=2", "-f", "lavfi", "-i", "sine=f=440:d=2", "-c:v", "libx264", "-c:a", "aac", "-shortest", "a.mp4"]);
    run(["-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=1.5", "-c:v", "libx264", "b.mp4"]);
    const a = probe("a.mp4");
    const b = probe("b.mp4");
    assert.notEqual(signature(a), signature(b));
    const target = { width: a.width!, height: a.height!, fps: a.fps! };
    run(normalizeArgs("a.mp4", "n0.mp4", target, "keep", a.duration!));
    run(normalizeArgs("b.mp4", "n1.mp4", target, "silence", b.duration!));
    assert.equal(signature(probe("n0.mp4")), signature(probe("n1.mp4")));
    writeFileSync(join(dir, "list.txt"), "file 'n0.mp4'\nfile 'n1.mp4'\n");
    run(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "-movflags", "+faststart", "film.mp4"]);
    const film = probe("film.mp4");
    assert.equal(film.width, 1280);
    assert.equal(film.acodec, "aac");
    assert.ok(Math.abs(film.duration! - 3.5) < 0.25, `duration ${film.duration}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
