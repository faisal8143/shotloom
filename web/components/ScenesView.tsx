"use client";
import { useEffect, useRef, useState } from "react";
import type { MediaItem } from "@/lib/project";
import { Icon } from "./Icon";

function timecode(sec: number) {
  const s = Math.round(sec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Scenebuilder: plays the scene clip after clip, with a reorderable strip below. */
export function ScenesView({
  clips,
  aspect,
  onMove,
  onRemove,
  onOpen,
  onExport,
  onBrowse,
}: {
  clips: MediaItem[];
  aspect: string;
  onMove: (takeId: string, dir: -1 | 1) => void;
  onRemove: (takeId: string) => void;
  onOpen: (takeId: string) => void;
  onExport: () => void;
  onBrowse: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const [w, h] = aspect.split(":").map(Number);
  const total = clips.reduce((s, c) => s + (c.take.duration ?? 0), 0);
  const current = clips[Math.min(index, clips.length - 1)];

  useEffect(() => {
    if (index >= clips.length && clips.length) setIndex(clips.length - 1);
  }, [clips.length, index]);

  useEffect(() => {
    if (auto) video.current?.play().catch(() => undefined);
  }, [index, auto]);

  if (!clips.length) {
    return (
      <div className="empty">
        <Icon name="scenes" size={44} />
        <p className="empty__title">Your scene is empty</p>
        <p className="empty__text">Open any clip and press “Add to scene”. Clips made with Extend join it automatically.</p>
        <button className="btn" onClick={onBrowse}>
          <Icon name="grid" size={16} /> Go to all media
        </button>
      </div>
    );
  }

  return (
    <div className="scenes">
      <div className="scenes__player" style={{ aspectRatio: `${w || 16} / ${h || 9}` }}>
        {current ? (
          <video
            ref={video}
            key={current.take.id}
            src={current.take.videoUrl}
            controls
            playsInline
            onPlay={() => setAuto(true)}
            onEnded={() => {
              if (index + 1 < clips.length) setIndex(index + 1);
              else setAuto(false);
            }}
          />
        ) : null}
      </div>

      <div className="scenes__bar">
        <button
          className="btn"
          onClick={() => {
            setIndex(0);
            setAuto(true);
            requestAnimationFrame(() => video.current?.play().catch(() => undefined));
          }}
        >
          <Icon name="play" size={14} /> Play from start
        </button>
        <span className="mono dim">
          {clips.length} clip{clips.length === 1 ? "" : "s"} · {timecode(total)}
        </span>
        <span className="spacer" />
        <button className="btn btn--primary" onClick={onExport}>
          <Icon name="download" size={16} /> Export MP4
        </button>
      </div>

      <ol className="strip">
        {clips.map((c, i) => (
          <li key={c.take.id} className={"strip__clip" + (i === index ? " is-current" : "")}>
            <button
              className="strip__thumb"
              style={{ aspectRatio: `${w || 16} / ${h || 9}` }}
              onClick={() => {
                setIndex(i);
                setAuto(false);
              }}
              onDoubleClick={() => onOpen(c.take.id)}
              title={c.take.prompt}
            >
              <video src={c.take.videoUrl + "#t=0.1"} muted playsInline preload="metadata" />
              <span className="strip__no mono">{String(i + 1).padStart(2, "0")}</span>
              {c.take.duration ? <span className="strip__dur mono">{c.take.duration.toFixed(1)}s</span> : null}
            </button>
            <span className="strip__tools">
              <button className="icon-btn" onClick={() => onMove(c.take.id, -1)} disabled={i === 0} aria-label="Move earlier">
                <Icon name="left" size={15} />
              </button>
              <button className="icon-btn" onClick={() => onMove(c.take.id, 1)} disabled={i === clips.length - 1} aria-label="Move later">
                <Icon name="right" size={15} />
              </button>
              <button className="icon-btn" onClick={() => onRemove(c.take.id)} aria-label="Remove from scene">
                <Icon name="x" size={15} />
              </button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
