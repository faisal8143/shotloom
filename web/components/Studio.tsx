"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, credentials, serverHasKey } from "@/lib/client-api";
import { downloadClip, grabFrame, slug } from "@/lib/media";
import { isHfEndpoint } from "@/lib/hf";
import { MODELS } from "@/lib/models";
import { follow, runTake, type TakeRef } from "@/lib/runner";
import { deleteProject, flushSaves, loadProjects, saveProject } from "@/lib/store";
import { uid, type Aspect, type Project, type Shot, type Take } from "@/lib/types";
import { ExportDialog } from "./ExportDialog";
import { FilmPlayer } from "./FilmPlayer";
import { SettingsDialog } from "./SettingsDialog";
import { ShotEditor, type GeneratePlan } from "./ShotEditor";
import { ShotRail } from "./ShotRail";
import { TakeCard } from "./TakeCard";
import { Timeline, selectedClips } from "./Timeline";
import { TopBar } from "./TopBar";

const LAST_PROJECT = "shotloom.lastProject";
// exact inputs of takes sent in this session, so "Try again" can resend them (images aren't stored on takes)
const sentInputs = new Map<string, { endpoint: string; input: Record<string, unknown>; mode: "text" | "image" }>();

function newShot(from?: Partial<Shot>): Shot {
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

function newProject(name = "My first film"): Project {
  const now = Date.now();
  return { id: uid("p_"), name, aspect: "16:9", look: "", shots: [newShot()], createdAt: now, updatedAt: now };
}

export default function Studio() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string>();
  const [shotId, setShotId] = useState<string>();
  const [ready, setReady] = useState(false);
  const [serverKey, setServerKey] = useState(false);
  const [dialog, setDialog] = useState<"settings" | "play" | "export" | null>(null);
  const [toast, setToast] = useState<string>();
  const resumed = useRef(false);

  // ---- load -----------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      const [list, hasServerKey] = await Promise.all([loadProjects(), serverHasKey()]);
      if (!alive) return;
      let all = list;
      if (!all.length) {
        all = [newProject()];
        saveProject(all[0], 0);
      }
      const last = (() => {
        try {
          return localStorage.getItem(LAST_PROJECT);
        } catch {
          return null;
        }
      })();
      const current = all.find((p) => p.id === last) ?? all[0];
      setProjects(all);
      setProjectId(current.id);
      setShotId(current.shots[0]?.id);
      setServerKey(hasServerKey);
      setReady(credentials.ready);
    })();
    const onHide = () => flushSaves();
    window.addEventListener("pagehide", onHide);
    return () => {
      alive = false;
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- mutations ------------------------------------------------------------
  const mutate = useCallback((id: string, fn: (p: Project) => Project) => {
    setProjects((prev) => {
      if (!prev) return prev;
      return prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...fn(p), updatedAt: Date.now() };
        saveProject(next);
        return next;
      });
    });
  }, []);

  const updateTake = useCallback(
    (ref: TakeRef, patch: Partial<Take>) => {
      mutate(ref.projectId, (p) => ({
        ...p,
        shots: p.shots.map((s) => {
          if (s.id !== ref.shotId) return s;
          const takes = s.takes.map((t) => (t.id === ref.takeId ? { ...t, ...patch } : t));
          // first finished take of a shot goes into the film automatically
          const selectedTakeId =
            s.selectedTakeId && takes.some((t) => t.id === s.selectedTakeId)
              ? s.selectedTakeId
              : patch.status === "done"
                ? ref.takeId
                : s.selectedTakeId;
          return { ...s, takes, selectedTakeId };
        }),
      }));
    },
    [mutate],
  );

  // resume takes that were still rendering when the page was closed
  useEffect(() => {
    if (!projects || resumed.current) return;
    resumed.current = true;
    for (const p of projects) {
      for (const s of p.shots) {
        for (const t of s.takes) {
          const ref = { projectId: p.id, shotId: s.id, takeId: t.id };
          if (isHfEndpoint(t.endpoint) && t.status !== "done" && t.status !== "failed") {
            // a Space is followed over one open connection, which the closed tab ended
            updateTake(ref, {
              status: "failed",
              error: "The page closed while the Space was rendering. Press Try again.",
              finishedAt: Date.now(),
            });
          } else if ((t.status === "queued" || t.status === "running") && t.statusUrl && t.responseUrl) {
            follow(ref, t.statusUrl, t.responseUrl, t.createdAt, updateTake);
          } else if (t.status === "submitting") {
            updateTake(ref, { status: "failed", error: "The page closed before this reached fal. Try again." });
          }
        }
      }
    }
  }, [projects, updateTake]);

  const project = useMemo(() => projects?.find((p) => p.id === projectId), [projects, projectId]);
  const shot = project?.shots.find((s) => s.id === shotId) ?? project?.shots[0];
  const shotIndex = project && shot ? project.shots.indexOf(shot) : 0;

  useEffect(() => {
    if (!projectId) return;
    try {
      localStorage.setItem(LAST_PROJECT, projectId);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  if (!projects || !project || !shot) {
    return (
      <div className="boot">
        <span className="brand__name">Shotloom</span>
        <span className="scanbar" aria-hidden />
      </div>
    );
  }

  const pid = project.id;

  const patchShot = (id: string, patch: Partial<Shot>) =>
    mutate(pid, (p) => ({ ...p, shots: p.shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const insertShotAfter = (afterId: string, s: Shot) => {
    mutate(pid, (p) => {
      const i = p.shots.findIndex((x) => x.id === afterId);
      const shots = [...p.shots];
      shots.splice(i + 1, 0, s);
      return { ...p, shots };
    });
    setShotId(s.id);
  };

  function generate(target: Shot, plan: GeneratePlan, count: number) {
    const takes: Take[] = Array.from({ length: count }, () => ({
      id: uid("t_"),
      createdAt: Date.now(),
      endpoint: plan.endpoint,
      modelName: plan.modelName,
      prompt: plan.prompt,
      params: Object.fromEntries(Object.entries(plan.input).filter(([, v]) => typeof v !== "string" || !v.startsWith("data:"))),
      status: "submitting",
    }));
    mutate(pid, (p) => ({
      ...p,
      shots: p.shots.map((s) => (s.id === target.id ? { ...s, takes: [...takes, ...s.takes] } : s)),
    }));
    requestAnimationFrame(() => document.querySelector(".takes")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    for (const t of takes) {
      const input = { ...plan.input };
      // several takes of the same shot should differ: let fal pick each seed
      if (count > 1) delete input.seed;
      sentInputs.set(t.id, { endpoint: plan.endpoint, input, mode: plan.mode });
      runTake({ projectId: pid, shotId: target.id, takeId: t.id }, plan.endpoint, input, updateTake, plan.mode);
    }
  }

  async function startFromFrame(source: Shot, take: Take, at: number | "last") {
    if (!take.videoUrl) return;
    setToast(at === "last" ? "Grabbing the last frame…" : "Grabbing that frame…");
    try {
      const frame = await grabFrame(take.videoUrl, at);
      const next = newShot({
        title: source.title ? `${source.title} (cont.)` : "",
        modelKey: source.modelKey,
        customEndpoint: source.customEndpoint,
        camera: { ...source.camera },
        startFrame: frame,
        references: [...source.references],
      });
      insertShotAfter(source.id, next);
      setToast("New shot added. Describe what happens next.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  }

  const clips = selectedClips(project.shots);

  return (
    <div className="app">
      <TopBar
        projects={projects}
        project={project}
        ready={ready}
        onSwitch={(id) => {
          setProjectId(id);
          setShotId(projects.find((p) => p.id === id)?.shots[0]?.id);
        }}
        onNew={() => {
          const p = newProject(`Film ${projects.length + 1}`);
          setProjects([p, ...projects]);
          saveProject(p, 0);
          setProjectId(p.id);
          setShotId(p.shots[0].id);
        }}
        onRename={(name) => mutate(pid, (p) => ({ ...p, name }))}
        onDelete={async () => {
          if (!window.confirm(`Delete "${project.name}" and all its takes from this browser?`)) return;
          await deleteProject(pid);
          const rest = projects.filter((p) => p.id !== pid);
          const next = rest.length ? rest : [newProject()];
          if (!rest.length) saveProject(next[0], 0);
          setProjects(next);
          setProjectId(next[0].id);
          setShotId(next[0].shots[0]?.id);
        }}
        onAspect={(aspect: Aspect) => mutate(pid, (p) => ({ ...p, aspect }))}
        onLook={(look) => mutate(pid, (p) => ({ ...p, look }))}
        onSettings={() => setDialog("settings")}
      />

      <div className="main">
        <ShotRail
          shots={project.shots}
          currentId={shot.id}
          aspect={project.aspect}
          onSelect={setShotId}
          onAdd={() =>
            insertShotAfter(
              shot.id,
              newShot({ modelKey: shot.modelKey, customEndpoint: shot.customEndpoint, camera: { ...shot.camera } }),
            )
          }
          onMove={(id, dir) =>
            mutate(pid, (p) => {
              const shots = [...p.shots];
              const i = shots.findIndex((s) => s.id === id);
              const j = i + dir;
              if (j < 0 || j >= shots.length) return p;
              [shots[i], shots[j]] = [shots[j], shots[i]];
              return { ...p, shots };
            })
          }
          onDuplicate={(id) => {
            const src = project.shots.find((s) => s.id === id);
            if (src) insertShotAfter(id, newShot({ ...src, id: uid("s_"), takes: [], selectedTakeId: undefined, title: src.title ? src.title + " copy" : "" }));
          }}
          onDelete={(id) => {
            const target = project.shots.find((s) => s.id === id);
            if (target?.takes.length && !window.confirm("Delete this shot and its takes?")) return;
            const i = project.shots.findIndex((s) => s.id === id);
            mutate(pid, (p) => ({ ...p, shots: p.shots.filter((s) => s.id !== id) }));
            if (id === shot.id) setShotId(project.shots[i + 1]?.id ?? project.shots[i - 1]?.id);
          }}
        />

        <main className="stage">
          <ShotEditor
            key={shot.id}
            project={project}
            shot={shot}
            shotNumber={shotIndex + 1}
            ready={ready}
            onChange={(patch) => patchShot(shot.id, patch)}
            onGenerate={(plan, count) => generate(shot, plan, count)}
            onOpenSettings={() => setDialog("settings")}
          />

          <section className="takes" aria-label="Takes">
            <div className="takes__head">
              <h2>Takes</h2>
              <span className="mono dim">{shot.takes.length}</span>
            </div>
            {shot.takes.length ? (
              <div className="takes__grid">
                {shot.takes.map((t, i) => {
                  const ref = { projectId: pid, shotId: shot.id, takeId: t.id };
                  return (
                    <TakeCard
                      key={t.id}
                      take={t}
                      index={shot.takes.length - 1 - i}
                      aspect={project.aspect}
                      selected={shot.selectedTakeId === t.id}
                      onSelect={() => patchShot(shot.id, { selectedTakeId: shot.selectedTakeId === t.id ? undefined : t.id })}
                      onExtend={() => startFromFrame(shot, t, "last")}
                      onGrabFrame={(sec) => startFromFrame(shot, t, sec)}
                      onDownload={() =>
                        downloadClip(t.videoUrl!, `${slug(project.name)}-shot${shotIndex + 1}-t${shot.takes.length - i}.mp4`).catch((e) =>
                          setToast(e instanceof Error ? e.message : String(e)),
                        )
                      }
                      onDelete={() =>
                        patchShot(shot.id, {
                          takes: shot.takes.filter((x) => x.id !== t.id),
                          selectedTakeId: shot.selectedTakeId === t.id ? undefined : shot.selectedTakeId,
                        })
                      }
                      onCancel={async () => {
                        if (isHfEndpoint(t.endpoint)) {
                          const { cancelHfTake } = await import("@/lib/hf-client");
                          if (!cancelHfTake(t.id)) updateTake(ref, { status: "failed", error: "Cancelled." });
                          return;
                        }
                        try {
                          await api.cancel(t.responseUrl!);
                          updateTake(ref, { status: "failed", error: "Cancelled." });
                        } catch (e) {
                          setToast("Couldn't cancel: " + (e instanceof Error ? e.message : String(e)));
                        }
                      }}
                      onRetry={() => {
                        const sent = sentInputs.get(t.id);
                        if (!sent) return setToast("Press Generate to render this shot again.");
                        updateTake(ref, {
                          status: "submitting",
                          error: undefined,
                          createdAt: Date.now(),
                          finishedAt: undefined,
                          statusUrl: undefined,
                          responseUrl: undefined,
                        });
                        runTake(ref, sent.endpoint, sent.input, updateTake, sent.mode);
                      }}
                      onDuration={(d) => updateTake(ref, { duration: d })}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="takes__empty">
                <p>No takes yet. Write a prompt, pick a model and press Generate.</p>
                <p className="dim small">
                  Tip: make a still in any image tool, drop it in Start frame, and the model animates it. That&apos;s the
                  most reliable way to keep a character consistent across shots.
                </p>
              </div>
            )}
          </section>
        </main>
      </div>

      <Timeline
        shots={project.shots}
        currentId={shot.id}
        aspect={project.aspect}
        onSelect={setShotId}
        onPlay={() => setDialog("play")}
        onExport={() => setDialog("export")}
      />

      {dialog === "settings" ? (
        <SettingsDialog serverKey={serverKey} onClose={() => setDialog(null)} onSaved={() => setReady(credentials.ready)} />
      ) : null}
      {dialog === "play" ? (
        <FilmPlayer
          clips={clips.map((c) => ({ url: c.take!.videoUrl!, label: c.shot.title || `Shot ${c.index + 1}` }))}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "export" ? (
        <ExportDialog clipUrls={clips.map((c) => c.take!.videoUrl!)} name={project.name} onClose={() => setDialog(null)} />
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
