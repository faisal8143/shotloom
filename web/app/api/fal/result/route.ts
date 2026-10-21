import { HttpError, assertQueueUrl, errorResponse, falFetch, resolveKey } from "@/lib/fal-server";

export const dynamic = "force-dynamic";

/** Finds the generated video in a fal result, whatever the model calls it. */
function findVideo(data: any, depth = 0): string | undefined {
  if (!data || typeof data !== "object" || depth > 4) return undefined;
  for (const k of ["video", "videos", "output"]) {
    const v = data[k];
    const first = Array.isArray(v) ? v[0] : v;
    if (typeof first === "string" && /^https?:\/\//.test(first)) return first;
    if (first && typeof first.url === "string") return first.url;
  }
  if (typeof data.url === "string" && (/video/.test(String(data.content_type)) || /\.(mp4|webm|mov)(\?|$)/.test(data.url))) {
    return data.url;
  }
  for (const v of Object.values(data)) {
    const found = findVideo(v, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export async function POST(req: Request) {
  try {
    const key = resolveKey(req);
    const { responseUrl } = (await req.json()) as { responseUrl?: string };
    const body = await falFetch(assertQueueUrl(responseUrl), key);
    const videoUrl = findVideo(body);
    if (!videoUrl) throw new HttpError(502, "The model finished but returned no video");
    return Response.json({ videoUrl, seed: typeof body?.seed === "number" ? body.seed : undefined });
  } catch (err) {
    return errorResponse(err);
  }
}
