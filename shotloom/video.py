"""Video helpers: exact-length encoding, still-motion camera moves, last-frame grab,
title cards and Scenebuilder assembly.  CPU only - needs nothing but ffmpeg."""
from __future__ import annotations

import math
import os
import shutil
import subprocess
import textwrap

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FPS = 24
ASPECTS = {"16:9": (1920, 1080), "9:16": (1080, 1920)}

CAMERA_MOVES = ["auto", "push_in", "pull_out", "pan_left", "pan_right", "tilt_up",
                "tilt_down", "push_in_left", "push_in_right", "drift_up", "drift_down", "static"]
_AUTO_CYCLE = ["push_in", "pan_right", "pull_out", "pan_left", "drift_up", "tilt_down",
               "push_in_left", "drift_down", "tilt_up", "push_in_right"]

ENCODE = ["-c:v", "libx264", "-preset", "medium", "-crf", "16",
          "-pix_fmt", "yuv420p", "-movflags", "+faststart"]


def ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:  # pragma: no cover
        raise RuntimeError("ffmpeg not found - run: pip install imageio-ffmpeg") from e


def frames_for(seconds: float, fps: int = FPS) -> int:
    return int(round(seconds * fps))


# ------------------------------------------------------------------ encoding
class FrameWriter:
    """Pipe RGB frames of size (src_w, src_h) into an H.264 file of exactly
    `n` frames at (W, H), cover-scaled with lanczos."""

    def __init__(self, out, src_w, src_h, W, H, n, fps=FPS):
        self.out, self.n, self.tmp = out, n, out + ".part.mp4"
        vf = []
        if (src_w, src_h) != (W, H):
            vf = ["-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,"
                         f"crop={W}:{H},setsar=1"]
        cmd = [ffmpeg(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
               "-s", f"{src_w}x{src_h}", "-r", str(fps), "-i", "-", *vf,
               "-frames:v", str(n), *ENCODE, "-r", str(fps), self.tmp]
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        self.p = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    def write(self, rgb_uint8: np.ndarray):
        self.p.stdin.write(np.ascontiguousarray(rgb_uint8, dtype=np.uint8).tobytes())

    def close(self):
        self.p.stdin.close()
        if self.p.wait() != 0:
            raise RuntimeError(f"ffmpeg failed writing {self.out}")
        os.replace(self.tmp, self.out)
        return self.out


def write_frames(frames, out, W, H, seconds, fps=FPS):
    """frames: sequence of HxWx3 arrays (float 0..1 or uint8). Writes exactly
    seconds*fps frames; repeats the last frame if the model returned too few."""
    n = frames_for(seconds, fps)
    first = np.asarray(frames[0])
    h, w = first.shape[:2]
    wr = FrameWriter(out, w, h, W, H, n, fps)
    for i in range(n):
        f = np.asarray(frames[min(i, len(frames) - 1)])
        if f.dtype != np.uint8:
            f = (np.clip(f, 0, 1) * 255 + 0.5).astype(np.uint8)
        wr.write(f)
    return wr.close()


# ------------------------------------------------------------------ stills
def cover_fit(img: Image.Image, W: int, H: int, oversample: float = 1.0) -> Image.Image:
    iw, ih = img.size
    target = W / H
    if iw / ih > target:
        nw = int(round(ih * target)); x0 = (iw - nw) // 2
        img = img.crop((x0, 0, x0 + nw, ih))
    else:
        nh = int(round(iw / target)); y0 = (ih - nh) // 2
        img = img.crop((0, y0, iw, y0 + nh))
    return img.resize((int(W * oversample), int(H * oversample)), Image.LANCZOS)


def _ease(t):
    return 0.5 - 0.5 * math.cos(math.pi * t)


def _plan(move, t, zoom):
    e = _ease(t)
    z_in = 1.0 / (1.0 + zoom)
    room = (1.0 - z_in) / 2.0
    if move == "push_in":
        return 1.0 + (z_in - 1.0) * e, 0.5, 0.5
    if move == "pull_out":
        return z_in + (1.0 - z_in) * e, 0.5, 0.5
    if move in ("push_in_left", "push_in_right"):
        s = 1.0 + (z_in - 1.0) * e
        d = (1.0 - s) / 2.0 * 0.6
        return s, 0.5 - d if move == "push_in_left" else 0.5 + d, 0.5
    if move == "pan_right":
        return z_in, 0.5 - room + 2 * room * e, 0.5
    if move == "pan_left":
        return z_in, 0.5 + room - 2 * room * e, 0.5
    if move == "tilt_up":
        return z_in, 0.5, 0.5 + room - 2 * room * e
    if move == "tilt_down":
        return z_in, 0.5, 0.5 - room + 2 * room * e
    if move in ("drift_up", "drift_down"):
        s = 1.0 + (z_in - 1.0) * (0.5 * e)
        r = (1.0 - s) / 2.0
        if move == "drift_up":
            return s, 0.5 - r * 0.5 + r * e, 0.5 + r - 2 * r * e
        return s, 0.5 + r * 0.5 - r * e, 0.5 - r + 2 * r * e
    return 1.0, 0.5, 0.5


def resolve_move(move: str, index: int = 0) -> str:
    move = (move or "auto").strip().lower()
    if move not in CAMERA_MOVES or move == "auto":
        return _AUTO_CYCLE[index % len(_AUTO_CYCLE)]
    return move


def still_motion(image_path, out, seconds, move="auto", aspect="16:9",
                 zoom=0.12, index=0, fps=FPS):
    """Smooth sub-pixel camera move over a still. Exactly seconds*fps frames."""
    W, H = ASPECTS[aspect]
    move = resolve_move(move, index)
    src = cover_fit(Image.open(image_path).convert("RGB"), W, H, oversample=2.0)
    SW, SH = src.size
    n = frames_for(seconds, fps)
    wr = FrameWriter(out, W, H, W, H, n, fps)
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0.0
        s, cx, cy = _plan(move, t, zoom)
        w, h = SW * s, SH * s
        x0 = min(max(cx * SW - w / 2, 0.0), SW - w)
        y0 = min(max(cy * SH - h / 2, 0.0), SH - h)
        fr = src.transform((W, H), Image.EXTENT, (x0, y0, x0 + w, y0 + h), resample=Image.BICUBIC)
        wr.write(np.asarray(fr))
    wr.close()
    return out, move


# ------------------------------------------------------------------ misc
def last_frame(video, out_png):
    """Save the final frame of a clip (used by Extend)."""
    subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-sseof", "-0.5", "-i", video,
                    "-update", "1", "-q:v", "1", out_png], check=True)
    return out_png


