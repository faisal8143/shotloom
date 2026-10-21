"use client";

/** Reads an image file and returns a compressed JPEG data URL (long side <= maxSide). */
export async function compressImage(file: Blob, maxSide = 1600, quality = 0.88): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file isn't an image the browser can read."));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(2, Math.round(img.naturalWidth * scale));
    const h = Math.max(2, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fetches a generated clip as a Blob: directly if CORS allows, otherwise through /api/media. */
export async function fetchVideoBlob(url: string): Promise<Blob> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (res.ok) return await res.blob();
  } catch {
    /* fall through to the proxy */
  }
  const res = await fetch("/api/media?url=" + encodeURIComponent(url));
  if (!res.ok) throw new Error(`Couldn't download the clip (${res.status}). It may have expired on fal.`);
  return await res.blob();
}

/**
 * Grabs one frame of a clip as a JPEG data URL.
 * `at` is seconds, or "last" for the final frame (used by Extend).
 */
export async function grabFrame(videoUrl: string, at: number | "last"): Promise<string> {
  const blob = await fetchVideoBlob(videoUrl);
  const src = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("The browser couldn't decode this clip."));
    });
    const target = at === "last" ? Math.max(0, video.duration - 0.04) : Math.min(at, video.duration - 0.04);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = Math.max(0, target);
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    URL.revokeObjectURL(src);
  }
}

export function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Downloads a remote clip with a proper filename (cross-origin links ignore `download`). */
export async function downloadClip(url: string, filename: string) {
  const blob = await fetchVideoBlob(url);
  const href = URL.createObjectURL(blob);
  downloadUrl(href, filename);
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "shot"
  );
}
