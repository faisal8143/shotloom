"use client";
import { ApiError, api, loadSchema } from "./client-api";
import { isHfEndpoint } from "./hf";
import type { Take } from "./types";

export type TakeRef = { projectId: string; shotId: string; takeId: string };
export type TakeUpdater = (ref: TakeRef, patch: Partial<Take>) => void;

const polling = new Set<string>();
const GIVE_UP_MS = 45 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function friendly(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/** Sends a take to fal, or to a free Hugging Face Space, and follows it. */
export async function runTake(
  ref: TakeRef,
  endpoint: string,
  input: Record<string, unknown>,
  update: TakeUpdater,
  mode: "text" | "image" = "text",
) {
  if (isHfEndpoint(endpoint)) {
    try {
      const [{ runHfTake }, schema] = await Promise.all([import("./hf-client"), loadSchema(endpoint, mode)]);
      await runHfTake(ref, schema, input, update);
    } catch (err) {
      update(ref, { status: "failed", error: friendly(err), finishedAt: Date.now() });
    }
    return;
  }
  try {
    const sub = await api.submit(endpoint, input);
    update(ref, {
      status: "queued",
      requestId: sub.requestId,
      statusUrl: sub.statusUrl,
      responseUrl: sub.responseUrl,
      queuePosition: sub.queuePosition,
    });
    await follow(ref, sub.statusUrl, sub.responseUrl, Date.now(), update);
  } catch (err) {
    update(ref, { status: "failed", error: friendly(err), finishedAt: Date.now() });
  }
}

/** Polls a submitted take. Safe to call again after a page reload. */
export async function follow(
  ref: TakeRef,
  statusUrl: string,
  responseUrl: string,
  startedAt: number,
  update: TakeUpdater,
) {
  if (polling.has(ref.takeId)) return;
  polling.add(ref.takeId);
  let wait = 2500;
  let networkFailures = 0;
  try {
    for (;;) {
      if (Date.now() - startedAt > GIVE_UP_MS) {
        update(ref, { status: "failed", error: "Gave up after 45 minutes in fal's queue.", finishedAt: Date.now() });
        return;
      }
      let st;
      try {
        st = await api.status(statusUrl);
        networkFailures = 0;
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        if ((status >= 400 && status < 500 && status !== 429 && status !== 408) || ++networkFailures > 8) {
          update(ref, { status: "failed", error: friendly(err), finishedAt: Date.now() });
          return;
        }
        await sleep(Math.min(20000, wait * 2 ** networkFailures));
        continue;
      }

      if (st.status === "COMPLETED") {
        if (st.error) {
          update(ref, { status: "failed", error: String(st.error), finishedAt: Date.now() });
          return;
        }
        try {
          const res = await api.result(responseUrl);
          update(ref, {
            status: "done",
            videoUrl: res.videoUrl,
            imageUrl: res.imageUrl,
            seed: res.seed,
            log: undefined,
            queuePosition: undefined,
            finishedAt: Date.now(),
          });
        } catch (err) {
          update(ref, { status: "failed", error: friendly(err), finishedAt: Date.now() });
        }
        return;
      }

      update(ref, {
        status: st.status === "IN_PROGRESS" ? "running" : "queued",
        queuePosition: st.queuePosition,
        log: st.log || undefined,
      });
      await sleep(wait);
      wait = Math.min(6000, wait + 500);
    }
  } finally {
    polling.delete(ref.takeId);
  }
}

export function isPolling(takeId: string) {
  return polling.has(takeId);
}
