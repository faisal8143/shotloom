"""Projects, shots and takes - stored as plain folders + project.json so they
are easy to back up, zip, or move between Kaggle and your own PC."""
from __future__ import annotations

import csv
import json
import os
import re
import shutil
import threading
import time
from dataclasses import asdict, dataclass, field

SECONDS = (4, 6, 8)
MODES = ("AI", "STILL")
_lock = threading.RLock()


def slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_-]+", "-", (name or "").strip()).strip("-")
    return s[:60] or "untitled"


@dataclass
class Take:
    file: str                 # relative to project dir
    kind: str                 # "ai" | "still"
    engine: str = ""
    prompt: str = ""
    seed: int = 0
    quality: str = ""
    seconds: float = 0
    created: float = field(default_factory=time.time)


@dataclass
class Shot:
    id: str
    seconds: float = 6
    mode: str = "AI"          # AI = generate video, STILL = camera move on the frame
    prompt: str = ""
    camera: str = "auto"
    frame: str = ""           # relative path of the first frame, "" = text-to-video
    notes: str = ""
    takes: list = field(default_factory=list)
    chosen: int = -1          # index into takes, -1 = latest

    def chosen_take(self):
        if not self.takes:
            return None
        i = self.chosen if 0 <= self.chosen < len(self.takes) else len(self.takes) - 1
        return self.takes[i]


class Project:
    def __init__(self, root: str, name: str):
        self.name = slug(name)
        self.dir = os.path.join(root, self.name)
        self.aspect = "16:9"
        self.style = ""
        self.negative = ""
        self.shots: list[Shot] = []
        for sub in ("frames", "takes", "exports", "audio"):
            os.makedirs(os.path.join(self.dir, sub), exist_ok=True)
        self.load()

    # ---------------------------------------------------------------- io
    @property
    def path(self):
        return os.path.join(self.dir, "project.json")

    def load(self):
        if not os.path.exists(self.path):
            self.save()
            return
        with open(self.path, encoding="utf-8") as f:
            data = json.load(f)
        self.aspect = data.get("aspect", "16:9")
        self.style = data.get("style", "")
        self.negative = data.get("negative", "")
        self.shots = []
        for s in data.get("shots", []):
            takes = [Take(**t) for t in s.pop("takes", [])]
            self.shots.append(Shot(**s, takes=takes))

    def save(self):
        with _lock:
            data = {"name": self.name, "aspect": self.aspect, "style": self.style,
                    "negative": self.negative,
                    "shots": [asdict(s) for s in self.shots]}
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp, self.path)

    def abs(self, rel: str) -> str:
        return os.path.join(self.dir, rel) if rel else ""

    # ---------------------------------------------------------------- shots
    def get(self, shot_id: str) -> Shot | None:
        return next((s for s in self.shots if s.id == shot_id), None)

    def next_id(self) -> str:
        nums = [int(m.group(1)) for s in self.shots if (m := re.match(r"S(\d+)$", s.id))]
        return f"S{(max(nums) + 1 if nums else 1):03d}"

    def upsert(self, shot: Shot, after: str | None = None):
        with _lock:
            old = self.get(shot.id)
            if old:
                shot.takes, shot.chosen = old.takes, old.chosen
                self.shots[self.shots.index(old)] = shot
            elif after and self.get(after):
                self.shots.insert(self.shots.index(self.get(after)) + 1, shot)
            else:
                self.shots.append(shot)
            self.save()
        return shot

    def delete(self, shot_id: str):
        with _lock:
            self.shots = [s for s in self.shots if s.id != shot_id]
            self.save()

    def move(self, shot_id: str, delta: int):
        with _lock:
            s = self.get(shot_id)
            if not s:
                return
            i = self.shots.index(s)
            j = max(0, min(len(self.shots) - 1, i + delta))
            self.shots.insert(j, self.shots.pop(i))
            self.save()

    def set_frame(self, shot: Shot, src_path: str):
        ext = os.path.splitext(src_path)[1].lower() or ".png"
        rel = os.path.join("frames", f"{shot.id}{ext}")
        if os.path.abspath(src_path) != os.path.abspath(self.abs(rel)):
            shutil.copyfile(src_path, self.abs(rel))
        shot.frame = rel
        return rel

    def add_take(self, shot: Shot, take: Take, choose=True):
        with _lock:
            shot.takes.append(take)
            if choose:
                shot.chosen = len(shot.takes) - 1
            self.save()

    def new_take_path(self, shot_id: str, kind: str) -> str:
        n = len(os.listdir(os.path.join(self.dir, "takes"))) + 1
        return os.path.join("takes", f"{shot_id}_{kind}_{n:03d}_{int(time.time())}.mp4")

    # ---------------------------------------------------------------- csv import
    def import_csv(self, csv_path: str, image_paths: list[str] | None = None, replace=False):
        """Columns (case-insensitive): shot_id, seconds, type (HERO/AI/STILL),
        image, motion_prompt (or prompt), camera_move, notes."""
        images = {}
        for p in image_paths or []:
            base = os.path.basename(p)
            images[base.lower()] = p
            images[os.path.splitext(base)[0].lower()] = p
        with open(csv_path, newline="", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
        added, missing = 0, []
        with _lock:
            if replace:
                self.shots = []
            for r in rows:
                r = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
                sid = r.get("shot_id") or r.get("id") or self.next_id()
                try:
                    secs = float(r.get("seconds") or 6)
                except ValueError:
                    secs = 6
                typ = (r.get("type") or "AI").upper()
                shot = Shot(id=sid, seconds=secs,
                            mode="STILL" if typ == "STILL" else "AI",
                            prompt=r.get("motion_prompt") or r.get("prompt") or "",
                            camera=(r.get("camera_move") or "auto").lower(),
                            notes=r.get("notes", ""))
                img = r.get("image") or sid
                src = images.get(img.lower()) or images.get(os.path.splitext(img)[0].lower())
                if src:
                    self.set_frame(shot, src)
                elif img and image_paths:
                    missing.append(f"{sid} ({img})")
                old = self.get(sid)
                if old and not shot.frame:
                    shot.frame = old.frame
                self.upsert(shot)
                added += 1
            self.save()
        return added, missing

    # ---------------------------------------------------------------- summary
    def table(self):
        rows = []
        for s in self.shots:
            t = s.chosen_take()
            rows.append([s.id, s.seconds, s.mode, s.camera, "yes" if s.frame else "-",
                         len(s.takes), (t.kind if t else "-"), s.prompt[:90]])
        return rows

    TABLE_HEADERS = ["shot", "sec", "mode", "camera", "frame", "takes", "using", "prompt"]

    def total_seconds(self):
        return sum(s.seconds for s in self.shots)


def list_projects(root: str):
    os.makedirs(root, exist_ok=True)
    return sorted(d for d in os.listdir(root)
                  if os.path.exists(os.path.join(root, d, "project.json")))
