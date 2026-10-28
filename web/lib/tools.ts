// Things you can do to a finished clip, each one a fal model:
//   upscale - ByteDance Video Upscaler, to FHD 1080p / 2K / 4K (Flow's "high-resolution export")
//   sound   - MMAudio v2, adds sound effects and ambience to a silent clip
//   edit    - Kling O3 Edit, changes a clip with words (outfit, background, style...)
// Endpoint IDs and prices checked against fal's docs, October 2026.

export type ToolId = "upscale" | "sound" | "edit";
export type UpscaleTarget = "1080p" | "2k" | "4k";

export const TOOL_ENDPOINTS: Record<ToolId, string> = {
  upscale: "fal-ai/bytedance-upscaler/upscale/video",
  sound: "fal-ai/mmaudio-v2",
  edit: "fal-ai/kling-video/o3/pro/video-to-video/edit",
};

export const UPSCALE_LABEL: Record<UpscaleTarget, string> = { "1080p": "FHD 1080p", "2k": "2K", "4k": "4K" };
const UPSCALE_RATE: Record<UpscaleTarget, number> = { "1080p": 0.0072, "2k": 0.0144, "4k": 0.0288 };

export interface ToolRun {
  endpoint: string;
  input: Record<string, unknown>;
  /** shown as the take's model name */
  label: string;
  /** shown as the take's prompt */
  prompt: string;
}

export function upscaleRun(videoUrl: string, target: UpscaleTarget, sourcePrompt: string): ToolRun {
  return {
    endpoint: TOOL_ENDPOINTS.upscale,
    input: { video_url: videoUrl, target_resolution: target, enhancement_preset: "aigc", enhancement_tier: "standard" },
    label: `Upscaled · ${UPSCALE_LABEL[target]}`,
    prompt: sourcePrompt,
  };
}

export function soundRun(videoUrl: string, soundPrompt: string, duration: number | undefined): ToolRun {
  return {
    endpoint: TOOL_ENDPOINTS.sound,
    input: {
      video_url: videoUrl,
      prompt: soundPrompt,
      ...(duration ? { duration: Math.min(30, Math.max(1, Math.round(duration * 10) / 10)) } : {}),
    },
    label: "Sound added · MMAudio",
    prompt: soundPrompt,
  };
}

export function editRun(videoUrl: string, instruction: string): ToolRun {
  const text = /@video1/i.test(instruction) ? instruction : `${instruction.trim().replace(/\.$/, "")} in @Video1.`;
  return {
    endpoint: TOOL_ENDPOINTS.edit,
    input: { video_url: videoUrl, prompt: text, keep_audio: true },
    label: "Edited · Kling O3",
    prompt: instruction,
  };
}

export function toolCost(tool: ToolId, duration: number | undefined, target: UpscaleTarget = "1080p"): number {
  const d = duration ?? 8;
  if (tool === "upscale") return UPSCALE_RATE[target] * d;
  if (tool === "sound") return 0.001 * d;
  return 0.168 * d;
}

/** Why a tool can't run on this clip, if it can't. */
export function toolBlocker(tool: ToolId, clip: { duration?: number; width?: number; height?: number }): string | undefined {
  if (tool === "edit") {
    if (clip.duration !== undefined && (clip.duration < 3 || clip.duration > 15)) return "Edit works on clips 3–15 seconds long.";
    const short = Math.min(clip.width ?? 9999, clip.height ?? 9999);
    if (short < 720) return "Edit needs a clip of at least 720p. Upscale it to FHD first.";
  }
  return undefined;
}
