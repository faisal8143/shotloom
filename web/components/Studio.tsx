"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, credentials, serverHasKey } from "@/lib/client-api";
import { isHfEndpoint } from "@/lib/hf";
import { downloadClip, grabFrame, slug } from "@/lib/media";
import {
  findTake,
  mediaItems,
  moveInScene,
  newProject,
  newShot,
  normalizeProject,
  placeFinishedTake,
  sceneClips,
  type MediaItem,
} from "@/lib/project";
import { follow, runTake, type TakeRef } from "@/lib/runner";
import { deleteProject, flushSaves, loadProjects, saveProject } from "@/lib/store";
import { uid, type Project, type Shot, type Take } from "@/lib/types";
import { Composer, type ComposerHandle, type GeneratePlan } from "./Composer";
import { CharactersView } from "./CharactersView";
import { ExportDialog } from "./ExportDialog";
import { Icon } from "./Icon";
import { LibraryView } from "./LibraryView";
import { MediaCard, isWorking } from "./MediaCard";
import { Modal } from "./Modal";
import { MenuItem, Popover } from "./Popover";
import { ScenesView } from "./ScenesView";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar, type View } from "./Sidebar";
import { Viewer } from "./Viewer";

const LAST_PROJECT = "shotloom.lastProject";
const COLLAPSED = "shotflow.sidebarCollapsed";
// exact inputs of takes sent in this session, so "Try again" can resend them (images aren't stored on takes)
const sentInputs = new Map<string, { endpoint: string; input: Record<string, unknown>; mode: "text" | "image" }>();

type Filter = "all" | "done" | "working" | "failed";

