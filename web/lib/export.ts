"use client";
// Stitches the chosen takes into one MP4, entirely in the browser (ffmpeg.wasm).
import { fetchVideoBlob } from "./media";
import { type ClipInfo, even, normalizeArgs, parseProbe, signature } from "./ffmpeg-args";

declare global {
  interface Window {
    FFmpegWASM?: { FFmpeg: new () => FFmpegLike };
  }
}

interface FFmpegLike {
  load(opts: { coreURL: string; wasmURL: string }): Promise<boolean>;
  exec(args: string[]): Promise<number>;
  writeFile(path: string, data: Uint8Array | string): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array | string>;
  deleteFile(path: string): Promise<boolean>;
  on(event: "log", cb: (e: { message: string }) => void): void;
  on(event: "progress", cb: (e: { progress: number }) => void): void;
  off(event: "log" | "progress", cb: (...a: any[]) => void): void;
  terminate(): void;
}

export interface ExportProgress {
  stage: string;
  /** 0..1 */
  value: number;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing && window.FFmpegWASM) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load the video exporter (" + src + ")."));
    document.head.appendChild(s);
  });
}

async function createFFmpeg(): Promise<FFmpegLike> {
  if (!window.FFmpegWASM) await loadScript("/ffmpeg/ffmpeg.js");
  if (!window.FFmpegWASM) throw new Error("Video exporter failed to start.");
  const ff = new window.FFmpegWASM.FFmpeg();
  const base = location.origin + "/ffmpeg/";
  await ff.load({ coreURL: base + "ffmpeg-core.js", wasmURL: base + "ffmpeg-core.wasm" });
  return ff;
}

export async function exportFilm(
  clipUrls: string[],
  onProgress: (p: ExportProgress) => void,
): Promise<{ blob: Blob; warning?: string }> {
  if (!clipUrls.length) throw new Error("Pick a take for at least one shot first.");
  onProgress({ stage: "Loading the exporter (first time ~30 MB)…", value: 0 });
  const ff = await createFFmpeg();
  let logBuffer = "";
  const onLog = (e: { message: string }) => {
    logBuffer += e.message + "\n";
  };
  ff.on("log", onLog);

  try {
    const n = clipUrls.length;
    const infos: ClipInfo[] = [];
    for (let i = 0; i < n; i++) {
      onProgress({ stage: `Downloading clip ${i + 1} of ${n}…`, value: (i / n) * 0.3 });
      const blob = await fetchVideoBlob(clipUrls[i]);
      await ff.writeFile(`in${i}.mp4`, new Uint8Array(await blob.arrayBuffer()));
      logBuffer = "";
      await ff.exec(["-hide_banner", "-i", `in${i}.mp4`]); // exits non-zero by design; we only want the log
      infos.push(parseProbe(logBuffer));
    }

    const sameFormat = infos.every((c) => c.vcodec && signature(c) === signature(infos[0]));
    let files = infos.map((_, i) => `in${i}.mp4`);
    let warning: string | undefined;

    if (!sameFormat) {
      const first = infos.find((c) => c.width && c.height) ?? {};
      const target = {
        width: even(first.width ?? 1280),
        height: even(first.height ?? 720),
        fps: Math.round(first.fps && first.fps <= 60 ? first.fps : 30),
      };
      const anyAudio = infos.some((c) => c.acodec);
      const normalizeAll = async (withAudio: boolean) => {
        const out: string[] = [];
        for (let i = 0; i < n; i++) {
          const mode = !withAudio || !anyAudio ? "none" : infos[i].acodec ? "keep" : "silence";
          const onP = (e: { progress: number }) =>
            onProgress({
              stage: `Matching clip ${i + 1} of ${n} to one format…`,
              value: 0.3 + ((i + Math.min(1, Math.max(0, e.progress))) / n) * 0.6,
            });
          ff.on("progress", onP);
          logBuffer = "";
          const code = await ff.exec(normalizeArgs(`in${i}.mp4`, `n${i}.mp4`, target, mode, infos[i].duration ?? 8));
          ff.off("progress", onP);
          if (code !== 0) throw new Error(logBuffer.split("\n").filter(Boolean).slice(-3).join(" "));
          out.push(`n${i}.mp4`);
        }
        return out;
      };
      try {
        files = await normalizeAll(true);
      } catch (err) {
        if (!anyAudio) throw err;
        warning = "Some clips had no sound and silence couldn't be added, so the film was exported without audio.";
        files = await normalizeAll(false);
      }
    }

    onProgress({ stage: "Joining the shots…", value: 0.92 });
    await ff.writeFile("list.txt", files.map((f) => `file '${f}'`).join("\n"));
    logBuffer = "";
    const code = await ff.exec(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "-movflags", "+faststart", "film.mp4"]);
    if (code !== 0) throw new Error("Joining failed: " + logBuffer.split("\n").filter(Boolean).slice(-2).join(" "));
    const data = await ff.readFile("film.mp4");
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    onProgress({ stage: "Done", value: 1 });
    return { blob: new Blob([bytes as BlobPart], { type: "video/mp4" }), warning };
  } finally {
    ff.off("log", onLog);
    ff.terminate();
  }
}
