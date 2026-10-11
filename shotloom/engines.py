"""Generation engines.

WanEngine     - Wan 2.2 TI2V-5B (Apache-2.0) via diffusers. Text-to-video and
                first-frame-to-video, 24 fps. Runs on a free Kaggle T4 / T4x2 or
                any NVIDIA GPU with 16 GB+.
PreviewEngine - CPU stand-in that turns the frame into a camera-move clip, so
                the whole studio can be used / developed without a GPU.
"""
from __future__ import annotations

import gc
import os
import random
import threading
import time

import numpy as np
from PIL import Image

from . import video

CAMERA_PROMPTS = {
    "auto": "",
    "static": "static locked-off camera",
    "push_in": "slow cinematic camera push in",
    "pull_out": "slow camera pull back revealing the scene",
    "pan_left": "smooth camera pan to the left",
    "pan_right": "smooth camera pan to the right",
    "tilt_up": "slow camera tilt up",
    "tilt_down": "slow camera tilt down",
    "push_in_left": "slow push in drifting left",
    "push_in_right": "slow push in drifting right",
    "drift_up": "gentle floating camera drift upward",
    "drift_down": "gentle floating camera drift downward",
}

DEFAULT_NEGATIVE = (
    "overexposed, static, blurred details, subtitles, text, watermark, logo, worst quality, "
    "low quality, JPEG artifacts, ugly, deformed, disfigured, extra fingers, poorly drawn hands, "
    "poorly drawn face, fused fingers, messy background, three legs, walking backwards, "
    "flickering, morphing face"
)

QUALITY = {
    # name: (steps, long side, short side)
    "draft": (20, 832, 480),
    "standard": (30, 1280, 704),
    "final": (40, 1280, 704),
}


def build_prompt(prompt: str, camera: str = "auto", style: str = "") -> str:
    parts = [p.strip().rstrip(".") for p in (prompt, CAMERA_PROMPTS.get(camera or "auto", ""), style) if p and p.strip()]
    return ". ".join(parts)


class BaseEngine:
    name = "base"
    kind = "base"

    def __init__(self):
        self.lock = threading.Lock()
        self.status = "idle"

    def describe(self) -> str:
        return f"{self.name} - {self.status}"

    def warmup(self, log=print):
        pass

    def encode_many(self, prompts, negative, log=print):
        pass

    def generate(self, *, prompt, image_path, seconds, aspect, quality, seed, out,
                 negative=DEFAULT_NEGATIVE, steps=None, camera="auto", log=print):
        raise NotImplementedError


# --------------------------------------------------------------------------- preview
class PreviewEngine(BaseEngine):
    name = "Preview engine (CPU, camera moves only)"
    kind = "preview"

    def __init__(self):
        super().__init__()
        self.status = "ready - no GPU found, AI video disabled; clips are camera moves on your frame"

    def generate(self, *, prompt, image_path, seconds, aspect, quality, seed, out,
                 negative=DEFAULT_NEGATIVE, steps=None, camera="auto", log=print):
        src = image_path
        if not src:
            src = out.replace(".mp4", "_card.png")
            video.title_card(prompt, src, aspect)
        seed = int(seed) if seed is not None and int(seed) >= 0 else random.randint(0, 999)
        video.still_motion(src, out, seconds, move=camera, aspect=aspect, index=seed)
        return out, seed


