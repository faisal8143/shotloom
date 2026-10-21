"use client";
import type { Shot } from "@/lib/types";
import { Icon } from "./Icon";

function shotState(shot: Shot): "working" | "done" | "failed" | "empty" {
  if (shot.takes.some((t) => t.status === "submitting" || t.status === "queued" || t.status === "running")) return "working";
  if (shot.takes.some((t) => t.status === "done")) return "done";
  if (shot.takes.length) return "failed";
  return "empty";
}

export function ShotRail({
  shots,
  currentId,
  aspect,
  onSelect,
  onAdd,
  onMove,
  onDuplicate,
  onDelete,
}: {
  shots: Shot[];
  currentId?: string;
  aspect: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [w, h] = aspect.split(":").map(Number);
  return (
    <nav className="rail" aria-label="Shots">
      <div className="rail__head">
        <h2>Shots</h2>
        <button className="btn btn--sm" onClick={onAdd}>
          <Icon name="plus" size={14} /> Shot
        </button>
      </div>
      <ol className="rail__list">
        {shots.map((shot, i) => {
          const pick = shot.takes.find((t) => t.id === shot.selectedTakeId && t.videoUrl);
          const thumb = pick?.videoUrl;
          const state = shotState(shot);
          return (
            <li key={shot.id} className={"rail__item" + (shot.id === currentId ? " is-current" : "")}>
              <button className="rail__main" onClick={() => onSelect(shot.id)}>
                <span className="rail__thumb" style={{ aspectRatio: `${w || 16} / ${h || 9}` }}>
                  {thumb ? (
                    <video src={thumb + "#t=0.5"} muted playsInline preload="metadata" />
                  ) : shot.startFrame ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={shot.startFrame} alt="" />
                  ) : (
                    <span className="rail__num mono">{String(i + 1).padStart(2, "0")}</span>
                  )}
                  <span className={"status-dot status-dot--" + state} title={state} />
                </span>
                <span className="rail__text">
                  <span className="rail__title">
                    <span className="mono dim">{String(i + 1).padStart(2, "0")}</span> {shot.title || "Untitled shot"}
                  </span>
                  <span className="rail__sub">{shot.prompt.trim() || "No prompt yet"}</span>
                </span>
              </button>
              <span className="rail__tools">
                <button className="icon-btn" onClick={() => onMove(shot.id, -1)} disabled={i === 0} aria-label="Move up">
                  <Icon name="up" size={14} />
                </button>
                <button className="icon-btn" onClick={() => onMove(shot.id, 1)} disabled={i === shots.length - 1} aria-label="Move down">
                  <Icon name="down" size={14} />
                </button>
                <button className="icon-btn" onClick={() => onDuplicate(shot.id)} aria-label="Duplicate shot">
                  <Icon name="copy" size={14} />
                </button>
                <button className="icon-btn" onClick={() => onDelete(shot.id)} aria-label="Delete shot" disabled={shots.length === 1}>
                  <Icon name="trash" size={14} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
