import type { CameraChoice } from "./types";

// Cinematographer vocabulary that video models respond to well.
export const CAMERA = {
  size: {
    label: "Shot",
    options: [
      "extreme wide shot",
      "wide establishing shot",
      "full shot",
      "medium shot",
      "medium close-up",
      "close-up",
      "extreme close-up",
      "over-the-shoulder shot",
      "aerial drone shot",
    ],
  },
  move: {
    label: "Camera",
    options: [
      "locked-off static camera",
      "slow dolly-in",
      "slow dolly-out",
      "tracking shot following the subject",
      "slow pan left to right",
      "handheld documentary camera",
      "crane shot rising up",
      "orbit around the subject",
      "push-in with rack focus",
    ],
  },
  lens: {
    label: "Lens",
    options: [
      "24mm wide lens",
      "35mm lens",
      "50mm lens, natural perspective",
      "85mm portrait lens, shallow depth of field",
      "anamorphic lens with oval bokeh and subtle flares",
      "macro lens",
    ],
  },
  light: {
    label: "Light",
    options: [
      "golden hour sunlight",
      "soft overcast daylight",
      "moody low-key lighting, deep shadows",
      "neon night lighting",
      "candlelight, warm flicker",
      "harsh midday sun",
      "blue hour twilight",
      "volumetric light through haze",
    ],
  },
} as const;

export type CameraKey = keyof typeof CAMERA;

export const LOOKS: { name: string; text: string }[] = [
  { name: "None", text: "" },
  {
    name: "Cinematic film",
    text: "cinematic, shot on 35mm film, subtle film grain, rich contrast, natural color grade",
  },
  {
    name: "Documentary",
    text: "documentary realism, natural light, muted colors, observational framing",
  },
  {
    name: "Teal & orange blockbuster",
    text: "blockbuster teal and orange color grade, high contrast, epic scale",
  },
  {
    name: "Noir",
    text: "film noir, black and white, hard shadows, venetian blind light",
  },
  {
    name: "Ancient epic",
    text: "historical epic, dusty warm palette, torchlight and sunlight, period-accurate detail",
  },
  {
    name: "Soft animation",
    text: "stylized 3D animation, soft lighting, warm pastel palette, expressive characters",
  },
];

/** The prompt that is actually sent: the shot prompt, then camera notes, then the project look. */
export function buildPrompt(prompt: string, camera: CameraChoice, look: string): string {
  const text = prompt.trim();
  const parts: string[] = [text && !/[.!?…"')\]]$/.test(text) ? text + "." : text];
  const cam = [camera.size, camera.move, camera.lens].filter(Boolean).join(", ");
  if (cam) parts.push(cam.charAt(0).toUpperCase() + cam.slice(1) + ".");
  if (camera.light) parts.push("Lighting: " + camera.light + ".");
  if (look.trim()) parts.push("Style: " + look.trim().replace(/\.$/, "") + ".");
  return parts.filter(Boolean).join(" ");
}