# --------------------------------------------------------------------------- wan
class WanEngine(BaseEngine):
    """Wan 2.2 TI2V-5B. Memory plan (fits 16 GB cards):

    dual   (2+ GPUs, e.g. Kaggle T4 x2): video model on GPU 0, decoder (VAE) on GPU 1,
           text encoder parked in RAM and moved to GPU 1 only to encode new prompts.
    single (1 GPU, 16-24 GB): text encoder and video model take turns on the GPU,
           and the video model steps aside while the VAE decodes.
    big    (40 GB+): everything stays on one GPU.
    Prompts are encoded once and cached, so swaps only happen for new prompts.
    """
    name = "Wan 2.2 TI2V-5B"
    kind = "wan"

    def __init__(self, model_id: str | None = None):
        super().__init__()
        self.model_id = model_id or os.environ.get("SHOTLOOM_MODEL", "Wan-AI/Wan2.2-TI2V-5B-Diffusers")
        self.ready = False
        self.status = "not loaded (loads on first generate, ~5-10 min the first time)"
        self._embeds = {}

    # ------------------------------------------------------------ load
    def warmup(self, log=print):
        if self.ready:
            return
        import torch
        try:
            from diffusers import AutoencoderKLWan, WanImageToVideoPipeline, WanPipeline
        except (ImportError, RuntimeError) as e:
            if "torchao" in str(e):
                raise RuntimeError("an old 'torchao' package clashes with diffusers - run "
                                   "`pip uninstall -y torchao`, then restart Shotloom") from e
            raise
        from transformers import UMT5EncoderModel

        if not torch.cuda.is_available():
            raise RuntimeError("No CUDA GPU visible. On Kaggle: Settings > Accelerator > GPU T4 x2.")
        t0 = time.time()
        self.status = "loading..."
        n = torch.cuda.device_count()
        major, _ = torch.cuda.get_device_capability(0)
        vram = torch.cuda.get_device_properties(0).total_memory / 1e9
        forced = os.environ.get("SHOTLOOM_DTYPE", "").lower()
        if forced in ("bf16", "fp16", "fp32"):
            self.dtype = {"bf16": torch.bfloat16, "fp16": torch.float16, "fp32": torch.float32}[forced]
        else:
            # T4 / P100 / older (compute < 8) have no native bf16 -> fp16
            self.dtype = torch.bfloat16 if major >= 8 else torch.float16
        self.dev = torch.device("cuda:0")
        if n >= 2:
            self.mode, self.vae_dev, self.te_work = "dual", torch.device("cuda:1"), torch.device("cuda:1")
        elif vram >= 40:
            self.mode, self.vae_dev, self.te_work = "big", self.dev, self.dev
        else:
            self.mode, self.vae_dev, self.te_work = "single", self.dev, self.dev
        log(f"GPUs: {n} x {torch.cuda.get_device_name(0)} ({vram:.0f} GB), "
            f"video model {str(self.dtype).split('.')[-1]}, memory plan: {self.mode}")

        log("loading text encoder (umt5-xxl, ~11 GB; first run downloads it)...")
        self.text_encoder = UMT5EncoderModel.from_pretrained(
            self.model_id, subfolder="text_encoder", torch_dtype=torch.bfloat16)
        self.text_encoder.eval()
        if self.mode == "big":
            self.text_encoder.to(self.dev)

        log("loading VAE + video model (5B)...")
        vae = AutoencoderKLWan.from_pretrained(self.model_id, subfolder="vae", torch_dtype=torch.float32)
        self.i2v = WanImageToVideoPipeline.from_pretrained(
            self.model_id, vae=vae, text_encoder=None, torch_dtype=self.dtype)
        self.tokenizer = self.i2v.tokenizer
        self.t2v = WanPipeline(tokenizer=self.tokenizer, text_encoder=None, vae=self.i2v.vae,
                               scheduler=self.i2v.scheduler, transformer=self.i2v.transformer,
                               expand_timesteps=True)
        self.i2v.vae.enable_tiling()
        self.i2v.transformer.to(self.dev)
        self.i2v.vae.to(self.vae_dev)
        for pipe in (self.i2v, self.t2v):
            pipe.set_progress_bar_config(disable=True)
            # latents must live with the video model even when the VAE sits on another GPU
            base = type(pipe)
            dev = self.dev
            pipe.__class__ = type(base.__name__, (base,),
                                  {"_execution_device": property(lambda self, d=dev: d)})
        self.ready = True
        self.status = f"ready on {torch.cuda.get_device_name(0)} x{n} ({self.mode})"
        log(f"model ready in {time.time() - t0:.0f}s")

    # ------------------------------------------------------------ prompts
    def _encode(self, texts):
        import ftfy, html, re, torch
        clean = [re.sub(r"\s+", " ", html.unescape(html.unescape(ftfy.fix_text(t)))).strip() for t in texts]
        tok = self.tokenizer(clean, padding="max_length", max_length=512, truncation=True,
                             add_special_tokens=True, return_attention_mask=True, return_tensors="pt")
        dev = next(self.text_encoder.parameters()).device
        with torch.no_grad():
            h = self.text_encoder(tok.input_ids.to(dev), tok.attention_mask.to(dev)).last_hidden_state
        lens = tok.attention_mask.gt(0).sum(dim=1)
        out = []
        for i, L in enumerate(lens.tolist()):
            e = torch.zeros_like(h[i])
            e[:L] = h[i, :L]
            out.append(e.unsqueeze(0).to("cpu", self.dtype))
        return out

    def encode_many(self, prompts, negative, log=print):
        """Encode every prompt not yet cached, moving the text encoder onto a GPU
        once for the whole batch."""
        import torch
        todo = [p for p in dict.fromkeys(list(prompts) + [negative]) if p not in self._embeds]
        if not todo:
            return
        moved = False
        if self.mode in ("dual", "single"):
            log(f"encoding {len(todo)} prompt(s)")
            if self.mode == "single":
                self.i2v.transformer.to("cpu"); gc.collect(); torch.cuda.empty_cache()
            self.text_encoder.to(self.te_work)
            moved = True
        try:
            for i in range(0, len(todo), 4):
                chunk = todo[i:i + 4]
                try:
                    embeds = self._encode(chunk)
                except RuntimeError as err:   # e.g. no bf16 kernel / no room on this GPU
                    log(f"GPU text encoding failed ({str(err)[:80]}); encoding on CPU instead")
                    self.text_encoder.to("cpu"); gc.collect(); torch.cuda.empty_cache()
                    embeds = self._encode(chunk)
                for t, e in zip(chunk, embeds):
                    self._embeds[t] = e
        finally:
            if moved:
                self.text_encoder.to("cpu"); gc.collect(); torch.cuda.empty_cache()
                if self.mode == "single":
                    self.i2v.transformer.to(self.dev)

    # ------------------------------------------------------------ decode
    def _decode(self, latents):
        import torch
        vae = self.i2v.vae
        lat = latents.to(self.vae_dev, vae.dtype)
        mean = torch.tensor(vae.config.latents_mean).view(1, vae.config.z_dim, 1, 1, 1).to(lat.device, lat.dtype)
        inv_std = 1.0 / torch.tensor(vae.config.latents_std).view(1, vae.config.z_dim, 1, 1, 1).to(lat.device, lat.dtype)
        lat = lat / inv_std + mean
        with torch.no_grad():
            vid = vae.decode(lat, return_dict=False)[0]
        return self.i2v.video_processor.postprocess_video(vid, output_type="np")[0]

    # ------------------------------------------------------------ generate
    def generate(self, *, prompt, image_path, seconds, aspect, quality, seed, out,
                 negative=DEFAULT_NEGATIVE, steps=None, camera="auto", log=print):
        import torch
        with self.lock:
            self.warmup(log)
            q_steps, long_s, short_s = QUALITY.get(quality, QUALITY["standard"])
            steps = int(steps or q_steps)
            w, h = (long_s, short_s) if aspect == "16:9" else (short_s, long_s)
            nf = video.frames_for(seconds) + 1          # 4k+1 frames, we keep exactly 24*s
            if (nf - 1) % 4:
                nf = ((nf - 1) // 4 + 1) * 4 + 1
            seed = int(seed) if seed is not None and int(seed) >= 0 else random.randint(0, 2**31 - 1)
            self.encode_many([prompt], negative, log)
            mode = "frames-to-video" if image_path else "text-to-video"
            log(f"{mode} {w}x{h} {seconds}s ({nf} frames) {steps} steps seed {seed}")
            t0 = time.time()
            for attempt in (1, 2):
                kw = dict(prompt_embeds=self._embeds[prompt].to(self.dev),
                          negative_prompt_embeds=self._embeds[negative].to(self.dev),
                          height=h, width=w, num_frames=nf, num_inference_steps=steps,
                          guidance_scale=5.0, output_type="latent")
                gen = torch.Generator("cpu").manual_seed(seed)
                stage = "denoising"
                try:
                    if image_path:
                        img = video.cover_fit(Image.open(image_path).convert("RGB"), w, h)
                        latents = self.i2v(image=img, generator=gen, **kw).frames
                    else:
                        latents = self.t2v(generator=gen, **kw).frames
                    stage = "decoding"
                    if self.mode == "single":           # make room for the VAE
                        self.i2v.transformer.to("cpu"); gc.collect(); torch.cuda.empty_cache()
                    try:
                        frames = np.asarray(self._decode(latents))
                    finally:
                        del latents
                        if self.mode == "single":
                            self.i2v.transformer.to(self.dev)
                except torch.cuda.OutOfMemoryError:
                    gc.collect(); torch.cuda.empty_cache()
                    raise RuntimeError(f"out of GPU memory while {stage} ({quality}, {seconds:g}s) - "
                                       "try draft quality or a shorter clip on this GPU")
                if np.isfinite(frames).all() and frames.max() > 0.02:
                    break
                if attempt == 1 and self.dtype == torch.float16:
                    log("fp16 overflow (black/NaN frames) - switching video model to bf16 and retrying")
                    self.dtype = torch.bfloat16
                    self.i2v.transformer.to(torch.bfloat16)
                    self._embeds = {k: v.to(torch.bfloat16) for k, v in self._embeds.items()}
                    continue
                raise RuntimeError("model returned empty frames - try SHOTLOOM_DTYPE=bf16")
            W, H = video.ASPECTS[aspect]
            video.write_frames(frames, out, W, H, seconds)
            log(f"done in {time.time() - t0:.0f}s -> {os.path.basename(out)}")
            del frames
            gc.collect(); torch.cuda.empty_cache()
            return out, seed


def make_engine(kind: str = "auto") -> BaseEngine:
    kind = (kind or os.environ.get("SHOTLOOM_ENGINE", "auto")).lower()
    if kind == "preview":
        return PreviewEngine()
    if kind == "wan":
        return WanEngine()
    try:
        import torch  # noqa
        import diffusers  # noqa
        if torch.cuda.is_available():
            return WanEngine()
    except Exception:
        pass
    return PreviewEngine()
