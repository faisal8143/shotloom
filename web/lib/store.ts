"use client";
import { createStore, del, entries, set } from "idb-keyval";
import type { Project } from "./types";

// Projects live in the browser's IndexedDB (no account, no server database).
const db = typeof indexedDB !== "undefined" ? createStore("shotloom", "projects") : undefined;

export async function loadProjects(): Promise<Project[]> {
  if (!db) return [];
  try {
    const all = await entries<string, Project>(db);
    return all.map(([, p]) => p).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const latest = new Map<string, Project>();

/** Debounced save, so typing in a prompt doesn't write on every key. */
export function saveProject(project: Project, delay = 400) {
  if (!db) return;
  latest.set(project.id, project);
  clearTimeout(timers.get(project.id));
  timers.set(
    project.id,
    setTimeout(() => {
      timers.delete(project.id);
      const p = latest.get(project.id);
      latest.delete(project.id);
      if (p) set(p.id, p, db).catch((e) => console.warn("save failed", e));
    }, delay),
  );
}

export function flushSaves() {
  if (!db) return;
  for (const [id, t] of timers) {
    clearTimeout(t);
    const p = latest.get(id);
    if (p) set(p.id, p, db).catch(() => {});
  }
  timers.clear();
  latest.clear();
}

export async function deleteProject(id: string) {
  if (!db) return;
  clearTimeout(timers.get(id));
  timers.delete(id);
  latest.delete(id);
  await del(id, db);
}
