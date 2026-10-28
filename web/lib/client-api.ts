"use client";
import { isHfEndpoint } from "./hf";
import type { ModelSchema } from "./schema";

const KEY_STORE = "shotloom.falKey";
const PASS_STORE = "shotloom.studioPass";
const HF_STORE = "shotloom.hfToken";

function read(name: string): string {
  try {
    return localStorage.getItem(name) ?? "";
  } catch {
    return "";
  }
}
function write(name: string, value: string) {
  try {
    if (value) localStorage.setItem(name, value);
    else localStorage.removeItem(name);
  } catch {
    /* private mode: keep in memory only */
  }
}

let memoryKey = "";
let memoryPass = "";
let memoryHf = "";

export const credentials = {
  get key() {
    return memoryKey || read(KEY_STORE);
  },
  get pass() {
    return memoryPass || read(PASS_STORE);
  },
  /** optional: a Hugging Face token, for a bigger free daily GPU allowance */
  get hfToken() {
    return memoryHf || read(HF_STORE);
  },
  save(key: string, pass: string, hfToken = memoryHf || read(HF_STORE)) {
    memoryKey = key.trim();
    memoryPass = pass;
    memoryHf = hfToken.trim();
    write(KEY_STORE, memoryKey);
    write(PASS_STORE, memoryPass);
    write(HF_STORE, memoryHf);
  },
  /** ready to use the paid fal models */
  get ready() {
    return Boolean(this.key || this.pass);
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (credentials.key) headers["x-fal-key"] = credentials.key;
  else if (credentials.pass) headers["x-shotloom-pass"] = credentials.pass;
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Network problem - check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      res.status === 413
        ? "Images are too large to send. Use fewer or smaller reference images."
        : (data as any).error || `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export interface SubmitResult {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  queuePosition?: number;
}
export interface StatusResult {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | string;
  queuePosition?: number;
  log?: string;
  error?: string;
}

export const api = {
  submit: (endpoint: string, input: Record<string, unknown>) =>
    call<SubmitResult>("/api/fal/submit", { endpoint, input }),
  status: (statusUrl: string) => call<StatusResult>("/api/fal/status", { statusUrl }),
  result: (responseUrl: string) => call<{ videoUrl?: string; imageUrl?: string; seed?: number }>("/api/fal/result", { responseUrl }),
  /** rewrites a prompt into a detailed English video/image prompt (any language in) */
  enhance: (prompt: string, kind: "video" | "image", withImage: boolean) =>
    call<{ prompt: string }>("/api/enhance", { prompt, kind, withImage }),
  cancel: (responseUrl: string) => call<{ ok: boolean }>("/api/fal/cancel", { responseUrl }),
};

const schemaCache = new Map<string, Promise<ModelSchema>>();

export function loadSchema(endpoint: string, mode: "text" | "image" = "text"): Promise<ModelSchema> {
  const cacheKey = isHfEndpoint(endpoint) ? `${endpoint}|${mode}` : endpoint;
  let p = schemaCache.get(cacheKey);
  if (!p) {
    const url = isHfEndpoint(endpoint)
      ? `/api/hf/schema?endpoint=${encodeURIComponent(endpoint)}&mode=${mode}`
      : "/api/fal/schema?endpoint=" + encodeURIComponent(endpoint);
    p = fetch(url).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, (data as any).error || "Could not load model settings");
      return data as ModelSchema;
    });
    p.catch(() => schemaCache.delete(cacheKey)); // allow retry
    schemaCache.set(cacheKey, p);
  }
  return p;
}

export async function serverHasKey(): Promise<boolean> {
  try {
    const res = await fetch("/api/config");
    return Boolean((await res.json()).serverKey);
  } catch {
    return false;
  }
}
