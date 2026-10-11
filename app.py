#!/usr/bin/env python3
"""Shotloom - an open-source, Flow-style AI video studio.

    python app.py                 # local, http://127.0.0.1:7860
    python app.py --share         # public link (Kaggle / Colab / phone)
    python app.py --engine preview  # no GPU: camera-move preview engine
"""
from __future__ import annotations

import argparse
import os
import threading

import gradio as gr

from shotloom import looks, studio, video
from shotloom.engines import CAMERA_PROMPTS, DEFAULT_NEGATIVE, QUALITY_NAMES, build_prompt, make_engine
from shotloom.project import SECONDS, Project, Shot, list_projects

ROOT = os.path.abspath(os.environ.get("SHOTLOOM_HOME", "projects"))
ENGINE = None
STOP = threading.Event()
NEW = "+ new shot"
CAMS = list(CAMERA_PROMPTS)
SIZES, LENSES, LIGHTS, LOOKS = list(looks.SHOT_SIZES), list(looks.LENSES), list(looks.LIGHTING), list(looks.LOOKS)


def P(name) -> Project:
    if not name:
        raise gr.Error("Create or pick a project first")
    return Project(ROOT, name)


def shot_choices(p: Project):
    return [s.id for s in p.shots]


def take_label(i, t):
    tag = {"ai": "AI", "still": "still", "preview": "preview"}.get(t.kind, t.kind)
    q = f" {t.quality}" if t.quality else ""
    return f"#{i + 1} {tag}{q} seed {t.seed}"


# ------------------------------------------------------------------ project
def open_project(name):
    if not name:                      # fresh install / no project picked yet
        return (gr.skip(),) * 11
    p = P(name)
    ids = shot_choices(p)
    first = ids[0] if ids else None
    return (p.table(), p.aspect, p.style, p.negative or DEFAULT_NEGATIVE,
            gr.Dropdown(choices=[NEW] + ids, value=NEW),
            gr.Dropdown(choices=ids, value=first),
            status_line(p), scene_rows(p), p.look, p.letterbox, p.grain)


def create_project(new_name):
    if not (new_name or "").strip():
        raise gr.Error("Type a project name")
    p = Project(ROOT, new_name)
    return gr.Dropdown(choices=list_projects(ROOT), value=p.name), ""


def save_settings(name, aspect, style, negative, look, letterbox, grain):
    p = P(name)
    p.aspect, p.style = aspect, style or ""
    p.look, p.letterbox, p.grain = look or "none", bool(letterbox), float(grain or 0)
    p.negative = "" if (negative or "").strip() == DEFAULT_NEGATIVE else (negative or "")
    p.save()
    return status_line(p)


def status_line(p: Project):
    ai = sum(1 for s in p.shots if s.mode == "AI")
    done = sum(1 for s in p.shots if s.takes)
    need = ""
    if getattr(ENGINE, "image_only", False):
        nofr = sum(1 for s in p.shots if s.mode == "AI" and not s.frame)
        if nofr:
            need = f" - **{nofr} AI shot(s) need a first frame** for this engine"
    return (f"**{p.name}** - {len(p.shots)} shots ({ai} AI / {len(p.shots) - ai} still), "
            f"{p.total_seconds():.0f}s of picture, {done} with takes - {p.aspect}, look: {p.look} - "
            f"engine: {ENGINE.describe()}{need}")


# ------------------------------------------------------------------ shots tab
def import_csv(name, csv_file, images, replace):
    if not csv_file:
        raise gr.Error("Attach a shots CSV")
    p = P(name)
    added, missing = p.import_csv(csv_file, images or [], replace=bool(replace))
    msg = f"Imported {added} shots."
    if missing:
        msg += f" No image found for: {', '.join(missing[:20])}" + (" ..." if len(missing) > 20 else "")
    ids = shot_choices(p)
    return (msg, p.table(), gr.Dropdown(choices=[NEW] + ids, value=NEW),
            gr.Dropdown(choices=ids, value=ids[0] if ids else None), status_line(p), scene_rows(p))


