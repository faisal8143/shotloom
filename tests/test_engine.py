"""Runs WanEngine.generate end to end on CPU with tiny random Wan models."""
import os
import subprocess
import sys

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
torch = pytest.importorskip("torch")
pytest.importorskip("diffusers")
import tiny_wan  # noqa: E402

from shotloom import engines, video  # noqa: E402


def frame_count(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
                        "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path],
                       capture_output=True, text=True, check=True)
    return int(r.stdout.strip())


def make_engine(mode):
    e = engines.WanEngine()
    e.mode = mode
    e.dev = e.vae_dev = e.te_work = torch.device("cpu")
    e.dtype = torch.float32
    e.text_encoder = tiny_wan.text_encoder()
    e._attach(tiny_wan.ti2v_pipeline())
    e.ready = True
    return e


@pytest.fixture(autouse=True)
def tiny_quality(monkeypatch):
    monkeypatch.setitem(engines.WanEngine.quality, "tiny", (2, 64, 64))


@pytest.mark.parametrize("mode", ["dual", "single", "big"])
def test_text_to_video_exact_length(tmp_path, mode):
    e = make_engine(mode)
    out = str(tmp_path / "t2v.mp4")
    path, seed = e.generate(prompt="a red car at night", image_path=None, seconds=8 / 24,
                            aspect="16:9", quality="tiny", seed=7, out=out)
    assert path == out and seed == 7
    assert frame_count(out) == 8


def test_frames_to_video_and_prompt_cache(tmp_path):
    e = make_engine("dual")
    img = tmp_path / "f.png"
    Image.new("RGB", (300, 200), (200, 40, 40)).save(img)
    logs = []
    for i in range(2):
        e.generate(prompt="same prompt", image_path=str(img), seconds=8 / 24, aspect="9:16",
                   quality="tiny", seed=-1, out=str(tmp_path / f"i2v{i}.mp4"), log=logs.append)
    assert sum("encoding" in l for l in logs) == 1, logs      # second take reuses embeddings
    assert frame_count(str(tmp_path / "i2v1.mp4")) == 8
    assert "frames-to-video" in "".join(logs)


def test_execution_device_is_pinned():
    e = make_engine("dual")
    assert e.i2v._execution_device == torch.device("cpu")
    engines.pin_execution_device(e.i2v, torch.device("meta"))     # re-pinning replaces, not stacks
    assert e.i2v._execution_device == torch.device("meta")
    assert type(e.i2v).__mro__[1].__name__ == "WanImageToVideoPipeline"


def test_decode_matches_pipeline(tmp_path):
    """Our manual decode must equal what diffusers' own output_type='np' gives."""
    e = make_engine("big")
    pe = torch.randn(1, 512, tiny_wan.TEXT_DIM)
    kw = dict(prompt_embeds=pe, negative_prompt_embeds=pe, height=64, width=64, num_frames=9,
              num_inference_steps=2, guidance_scale=5.0)
    ref = e.t2v(generator=torch.Generator().manual_seed(1), output_type="np", **kw).frames[0]
    lat = e.t2v(generator=torch.Generator().manual_seed(1), output_type="latent", **kw).frames
    ours = e._decode(lat)
    assert np.allclose(np.asarray(ref), np.asarray(ours), atol=1e-5)
