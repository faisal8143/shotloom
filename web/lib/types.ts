export type Aspect = "16:9" | "9:16" | "1:1" | "21:9";

export type TakeStatus = "submitting" | "queued" | "running" | "done" | "failed";

export interface Take {
  id: string;
  createdAt: number;
  endpoint: string;
  modelName: string;
  /** final prompt that was sent, after presets and the project look were applied */
  prompt: string;
  params: Record<string, unknown>;
  status: TakeStatus;
  requestId?: string;
  statusUrl?: string;
  responseUrl?: string;
  queuePosition?: number;
  log?: string;
  error?: string;
  videoUrl?: string;
  seed?: number;
  /** seconds, read from the video once it loads */
  duration?: number;
  finishedAt?: number;
  /** moved to the Bin */
  deleted?: boolean;
}

export interface CameraChoice {
  size?: string;
  move?: string;
  lens?: string;
  light?: string;
}

export interface Shot {
  id: string;
  title: string;
  prompt: string;
  modelKey: string;
  customEndpoint?: string;
  /** user overrides, keyed by fal parameter name */
  params: Record<string, unknown>;
  camera: CameraChoice;
  /** data URLs (compressed JPEG) */
  startFrame?: string;
  endFrame?: string;
  references: string[];
  takes: Take[];
  /** legacy: the take a shot contributed to the film before scenes existed */
  selectedTakeId?: string;
  /** set by Extend: a finished take of this generation lands right after that clip in the scene */
  afterTakeId?: string;
}

export interface Character {
  id: string;
  name: string;
  /** compressed JPEG data URL */
  image: string;
}

export interface Project {
  id: string;
  name: string;
  aspect: Aspect;
  /** style text appended to every prompt in the project */
  look: string;
  /** every generation, oldest first; each holds the takes it produced */
  shots: Shot[];
  /** what the composer currently holds */
  draft?: Shot;
  /** take ids, in film order */
  scene?: string[];
  characters?: Character[];
  createdAt: number;
  updatedAt: number;
}

export function uid(prefix = ""): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return prefix + rand;
}
