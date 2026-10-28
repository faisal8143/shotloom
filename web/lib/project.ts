// Pure project helpers (no browser APIs), shared by the UI and the tests.
import { MODELS } from "./models.ts";
import { uid, type Project, type Shot, type Take } from "./types.ts";

export function newShot(from?: Partial<Shot>): Shot {
  return {
    id: uid("s_"),
    title: "",
    prompt: "",
    modelKey: MODELS[0].key,
    params: {},
    camera: {},
    references: [],
    takes: [],
    ...from,
  };
}

/** Flow-style default name: the date and time the project was made. */
export function defaultProjectName(d = new Date()): string {
  const month = d.toLocaleString("en", { month: "short" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${month} ${d.getDate()} - ${hh}:${mm}`;
}

export function newProject(name = defaultProjectName()): Project {
  const now = Date.now();
  return {
    id: uid("p_"),
    name,
    aspect: "16:9",
    look: "",
    shots: [],
    draft: newShot(),
    scene: [],
    characters: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Brings a project saved by an older version up to date:
 * empty placeholder shots are dropped, the composer gets a draft, and the
 * takes that were "in the film" become the scene, in shot order.
 */
export function normalizeProject(p: Project): Project {
  const shots = p.shots ?? [];
  const last = [...shots].reverse().find((s) => s.prompt || s.takes.length) ?? shots[shots.length - 1];
  const draft =
    p.draft ??
    newShot({
      prompt: last && !last.takes.length ? last.prompt : "",
      modelKey: last?.modelKey ?? MODELS[0].key,
      customEndpoint: last?.customEndpoint,
      camera: { ...(last?.camera ?? {}) },
      params: last && !last.takes.length ? { ...last.params } : {},
      startFrame: last && !last.takes.length ? last.startFrame : undefined,
      references: last && !last.takes.length ? [...last.references] : [],
    });
  const scene =
    p.scene ??
    shots
      .map((s) => s.takes.find((t) => t.id === s.selectedTakeId && t.status === "done" && t.videoUrl)?.id)
      .filter((id): id is string => Boolean(id));
  return {
    ...p,
    shots: shots.filter((s) => s.takes.length > 0),
    draft,
    scene,
    characters: p.characters ?? [],
  };
}

export interface MediaItem {
  take: Take;
  shot: Shot;
}

/** Every clip in the project, newest first. */
export function mediaItems(p: Project, { deleted = false } = {}): MediaItem[] {
  const out: MediaItem[] = [];
  for (const shot of p.shots) for (const take of shot.takes) if (Boolean(take.deleted) === deleted) out.push({ shot, take });
  return out.sort((a, b) => b.take.createdAt - a.take.createdAt);
}

export function findTake(p: Project, takeId: string): MediaItem | undefined {
  for (const shot of p.shots) {
    const take = shot.takes.find((t) => t.id === takeId);
    if (take) return { shot, take };
  }
  return undefined;
}

/** The scene's playable clips, in order. */
export function sceneClips(p: Project): MediaItem[] {
  return (p.scene ?? [])
    .map((id) => findTake(p, id))
    .filter((m): m is MediaItem => Boolean(m && m.take.status === "done" && m.take.videoUrl && !m.take.deleted));
}

/**
 * Called when a take finishes. A take made with Extend joins the scene right
 * after the clip it continues (once per generation).
 */
export function placeFinishedTake(p: Project, shotId: string, takeId: string): Project {
  const shot = p.shots.find((s) => s.id === shotId);
  const scene = p.scene ?? [];
  if (!shot?.afterTakeId || scene.includes(takeId)) return p;
  if (shot.takes.some((t) => t.id !== takeId && scene.includes(t.id))) return p;
  const at = scene.indexOf(shot.afterTakeId);
  if (at < 0) return p;
  const next = [...scene];
  next.splice(at + 1, 0, takeId);
  return { ...p, scene: next };
}

export function moveInScene(scene: string[], takeId: string, dir: -1 | 1): string[] {
  const i = scene.indexOf(takeId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= scene.length) return scene;
  const next = [...scene];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
