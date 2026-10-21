import { QUEUE_BASE, HttpError, errorResponse, falFetch, resolveKey } from "@/lib/fal-server";
import { isValidEndpoint } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const key = resolveKey(req);
    const { endpoint, input } = (await req.json()) as { endpoint?: string; input?: Record<string, unknown> };
    if (!endpoint || !isValidEndpoint(endpoint)) throw new HttpError(400, "Invalid model endpoint");
    if (!input || typeof input !== "object") throw new HttpError(400, "Missing input");

    const body = await falFetch(`${QUEUE_BASE}/${endpoint}`, key, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!body?.request_id) throw new HttpError(502, "fal did not return a request id");
    const base = `${QUEUE_BASE}/${endpoint}/requests/${body.request_id}`;
    return Response.json({
      requestId: body.request_id,
      statusUrl: body.status_url ?? `${base}/status`,
      responseUrl: body.response_url ?? base,
      queuePosition: body.queue_position,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