def load_shot(name, sid):
    blank = ("", 6, "AI", "auto", "", "", None, "auto", "auto", "auto")
    if not name or not sid or sid == NEW:
        return blank
    p = P(name)
    s = p.get(sid)
    if not s:
        return blank
    return (s.id, int(s.seconds) if s.seconds in SECONDS else s.seconds, s.mode, s.camera,
            s.prompt, s.notes, p.abs(s.frame) or None, s.size, s.lens, s.light)


def save_shot(name, sel, sid, seconds, mode, camera, prompt, notes, frame, size, lens, light):
    p = P(name)
    sid = (sid or "").strip() or (sel if sel and sel != NEW else p.next_id())
    old = p.get(sid)
    s = Shot(id=sid, seconds=float(seconds), mode=mode, prompt=prompt or "",
             camera=camera or "auto", notes=notes or "", size=size or "auto",
             lens=lens or "auto", light=light or "auto",
             frame=old.frame if old else "")
    if frame and os.path.exists(frame) and os.path.abspath(frame) != os.path.abspath(p.abs(s.frame)):
        p.set_frame(s, frame)
    p.upsert(s)
    ids = shot_choices(p)
    return (p.table(), gr.Dropdown(choices=[NEW] + ids, value=sid),
            gr.Dropdown(choices=ids, value=sid), status_line(p), scene_rows(p), f"Saved {sid}")


def delete_shot(name, sel):
    p = P(name)
    if sel and sel != NEW:
        p.delete(sel)
    ids = shot_choices(p)
    return (p.table(), gr.Dropdown(choices=[NEW] + ids, value=NEW),
            gr.Dropdown(choices=ids, value=ids[0] if ids else None), status_line(p), scene_rows(p))


def move_shot(name, sel, delta):
    p = P(name)
    if sel and sel != NEW:
        p.move(sel, delta)
    return p.table(), scene_rows(p)


# ------------------------------------------------------------------ generate tab
def gen_view(name, sid):
    """Frame, prompt, takes for the Generate tab."""
    empty = (None, "", "auto", 6, gr.Dropdown(choices=[], value=None), None, "auto", "auto", "auto")
    if not name or not sid:
        return empty
    p = P(name)
    s = p.get(sid)
    if not s:
        return empty
    labels = [take_label(i, t) for i, t in enumerate(s.takes)]
    t = s.chosen_take()
    cur = labels[s.takes.index(t)] if t else None
    return (p.abs(s.frame) or None, s.prompt, s.camera, s.seconds,
            gr.Dropdown(choices=labels, value=cur), p.abs(t.file) if t else None,
            s.size, s.lens, s.light)


def prompt_preview(name, prompt, camera, size, lens, light):
    """The exact prompt the model will receive."""
    if not name:
        return ""
    p = P(name)
    shot = Shot(id="_", prompt=prompt or "", camera=camera, size=size, lens=lens, light=light)
    text = build_prompt(shot.prompt, camera, p.style, shot=shot, look=p.look)
    return f"**Prompt sent to the model:** {text}" if text else ""


def _apply_edits(p, s, frame, prompt, camera, seconds, size="auto", lens="auto", light="auto"):
    s.prompt, s.camera, s.seconds = prompt or "", camera or "auto", float(seconds)
    s.size, s.lens, s.light = size or "auto", lens or "auto", light or "auto"
    if frame and os.path.exists(frame) and os.path.abspath(frame) != os.path.abspath(p.abs(s.frame)):
        p.set_frame(s, frame)
    elif not frame:
        s.frame = ""
    p.save()


def _tee(logs):
    """Log to the UI and to the server console (the Kaggle cell shows it live)."""
    def log(msg):
        logs.append(msg)
        print(msg, flush=True)
    return log


