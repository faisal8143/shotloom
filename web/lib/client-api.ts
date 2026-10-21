"use client";
import type { ModelSchema } from "./schema";

const KEY_STORE = "shotloom.falKey";
const PASS_STORE = "shotloom.studioPass";

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

export const credentials = {
  get key() {
    return memoryKey || read(KEY_STORE);
  },
  get pass() {
    return memoryPass || read(PASS_STORE);
  },
  save(key: string, pass: string) {
    memoryKey = key.trim();
    memoryPass = pass;
    write(KEY_STORE, memoryKey);
    write(PASS_STORE, memoryPass);
  },
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
  result: (responseUrl: string) => call<{ videoUrl: string; seed?: number }>("/api/fal/result", { responseUrl }),
  cancel: (responseUrl: string) => call<{ ok: boolean }>("/api/fal/cancel", { responseUrl }),
};

const schemaCache = new Map<string, Promise<ModelSchema>>();

export function loadSchema(endpoint: string): Promise<ModelSchema> {
  let p = schemaCache.get(endpoint);
  if (!p) {
    p = fetch("/api/fal/schema?endpoint=" + encodeURIComponent(endpoint)).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, (data as any).error || "Could not load model settings");
      return data as ModelSchema;
    });
    p.catch(() => schemaCache.delete(endpoint)); // allow retry
    schemaCache.set(endpoint, p);
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
