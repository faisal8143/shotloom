import { assertQueueUrl, errorResponse, falFetch, resolveKey } from "@/lib/fal-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const key = resolveKey(req);
    const { statusUrl } = (await req.json()) as { statusUrl?: string };
    const url = new URL(assertQueueUrl(statusUrl));
    url.searchParams.set("logs", "1");
    const body = await falFetch(url.toString(), key);
    const logs: string[] = Array.isArray(body?.logs)
      ? body.logs.map((l: any) => String(l?.message ?? "")).filter(Boolean)
      : [];
    return Response.json({
      status: body?.status ?? "UNKNOWN",
      queuePosition: body?.queue_position,
      log: logs.slice(-3).join("\n"),
      error: body?.error ?? undefined,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
