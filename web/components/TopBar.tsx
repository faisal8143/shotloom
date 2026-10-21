"use client";
import { useState } from "react";
import { LOOKS } from "@/lib/presets";
import type { Aspect, Project } from "@/lib/types";
import { Icon } from "./Icon";

const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1", "21:9"];

export function TopBar({
  projects,
  project,
  ready,
  onSwitch,
  onNew,
  onRename,
  onDelete,
  onAspect,
  onLook,
  onSettings,
}: {
  projects: Project[];
  project: Project;
  ready: boolean;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAspect: (a: Aspect) => void;
  onLook: (text: string) => void;
  onSettings: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const preset = LOOKS.find((l) => l.text === project.look);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark" aria-hidden>
          <Icon name="film" size={18} />
        </span>
        <span className="brand__name">Shotloom</span>
      </div>

      <div className="topbar__project">
        {editing ? (
          <input
            autoFocus
            className="topbar__rename"
            defaultValue={project.name}
            onBlur={(e) => {
              onRename(e.target.value.trim() || project.name);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
            aria-label="Project name"
          />
        ) : (
          <select value={project.id} onChange={(e) => onSwitch(e.target.value)} aria-label="Project">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button className="icon-btn" onClick={() => setEditing(true)} title="Rename project" aria-label="Rename project">
          <Icon name="edit" />
        </button>
        <button className="icon-btn" onClick={onNew} title="New project" aria-label="New project">
          <Icon name="plus" />
        </button>
        <button className="icon-btn" onClick={onDelete} title="Delete project" aria-label="Delete project">
          <Icon name="trash" />
        </button>
      </div>

      <div className="topbar__look">
        <label>
          <span>Aspect</span>
          <select value={project.aspect} onChange={(e) => onAspect(e.target.value as Aspect)}>
            {ASPECTS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label title={project.look || "No look applied"}>
          <span>Look</span>
          <select
            value={preset ? preset.name : "__custom"}
            onChange={(e) => {
              const l = LOOKS.find((x) => x.name === e.target.value);
              if (l) onLook(l.text);
              else {
                const text = window.prompt("Describe the look for every shot in this project:", project.look);
                if (text != null) onLook(text);
              }
            }}
          >
            {LOOKS.map((l) => (
              <option key={l.name}>{l.name}</option>
            ))}
            <option value="__custom">{preset ? "Custom…" : "Custom ✓"}</option>
          </select>
        </label>
      </div>

      <button className={"btn btn--sm" + (ready ? "" : " btn--attention")} onClick={onSettings}>
        <Icon name={ready ? "gear" : "key"} size={14} /> {ready ? "Settings" : "Add fal key"}
      </button>
    </header>
  );
}
