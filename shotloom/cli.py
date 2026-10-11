"""Shotloom command line - for headless runs (Kaggle "Save & Run All", servers, scripts).

  python -m shotloom.cli import  --project my-film --csv shots.csv --images ./images
  python -m shotloom.cli batch   --project my-film --quality standard
  python -m shotloom.cli build   --project my-film --audio narration.mp3
  python -m shotloom.cli status  --project my-film

--home sets the projects folder (default ./projects or $SHOTLOOM_HOME).
--copy-from copies a project folder in first (e.g. from a read-only Kaggle dataset).
"""
from __future__ import annotations

import argparse
import glob
import os
import shutil
import sys

from . import studio
from .engines import make_engine
from .project import Project, slug


def main(argv=None):
    ap = argparse.ArgumentParser(prog="shotloom", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["import", "batch", "build", "status"])
    ap.add_argument("--project", required=True)
    ap.add_argument("--home", default=os.environ.get("SHOTLOOM_HOME", "projects"))
    ap.add_argument("--copy-from", default="", help="existing project folder to copy in first")
    ap.add_argument("--csv", default="")
    ap.add_argument("--images", default="", help="folder of frames for import")
    ap.add_argument("--replace", action="store_true")
    ap.add_argument("--aspect", choices=["16:9", "9:16"], default=None)
    ap.add_argument("--style", default=None)
    ap.add_argument("--engine", default=os.environ.get("SHOTLOOM_ENGINE", "auto"),
                    choices=["auto", "wan", "preview"])
    ap.add_argument("--quality", default="standard", choices=["draft", "standard", "final"])
    ap.add_argument("--no-ai", action="store_true")
    ap.add_argument("--no-stills", action="store_true")
    ap.add_argument("--redo", action="store_true", help="render new takes even for shots that have one")
    ap.add_argument("--placeholders", action="store_true")
    ap.add_argument("--audio", default="")
    a = ap.parse_args(argv)

    home = os.path.abspath(a.home)
    if a.copy_from:
        dst = os.path.join(home, slug(a.project))
        if not os.path.exists(dst):
            shutil.copytree(a.copy_from, dst)
            print("copied project ->", dst)
    p = Project(home, a.project)
    if a.aspect:
        p.aspect = a.aspect
    if a.style is not None:
        p.style = a.style
    p.save()

    if a.command == "import":
        if not a.csv:
            sys.exit("--csv is required for import")
        imgs = []
        if a.images:
            for ext in ("png", "jpg", "jpeg", "webp", "PNG", "JPG", "JPEG", "WEBP"):
                imgs += glob.glob(os.path.join(a.images, f"*.{ext}"))
        added, missing = p.import_csv(a.csv, imgs, replace=a.replace)
        print(f"imported {added} shots into {p.dir}")
        if missing:
            print("no image for:", ", ".join(missing))
    elif a.command == "batch":
        engine = make_engine(a.engine)
        print("engine:", engine.describe(), flush=True)
        for line in studio.batch(p, engine, ai=not a.no_ai, stills=not a.no_stills,
                                 only_missing=not a.redo, quality=a.quality,
                                 placeholders=a.placeholders):
            print(line, flush=True)
    elif a.command == "build":
        out = studio.build(p, audio=a.audio or None)
        print(out)
    print(f"{p.name}: {len(p.shots)} shots, {p.total_seconds():.0f}s, "
          f"{sum(1 for s in p.shots if s.takes)} with takes")


if __name__ == "__main__":
    main()