def do_generate(name, sid, frame, prompt, camera, seconds, quality, seed, steps, size, lens, light,
                kind, progress):
    p = P(name)
    s = p.get(sid)
    if not s:
        raise gr.Error("Pick a shot (or add one in the Shots tab)")
    _apply_edits(p, s, frame, prompt, camera, seconds, size, lens, light)
    logs = []
    try:
        if kind == "ai":
            if ENGINE.kind == "preview":
                gr.Warning("No GPU engine - making a preview (camera move) instead")
            progress(0, desc="loading model / encoding prompt...")
            studio.generate_ai(p, ENGINE, s, quality=quality, seed=int(seed),
                               steps=int(steps) or None, log=_tee(logs),
                               progress=lambda i, n: progress(i / n, desc=f"step {i}/{n}"))
        else:
            studio.animate_still(p, s, seed=None, log=_tee(logs))
    except Exception as e:
        raise gr.Error(str(e))
    view = gen_view(name, sid)
    return view[5], view[4], "\n".join(logs), p.table(), status_line(p), scene_rows(p)


def gen_ai(name, sid, frame, prompt, camera, seconds, quality, seed, steps, size, lens, light,
           progress=gr.Progress()):
    return do_generate(name, sid, frame, prompt, camera, seconds, quality, seed, steps,
                       size, lens, light, "ai", progress)


def gen_still(name, sid, frame, prompt, camera, seconds, quality, seed, steps, size, lens, light,
              progress=gr.Progress()):
    return do_generate(name, sid, frame, prompt, camera, seconds, quality, seed, steps,
                       size, lens, light, "still", progress)


def pick_take(name, sid, label):
    p = P(name)
    s = p.get(sid)
    if not s or not label:
        return None
    i = int(label.split()[0][1:]) - 1
    return p.abs(s.takes[i].file)


def use_take(name, sid, label):
    p = P(name)
    s = p.get(sid)
    if not s or not label:
        raise gr.Error("Pick a take")
    s.chosen = int(label.split()[0][1:]) - 1
    p.save()
    gr.Info(f"{sid} now uses take {label.split()[0]}")
    return p.table(), scene_rows(p)


def do_extend(name, sid, ext_prompt):
    p = P(name)
    s = p.get(sid)
    if not s:
        raise gr.Error("Pick a shot")
    try:
        new = studio.extend(p, s, prompt=ext_prompt or "")
    except Exception as e:
        raise gr.Error(str(e))
    ids = shot_choices(p)
    gr.Info(f"Created {new.id} starting on the last frame of {sid}. Generate it next.")
    return (gr.Dropdown(choices=ids, value=new.id), gr.Dropdown(choices=[NEW] + ids, value=NEW),
            p.table(), scene_rows(p))


# ------------------------------------------------------------------ batch tab
def run_batch(name, ai, stills, only_missing, placeholders, quality):
    p = P(name)
    STOP.clear()
    lines = []
    for line in studio.batch(p, ENGINE, ai=ai, stills=stills, only_missing=only_missing,
                             quality=quality, placeholders=placeholders, stop=STOP.is_set):
        lines.append(line)
        yield "\n".join(lines[-400:])


def stop_batch():
    STOP.set()
    return "stopping after the current shot..."


# ------------------------------------------------------------------ scenebuilder
def scene_rows(p: Project):
    rows, t = [], 0.0
    for s in p.shots:
        tk = s.chosen_take()
        rows.append([s.id, f"{t:.0f}s", s.seconds, tk.kind if tk else "(placeholder)",
                     os.path.basename(tk.file) if tk else "-"])
        t += s.seconds
    return rows


def do_build(name, audio, finish):
    p = P(name)
    logs = []
    try:
        out = studio.build(p, audio=audio or None, log=_tee(logs), finish=bool(finish))
    except Exception as e:
        raise gr.Error(str(e))
    return out, out, "\n".join(logs), scene_rows(p)


