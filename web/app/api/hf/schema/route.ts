import { parseGradioInfo, parseHfEndpoint, pickSpaceApi, spaceBase } from "@/lib/hf";

// A Space's API description is public, so no token is needed here.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = parseHfEndpoint(url.searchParams.get("endpoint") ?? "");
  if (!target) {
    return Response.json({ error: "That doesn't look like a Hugging Face Space (use owner/space)." }, { status: 400 });
  }
  const want = url.searchParams.get("mode") === "image" ? "image" : "text";
  const base = spaceBase(target.space, process.env.SHOTLOOM_HF_BASE);
  try {
    const res = await fetch(`${base}/gradio_api/info`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 600 },
    });
    if (res.status === 404) {
      return Response.json({ error: `No running Space called "${target.space}".` }, { status: 404 });
    }
    if (res.status === 503) {
      return Response.json({ error: "That Space is asleep or starting up. Open it once on huggingface.co, then try again." }, { status: 503 });
    }
    if (!res.ok) throw new Error(`the Space answered ${res.status}`);
    const info = await res.json();
    const api = target.api || pickSpaceApi(info, want);
    if (!api) {
      return Response.json({ error: "That Space doesn't expose a video endpoint Shotloom can call." }, { status: 404 });
    }
    const schema = parseGradioInfo(info, target.space, api);
    return Response.json(schema, { headers: { "Cache-Control": "public, max-age=300, s-maxage=1800" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Couldn't read that Space's API (${message}).` }, { status: 502 });
  }
}
