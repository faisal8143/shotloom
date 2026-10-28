// "Enhance prompt": turns a short idea (in any language, Roman Urdu included)
// into a detailed English prompt, using an LLM through fal's OpenRouter endpoint.
import { HttpError, errorResponse, falFetch, resolveKey } from "@/lib/fal-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RUN_BASE = (process.env.FAL_RUN_BASE || "https://fal.run").replace(/\/+$/, "");
const MODEL = process.env.SHOTFLOW_ENHANCE_MODEL || "google/gemini-2.5-flash";

const VIDEO_RULES = `You write prompts for AI video models such as Veo, Seedance and Kling.
Rewrite the user's idea as ONE English prompt of 50-110 words for a single continuous shot.
Cover, in natural sentences: the subject and what it does, the setting and time of day, the camera (shot size and one movement), the lighting and mood, and the sound (ambience, effects, or a short line of dialogue in quotes if people speak).
Keep every detail the user gave and invent nothing that contradicts it. The user may write in Urdu, Roman Urdu or any language: understand it and answer in English.
Use only positive descriptions (say what is there, not what is absent). No lists, no headings, no quotes around the whole prompt, no preamble. Output the prompt only.`;

const IMAGE_RULES = `You write prompts for AI image models such as Nano Banana and FLUX.
Rewrite the user's idea as ONE English prompt of 40-90 words for a single still image: subject, pose or action, setting, composition and lens, lighting, colour palette and style.
Keep every detail the user gave. The user may write in Urdu, Roman Urdu or any language: understand it and answer in English.
No lists, no preamble. Output the prompt only.`;

const WITH_IMAGE = ` The user is also giving the model a start image, so describe what should happen and how the camera moves, rather than re-describing everything in the image.`;

export async function POST(req: Request) {
  try {
    const key = resolveKey(req);
    const { prompt, kind, withImage } = (await req.json()) as { prompt?: string; kind?: string; withImage?: boolean };
    const idea = (prompt ?? "").trim();
    if (!idea) throw new HttpError(400, "Write an idea first, then enhance it.");
    if (idea.length > 4000) throw new HttpError(400, "That prompt is too long to enhance.");
    const system = (kind === "image" ? IMAGE_RULES : VIDEO_RULES) + (withImage && kind !== "image" ? WITH_IMAGE : "");
    const body = await falFetch(`${RUN_BASE}/openrouter/router`, key, {
      method: "POST",
      body: JSON.stringify({ model: MODEL, system_prompt: system, prompt: idea, temperature: 0.7, max_tokens: 400 }),
    });
    const out = String(body?.output ?? "").trim().replace(/^["']|["']$/g, "");
    if (!out) throw new HttpError(502, body?.error ? String(body.error) : "The prompt helper returned nothing. Try again.");
    return Response.json({ prompt: out });
  } catch (err) {
    return errorResponse(err);
  }
}
