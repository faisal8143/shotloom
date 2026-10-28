"use client";
import { useEffect, useRef } from "react";
import type { MediaItem } from "@/lib/project";
import { Icon } from "./Icon";
import { elapsed, isWorking, statusText, useTicker } from "./MediaCard";

export interface ViewerActions {
  onToggleScene: () => void;
  onExtend: () => void;
  onFrame: (seconds: number) => void;
  onReuse: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
}

export function Viewer({ item, inScene, actions }: { item: MediaItem; inScene: boolean; actions: ViewerActions }) {
  const ref = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const { take, shot } = item;
  const working = isWorking(take);
  useTicker(working);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft" && actions.onPrev) actions.onPrev();
      if (e.key === "ArrowRight" && actions.onNext) actions.onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);

  const refs = [shot.startFrame && { label: "Start", src: shot.startFrame }, shot.endFrame && { label: "End", src: shot.endFrame }, ...shot.references.map((src) => ({ label: "Ingredient", src }))].filter(Boolean) as { label: string; src: string }[];

  return (
    <dialog
      ref={ref}
      className="viewer"
      onCancel={(e) => {
        e.preventDefault();
        actions.onClose();
      }}
    >
      <div className="viewer__stage" onClick={(e) => e.target === e.currentTarget && actions.onClose()}>
        <button className="icon-btn viewer__close" onClick={actions.onClose} aria-label="Close">
          <Icon name="x" />
        </button>
        {actions.onPrev ? (
          <button className="viewer__nav viewer__nav--prev" onClick={actions.onPrev} aria-label="Previous clip">
            <Icon name="left" size={22} />
          </button>
        ) : null}
        {actions.onNext ? (
          <button className="viewer__nav viewer__nav--next" onClick={actions.onNext} aria-label="Next clip">
            <Icon name="right" size={22} />
          </button>
        ) : null}

        {take.status === "done" && take.videoUrl ? (
          <video ref={video} key={take.id} src={take.videoUrl} controls autoPlay loop playsInline />
        ) : working ? (
          <div className="viewer__placeholder">
            <span className="spinner spinner--big" aria-hidden />
            <strong>{statusText(take)}</strong>
            <span className="mono">{elapsed(take.createdAt)}</span>
            {take.log ? <span className="tile__log">{take.log.split("\n").pop()}</span> : null}
          </div>
        ) : (
          <div className="viewer__placeholder viewer__placeholder--failed">
            <strong>This clip didn&apos;t generate</strong>
            <span>{take.error ?? "Unknown error"}</span>
          </div>
        )}
      </div>

      <aside className="viewer__side">
        <p className="viewer__prompt">{take.prompt}</p>
        <dl className="viewer__facts">
          <dt>Model</dt>
          <dd>{take.modelName}</dd>
          {take.duration ? (
            <>
              <dt>Length</dt>
              <dd>{take.duration.toFixed(1)} s</dd>
            </>
          ) : null}
          {take.seed != null ? (
            <>
              <dt>Seed</dt>
              <dd className="mono">{take.seed}</dd>
            </>
          ) : null}
          <dt>Made</dt>
          <dd>{new Date(take.createdAt).toLocaleString()}</dd>
        </dl>
        {refs.length ? (
          <div className="viewer__refs">
            {refs.map((r, i) => (
              <figure key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.src} alt={r.label} />
                <figcaption>{r.label}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}

        <div className="viewer__actions">
          {take.status === "done" ? (
            <>
              <button className={"btn btn--wide" + (inScene ? "" : " btn--primary")} onClick={actions.onToggleScene}>
                <Icon name={inScene ? "check" : "scene_add"} size={16} /> {inScene ? "In scene (remove)" : "Add to scene"}
              </button>
              <button className="btn btn--wide" onClick={actions.onExtend} title="Continue from this clip's last frame">
                <Icon name="extend" size={16} /> Extend
              </button>
              <button className="btn btn--wide" onClick={() => actions.onFrame(video.current?.currentTime ?? 0)} title="Start a new clip from the frame you paused on">
                <Icon name="camera" size={16} /> Use this frame
              </button>
            </>
          ) : null}
          {take.status === "failed" ? (
            <button className="btn btn--wide btn--primary" onClick={actions.onRetry}>
              <Icon name="refresh" size={16} /> Try again
            </button>
          ) : null}
          {working ? (
            <button className="btn btn--wide" onClick={actions.onCancel}>
              <Icon name="stop" size={16} /> Cancel
            </button>
          ) : null}
          <button className="btn btn--wide" onClick={actions.onReuse} title="Put this prompt and its settings back in the prompt box">
            <Icon name="undo" size={16} /> Reuse prompt
          </button>
          <div className="viewer__row">
            {take.status === "done" ? (
              <button className="btn" onClick={actions.onDownload}>
                <Icon name="download" size={16} /> Download
              </button>
            ) : null}
            {!working ? (
              <button className="btn btn--danger" onClick={actions.onDelete}>
                <Icon name="trash" size={16} /> Delete
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    </dialog>
  );
}
