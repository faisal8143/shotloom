"""WanCinemaEngine end to end on CPU: GGUF experts + Lightning LoRAs + 16->24 fps."""
import os
import subprocess
import sys

import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
torch = pytest.importorskip("torch")
pytest.importorskip("gguf")
import tiny_cinema  # noqa: E402
import tiny_wan  # noqa: E402

from shotloom import engines  # noqa: E402


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
                        "-show_entries", "stream=nb_read_frames,r_frame_rate", "-of", "csv=p=0", path],
                       capture_output=True, text=True, check=True)
    rate, n = r.stdout.strip().split(",")
    return rate, int(n)


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    tmp = str(tmp_path_factory.mktemp("cinema"))
    pipe, loras = tiny_cinema.build(tmp)
    e = engines.WanCinemaEngine()
    e.mode = "dual"
    e.dtype = torch.float32
    e.dev = torch.device("cpu")
    e.dev2 = e.vae_dev = e.te_work = torch.device("cpu", 0)   # != dev -> exercises the cross-device hook
    e.text_encoder = tiny_wan.text_encoder()
    e._attach(pipe, loras)
    e.ready = True
    return e


@pytest.fixture(autouse=True)
def tiny_quality(monkeypatch):
    monkeypatch.setitem(engines.WanCinemaEngine.quality, "tiny", (4, 64, 64))


def test_lightning_loras_on_gguf_experts(engine):
    for tr in (engine.i2v.transformer, engine.i2v.transformer_2):
        q = tr.blocks[0].attn1.to_q
        assert type(q).__name__ == "Linear" and type(q.base_layer).__name__ == "GGUFLinear"
        assert q.lora_A["lightning"].weight.dtype == engine.dtype
    assert hasattr(engine.i2v.transformer_2, "_hf_hook")            # low expert hops devices
    assert engine.i2v.scheduler.config.flow_shift == 5.0


def test_four_steps_split_two_and_two(engine):
    """Lightning wants 2 high-noise + 2 low-noise steps; boundary 0.9 + shift 5 gives that."""
    sched = engine.i2v.scheduler
    sched.set_timesteps(4)
    boundary = 0.9 * sched.config.num_train_timesteps
    assert [bool(t >= boundary) for t in sched.timesteps] == [True, True, False, False]


def test_frames_to_video_16fps_to_24fps(engine, tmp_path):
    img = tmp_path / "frame.png"
    Image.new("RGB", (320, 180), (30, 60, 200)).save(img)
    calls, logs = [], []
    out, seed = engine.generate(prompt="a ship at dawn", image_path=str(img), seconds=4,
                                aspect="16:9", quality="tiny", seed=3, out=str(tmp_path / "c.mp4"),
                                log=logs.append, progress=lambda i, n: calls.append((i, n)))
    assert probe(out) == ("24/1", 96)                 # 65 frames @16 -> exactly 4 s @24
    assert calls[-1] == (4, 4)
    assert "65 frames @ 16 fps" in "\n".join(logs)
    assert not any("negative" in l for l in logs)


def test_needs_first_frame(engine, tmp_path):
    with pytest.raises(ValueError, match="first frame"):
        engine.generate(prompt="x", image_path=None, seconds=4, aspect="16:9", quality="tiny",
                        seed=1, out=str(tmp_path / "x.mp4"))


def test_text_encoder_borrows_gpu1_from_low_expert(engine):
    assert engine._evict_for_text() == [engine.i2v.transformer_2]
    before = next(engine.i2v.transformer_2.parameters()).device
    engine.encode_many(["a brand new prompt"], engines.DEFAULT_NEGATIVE, log=lambda *_: None)
    assert next(engine.i2v.transformer_2.parameters()).device == before
    assert engines.DEFAULT_NEGATIVE not in engine._embeds     # no CFG -> negative never encoded
