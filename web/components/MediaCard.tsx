"use client";
import { useEffect, useRef, useState } from "react";
import type { Take } from "@/lib/types";
import { Icon } from "./Icon";

export function elapsed(from: number, to = Date.now()) {
  const s = Math.max(0, Math.round((to - from) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function useTicker(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

export const isWorking = (t: Take) => t.status === "submitting" || t.status === "queued" || t.status === "running";

export function statusText(t: Take) {
  if (t.status === "submitting") return "Sending…";
  if (t.status === "running" && t.sourceTakeId) return t.modelName.split(" · ")[0] + "…";
  if (t.status === "queued") return t.queuePosition != null ? `In queue · #${t.queuePosition + 1}` : "In queue…";
  return "Generating…";
}

/** One tile in the media grid. Hover plays the clip, click opens the viewer. */
export function MediaCard({
  take,
  aspect,
  inScene,
  onOpen,
  onDuration,
  onFavorite,
}: {
  take: Take;
  aspect: string;
  inScene: boolean;
  onOpen: () => void;
  onDuration: (d: number, w: number, h: number) => void;
  onFavorite?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const working = isWorking(take);
  useTicker(working);
  const [w, h] = aspect.split(":").map(Number);

  return (
    <button
      type="button"
      className={`tile tile--${take.status}`}
      style={{ aspectRatio: `${w || 16} / ${h || 9}` }}
      onClick={onOpen}
      onMouseEnter={() => video.current?.play().catch(() => undefined)}
      onMouseLeave={() => {
        const v = video.current;
        if (v) {
          v.pause();
          v.currentTime = 0.1;
        }
      }}
      aria-label={take.prompt}
    >
      {take.status === "done" && take.videoUrl ? (
        <video
          ref={video}
          src={take.videoUrl + "#t=0.1"}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (Number.isFinite(v.duration) && (!take.duration || !take.width)) onDuration(v.duration, v.videoWidth, v.videoHeight);
          }}
        />
      ) : take.status === "done" && take.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={take.imageUrl} alt="" loading="lazy" />
      ) : working ? (
        <span className="tile__working">
          <span className="spinner" aria-hidden />
          <span>{statusText(take)}</span>
          <span className="mono">{elapsed(take.createdAt)}</span>
          {take.log ? <span className="tile__log">{take.log.split("\n").pop()}</span> : null}
        </span>
      ) : (
        <span className="tile__failed">
          <strong>Failed</strong>
          <span>{take.error ?? "Unknown error"}</span>
        </span>
      )}
      {take.status === "done" ? (
        <span className="tile__overlay">
          <span className="tile__prompt">{take.prompt}</span>
          <span className="tile__meta">
            {take.modelName}
            {take.duration ? ` · ${take.duration.toFixed(1)}s` : ""}
            {take.height ? ` · ${Math.min(take.width ?? take.height, take.height)}p` : ""}
          </span>
        </span>
      ) : null}
      {take.kind === "image" && take.status === "done" ? (
        <span className="tile__kind" title="Image">
          <Icon name="image" size={13} />
        </span>
      ) : null}
      {onFavorite && take.status === "done" ? (
        <span
          role="button"
          tabIndex={0}
          className={"tile__fav" + (take.favorite ? " is-on" : "")}
          aria-label={take.favorite ? "Remove from favourites" : "Add to favourites"}
          aria-pressed={Boolean(take.favorite)}
          onClick={(e) => {
            e.stopPropagation();
            onFavorite();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onFavorite();
            }
          }}
        >
          <Icon name={take.favorite ? "heart_on" : "heart"} size={16} />
        </span>
      ) : null}
      {inScene ? (
        <span className="tile__badge" title="In your scene">
          <Icon name="scenes" size={13} /> Scene
        </span>
      ) : null}
    </button>
  );
}
