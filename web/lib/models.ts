// The model catalog. Two kinds of entry:
//
//   free - a Hugging Face Space running open weights. No card, no fal key; it
//          spends the daily ZeroGPU quota of whoever is using the studio.
//   fal  - a hosted model on fal.ai, billed per second to the visitor's own key.
//
// fal endpoint IDs were checked against fal's docs in October 2026, Space IDs in
// October 2026 too. Any other fal model or Space can be used through the two
// "Custom" entries - the studio reads parameters from the model's own schema
// either way (fal's OpenAPI document, or a Space's /gradio_api/info).
import { HF_PREFIX, hfEndpoint, isHfEndpoint } from "./hf.ts";

export type Mode = "text" | "image" | "reference";

export interface ModelDef {
  key: string;
  name: string;
  maker: string;
  blurb: string;
  /** rough guide only; fal's model page has the real, current price */
  price?: string;
  endpoints: Partial<Record<Mode, string>>;
  /** start-frame field name, used only if the schema can't be loaded */
  imageField?: string;
  /** runs on a free Hugging Face Space rather than on fal */
  free?: boolean;
}

export type Provider = "fal" | "hf";

export function providerOf(endpoint: string | undefined): Provider {
  return endpoint && isHfEndpoint(endpoint) ? "hf" : "fal";
}

export const MODELS: ModelDef[] = [
  {
    key: "ltx-free",
    name: "LTX Video (free)",
    maker: "Lightricks · Hugging Face",
    blurb:
      "Open weights running on a free Hugging Face Space. No key and no card - it uses your daily Hugging Face GPU quota instead (about 5 minutes a day signed in, 2 signed out).",
    price: "Free",
    free: true,
    endpoints: {
      text: hfEndpoint("Lightricks/ltx-video-distilled", "/text_to_video"),
      image: hfEndpoint("Lightricks/ltx-video-distilled", "/image_to_video"),
    },
    imageField: "input_image_filepath",
  },
  {
    key: "ltx-free-alt",
    name: "LTX Video (free, mirror)",
    maker: "DeepRat · Hugging Face",
    blurb: "Same model on a second Space. Use it when the first one is busy or out of quota.",
    price: "Free",
    free: true,
    endpoints: {
      text: hfEndpoint("DeepRat/LTX-Video-ZeroGPU-Optimized", "/text_to_video"),
      image: hfEndpoint("DeepRat/LTX-Video-ZeroGPU-Optimized", "/image_to_video"),
    },
    imageField: "input_image_filepath",
  },
  {
    key: "veo31-lite",
    name: "Veo 3.1 Lite · Lower Priority",
    maker: "Google",
    blurb: "Flow's economy Veo tier: cheapest Veo, may wait longer in the queue. Native audio, 4–8 s.",
    price: "≈ $0.03/s, $0.05/s with audio (720p)",
    endpoints: { text: "fal-ai/veo3.1/lite", image: "fal-ai/veo3.1/lite/image-to-video" },
    imageField: "image_url",
  },
  {
    key: "veo31-fast",
    name: "Veo 3.1 Fast",
    maker: "Google",
    blurb: "The model behind Google Flow, faster and cheaper. Native audio.",
    price: "≈ $0.10/s, $0.15/s with audio",
    endpoints: { text: "fal-ai/veo3.1/fast", image: "fal-ai/veo3.1/fast/image-to-video" },
    imageField: "image_url",
  },
  {
    key: "veo31",
    name: "Veo 3.1",
    maker: "Google",
    blurb: "Flagship Veo. Best prompt-following and dialogue; ingredients mode keeps characters consistent.",
    price: "≈ $0.40/s with audio",
    endpoints: {
      text: "fal-ai/veo3.1",
      image: "fal-ai/veo3.1/image-to-video",
      reference: "fal-ai/veo3.1/reference-to-video",
    },
    imageField: "image_url",
  },
  {
    key: "seedance2",
    name: "Seedance 2.0",
    maker: "ByteDance",
    blurb: "Cinematic motion, start + end frame control, synced audio, up to 15 s.",
    price: "≈ $0.30/s at 720p",
    endpoints: { text: "bytedance/seedance-2.0/text-to-video", image: "bytedance/seedance-2.0/image-to-video" },
    imageField: "image_url",
  },
  {
    key: "seedance2-mini",
    name: "Seedance 2.0 Mini",
    maker: "ByteDance",
    blurb: "Faster, cheaper Seedance 2.0 - good for drafts.",
    endpoints: {
      text: "bytedance/seedance-2.0/mini/text-to-video",
      image: "bytedance/seedance-2.0/mini/image-to-video",
    },
    imageField: "image_url",
  },
  {
    key: "kling3-pro",
    name: "Kling 3.0 Pro",
    maker: "Kuaishou",
    blurb: "Fluid, physical motion and multi-shot scenes with native audio.",
    price: "≈ $0.11/s, $0.17/s with audio",
    endpoints: {
      text: "fal-ai/kling-video/v3/pro/text-to-video",
      image: "fal-ai/kling-video/v3/pro/image-to-video",
    },
    imageField: "start_image_url",
  },
  {
    key: "flux3-max",
    name: "FLUX 3 Max",
    maker: "Black Forest Labs",
    blurb: "New (Oct 2026). Strong prompt adherence, low latency, start + end frame, 5–20 s, native audio.",
    endpoints: {
      text: "blackforestlabs/flux-3-max/text-to-video",
      image: "blackforestlabs/flux-3-max/image-to-video",
    },
    imageField: "image_url",
  },
  {
    key: "flux3-draft",
    name: "FLUX 3 Draft",
    maker: "Black Forest Labs",
    blurb: "Fast 720p previews for blocking out shots before paying for a final render.",
    price: "≈ $0.06/s at 720p",
    endpoints: {
      text: "blackforestlabs/flux-3/text-to-video/draft",
      image: "blackforestlabs/flux-3/image-to-video/draft",
    },
    imageField: "image_url",
  },
  {
    key: "ltx2-fast",
    name: "LTX-2 Fast",
    maker: "Lightricks (open weights)",
    blurb: "Cheapest way to test ideas. Text-to-video only here.",
    price: "≈ $0.04/s at 1080p",
    endpoints: { text: "fal-ai/ltx-2/text-to-video/fast" },
  },
];

export const CUSTOM_KEY = "custom";
export const SPACE_KEY = "custom-space";

export function findModel(key: string): ModelDef | undefined {
  return MODELS.find((m) => m.key === key);
}

/** Which endpoint a shot should use, given what the shot has. */
export function pickEndpoint(
  model: ModelDef,
  has: { start: boolean; references: boolean },
): { mode: Mode; endpoint: string } | { error: string } {
  if (has.references && model.endpoints.reference) return { mode: "reference", endpoint: model.endpoints.reference };
  if (has.start) {
    if (model.endpoints.image) return { mode: "image", endpoint: model.endpoints.image };
    return { error: `${model.name} can't start from a frame here. Remove the start frame or pick another model.` };
  }
  if (model.endpoints.text) return { mode: "text", endpoint: model.endpoints.text };
  if (model.endpoints.reference && has.references) return { mode: "reference", endpoint: model.endpoints.reference };
  return { error: `${model.name} needs a start frame.` };
}

export { HF_PREFIX };

const ENDPOINT_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){1,6}$/i;

export function isValidEndpoint(id: string): boolean {
  return ENDPOINT_RE.test(id) && !id.includes("..") && id.length <= 200;
}
