"""Studio actions shared by the web UI and the command line."""
from __future__ import annotations

import os
import time

from . import video
from .engines import DEFAULT_NEGATIVE, BaseEngine, build_prompt
from .project import Project, Shot, Take


def _negative(p: Project) -> str:
    return (p.negative or "").strip() or DEFAULT_NEGATIVE


def animate_still(p: Project, shot: Shot, seed: int | None = None, log=print) -> Take:
    """Free camera move on the shot's frame (title card if it has none)."""
    rel = p.new_take_path(shot.id, "still")
    src = p.abs(shot.frame)
    if not src or not os.path.exists(src):
        src = p.abs(os.path.join("frames", f"{shot.id}_card.png"))
        video.title_card(shot.prompt or shot.id, src, p.aspect)
    index = p.shots.index(shot) if seed is None or int(seed) < 0 else int(seed)
    t0 = time.time()
    _, move = video.still_motion(src, p.abs(rel), shot.seconds, move=shot.camera,
                                 aspect=p.aspect, index=index)
    log(f"{shot.id}: still ({move}) {shot.seconds:g}s in {time.time() - t0:.0f}s")
    take = Take(file=rel, kind="still", engine="still-motion", prompt=move,
                seed=index, quality="", seconds=shot.seconds)
    p.add_take(shot, take)
    return take


def generate_ai(p: Project, engine: BaseEngine, shot: Shot, quality="standard",
                seed: int | None = -1, steps=None, log=print, progress=None) -> Take:
    """Text-to-video (no frame) or frames-to-video (first frame) for one shot."""
    rel = p.new_take_path(shot.id, "ai")
    prompt = build_prompt(shot.prompt, shot.camera, p.style, shot=shot, look=p.look)
    if not prompt:
        raise ValueError(f"{shot.id} has no prompt")
    frame = p.abs(shot.frame) if shot.frame and os.path.exists(p.abs(shot.frame)) else None
    _, used_seed = engine.generate(prompt=prompt, image_path=frame, seconds=shot.seconds,
                                   aspect=p.aspect, quality=quality, seed=seed, out=p.abs(rel),
                                   negative=_negative(p), steps=steps, camera=shot.camera, log=log,
                                   progress=progress)
    log(f"{shot.id}: {'AI' if engine.kind != 'preview' else 'preview'} take, seed {used_seed}")
    take = Take(file=rel, kind="ai" if engine.kind != "preview" else "preview",
                engine=engine.name, prompt=prompt, seed=used_seed, quality=quality,
                seconds=shot.seconds)
    p.add_take(shot, take)
    return take


def extend(p: Project, shot: Shot, prompt: str = "", seconds: float | None = None) -> Shot:
    """Flow-style Extend: new shot right after this one, starting on its last frame."""
    take = shot.chosen_take()
    if not take:
        raise ValueError(f"{shot.id} has no take to extend yet - generate one first")
    new = Shot(id=p.next_id(), seconds=seconds or shot.seconds, mode="AI",
               prompt=prompt or shot.prompt, camera=shot.camera,
               notes=f"extends {shot.id}")
    png = p.abs(os.path.join("frames", f"{new.id}.png"))
    video.last_frame(p.abs(take.file), png)
    new.frame = os.path.join("frames", f"{new.id}.png")
    p.upsert(new, after=shot.id)
    return new


def batch(p: Project, engine: BaseEngine, ai=True, stills=True, only_missing=True,
          quality="standard", placeholders=False, stop=lambda: False):
    """Render the whole shot list. Yields progress lines. Safe to stop and resume."""
    todo = []
    for s in p.shots:
        has = bool(s.takes)
        if s.mode == "STILL" and stills and not (only_missing and has):
            todo.append((s, "still"))
        elif s.mode == "AI":
            has_ai = any(t.kind in ("ai", "preview") for t in s.takes)
            if ai and not (only_missing and has_ai):
                todo.append((s, "ai"))
            elif placeholders and not has:
                todo.append((s, "still"))
    yield f"{len(todo)} shot(s) to render ({sum(1 for _, k in todo if k == 'ai')} AI, " \
          f"{sum(1 for _, k in todo if k == 'still')} still)"
    ai_shots = [s for s, k in todo if k == "ai"]
    if getattr(engine, "image_only", False):
        missing = [s.id for s in ai_shots if not (s.frame and os.path.exists(p.abs(s.frame)))]
        if missing:
            yield (f"{engine.name} needs a first frame - {len(missing)} AI shot(s) without one get a "
                   f"still instead: {', '.join(missing[:12])}")
            todo = [(s, "still" if s.id in missing else k) for s, k in todo]
            ai_shots = [s for s in ai_shots if s.id not in missing]
    if ai_shots and engine.kind.startswith("wan"):
        logs = []
        engine.warmup(log=logs.append)
        yield from logs
        logs.clear()
        engine.encode_many([build_prompt(s.prompt, s.camera, p.style, shot=s, look=p.look) for s in ai_shots],
                           _negative(p), log=logs.append)
        yield from logs
    t0, done = time.time(), 0
    for s, kind in todo:
        if stop():
            yield "stopped - press Run again to resume where it left off"
            return
        logs = []
        try:
            if kind == "ai":
                generate_ai(p, engine, s, quality=quality, log=logs.append)
            else:
                animate_still(p, s, log=logs.append)
            done += 1
        except Exception as e:  # keep going - one bad shot must not kill a 12 h run
            logs.append(f"{s.id}: FAILED - {e}")
        yield from logs
        el = time.time() - t0
        left = len(todo) - done
        if done:
            yield f"   progress {done}/{len(todo)} - ~{el / done * left / 60:.0f} min left"
    yield "batch complete"


def build(p: Project, audio: str | None = None, log=print, finish: bool = True) -> str:
    """Scenebuilder export: chosen take per shot, in order, narration underneath,
    then the project's cinematic finish (grade, grain, letterbox).
    Shots without a take get a still-motion placeholder so the cut is never short."""
    from . import looks
    clips = []
    for s in p.shots:
        t = s.chosen_take()
        if not t or not os.path.exists(p.abs(t.file)):
            log(f"{s.id}: no take - adding still placeholder")
            t = animate_still(p, s, log=log)
        clips.append(p.abs(t.file))
    if not clips:
        raise ValueError("no shots in this project")
    stamp = time.strftime('%Y%m%d_%H%M%S')
    out = p.abs(os.path.join("exports", f"{p.name}_{stamp}.mp4"))
    video.assemble(clips, out, audio=audio)
    look = looks.LOOKS.get(p.look or "none", looks.LOOKS["none"])
    if finish and (look["grade"] or p.letterbox or p.grain > 0):
        t0 = time.time()
        vf = video.finish_filters(look["grade"], p.letterbox, p.grain, p.aspect)
        video.finish(out, out, vf)
        log(f"finish ({p.look}{', letterbox' if p.letterbox else ''}, grain {p.grain:.2f}) "
            f"in {time.time() - t0:.0f}s")
    pic = p.total_seconds()
    msg = f"exported {len(clips)} shots, picture {pic:.1f}s"
    if audio:
        a = video.duration(audio)
        msg += f", narration {a:.1f}s"
        if abs(a - pic) > 0.5:
            msg += f"  (picture is {'longer' if pic > a else 'SHORTER'} by {abs(pic - a):.1f}s)"
    log(msg)
    return out
