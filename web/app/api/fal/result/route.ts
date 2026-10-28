import { HttpError, assertQueueUrl, errorResponse, falFetch, resolveKey } from "@/lib/fal-server";
import { findMedia } from "@/lib/fal-result";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const key = resolveKey(req);
    const { responseUrl } = (await req.json()) as { responseUrl?: string };
    const body = await falFetch(assertQueueUrl(responseUrl), key);
    const media = findMedia(body);
    if (!media.videoUrl && !media.imageUrl) throw new HttpError(502, "The model finished but returned nothing to show");
    return Response.json({ ...media, seed: typeof body?.seed === "number" ? body.seed : undefined });
  } catch (err) {
    return errorResponse(err);
  }
}
