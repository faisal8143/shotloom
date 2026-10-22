// Streams a generated clip through this site, for the two browser features that
// need same-origin video bytes: grabbing a frame for "Extend" and stitching the
// film. Only fal's own media hosts and Hugging Face Spaces are allowed.

export const dynamic = "force-dynamic";

function allowed(url: URL): boolean {
  // local tests point this at a mock server
  const testOrigin = process.env.SHOTLOOM_TEST_MEDIA_ORIGIN;
  if (testOrigin && url.origin === testOrigin) return true;
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  if (host === "fal.media" || host.endsWith(".fal.media")) return true;
  if (host === "storage.googleapis.com" && url.pathname.startsWith("/falserverless/")) return true;
  // clips rendered by a free Hugging Face Space
  if (host.endsWith(".hf.space")) return true;
  return false;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (!allowed(target)) return new Response("Host not allowed", { status: 403 });

  const upstream = await fetch(target, { redirect: "follow", cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream error ${upstream.status}`, { status: 502 });
  }
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "video/mp4");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(upstream.body, { status: 200, headers });
}
