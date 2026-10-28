import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultProjectName, mediaItems, moveInScene, newProject, newShot, normalizeProject, placeFinishedTake, sceneClips } from "../lib/project.ts";
import type { Project, Take } from "../lib/types.ts";

const take = (id: string, over: Partial<Take> = {}): Take => ({
  id,
  createdAt: Number(id.replace(/\D/g, "")) || 1,
  endpoint: "fal-ai/veo3.1/fast",
  modelName: "Veo 3.1 Fast",
  prompt: "p " + id,
  params: {},
  status: "done",
  videoUrl: `https://v3.fal.media/${id}.mp4`,
  ...over,
});

test("Flow-style default project name", () => {
  assert.equal(defaultProjectName(new Date(2026, 9, 28, 13, 5)), "Oct 28 - 13:05");
});

test("migrates an old project: picked takes become the scene, empty shots go, draft is created", () => {
  const old: Project = {
    id: "p",
    name: "Old",
    aspect: "16:9",
    look: "",
    createdAt: 0,
    updatedAt: 0,
    shots: [
      newShot({ id: "s1", prompt: "one", takes: [take("t1"), take("t2")], selectedTakeId: "t2" }),
      newShot({ id: "s2", prompt: "two", takes: [take("t3", { status: "failed", videoUrl: undefined })], selectedTakeId: "t3" }),
      newShot({ id: "s3", prompt: "half-written idea", modelKey: "seedance2" }),
    ],
  };
  const p = normalizeProject(old);
  assert.deepEqual(p.scene, ["t2"]);
  assert.deepEqual(p.shots.map((s) => s.id), ["s1", "s2"]);
  assert.equal(p.draft?.prompt, "half-written idea");
  assert.equal(p.draft?.modelKey, "seedance2");
  assert.deepEqual(p.characters, []);
  // already-migrated projects are left alone
  assert.deepEqual(normalizeProject(p).scene, ["t2"]);
});

test("media is newest first and excludes the bin; scene skips missing or binned clips", () => {
  const p = newProject("x");
  p.shots = [newShot({ id: "s1", takes: [take("t1"), take("t5", { deleted: true })] }), newShot({ id: "s2", takes: [take("t3")] })];
  p.scene = ["t3", "t5", "gone", "t1"];
  assert.deepEqual(mediaItems(p).map((m) => m.take.id), ["t3", "t1"]);
  assert.deepEqual(mediaItems(p, { deleted: true }).map((m) => m.take.id), ["t5"]);
  assert.deepEqual(sceneClips(p).map((m) => m.take.id), ["t3", "t1"]);
});

test("an extended clip lands right after its source, once per generation", () => {
  const p = newProject("x");
  p.shots = [
    newShot({ id: "s1", takes: [take("t1")] }),
    newShot({ id: "s2", takes: [take("t2")] }),
    newShot({ id: "s3", afterTakeId: "t1", takes: [take("t8"), take("t9")] }),
  ];
  p.scene = ["t1", "t2"];
  const a = placeFinishedTake(p, "s3", "t8");
  assert.deepEqual(a.scene, ["t1", "t8", "t2"]);
  const b = placeFinishedTake(a, "s3", "t9");
  assert.deepEqual(b.scene, ["t1", "t8", "t2"], "second output of the same prompt stays in media only");
  assert.equal(placeFinishedTake(p, "s2", "t2"), p, "normal clips don't join the scene by themselves");
});

test("reorders the scene", () => {
  assert.deepEqual(moveInScene(["a", "b", "c"], "c", -1), ["a", "c", "b"]);
  assert.deepEqual(moveInScene(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
});
