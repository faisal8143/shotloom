// Finds the generated media in a fal result, whatever the model calls it.

type Json = any;

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|$)/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i;

function urlOf(v: Json): string | undefined {
  if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  if (v && typeof v === "object" && typeof v.url === "string") return v.url;
  return undefined;
}

export function findVideo(data: Json, depth = 0): string | undefined {
  if (!data || typeof data !== "object" || depth > 4) return undefined;
  for (const k of ["video", "videos", "output"]) {
    const v = data[k];
    const url = urlOf(Array.isArray(v) ? v[0] : v);
    if (url && !IMAGE_EXT.test(url)) return url;
  }
  if (typeof data.url === "string" && (/video/.test(String(data.content_type)) || VIDEO_EXT.test(data.url))) return data.url;
  for (const [k, v] of Object.entries(data)) {
    if (/image/i.test(k)) continue;
    const found = findVideo(v, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function findImage(data: Json, depth = 0): string | undefined {
  if (!data || typeof data !== "object" || depth > 4) return undefined;
  for (const k of ["images", "image", "output"]) {
    const v = data[k];
    const url = urlOf(Array.isArray(v) ? v[0] : v);
    if (url && !VIDEO_EXT.test(url)) return url;
  }
  if (typeof data.url === "string" && (/image/.test(String(data.content_type)) || IMAGE_EXT.test(data.url))) return data.url;
  for (const v of Object.values(data)) {
    const found = findImage(v, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** Video wins when a result holds both (e.g. a clip and its poster frame). */
export function findMedia(data: Json): { videoUrl?: string; imageUrl?: string } {
  const videoUrl = findVideo(data);
  if (videoUrl) return { videoUrl };
  const imageUrl = findImage(data);
  return imageUrl ? { imageUrl } : {};
}