# ------------------------------------------------------------------ ui
HELP = """
### How it works
1. **Project** - one per film. Pick 16:9 (YouTube) or 9:16 (Shorts / Reels), a **look** (grade + style words),
   letterbox and grain. *Style* is added to every AI prompt.
2. **Shots** - import your shot list CSV + images (columns: `shot_id, seconds, type, image, motion_prompt,
   camera_move, shot_size, lens, lighting, notes`; type `HERO`/`AI` = AI video, `STILL` = camera move), or add shots by hand.
3. **Generate** - per shot: **Generate video** or **Animate still** (free, instant camera move). Set shot size, lens and
   lighting like a cinematographer - the line under the prompt shows exactly what the model receives.
   Make several takes, keep the best with **Use this take**. **Extend** starts a new shot on the last frame.
4. **Batch** - render every shot unattended. Stop any time; Run again resumes.
5. **Scenebuilder** - chosen takes in order + narration, then the film finish (grade, grain, letterbox) -> one MP4.

### Engines
- **Cinematic** - Wan 2.2 A14B + Lightning (Kaggle T4 x2 or a 24 GB GPU). Best quality; animates a **first frame**
  (make your keyframes in Gemini / ChatGPT / Midjourney first). ~480p, 16 fps interpolated to 24 fps.
- **Fast** - Wan 2.2 TI2V-5B. Also does text-to-video; runs on one 16 GB GPU.

Every clip is exactly 4/6/8 s at 24 fps, 1080p, so cuts land on your act grid.

### Writing prompts that look professional
Describe **what moves** and **how the camera moves**, in one or two sentences: subject + action + setting + camera.
*"The courier hesitates at the vault door, breath fogging in the cold, then pushes it open; slow push in."*
Let shot size / lens / lighting do the cinematography words for you.
"""


