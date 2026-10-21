// Pure helpers for the film exporter (no browser APIs), kept separate so they can be unit-tested.

export interface ClipInfo {
  vcodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  pix?: string;
  acodec?: string;
  rate?: number;
  layout?: string;
  duration?: number;
}

/** Reads the stream lines ffmpeg prints for `-i file`. Exported for tests. */
export function parseProbe(log: string): ClipInfo {
  const info: ClipInfo = {};
  const dur = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (dur) info.duration = +dur[1] * 3600 + +dur[2] * 60 + parseFloat(dur[3]);
  const v = log.match(/Stream #\S+.*?Video:\s*([a-z0-9_]+)[^\n]*/i);
  if (v) {
    info.vcodec = v[1];
    const line = v[0];
    const size = line.match(/,\s*(\d{2,5})x(\d{2,5})/);
    if (size) {
      info.width = +size[1];
      info.height = +size[2];
    }
    const fps = line.match(/([\d.]+)\s*fps/);
    if (fps) info.fps = parseFloat(fps[1]);
    const pix = line.match(/,\s*(yuv\w+|rgb\w+|nv12)/);
    if (pix) info.pix = pix[1];
  }
  const a = log.match(/Stream #\S+.*?Audio:\s*([a-z0-9_]+)[^\n]*/i);
  if (a) {
    info.acodec = a[1];
    const rate = a[0].match(/(\d+)\s*Hz/);
    if (rate) info.rate = +rate[1];
    const layout = a[0].match(/Hz,\s*([a-z0-9.()]+)/i);
    if (layout) info.layout = layout[1];
  }
  return info;
}

export function signature(c: ClipInfo): string {
  return [c.vcodec, c.width, c.height, c.fps, c.pix, c.acodec ?? "none", c.rate, c.layout].join("|");
}

export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** ffmpeg arguments that bring one clip to the common format. Exported for tests. */
export function normalizeArgs(
  input: string,
  output: string,
  target: { width: number; height: number; fps: number },
  audio: "keep" | "silence" | "none",
  duration: number,
): string[] {
  const { width: W, height: H, fps } = target;
  const vf =
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v]`;
  const args = ["-i", input];
  if (audio === "silence") {
    args.push("-f", "lavfi", "-t", String(Math.max(0.1, duration)), "-i", "anullsrc=r=44100:cl=stereo");
  }
  args.push("-filter_complex", vf, "-map", "[v]");
  if (audio === "keep") args.push("-map", "0:a:0");
  if (audio === "silence") args.push("-map", "1:a:0", "-shortest");
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "20");
  if (audio === "none") args.push("-an");
  else args.push("-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2");
  args.push("-movflags", "+faststart", output);
  return args;
}
