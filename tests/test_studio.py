"""Project / studio / video tests - CPU only, no models."""
import os
import subprocess

import pytest
from PIL import Image

from shotloom import engines, studio, video
from shotloom.project import Project


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
                        "-show_entries", "stream=nb_read_frames,width,height", "-of", "csv=p=0", path],
                       capture_output=True, text=True, check=True)
    w, h, n = r.stdout.strip().split(",")
    return int(w), int(h), int(n)


@pytest.fixture
def project(tmp_path):
    imgs = tmp_path / "imgs"
    imgs.mkdir()
    for name, size in (("A1", (1344, 768)), ("unused", (768, 1344)), ("S1", (1024, 1024))):
        Image.new("RGB", size, (90, 40, 140)).save(imgs / f"{name}.png")
    csv = tmp_path / "shots.csv"
    csv.write_text(
        "shot_id,seconds,type,image,motion_prompt,camera_move,shot_size,lens,lighting,notes\n"
        "A1,4,HERO,A1.png,The courier pushes open the vault door,push_in,wide,anamorphic,low-key noir,\n"
        "A2,4,AI,,A crowd gathers outside the bank at dawn,,,,,no frame\n"
        "S1,4,STILL,S1.png,,pan_left,,,,\n")
    p = Project(str(tmp_path / "home"), "Test Film")
    added, missing = p.import_csv(str(csv), [str(x) for x in imgs.iterdir()])
    assert added == 3 and missing == []
    return p


def test_import_reads_presets(project):
    a1 = project.get("A1")
    assert (a1.size, a1.lens, a1.light, a1.camera) == ("wide", "anamorphic", "low-key noir", "push_in")
    assert project.get("A2").frame == "" and project.get("S1").mode == "STILL"
    # reload from disk keeps everything, unknown keys are ignored
    again = Project(os.path.dirname(project.dir), project.name)
    assert again.get("A1").lens == "anamorphic" and again.look == "cinematic film"


def test_prompt_has_cinematography(project):
    a1 = project.get("A1")
    text = engines.build_prompt(a1.prompt, a1.camera, project.style, shot=a1, look=project.look)
    for words in ("vault door", "wide shot", "anamorphic", "low-key", "push in", "Kodak"):
        assert words in text


class ImageOnly(engines.PreviewEngine):
    image_only = True
    kind = "wan-cinema"
    name = "fake cinematic"


def test_batch_with_image_only_engine_falls_back_to_still(project):
    lines = list(studio.batch(project, ImageOnly(), quality="draft"))
    text = "\n".join(lines)
    assert "A2" in text and "first frame" in text
    assert project.get("A2").chosen_take().kind == "still"     # no frame -> still, not an error
    assert project.get("A1").chosen_take().kind == "ai"
    assert "batch complete" in lines[-1]


def test_extend_then_build_with_finish(project, tmp_path):
    eng = engines.PreviewEngine()
    studio.generate_ai(project, eng, project.get("A1"), quality="draft")
    new = studio.extend(project, project.get("A1"), prompt="he steps inside")
    assert [s.id for s in project.shots][:2] == ["A1", new.id]
    project.letterbox, project.grain, project.look = True, 0.4, "noir thriller"
    audio = tmp_path / "vo.mp3"
    subprocess.run([video.ffmpeg(), "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                    "sine=f=200:d=17", str(audio)], check=True)
    logs = []
    out = studio.build(project, audio=str(audio), log=logs.append)
    assert probe(out) == (1920, 1080, 16 * 24)                 # 4 shots x 4 s, exact
    assert any("finish (noir thriller, letterbox" in l for l in logs)
    # letterbox bars really are black
    png = str(tmp_path / "f.png")
    subprocess.run([video.ffmpeg(), "-y", "-loglevel", "error", "-ss", "1", "-i", out,
                    "-frames:v", "1", png], check=True)
    px = Image.open(png).convert("L")
    assert px.getpixel((960, 20)) < 20 and px.getpixel((960, 1060)) < 20


def test_vertical_project_exports_1080x1920(project):
    project.aspect = "9:16"
    project.save()
    studio.animate_still(project, project.get("S1"))
    w, h, n = probe(project.abs(project.get("S1").chosen_take().file))
    assert (w, h, n) == (1080, 1920, 96)
