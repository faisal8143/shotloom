"use client";
import { mediaItems } from "@/lib/project";
import type { Project } from "@/lib/types";
import { Icon } from "./Icon";

/** All projects in this browser. */
export function LibraryView({
  projects,
  currentId,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: {
  projects: Project[];
  currentId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="library">
      <div className="lib-grid">
        <button className="lib-card lib-card--new" onClick={onNew}>
          <Icon name="plus" size={28} />
          <span>New project</span>
        </button>
        {projects.map((p) => {
          const items = mediaItems(p);
          const cover = items.find((m) => m.take.status === "done" && m.take.videoUrl);
          const [w, h] = p.aspect.split(":").map(Number);
          return (
            <article key={p.id} className={"lib-card" + (p.id === currentId ? " is-current" : "")}>
              <button className="lib-card__cover" style={{ aspectRatio: `${Math.max(w / h, 1.2)}` }} onClick={() => onOpen(p.id)}>
                {cover ? <video src={cover.take.videoUrl + "#t=0.1"} muted playsInline preload="metadata" /> : <Icon name="film" size={30} />}
              </button>
              <div className="lib-card__info">
                <button className="lib-card__name" onClick={() => onOpen(p.id)}>
                  {p.name}
                </button>
                <span className="dim small">
                  {items.length} clip{items.length === 1 ? "" : "s"} · {p.aspect} · {new Date(p.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <span className="lib-card__tools">
                <button className="icon-btn" onClick={() => onRename(p.id)} aria-label={`Rename ${p.name}`}>
                  <Icon name="edit" size={16} />
                </button>
                <button className="icon-btn" onClick={() => onDelete(p.id)} aria-label={`Delete ${p.name}`}>
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </article>
          );
        })}
      </div>
    </div>
  );
}
