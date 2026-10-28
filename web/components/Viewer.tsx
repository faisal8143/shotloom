"use client";
import { useEffect, useRef, useState } from "react";
import { formatUsd } from "@/lib/pricing";
import type { MediaItem } from "@/lib/project";
import { UPSCALE_LABEL, toolBlocker, toolCost, type UpscaleTarget } from "@/lib/tools";
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
  onFavorite: () => void;
  onUpscale: (target: UpscaleTarget) => void;
  onSound: (prompt: string) => void;
  onEdit: (instruction: string) => void;
  onAnimate: () => void;
  onSaveCharacter: () => void;
  onEditImage: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
}

type Panel = "upscale" | "sound" | "edit" | null;

export function Viewer({ item, inScene, ready, actions }: { item: MediaItem; inScene: boolean; ready: boolean; actions: ViewerActions }) {
  const ref = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const { take, shot } = item;
  const working = isWorking(take);
  const isImage = take.kind === "image";
  const [panel, setPanel] = useState<Panel>(null);
  const [soundPrompt, setSoundPrompt] = useState(() => shot.prompt || take.prompt);
  const [editText, setEditText] = useState("");
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

  const refs = [
    shot.startFrame && { label: isImage ? "Reference" : "Start", src: shot.startFrame },
    shot.endFrame && { label: "End", src: shot.endFrame },
    ...shot.references.map((src) => ({ label: isImage ? "Reference" : "Ingredient", src })),
  ].filter(Boolean) as { label: string; src: string }[];

  const shortSide = take.width && take.height ? Math.min(take.width, take.height) : undefined;
  const editBlock = toolBlocker("edit", take);
  const paid = (usd: number) => (ready ? formatUsd(usd) : "fal key");

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
          <button className="viewer__nav viewer__nav--prev" onClick={actions.onPrev} aria-label="Previous">
            <Icon name="left" size={22} />
          </button>
        ) : null}
        {actions.onNext ? (
          <button className="viewer__nav viewer__nav--next" onClick={actions.onNext} aria-label="Next">
            <Icon name="right" size={22} />
          </button>
        ) : null}

        {take.status === "done" && take.videoUrl ? (
          <video ref={video} key={take.id} src={take.videoUrl} controls autoPlay loop playsInline />
        ) : take.status === "done" && take.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="viewer__image" src={take.imageUrl} alt={take.prompt} />
        ) : working ? (
          <div className="viewer__placeholder">
            <span className="spinner spinner--big" aria-hidden />
            <strong>{statusText(take)}</strong>
            <span className="mono">{elapsed(take.createdAt)}</span>
            {take.log ? <span className="tile__log">{take.log.split("\n").pop()}</span> : null}
          </div>
        ) : (
          <div className="viewer__placeholder viewer__placeholder--failed">
            <strong>This {isImage ? "image" : "clip"} didn&apos;t generate</strong>
            <span>{take.error ?? "Unknown error"}</span>
          </div>
        )}
      </div>

      <aside className="viewer__side">
        <div className="viewer__head">
          <p className="viewer__prompt">{take.prompt}</p>
          {take.status === "done" ? (
            <button className={"icon-btn viewer__fav" + (take.favorite ? " is-on" : "")} onClick={actions.onFavorite} aria-label={take.favorite ? "Remove from favourites" : "Add to favourites"} aria-pressed={Boolean(take.favorite)}>
              <Icon name={take.favorite ? "heart_on" : "heart"} />
            </button>
          ) : null}
        </div>
        <dl className="viewer__facts">
          <dt>Model</dt>
          <dd>{take.modelName}</dd>
          {take.duration ? (
            <>
              <dt>Length</dt>
              <dd>{take.duration.toFixed(1)} s</dd>
            </>
          ) : null}
          {take.width && take.height ? (
            <>
              <dt>Size</dt>
              <dd>
                {take.width}×{take.height}
                {shortSide ? <span className="res-tag">{shortSide >= 2000 ? "4K" : shortSide >= 1400 ? "2K" : shortSide >= 1080 ? "FHD" : shortSide >= 720 ? "HD" : "SD"}</span> : null}
              </dd>
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
          {take.status === "done" && !isImage ? (
            <>
              <button className={"btn btn--wide" + (inScene ? "" : " btn--primary")} onClick={actions.onToggleScene}>
                <Icon name={inScene ? "check" : "scene_add"} size={16} /> {inScene ? "In scene (remove)" : "Add to scene"}
              </button>
              <div className="viewer__row">
                <button className="btn" onClick={actions.onExtend} title="Continue from this clip's last frame">
                  <Icon name="extend" size={16} /> Extend
                </button>
                <button className="btn" onClick={() => actions.onFrame(video.current?.currentTime ?? 0)} title="Start a new clip from the frame you paused on">
                  <Icon name="camera" size={16} /> Use frame
                </button>
              </div>

              <div className="tools" role="group" aria-label="Enhance this clip">
                <span className="tools__label">Enhance</span>
                <div className="tools__tabs">
                  <button className={panel === "upscale" ? "is-on" : ""} onClick={() => setPanel(panel === "upscale" ? null : "upscale")}>
                    <Icon name="hd" size={16} /> Upscale
                  </button>
                  <button className={panel === "sound" ? "is-on" : ""} onClick={() => setPanel(panel === "sound" ? null : "sound")}>
                    <Icon name="sound" size={16} /> Add sound
                  </button>
                  <button className={panel === "edit" ? "is-on" : ""} onClick={() => setPanel(panel === "edit" ? null : "edit")}>
                    <Icon name="wand" size={16} /> Edit
                  </button>
                </div>
                {panel === "upscale" ? (
                  <div className="tools__panel">
                    <p className="dim small">Make a sharper copy of this clip. The copy takes this clip&apos;s place in your scene.</p>
                    {(["1080p", "2k", "4k"] as UpscaleTarget[]).map((t) => {
                      const target = t === "1080p" ? 1080 : t === "2k" ? 1440 : 2160;
                      const already = shortSide !== undefined && shortSide >= target;
                      return (
                        <button key={t} className="btn btn--wide tools__opt" disabled={already} onClick={() => actions.onUpscale(t)}>
                          <span>{UPSCALE_LABEL[t]}</span>
                          <span className="mono dim">{already ? "already" : paid(toolCost("upscale", take.duration, t))}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {panel === "sound" ? (
                  <div className="tools__panel">
                    <p className="dim small">Generates matching sound effects and ambience. Replaces any sound the clip has.</p>
                    <textarea rows={2} value={soundPrompt} onChange={(e) => setSoundPrompt(e.target.value)} placeholder="e.g. waves crashing, wind, distant thunder" />
                    <button className="btn btn--primary btn--wide tools__opt" disabled={!soundPrompt.trim()} onClick={() => actions.onSound(soundPrompt)}>
                      <span>Add sound</span>
                      <span className="mono">{paid(toolCost("sound", take.duration))}</span>
                    </button>
                  </div>
                ) : null}
                {panel === "edit" ? (
                  <div className="tools__panel">
                    <p className="dim small">Change the clip with words. The rest of the shot stays the same.</p>
                    <textarea rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="e.g. make it night with neon signs · change her dress to red · remove the car" />
                    {editBlock ? <p className="warn">{editBlock}</p> : null}
                    <button className="btn btn--primary btn--wide tools__opt" disabled={!editText.trim() || Boolean(editBlock)} onClick={() => actions.onEdit(editText)}>
                      <span>Apply edit</span>
                      <span className="mono">{paid(toolCost("edit", take.duration))}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {take.status === "done" && isImage ? (
            <>
              <button className="btn btn--wide btn--primary" onClick={actions.onAnimate} title="Use this image as the start frame of a video">
                <Icon name="animate" size={16} /> Animate
              </button>
              <div className="viewer__row">
                <button className="btn" onClick={actions.onEditImage} title="Change this image with words">
                  <Icon name="wand" size={16} /> Edit image
                </button>
                <button className="btn" onClick={actions.onSaveCharacter} title="Reuse it in any prompt">
                  <Icon name="person" size={16} /> Character
                </button>
              </div>
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
          {!take.sourceTakeId ? (
            <button className="btn btn--wide" onClick={actions.onReuse} title="Put this prompt and its settings back in the prompt box">
              <Icon name="undo" size={16} /> Reuse prompt
            </button>
          ) : null}
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
