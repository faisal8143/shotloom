import { assertQueueUrl, errorResponse, falFetch, resolveKey } from "@/lib/fal-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const key = resolveKey(req);
    const { responseUrl } = (await req.json()) as { responseUrl?: string };
    const url = assertQueueUrl(responseUrl).replace(/\/+$/, "") + "/cancel";
    await falFetch(url, key, { method: "PUT" });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
