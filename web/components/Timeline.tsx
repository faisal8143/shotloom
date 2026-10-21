"use client";
import type { Shot } from "@/lib/types";
import { Icon } from "./Icon";

export function selectedClips(shots: Shot[]) {
  return shots
    .map((s, i) => ({ shot: s, index: i, take: s.takes.find((t) => t.id === s.selectedTakeId && t.status === "done" && t.videoUrl) }))
    .filter((c) => c.take);
}

function timecode(sec: number) {
  const s = Math.round(sec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function Timeline({
  shots,
  currentId,
  aspect,
  onSelect,
  onPlay,
  onExport,
}: {
  shots: Shot[];
  currentId?: string;
  aspect: string;
  onSelect: (id: string) => void;
  onPlay: () => void;
  onExport: () => void;
}) {
  const clips = selectedClips(shots);
  const total = clips.reduce((sum, c) => sum + (c.take!.duration ?? 0), 0);
  const [w, h] = aspect.split(":").map(Number);
  const ratio = (w || 16) / (h || 9);

  return (
    <footer className="timeline" aria-label="Film timeline">
      <div className="timeline__info">
        <span className="timeline__label">Scenebuilder</span>
        <span className="mono">
          {clips.length}/{shots.length} shots · {timecode(total)}
        </span>
        <div className="timeline__btns">
          <button className="btn btn--sm" onClick={onPlay} disabled={!clips.length}>
            <Icon name="play" size={12} /> Play film
          </button>
          <button className="btn btn--sm btn--primary" onClick={onExport} disabled={!clips.length}>
            <Icon name="download" size={14} /> Export MP4
          </button>
        </div>
      </div>
      <div className="strip">
        {shots.map((shot, i) => {
          const take = shot.takes.find((t) => t.id === shot.selectedTakeId && t.status === "done" && t.videoUrl);
          const width = Math.max(64, Math.min(180, (take?.duration ?? 5) * 16)) * Math.min(1.4, Math.max(0.6, ratio / 1.78));
          return (
            <button
              key={shot.id}
              className={"strip__cell" + (shot.id === currentId ? " is-current" : "") + (take ? "" : " is-empty")}
              style={{ width }}
              onClick={() => onSelect(shot.id)}
              title={shot.title || `Shot ${i + 1}`}
            >
              {take ? <video src={take.videoUrl + "#t=0.5"} muted playsInline preload="metadata" /> : <span>no take</span>}
              <span className="strip__no mono">{String(i + 1).padStart(2, "0")}</span>
            </button>
          );
        })}
      </div>
    </footer>
  );
}
