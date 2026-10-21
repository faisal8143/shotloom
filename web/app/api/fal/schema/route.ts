import { SCHEMA_URL } from "@/lib/fal-server";
import { isValidEndpoint } from "@/lib/models";
import { parseOpenApi } from "@/lib/schema";

// Public data, no key needed. Cached for an hour per endpoint.
export async function GET(req: Request) {
  const endpoint = new URL(req.url).searchParams.get("endpoint") ?? "";
  if (!isValidEndpoint(endpoint)) {
    return Response.json({ error: "Invalid model endpoint" }, { status: 400 });
  }
  try {
    const res = await fetch(SCHEMA_URL + encodeURIComponent(endpoint), {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (res.status === 404) {
      return Response.json({ error: `fal has no model called "${endpoint}"` }, { status: 404 });
    }
    if (!res.ok) throw new Error(`schema request failed (${res.status})`);
    const schema = parseOpenApi(await res.json(), endpoint);
    return Response.json(schema, { headers: { "Cache-Control": "public, max-age=600, s-maxage=3600" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}
