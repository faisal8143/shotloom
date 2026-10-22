"use client";
// Calls a Hugging Face Space straight from the browser.
//
// This path deliberately does NOT go through our own server: a Space can take
// minutes to render and holds the connection open the whole time, which a
// serverless function on a free plan would cut off. The browser can wait.
import { credentials } from "./client-api";
import { drainSse, findGradioVideo, parseHfEndpoint, positionalArgs, progressLine, spaceBase } from "./hf";
import type { ModelSchema } from "./schema";
import type { TakeRef, TakeUpdater } from "./runner";

const BASE_OVERRIDE = process.env.NEXT_PUBLIC_SHOTLOOM_HF_BASE || "";

const running = new Map<string, AbortController>();

export function cancelHfTake(takeId: string): boolean {
  const c = running.get(takeId);
  if (!c) return false;
  c.abort();
  running.delete(takeId);
  return true;
}

function authHeaders(): Record<string, string> {
  const token = credentials.hfToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",", 2);
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const bytes = atob(body);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
  return new Blob([out], { type: mime });
}

/** Sends one image to the Space's file store and returns the handle it expects. */
async function uploadImage(base: string, dataUrl: string): Promise<unknown> {
  const form = new FormData();
  const blob = dataUrlToBlob(dataUrl);
  form.append("files", blob, "frame.jpg");
  const res = await fetch(`${base}/gradio_api/upload`, { method: "POST", body: form, headers: authHeaders() });
  if (!res.ok) throw new Error(`The Space refused the image (${res.status}).`);
  const paths = (await res.json()) as string[];
  if (!Array.isArray(paths) || !paths[0]) throw new Error("The Space didn't accept the image.");
  return { path: paths[0], meta: { _type: "gradio.FileData" } };
}

function quotaMessage(status: number, body: string): string {
  const text = body.slice(0, 300);
  if (status === 429 || /quota|exceeded/i.test(text)) {
    return credentials.hfToken
      ? "Your Hugging Face GPU quota is used up for today. It resets 24 hours after your first render."
      : "The free GPU quota for this browser is used up. Add a Hugging Face token in Settings for a bigger daily allowance, or wait for the reset.";
  }
  if (status === 401 || status === 403) return `Hugging Face rejected the token (${status}). ${text}`;
  if (status === 503) return "That Space is asleep or starting up. Open it once on huggingface.co, then try again.";
  return `The Space answered ${status}. ${text}`;
}

/** Sends a take to a Space and follows its event stream until the clip is ready. */
export async function runHfTake(
  ref: TakeRef,
  schema: ModelSchema,
  input: Record<string, unknown>,
  update: TakeUpdater,
) {
  const target = parseHfEndpoint(schema.endpoint);
  const api = schema.apiName ?? target?.api;
  if (!target || !api) {
    update(ref, { status: "failed", error: "This free model is misconfigured.", finishedAt: Date.now() });
    return;
  }
  const base = spaceBase(target.space, BASE_OVERRIDE);
  const controller = new AbortController();
  running.set(ref.takeId, controller);

  try {
    // images have to live on the Space before they can be passed to it
    const prepared: Record<string, unknown> = { ...input };
    for (const field of schema.fields) {
      const value = prepared[field.name];
      if (field.kind === "image" && typeof value === "string" && value.startsWith("data:")) {
        update(ref, { status: "submitting", log: "Sending the start frame…" });
        prepared[field.name] = await uploadImage(base, value);
      }
    }

    const body = JSON.stringify({ data: positionalArgs(schema, prepared) });
    const path = `${base}/gradio_api/call${api}`;
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(quotaMessage(res.status, text));
    let eventId = "";
    try {
      eventId = JSON.parse(text).event_id ?? "";
    } catch {
      /* handled below */
    }
    if (!eventId) throw new Error("The Space didn't start the job.");

    update(ref, { status: "queued", requestId: eventId, log: "Waiting for a free GPU on the Space…" });

    const stream = await fetch(`${path}/${eventId}`, { headers: authHeaders(), signal: controller.signal });
    if (!stream.ok || !stream.body) throw new Error(quotaMessage(stream.status, await stream.text().catch(() => "")));

    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = drainSse(buffer);
      buffer = rest;
      for (const ev of events) {
        if (ev.event === "complete") {
          let payload: unknown;
          try {
            payload = JSON.parse(ev.data);
          } catch {
            payload = ev.data;
          }
          const videoUrl = findGradioVideo(payload, base);
          if (!videoUrl) throw new Error("The Space finished but returned no video.");
          const seed = Array.isArray(payload) ? payload.find((v) => typeof v === "number") : undefined;
          update(ref, {
            status: "done",
            videoUrl,
            seed: typeof seed === "number" ? seed : undefined,
            log: undefined,
            finishedAt: Date.now(),
          });
          return;
        }
        if (ev.event === "error") {
          throw new Error(
            progressLine(ev.data) ??
              "The Space stopped without a message - usually its free GPU quota, or the Space restarting.",
          );
        }
        if (ev.event === "generating" || ev.event === "heartbeat" || ev.event === "estimation") {
          update(ref, { status: "running", log: progressLine(ev.data) });
        }
      }
    }
    throw new Error("The Space closed the connection before the video was ready.");
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    update(ref, {
      status: "failed",
      error: aborted ? "Cancelled." : err instanceof Error ? err.message : String(err),
      finishedAt: Date.now(),
    });
  } finally {
    running.delete(ref.takeId);
  }
}
