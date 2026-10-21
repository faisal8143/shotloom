// Server-side helpers shared by the /api/fal/* routes.
import { timingSafeEqual } from "node:crypto";

export const QUEUE_BASE = (process.env.FAL_QUEUE_BASE || "https://queue.fal.run").replace(/\/+$/, "");
export const SCHEMA_URL =
  process.env.FAL_SCHEMA_URL || "https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The fal key for this request: the visitor's own key (BYOK), or the
 * deployment's FAL_KEY when the visitor knows SHOTLOOM_PASSWORD.
 */
export function resolveKey(req: Request): string {
  const own = req.headers.get("x-fal-key")?.trim();
  if (own) return own;
  const serverKey = process.env.FAL_KEY?.trim();
  const password = process.env.SHOTLOOM_PASSWORD;
  if (serverKey && password) {
    const given = req.headers.get("x-shotloom-pass") ?? "";
    if (given && safeEqual(given, password)) return serverKey;
    throw new HttpError(401, "Wrong studio password. Check Settings.");
  }
  throw new HttpError(401, "Add your fal.ai API key in Settings first.");
}

export function serverKeyAvailable(): boolean {
  return Boolean(process.env.FAL_KEY?.trim() && process.env.SHOTLOOM_PASSWORD);
}

/** Only follow status/result URLs that point back at fal's queue. */
export function assertQueueUrl(url: unknown): string {
  if (typeof url !== "string") throw new HttpError(400, "Missing URL");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, "Bad URL");
  }
  const base = new URL(QUEUE_BASE);
  if (parsed.origin !== base.origin || !parsed.pathname.includes("/requests/")) {
    throw new HttpError(400, "URL is not a fal queue request");
  }
  return parsed.toString();
}

/** fal error bodies come in a few shapes; turn them into one readable line. */
export function falErrorMessage(status: number, body: unknown): string {
  const b = body as any;
  let detail: unknown = b?.detail ?? b?.error ?? b?.message ?? b;
  if (Array.isArray(detail)) {
    detail = detail
      .map((d: any) => {
        const where = Array.isArray(d?.loc) ? d.loc.filter((x: unknown) => x !== "body").join(".") : "";
        return (where ? where + ": " : "") + (d?.msg ?? JSON.stringify(d));
      })
      .join("; ");
  } else if (detail && typeof detail === "object") {
    detail = JSON.stringify(detail);
  }
  const text = String(detail ?? "").slice(0, 600) || "no details";
  if (status === 401 || status === 403) return `fal rejected the key (${status}): ${text}`;
  if (status === 402) return `Not enough fal credits: ${text}`;
  return `fal error ${status}: ${text}`;
}

export async function falFetch(url: string, key: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Key ${key}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* keep text */
  }
  if (!res.ok) throw new HttpError(res.status, falErrorMessage(res.status, body));
  return body;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    // pass fal's own status through, except auth problems with *our* routes stay 4xx
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    return Response.json({ error: err.message }, { status });
  }
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: "Server error: " + message }, { status: 500 });
}