def ui():
    projects = list_projects(ROOT)
    with gr.Blocks(title="Shotloom") as demo:
        gr.Markdown("# Shotloom\nOpen-source cinematic AI video studio - Wan 2.2 on free GPUs")
        status = gr.Markdown(f"engine: {ENGINE.describe()}")
        with gr.Row():
            proj = gr.Dropdown(projects, value=projects[0] if projects else None,
                               label="Project", scale=2, allow_custom_value=True)
            new_name = gr.Textbox(label="New project name", placeholder="e.g. hatton-garden", scale=2)
            create = gr.Button("Create project", scale=1)
        with gr.Accordion("Project settings", open=False):
            with gr.Row():
                aspect = gr.Radio(list(video.ASPECTS), value="16:9", label="Aspect")
                style = gr.Textbox(label="Style (appended to every AI prompt)",
                                   placeholder="cinematic documentary, 35mm, moody low-key light", scale=3)
            with gr.Row():
                look = gr.Dropdown(LOOKS, value="cinematic film", label="Look (grade + style)")
                letterbox = gr.Checkbox(False, label="2.39:1 letterbox on export")
                grain = gr.Slider(0, 1, value=0.35, step=0.05, label="Film grain")
            negative = gr.Textbox(DEFAULT_NEGATIVE, label="Negative prompt (fast engine only)", lines=2)
            save_set = gr.Button("Save settings")

        with gr.Tabs():
            # ---------------- shots
            with gr.Tab("Shots"):
                table = gr.Dataframe(headers=Project.TABLE_HEADERS, interactive=False, wrap=True,
                                     max_height=420)
                with gr.Row():
                    up_mv = gr.Button("Move up", size="sm")
                    down_mv = gr.Button("Move down", size="sm")
                with gr.Accordion("Import shot list (CSV + images)", open=True):
                    with gr.Row():
                        csv_file = gr.File(label="shots.csv", file_types=[".csv"], type="filepath")
                        imgs = gr.File(label="Images (select many)", file_count="multiple",
                                       file_types=["image"], type="filepath")
                    with gr.Row():
                        replace = gr.Checkbox(label="Replace existing shot list")
                        do_import = gr.Button("Import", variant="primary")
                    import_msg = gr.Markdown()
                with gr.Accordion("Add / edit a shot", open=False):
                    with gr.Row():
                        sel = gr.Dropdown([NEW], value=NEW, label="Shot", allow_custom_value=True)
                        sid = gr.Textbox(label="Shot id", placeholder="auto")
                        secs = gr.Radio(list(SECONDS), value=6, label="Seconds")
                        mode = gr.Radio(["AI", "STILL"], value="AI", label="Mode")
                        cam = gr.Dropdown(CAMS, value="auto", label="Camera")
                    with gr.Row():
                        with gr.Column(scale=3):
                            prompt = gr.Textbox(label="Prompt (action + camera, what moves)", lines=4)
                            notes = gr.Textbox(label="Notes")
                        frame = gr.Image(label="First frame", type="filepath", scale=2)
                    with gr.Row():
                        size = gr.Dropdown(SIZES, value="auto", label="Shot size")
                        lens = gr.Dropdown(LENSES, value="auto", label="Lens")
                        light = gr.Dropdown(LIGHTS, value="auto", label="Lighting")
                    with gr.Row():
                        save_btn = gr.Button("Save shot", variant="primary")
                        del_btn = gr.Button("Delete shot", variant="stop")
                    shot_msg = gr.Markdown()

            # ---------------- generate
            with gr.Tab("Generate"):
                with gr.Row():
                    g_shot = gr.Dropdown([], label="Shot", scale=1, allow_custom_value=True)
                    g_secs = gr.Radio(list(SECONDS), value=6, label="Seconds", scale=1)
                    g_cam = gr.Dropdown(CAMS, value="auto", label="Camera", scale=1)
                with gr.Row():
                    with gr.Column(scale=2):
                        g_frame = gr.Image(label="First frame", type="filepath")
                        g_prompt = gr.Textbox(label="Prompt - what moves, and how the camera moves", lines=3)
                        with gr.Row():
                            g_size = gr.Dropdown(SIZES, value="auto", label="Shot size")
                            g_lens = gr.Dropdown(LENSES, value="auto", label="Lens")
                            g_light = gr.Dropdown(LIGHTS, value="auto", label="Lighting")
                        g_preview = gr.Markdown()
                        with gr.Row():
                            g_quality = gr.Radio(list(QUALITY_NAMES), value="standard", label="Quality")
                            g_seed = gr.Number(-1, label="Seed (-1 random)", precision=0)
                            g_steps = gr.Slider(0, 60, value=0, step=1, label="Steps (0 = preset)")
                        with gr.Row():
                            g_ai = gr.Button("Generate video", variant="primary")
                            g_still = gr.Button("Animate still (free)")
                        g_log = gr.Textbox(label="Log", lines=3)
                    with gr.Column(scale=3):
                        g_video = gr.Video(label="Take", autoplay=True, loop=True)
                        with gr.Row():
                            g_takes = gr.Dropdown([], label="Takes", scale=2, allow_custom_value=True)
                            g_use = gr.Button("Use this take", scale=1)
                        with gr.Row():
                            g_ext_prompt = gr.Textbox(label="Extend: what happens next (blank = same prompt)", scale=3)
                            g_ext = gr.Button("Extend", scale=1)

            # ---------------- batch
            with gr.Tab("Batch"):
                gr.Markdown("Render every shot unattended. Finished shots are skipped, so a stopped run resumes.")
                with gr.Row():
                    b_ai = gr.Checkbox(True, label="AI shots")
                    b_still = gr.Checkbox(True, label="STILL shots")
                    b_missing = gr.Checkbox(True, label="Only shots without a take")
                    b_ph = gr.Checkbox(False, label="Placeholder stills for AI shots not done")
                    b_quality = gr.Radio(list(QUALITY_NAMES), value="standard", label="Quality")
                with gr.Row():
                    b_run = gr.Button("Run batch", variant="primary")
                    b_stop = gr.Button("Stop", variant="stop")
                b_log = gr.Textbox(label="Progress", lines=18, autoscroll=True)

            # ---------------- scenebuilder
            with gr.Tab("Scenebuilder"):
                scene = gr.Dataframe(headers=["shot", "starts", "sec", "using", "file"],
                                     interactive=False, max_height=380)
                with gr.Row():
                    narration = gr.Audio(label="Narration (optional)", type="filepath")
                    with gr.Column():
                        s_finish = gr.Checkbox(True, label="Cinematic finish (grade, grain, letterbox)")
                        build_btn = gr.Button("Build film", variant="primary")
                s_log = gr.Markdown()
                with gr.Row():
                    s_video = gr.Video(label="Export")
                    s_file = gr.File(label="Download")

            with gr.Tab("Help"):
                gr.Markdown(HELP)

        # ---------------- wiring
        proj_out = [table, aspect, style, negative, sel, g_shot, status, scene, look, letterbox, grain]
        proj.change(open_project, proj, proj_out)
        create.click(create_project, new_name, [proj, new_name])
        save_set.click(save_settings, [proj, aspect, style, negative, look, letterbox, grain], status)

        do_import.click(import_csv, [proj, csv_file, imgs, replace],
                        [import_msg, table, sel, g_shot, status, scene])
        sel.change(load_shot, [proj, sel], [sid, secs, mode, cam, prompt, notes, frame, size, lens, light])
        save_btn.click(save_shot, [proj, sel, sid, secs, mode, cam, prompt, notes, frame, size, lens, light],
                       [table, sel, g_shot, status, scene, shot_msg])
        del_btn.click(delete_shot, [proj, sel], [table, sel, g_shot, status, scene])
        up_mv.click(lambda n, s: move_shot(n, s, -1), [proj, sel], [table, scene])
        down_mv.click(lambda n, s: move_shot(n, s, 1), [proj, sel], [table, scene])

        g_view_out = [g_frame, g_prompt, g_cam, g_secs, g_takes, g_video, g_size, g_lens, g_light]
        g_shot.change(gen_view, [proj, g_shot], g_view_out)
        pv_in = [proj, g_prompt, g_cam, g_size, g_lens, g_light]
        for comp in (g_prompt, g_cam, g_size, g_lens, g_light):
            comp.change(prompt_preview, pv_in, g_preview)
        g_in = [proj, g_shot, g_frame, g_prompt, g_cam, g_secs, g_quality, g_seed, g_steps,
                g_size, g_lens, g_light]
        g_out = [g_video, g_takes, g_log, table, status, scene]
        g_ai.click(gen_ai, g_in, g_out)
        g_still.click(gen_still, g_in, g_out)
        g_takes.input(pick_take, [proj, g_shot, g_takes], g_video)
        g_use.click(use_take, [proj, g_shot, g_takes], [table, scene])
        g_ext.click(do_extend, [proj, g_shot, g_ext_prompt], [g_shot, sel, table, scene])

        b_run.click(run_batch, [proj, b_ai, b_still, b_missing, b_ph, b_quality], b_log)
        b_stop.click(stop_batch, None, b_log)
        build_btn.click(do_build, [proj, narration, s_finish], [s_video, s_file, s_log, scene])

        def refresh_projects(current):
            names = list_projects(ROOT)
            return gr.Dropdown(choices=names, value=current if current in names else
                               (names[0] if names else None))

        demo.load(refresh_projects, proj, proj).then(
            lambda n: open_project(n) if n else gr.skip(), proj, proj_out)
    return demo


def main():
    global ENGINE, ROOT
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default=os.environ.get("SHOTLOOM_ENGINE", "auto"),
                    choices=["auto", "cinematic", "fast", "preview", "wan"],
                    help="cinematic = Wan 2.2 A14B Lightning, fast = Wan 2.2 5B, preview = CPU camera moves")
    ap.add_argument("--home", default=ROOT, help="folder for projects")
    ap.add_argument("--share", action="store_true", help="public gradio.live link")
    ap.add_argument("--port", type=int, default=7860)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--password", default=os.environ.get("SHOTLOOM_PASSWORD", ""),
                    help="protect a shared link: user 'shotloom' + this password")
    a = ap.parse_args()
    ROOT = os.path.abspath(a.home)
    os.makedirs(ROOT, exist_ok=True)
    ENGINE = make_engine(a.engine)
    print("Shotloom engine:", ENGINE.describe(), "| projects:", ROOT)
    ui().queue(default_concurrency_limit=1).launch(
        server_name=a.host, server_port=a.port, share=a.share, allowed_paths=[ROOT],
        auth=("shotloom", a.password) if a.password else None)


if __name__ == "__main__":
    main()