def title_card(text, out_png, aspect="16:9"):
    """Plain card used when there is no frame (Animate still without an image)."""
    W, H = ASPECTS[aspect]
    img = Image.new("RGB", (W, H), (14, 14, 18))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 44)
    except OSError:
        font = ImageFont.load_default()
    lines = textwrap.wrap(text or "", width=48 if W > H else 26)[:8]
    y = H // 2 - len(lines) * 30
    for ln in lines:
        w = d.textlength(ln, font=font)
        d.text(((W - w) / 2, y), ln, fill=(220, 220, 225), font=font)
        y += 60
    img.save(out_png)
    return out_png


def duration(path) -> float:
    """Media duration in seconds (decodes the header via ffmpeg, no ffprobe needed)."""
    r = subprocess.run([ffmpeg(), "-i", path], capture_output=True, text=True)
    for line in r.stderr.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            hms = line.split(",")[0].split()[1]
            try:
                h, m, s = hms.split(":")
                return int(h) * 3600 + int(m) * 60 + float(s)
            except ValueError:
                return 0.0
    return 0.0


def assemble(clips, out, audio=None):
    """Concatenate same-format clips (stream copy) and lay narration underneath."""
    listing = out + ".txt"
    with open(listing, "w", encoding="utf-8") as f:
        for c in clips:
            f.write("file '" + os.path.abspath(c).replace("'", "'\\''") + "'\n")
    cmd = [ffmpeg(), "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listing]
    if audio:
        cmd += ["-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
                "-c:a", "aac", "-b:a", "320k"]
    else:
        cmd += ["-c", "copy"]
    cmd += ["-movflags", "+faststart", out]
    subprocess.run(cmd, check=True)
    os.remove(listing)
    return out
