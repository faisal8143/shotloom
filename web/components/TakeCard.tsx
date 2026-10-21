"use client";
import { useEffect, useRef, useState } from "react";
import type { Take } from "@/lib/types";
import { Icon } from "./Icon";

function elapsed(from: number, to = Date.now()) {
  const s = Math.max(0, Math.round((to - from) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useTicker(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

export function TakeCard({
  take,
  index,
  aspect,
  selected,
  onSelect,
  onExtend,
  onGrabFrame,
  onDownload,
  onDelete,
  onCancel,
  onRetry,
  onDuration,
}: {
  take: Take;
  index: number;
  aspect: string;
  selected: boolean;
  onSelect: () => void;
  onExtend: () => void;
  onGrabFrame: (seconds: number) => void;
  onDownload: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDuration: (d: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const working = take.status === "submitting" || take.status === "queued" || take.status === "running";
  useTicker(working);
  const [w, h] = aspect.split(":").map(Number);

  return (
    <article className={"take" + (selected ? " take--selected" : "") + ` take--${take.status}`}>
      <div className="take__screen" style={{ aspectRatio: `${w || 16} / ${h || 9}` }}>
        {take.status === "done" && take.videoUrl ? (
          <video
            ref={video}
            src={take.videoUrl}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && !take.duration) onDuration(d);
            }}
            onError={() => undefined}
          />
        ) : working ? (
          <div className="take__working">
            <span className="rec-dot" aria-hidden />
            <strong>
              {take.status === "submitting"
                ? "Sending to fal…"
                : take.status === "queued"
                  ? take.queuePosition != null
                    ? `In queue · position ${take.queuePosition + 1}`
                    : "In queue…"
                  : "Rendering…"}
            </strong>
            <span className="mono">{elapsed(take.createdAt)}</span>
            {take.log ? <span className="take__log">{take.log.split("\n").pop()}</span> : null}
            <span className="scanbar" aria-hidden />
          </div>
        ) : (
          <div className="take__failed">
            <strong>Didn&apos;t render</strong>
            <span>{take.error ?? "Unknown error"}</span>
          </div>
        )}
        {selected ? (
          <span className="take__badge">
            <Icon name="star-filled" size={12} /> In film
          </span>
        ) : null}
      </div>

      <div className="take__meta">
        <span className="take__no mono">T{index + 1}</span>
        <span className="take__model">{take.modelName}</span>
        {take.duration ? <span className="mono">{take.duration.toFixed(1)}s</span> : null}
        {take.seed != null ? <span className="mono dim">seed {take.seed}</span> : null}
        {take.status === "done" && take.finishedAt ? <span className="mono dim">{elapsed(take.createdAt, take.finishedAt)} render</span> : null}
      </div>

      <div className="take__actions">
        {take.status === "done" ? (
          <>
            <button className={"btn btn--sm" + (selected ? " btn--on" : "")} onClick={onSelect} title="Use this take in the film">
              <Icon name={selected ? "star-filled" : "star"} size={14} /> {selected ? "In film" : "Use"}
            </button>
            <button className="btn btn--sm" onClick={onExtend} title="New shot that starts from this take's last frame">
              <Icon name="extend" size={14} /> Extend
            </button>
            <button
              className="btn btn--sm"
              onClick={() => onGrabFrame(video.current?.currentTime ?? 0)}
              title="Use the frame you paused on as the start of a new shot"
            >
              <Icon name="camera" size={14} /> Frame
            </button>
            <button className="icon-btn" onClick={onDownload} title="Download clip" aria-label="Download clip">
              <Icon name="download" />
            </button>
          </>
        ) : null}
        {working && take.responseUrl ? (
          <button className="btn btn--sm" onClick={onCancel} title="Cancel while still queued">
            <Icon name="stop" size={14} /> Cancel
          </button>
        ) : null}
        {take.status === "failed" ? (
          <button className="btn btn--sm" onClick={onRetry}>
            <Icon name="refresh" size={14} /> Try again
          </button>
        ) : null}
        <span className="spacer" />
        {!working ? (
          <button className="icon-btn" onClick={onDelete} title="Delete take" aria-label="Delete take">
            <Icon name="trash" />
          </button>
        ) : null}
      </div>
      <details className="take__prompt">
        <summary>Prompt sent</summary>
        <p>{take.prompt}</p>
        <p className="mono dim">{take.endpoint}</p>
      </details>
    </article>
  );
}