const TITLES: Record<View, string> = {
  media: "All media",
  characters: "Characters",
  scenes: "Scenes",
  library: "Library",
  bin: "Bin",
};

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export default function Studio() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string>();
  const [view, setView] = useState<View>("media");
  const [ready, setReady] = useState(false);
  const [serverKey, setServerKey] = useState(false);
  const [dialog, setDialog] = useState<"settings" | "export" | "help" | null>(null);
  const [toast, setToast] = useState<string>();
  const [viewer, setViewer] = useState<{ takeId: string; from: "media" | "scenes" | "bin" }>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const resumed = useRef(false);

  // ---- load -----------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      const [list, hasServerKey] = await Promise.all([loadProjects(), serverHasKey()]);
      if (!alive) return;
      let all = list.map(normalizeProject);
      if (!all.length) {
        all = [newProject()];
        saveProject(all[0], 0);
      }
      const last = readLocal(LAST_PROJECT);
      const current = all.find((p) => p.id === last) ?? all[0];
      setProjects(all);
      setProjectId(current.id);
      setServerKey(hasServerKey);
      setReady(credentials.ready);
      setCollapsed(readLocal(COLLAPSED) === "1");
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

  useEffect(() => {
    if (projectId) writeLocal(LAST_PROJECT, projectId);
  }, [projectId]);

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
      mutate(ref.projectId, (p) => {
        const next = {
          ...p,
          shots: p.shots.map((s) =>
            s.id !== ref.shotId ? s : { ...s, takes: s.takes.map((t) => (t.id === ref.takeId ? { ...t, ...patch } : t)) },
          ),
        };
        return patch.status === "done" ? placeFinishedTake(next, ref.shotId, ref.takeId) : next;
      });
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
          if (isHfEndpoint(t.endpoint) && isWorking(t)) {
            // a Space is followed over one open connection, which the closed tab ended
            updateTake(ref, { status: "failed", error: "The page closed while the Space was rendering. Press Try again.", finishedAt: Date.now() });
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

  const media = useMemo(() => (project ? mediaItems(project) : []), [project]);
  const binned = useMemo(() => (project ? mediaItems(project, { deleted: true }) : []), [project]);
  const scene = useMemo(() => (project ? sceneClips(project) : []), [project]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return media.filter((m) => {
      if (filter === "done" && m.take.status !== "done") return false;
      if (filter === "working" && !isWorking(m.take)) return false;
      if (filter === "failed" && m.take.status !== "failed") return false;
      return !q || m.take.prompt.toLowerCase().includes(q) || m.take.modelName.toLowerCase().includes(q);
    });
  }, [media, query, filter]);

  if (!projects || !project || !project.draft) {
    return (
      <div className="boot">
        <span className="logo logo--big" aria-hidden>
          <Icon name="spark" size={26} />
        </span>
        <span className="spinner" aria-hidden />
      </div>
    );
  }

  const pid = project.id;
  const draft = project.draft;
  const sceneIds = project.scene ?? [];
  const errorMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const patchDraft = (patch: Partial<Shot>) => mutate(pid, (p) => ({ ...p, draft: { ...(p.draft ?? newShot()), ...patch } }));
  const patchTakeIn = (takeId: string, patch: Partial<Take>) =>
    mutate(pid, (p) => ({ ...p, shots: p.shots.map((s) => ({ ...s, takes: s.takes.map((t) => (t.id === takeId ? { ...t, ...patch } : t)) })) }));

  function generate(plan: GeneratePlan, count: number) {
    const now = Date.now();
    const takes: Take[] = Array.from({ length: count }, (_, i) => ({
      id: uid("t_"),
      createdAt: now + i,
      endpoint: plan.endpoint,
      modelName: plan.modelName,
      prompt: plan.prompt,
      params: Object.fromEntries(Object.entries(plan.input).filter(([, v]) => typeof v !== "string" || !v.startsWith("data:"))),
      status: "submitting",
    }));
    const record: Shot = { ...draft, id: uid("s_"), title: "", takes, params: { ...draft.params }, camera: { ...draft.camera }, references: [...draft.references] };
    mutate(pid, (p) => ({ ...p, shots: [...p.shots, record], draft: { ...draft, afterTakeId: undefined } }));
    setView("media");
    setFilter("all");
    setQuery("");
    requestAnimationFrame(() => document.querySelector(".content")?.scrollTo({ top: 0, behavior: "smooth" }));
    for (const t of takes) {
      const input = { ...plan.input };
      // several outputs of the same prompt should differ: let the model pick each seed
      if (count > 1) delete input.seed;
      sentInputs.set(t.id, { endpoint: plan.endpoint, input, mode: plan.mode });
      runTake({ projectId: pid, shotId: record.id, takeId: t.id }, plan.endpoint, input, updateTake, plan.mode);
    }
  }

  async function fromFrame(item: MediaItem, at: number | "last") {
    if (!item.take.videoUrl) return;
    setToast(at === "last" ? "Grabbing the last frame…" : "Grabbing that frame…");
    try {
      const frame = await grabFrame(item.take.videoUrl, at);
      if (at === "last") {
        mutate(pid, (p) => ({
          ...p,
          scene: (p.scene ?? []).includes(item.take.id) ? p.scene : [...(p.scene ?? []), item.take.id],
          draft: { ...(p.draft ?? newShot()), startFrame: frame, endFrame: undefined, afterTakeId: item.take.id, prompt: "" },
        }));
        setToast("Describe what happens next, then press Enter.");
      } else {
        patchDraft({ startFrame: frame, endFrame: undefined, afterTakeId: undefined });
        setToast("Frame added as the start of your next clip.");
      }
      setViewer(undefined);
      setView("media");
      requestAnimationFrame(() => composer.current?.focus());
    } catch (e) {
      setToast(errorMsg(e));
    }
  }

  function reuse(item: MediaItem) {
    const s = item.shot;
    patchDraft({
      prompt: s.prompt,
      modelKey: s.modelKey,
      customEndpoint: s.customEndpoint,
      params: { ...s.params },
      camera: { ...s.camera },
      startFrame: s.startFrame,
      endFrame: s.endFrame,
      references: [...s.references],
      afterTakeId: undefined,
    });
    setViewer(undefined);
    setView("media");
    requestAnimationFrame(() => composer.current?.focus());
  }

  function retry(item: MediaItem) {
    const ref = { projectId: pid, shotId: item.shot.id, takeId: item.take.id };
    const sent = sentInputs.get(item.take.id);
    if (!sent) {
      reuse(item);
      setToast("Prompt is back in the box. Press Enter to generate it again.");
      return;
    }
    updateTake(ref, { status: "submitting", error: undefined, createdAt: Date.now(), finishedAt: undefined, statusUrl: undefined, responseUrl: undefined });
    runTake(ref, sent.endpoint, sent.input, updateTake, sent.mode);
  }

  async function cancel(item: MediaItem) {
    const ref = { projectId: pid, shotId: item.shot.id, takeId: item.take.id };
    if (isHfEndpoint(item.take.endpoint)) {
      const { cancelHfTake } = await import("@/lib/hf-client");
      if (!cancelHfTake(item.take.id)) updateTake(ref, { status: "failed", error: "Cancelled." });
      return;
    }
    try {
      if (item.take.responseUrl) await api.cancel(item.take.responseUrl);
      updateTake(ref, { status: "failed", error: "Cancelled." });
    } catch (e) {
      setToast("Couldn't cancel: " + errorMsg(e));
    }
  }

  const toggleScene = (takeId: string) =>
    mutate(pid, (p) => {
      const sc = p.scene ?? [];
      return { ...p, scene: sc.includes(takeId) ? sc.filter((x) => x !== takeId) : [...sc, takeId] };
    });

  const binTake = (takeId: string) => {
    mutate(pid, (p) => ({
      ...p,
      scene: (p.scene ?? []).filter((x) => x !== takeId),
      shots: p.shots.map((s) => ({ ...s, takes: s.takes.map((t) => (t.id === takeId ? { ...t, deleted: true } : t)) })),
    }));
    setToast("Moved to Bin.");
  };

  const purge = (ids: string[]) =>
    mutate(pid, (p) => ({
      ...p,
      shots: p.shots.map((s) => ({ ...s, takes: s.takes.filter((t) => !ids.includes(t.id)) })).filter((s) => s.takes.length),
    }));

  function newProjectNow() {
    const p = newProject();
    setProjects([p, ...projects!]);
    saveProject(p, 0);
    setProjectId(p.id);
    setView("media");
  }

  function renameProject(id: string) {
    const p = projects!.find((x) => x.id === id);
    const name = window.prompt("Project name", p?.name ?? "");
    if (name?.trim()) mutate(id, (x) => ({ ...x, name: name.trim() }));
  }

  async function removeProject(id: string) {
    const p = projects!.find((x) => x.id === id);
    if (!p || !window.confirm(`Delete "${p.name}" and all its clips from this browser?`)) return;
    await deleteProject(id);
    const rest = projects!.filter((x) => x.id !== id);
    const next = rest.length ? rest : [newProject()];
    if (!rest.length) saveProject(next[0], 0);
    setProjects(next);
    if (id === pid) setProjectId(next[0].id);
  }

  // ---- viewer ---------------------------------------------------------------
  const viewerList = viewer?.from === "scenes" ? scene : viewer?.from === "bin" ? binned : visible;
  const viewerIndex = viewer ? viewerList.findIndex((m) => m.take.id === viewer.takeId) : -1;
  const viewerItem = viewer ? (viewerList[viewerIndex] ?? findTake(project, viewer.takeId)) : undefined;

  const extendingLabel = draft.afterTakeId ? findTake(project, draft.afterTakeId)?.shot.prompt.slice(0, 40) || "clip" : undefined;
  const showComposer = view === "media" || view === "characters";
  const working = media.filter((m) => isWorking(m.take)).length;

  return (
    <div className={"app" + (collapsed ? " app--collapsed" : "")}>
      <Sidebar
        view={view}
        projectName={project.name}
        counts={{ media: media.length, scenes: scene.length, characters: project.characters?.length, bin: binned.length }}
        collapsed={collapsed}
        open={sideOpen}
        onView={setView}
        onNewProject={newProjectNow}
        onRename={() => renameProject(pid)}
        onDeleteProject={() => removeProject(pid)}
        onCollapse={() => {
          setCollapsed((c) => {
            writeLocal(COLLAPSED, c ? "0" : "1");
            return !c;
          });
        }}
        onClose={() => setSideOpen(false)}
      />

      <div
        className={"main" + (dragging ? " is-dragging" : "")}
        onDragOver={(e) => {
          if (!showComposer || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          setDragging(false);
          const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
          if (!file || !showComposer) return;
          e.preventDefault();
          composer.current?.addImage(file);
        }}
      >
        <header className="topbar">
          <button className="icon-btn topbar__menu" onClick={() => setSideOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <h1 className="topbar__title">{TITLES[view]}</h1>
          {view === "media" || view === "bin" ? (
            <div className="search">
              <Icon name="search" size={18} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search prompts" aria-label="Search prompts" />
              {query ? (
                <button className="icon-btn" onClick={() => setQuery("")} aria-label="Clear search">
                  <Icon name="x" size={14} />
                </button>
              ) : null}
            </div>
          ) : (
            <span className="search search--ghost" />
          )}
          {view === "media" ? (
            <Popover label="Filter" placement="down" buttonClass={"icon-btn icon-btn--boxed" + (filter !== "all" ? " is-on" : "")} trigger={<Icon name="filter" />}>
              {(close) => (
                <div className="menu">
                  {(
                    [
                      ["all", "All clips"],
                      ["done", "Ready"],
                      ["working", "Generating"],
                      ["failed", "Failed"],
                    ] as [Filter, string][]
                  ).map(([f, label]) => (
                    <MenuItem key={f} icon={filter === f ? <Icon name="check" /> : <span />} onClick={() => { setFilter(f); close(); }}>
                      {label}
                    </MenuItem>
                  ))}
                </div>
              )}
            </Popover>
          ) : null}
          <span className="spacer" />
          {working ? (
            <span className="topbar__busy" title={`${working} generating`}>
              <span className="spinner spinner--sm" aria-hidden /> {working}
            </span>
          ) : null}
          <button className="icon-btn" onClick={newProjectNow} aria-label="New project" title="New project">
            <Icon name="plus" />
          </button>
          <button className="icon-btn" onClick={() => setDialog("help")} aria-label="Help" title="Help">
            <Icon name="help" />
          </button>
          <button className="icon-btn" onClick={() => setDialog("settings")} aria-label="Settings" title="Settings">
            <Icon name="gear" />
          </button>
        </header>

        <main className={"content" + (showComposer ? " content--composer" : "")}>
          {view === "media" ? (
            visible.length ? (
              <div className={"grid grid--" + project.aspect.replace(":", "x")}>
                {visible.map((m) => (
                  <MediaCard
                    key={m.take.id}
                    take={m.take}
                    aspect={project.aspect}
                    inScene={sceneIds.includes(m.take.id)}
                    onOpen={() => setViewer({ takeId: m.take.id, from: "media" })}
                    onDuration={(d) => patchTakeIn(m.take.id, { duration: d })}
                  />
                ))}
              </div>
            ) : media.length ? (
              <div className="empty">
                <Icon name="search" size={40} />
                <p className="empty__title">Nothing matches</p>
                <button className="btn" onClick={() => { setQuery(""); setFilter("all"); }}>
                  Clear search
                </button>
              </div>
            ) : (
              <div className="empty">
                <Icon name="spark" size={48} />
                <p className="empty__title">Start creating or drop media</p>
                <p className="empty__text">
                  Describe a shot below and press Enter. Drop an image here to animate it. The first two models are free.
                </p>
              </div>
            )
          ) : view === "scenes" ? (
            <ScenesView
              clips={scene}
              aspect={project.aspect}
              onMove={(id, dir) => mutate(pid, (p) => ({ ...p, scene: moveInScene(p.scene ?? [], id, dir) }))}
              onRemove={(id) => toggleScene(id)}
              onOpen={(id) => setViewer({ takeId: id, from: "scenes" })}
              onExport={() => setDialog("export")}
              onBrowse={() => setView("media")}
            />
          ) : view === "characters" ? (
            <CharactersView
              characters={project.characters ?? []}
              onChange={(characters) => mutate(pid, (p) => ({ ...p, characters }))}
              onUse={(c, as) => {
                if (as === "start") patchDraft({ startFrame: c.image, endFrame: undefined });
                else patchDraft({ references: [...draft.references, c.image].slice(0, 3) });
                setToast(`${c.name} added to the prompt box.`);
              }}
              onNotice={setToast}
            />
          ) : view === "library" ? (
            <LibraryView
              projects={projects}
              currentId={pid}
              onOpen={(id) => {
                setProjectId(id);
                setView("media");
              }}
              onNew={newProjectNow}
              onRename={renameProject}
              onDelete={removeProject}
            />
          ) : (
            <div className="bin">
              {binned.length ? (
                <>
                  <div className="bin__bar">
                    <p className="view-intro">Deleted clips stay here until you empty the Bin.</p>
                    <button
                      className="btn btn--danger"
                      onClick={() => {
                        if (window.confirm(`Delete ${binned.length} clip(s) for good?`)) purge(binned.map((m) => m.take.id));
                      }}
                    >
                      Empty Bin
                    </button>
                  </div>
                  <div className="grid">
                    {binned
                      .filter((m) => !query.trim() || m.take.prompt.toLowerCase().includes(query.trim().toLowerCase()))
                      .map((m) => (
                        <div key={m.take.id} className="bin-item">
                          <MediaCard take={m.take} aspect={project.aspect} inScene={false} onOpen={() => setViewer({ takeId: m.take.id, from: "bin" })} onDuration={() => undefined} />
                          <span className="bin-item__tools">
                            <button className="btn btn--sm" onClick={() => patchTakeIn(m.take.id, { deleted: false })}>
                              <Icon name="undo" size={14} /> Restore
                            </button>
                            <button className="btn btn--sm btn--danger" onClick={() => purge([m.take.id])}>
                              Delete forever
                            </button>
                          </span>
                        </div>
                      ))}
                  </div>
                </>
              ) : (
                <div className="empty">
                  <Icon name="trash" size={44} />
                  <p className="empty__title">Bin is empty</p>
                </div>
              )}
            </div>
          )}
        </main>

        {showComposer ? (
          <div className="composer-dock">
            <Composer
              ref={composer}
              project={project}
              draft={draft}
              ready={ready}
              extending={extendingLabel}
              onChange={patchDraft}
              onGenerate={generate}
              onOpenSettings={() => {
                setToast("This model runs on fal.ai and needs your key. The two LTX models are free.");
                setDialog("settings");
              }}
              onAspect={(aspect) => mutate(pid, (p) => ({ ...p, aspect }))}
              onNotice={setToast}
            />
            <p className="composer-dock__note">Shotflow can make mistakes, so double-check it. Clips are saved in this browser.</p>
          </div>
        ) : null}

        {dragging ? (
          <div className="dropzone" aria-hidden>
            <Icon name="image" size={36} />
            <span>Drop to use as {draft.startFrame ? "an ingredient" : "the start frame"}</span>
          </div>
        ) : null}
      </div>

      {viewerItem ? (
        <Viewer
          key={viewerItem.take.id}
          item={viewerItem}
          inScene={sceneIds.includes(viewerItem.take.id)}
          actions={{
            onToggleScene: () => {
              toggleScene(viewerItem.take.id);
              setToast(sceneIds.includes(viewerItem.take.id) ? "Removed from scene." : "Added to scene.");
            },
            onExtend: () => fromFrame(viewerItem, "last"),
            onFrame: (sec) => fromFrame(viewerItem, sec),
            onReuse: () => reuse(viewerItem),
            onDownload: () =>
              downloadClip(viewerItem.take.videoUrl!, `${slug(project.name)}-${slug(viewerItem.take.prompt).slice(0, 24)}.mp4`).catch((e) => setToast(errorMsg(e))),
            onDelete: () => {
              if (viewerItem.take.deleted) purge([viewerItem.take.id]);
              else binTake(viewerItem.take.id);
              setViewer(undefined);
            },
            onRetry: () => retry(viewerItem),
            onCancel: () => cancel(viewerItem),
            onPrev: viewerIndex > 0 ? () => setViewer({ ...viewer!, takeId: viewerList[viewerIndex - 1].take.id }) : undefined,
            onNext:
              viewerIndex >= 0 && viewerIndex < viewerList.length - 1
                ? () => setViewer({ ...viewer!, takeId: viewerList[viewerIndex + 1].take.id })
                : undefined,
            onClose: () => setViewer(undefined),
          }}
        />
      ) : null}

      {dialog === "settings" ? (
        <SettingsDialog serverKey={serverKey} onClose={() => setDialog(null)} onSaved={() => setReady(credentials.ready)} />
      ) : null}
      {dialog === "export" ? (
        <ExportDialog clipUrls={scene.map((c) => c.take.videoUrl!)} name={project.name} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "help" ? (
        <Modal title="How Shotflow works" onClose={() => setDialog(null)}>
          <ol className="help">
            <li>
              <strong>Describe a shot</strong> in the box at the bottom and press Enter. Pick the model from the pill next to
              <strong> +</strong>. The two LTX models are free; the others use your fal.ai key (Settings).
            </li>
            <li>
              <strong>Add images</strong> with <strong>+</strong>, or drop/paste one: a start frame is animated, an end frame is
              where the shot lands, ingredients keep characters consistent (Veo 3.1).
            </li>
            <li>
              <strong>Open a clip</strong> to watch it, then <em>Add to scene</em>, <em>Extend</em> it from its last frame, or{" "}
              <em>Use this frame</em> to branch off.
            </li>
            <li>
              <strong>Scenes</strong> plays your clips in order. Reorder them there and <em>Export MP4</em> to get one video.
            </li>
            <li>
              The <strong>sliders</strong> button sets the aspect ratio and how many videos each prompt makes.
            </li>
          </ol>
        </Modal>
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
