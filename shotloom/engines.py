"""Generation engines.

WanCinemaEngine - Wan 2.2 I2V-A14B + Lightning, 4-bit GGUF (Apache-2.0). Best quality;
                  frames-to-video; needs Kaggle T4 x2 or a 24 GB GPU.
WanEngine       - Wan 2.2 TI2V-5B (Apache-2.0). Faster, also does text-to-video;
                  runs on one 16 GB GPU.
PreviewEngine   - CPU stand-in that turns the frame into a camera-move clip, so
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

QUALITY_NAMES = ("draft", "standard", "final")


def cast_half(module, dtype):
    """Switch fp16 weights to `dtype` but leave the layers diffusers keeps in fp32
    (norms, rope, time embedder) untouched."""
    import torch
    for t in list(module.parameters()) + list(module.buffers()):
        if t.dtype == torch.float16:
            t.data = t.data.to(dtype)
    return module


def pin_execution_device(pipe, dev):
    """diffusers puts latents on the first non-CPU module it finds, which is the
    VAE when the VAE sits on another GPU. Pin it to the video model's device."""
    base = type(pipe)
    if getattr(base, "_shotloom_pinned", False):
        base = base.__mro__[1]
    pipe.__class__ = type(base.__name__, (base,),
                          {"_execution_device": property(lambda self, d=dev: d),
                           "_shotloom_pinned": True})
    return pipe


def build_prompt(prompt: str, camera: str = "auto", style: str = "", shot=None, look: str = "") -> str:
    """Compose the AI prompt like a shot description: action, framing/lens/light,
    camera move, project style, look, quality words."""
    from . import looks
    framing = looks.describe(getattr(shot, "size", ""), getattr(shot, "lens", ""),
                             getattr(shot, "light", "")) if shot is not None else ""
    look_style = looks.LOOKS.get(look or "none", {}).get("style", "")
    parts = [prompt, framing, CAMERA_PROMPTS.get(camera or "auto", ""), style, look_style,
             looks.DEFAULT_QUALITY_WORDS if prompt and prompt.strip() else ""]
    seen, out = set(), []
    for p in parts:
        p = (p or "").strip().rstrip(".")
        if p and p.lower() not in seen:
            seen.add(p.lower()); out.append(p)
    return ". ".join(out)


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
                 negative=DEFAULT_NEGATIVE, steps=None, camera="auto", log=print, progress=None):
        raise NotImplementedError


# --------------------------------------------------------------------------- preview
class PreviewEngine(BaseEngine):
    name = "Preview engine (CPU, camera moves only)"
    kind = "preview"

    def __init__(self):
        super().__init__()
        self.status = "ready - no GPU found, AI video disabled; clips are camera moves on your frame"

    def generate(self, *, prompt, image_path, seconds, aspect, quality, seed, out,
                 negative=DEFAULT_NEGATIVE, steps=None, camera="auto", log=print, progress=None):
        src = image_path
        if not src:
            src = out.replace(".mp4", "_card.png")
            video.title_card(prompt, src, aspect)
        seed = int(seed) if seed is not None and int(seed) >= 0 else random.randint(0, 999)
        video.still_motion(src, out, seconds, move=camera, aspect=aspect, index=seed)
        return out, seed


# --------------------------------------------------------------------------- wan (shared)
CINEMA_BASE = os.environ.get("SHOTLOOM_CINEMA_BASE", "Wan-AI/Wan2.2-I2V-A14B-Diffusers")
CINEMA_GGUF_REPO = os.environ.get("SHOTLOOM_CINEMA_GGUF", "QuantStack/Wan2.2-I2V-A14B-GGUF")
CINEMA_QUANT = os.environ.get("SHOTLOOM_CINEMA_QUANT", "Q4_K_M")
CINEMA_LORA_REPO = "lightx2v/Wan2.2-Lightning"
CINEMA_LORA_DIR = "Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1"


class _Evicted:
    """Temporarily park modules on the CPU and put them back where they were."""

    def __init__(self, modules):
        self.modules = [m for m in modules if m is not None]
        self.homes = []

    def __enter__(self):
        import torch
        for m in self.modules:
            self.homes.append(next(m.parameters()).device)
            m.to("cpu")
        if self.modules:
            gc.collect(); torch.cuda.empty_cache()
        return self

    def __exit__(self, *exc):
        for m, home in zip(self.modules, self.homes):
            m.to(home)
        return False


def _cuda_free_gb(dev):
    import torch
    if getattr(dev, "type", "") != "cuda":
        return 1e9
    free, _ = torch.cuda.mem_get_info(dev)
    return free / 1e9


class _WanBase(BaseEngine):
    """Shared machinery: GPU plan, prompt cache, text-encoder swaps, decode,
    exact-length output. Subclasses provide the models."""
    fps_native = 24          # frames per second the model was trained at
    cfg = 5.0                # classifier-free guidance (1.0 = off)
    image_only = False       # True: needs a first frame
    quality = {}             # name -> (steps, long side, short side)
    decode_headroom_gb = 4.0

    def __init__(self):
        super().__init__()
        self.ready = False
        self.status = "not loaded (loads on first generate; first run downloads the model)"
        self._embeds = {}

    # ------------------------------------------------------------ plan
    def _gpu_plan(self, log):
        import torch
        if not torch.cuda.is_available():
            raise RuntimeError("No CUDA GPU visible. On Kaggle: Settings > Accelerator > GPU T4 x2.")
        n = torch.cuda.device_count()
        major, _ = torch.cuda.get_device_capability(0)
        vram = torch.cuda.get_device_properties(0).total_memory / 1e9
        forced = os.environ.get("SHOTLOOM_DTYPE", "").lower()
        if forced in ("bf16", "fp16", "fp32"):
            self.dtype = {"bf16": torch.bfloat16, "fp16": torch.float16, "fp32": torch.float32}[forced]
        else:   # T4 / P100 and older have no native bf16
            self.dtype = torch.bfloat16 if major >= 8 else torch.float16
        self.dev = torch.device("cuda:0")
        self.n_gpus, self.vram = n, vram
        return n, vram

    def _load_text_encoder(self, repo, log):
        import torch
        from transformers import UMT5EncoderModel
        log("loading text encoder (umt5-xxl, ~11 GB; first run downloads it)...")
        self.text_encoder = UMT5EncoderModel.from_pretrained(
            repo, subfolder="text_encoder", torch_dtype=torch.bfloat16).eval()
        if self.mode == "big":
            self.text_encoder.to(self.dev)

    def _finish_setup(self, pipes):
        for pipe in pipes:
            pipe.set_progress_bar_config(disable=True)
            pin_execution_device(pipe, self.dev)

    # hooks for subclasses
    def _evict_for_text(self):
        return []

    def _evict_for_decode(self):
        return []

    def _pipe(self, image_path):
        raise NotImplementedError

    def _transformers(self):
        raise NotImplementedError

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
        """Encode every prompt not yet cached; the text encoder visits a GPU once
        for the whole batch."""
        import torch
        wanted = list(prompts) + ([negative] if self.cfg > 1 else [])
        todo = [p for p in dict.fromkeys(wanted) if p not in self._embeds]
        if not todo:
            return
        log(f"encoding {len(todo)} prompt(s)")
        visit = self.mode != "big" and self.te_work.type == "cuda"
        with _Evicted(self._evict_for_text() if visit else []):
            if visit:
                self.text_encoder.to(self.te_work)
            try:
                for i in range(0, len(todo), 4):
                    chunk = todo[i:i + 4]
                    try:
                        embeds = self._encode(chunk)
                    except RuntimeError as err:   # no bf16 kernel / no room on this GPU
                        log(f"GPU text encoding failed ({str(err)[:80]}); encoding on CPU instead")
                        self.text_encoder.to("cpu"); gc.collect(); torch.cuda.empty_cache()
                        embeds = self._encode(chunk)
                    for t, e in zip(chunk, embeds):
                        self._embeds[t] = e
            finally:
                if visit:
                    self.text_encoder.to("cpu"); gc.collect(); torch.cuda.empty_cache()

    # ------------------------------------------------------------ decode
    def _decode(self, latents):
        import torch
        vae = self.vae
        lat = latents.to(self.vae_dev, vae.dtype)
        mean = torch.tensor(vae.config.latents_mean).view(1, vae.config.z_dim, 1, 1, 1).to(lat.device, lat.dtype)
        inv_std = 1.0 / torch.tensor(vae.config.latents_std).view(1, vae.config.z_dim, 1, 1, 1).to(lat.device, lat.dtype)
        lat = lat / inv_std + mean
        with torch.no_grad():
            vid = vae.decode(lat, return_dict=False)[0]
        return self.video_processor.postprocess_video(vid, output_type="np")[0]

    # ------------------------------------------------------------ generate
    def num_frames(self, seconds):
        nf = int(round(seconds * self.fps_native)) + 1      # Wan wants 4k+1 frames
        if (nf - 1) % 4:
            nf = ((nf - 1) // 4 + 1) * 4 + 1
        return nf

    def size(self, quality, aspect):
        steps, long_s, short_s = self.quality.get(quality) or self.quality["standard"]
        return steps, ((long_s, short_s) if aspect == "16:9" else (short_s, long_s))

    def generate(self, *, prompt, image_path, seconds, aspect, quality, seed, out,
                 negative=DEFAULT_NEGATIVE, steps=None, camera="auto", log=print, progress=None):
        import torch
        if self.image_only and not image_path:
            raise ValueError(f"{self.name} animates a first frame - add an image to this shot "
                             "(make one in Gemini, ChatGPT or Midjourney), or use Animate still")
        with self.lock:
            self.warmup(log)
            q_steps, (w, h) = self.size(quality, aspect)
            steps = int(steps or q_steps)
            nf = self.num_frames(seconds)
            seed = int(seed) if seed is not None and int(seed) >= 0 else random.randint(0, 2**31 - 1)
            self.encode_many([prompt], negative, log)
            mode = "frames-to-video" if image_path else "text-to-video"
            log(f"{mode} {w}x{h} {seconds:g}s ({nf} frames @ {self.fps_native} fps) {steps} steps seed {seed}")

            def on_step(pipe, i, t, kw):
                if progress:
                    progress(i + 1, steps)
                return kw

            t0 = time.time()
            for attempt in (1, 2):
                kw = dict(prompt_embeds=self._embeds[prompt].to(self.dev), height=h, width=w,
                          num_frames=nf, num_inference_steps=steps, guidance_scale=self.cfg,
                          output_type="latent", callback_on_step_end=on_step)
                if self.cfg > 1:
                    kw["negative_prompt_embeds"] = self._embeds[negative].to(self.dev)
                else:
                    kw["guidance_scale_2"] = self.cfg
                gen = torch.Generator("cpu").manual_seed(seed)
                stage = "denoising"
                try:
                    pipe = self._pipe(image_path)
                    if image_path:
                        img = video.cover_fit(Image.open(image_path).convert("RGB"), w, h)
                        latents = pipe(image=img, generator=gen, **kw).frames
                    else:
                        latents = pipe(generator=gen, **kw).frames
                    stage = "decoding"
                    evict = self._evict_for_decode()
                    if evict and _cuda_free_gb(self.vae_dev) >= self.decode_headroom_gb:
                        evict = []
                    with _Evicted(evict):
                        frames = np.asarray(self._decode(latents))
                    del latents
                except torch.cuda.OutOfMemoryError:
                    gc.collect(); torch.cuda.empty_cache()
                    raise RuntimeError(f"out of GPU memory while {stage} ({quality}, {seconds:g}s) - "
                                       "try draft quality or a shorter clip on this GPU")
                if np.isfinite(frames).all() and frames.max() > 0.02:
                    break
                if attempt == 1 and self.dtype == torch.float16:
                    log("fp16 overflow (black/NaN frames) - switching to bf16 and retrying")
                    self.dtype = torch.bfloat16
                    for tr in self._transformers():
                        cast_half(tr, torch.bfloat16)
                    self._embeds = {k: v.to(torch.bfloat16) for k, v in self._embeds.items()}
                    continue
                raise RuntimeError("model returned empty frames - try SHOTLOOM_DTYPE=bf16")
            W, H = video.ASPECTS[aspect]
            video.write_frames(frames, out, W, H, seconds, src_fps=self.fps_native)
            log(f"done in {time.time() - t0:.0f}s -> {os.path.basename(out)}")
            del frames
            gc.collect(); torch.cuda.empty_cache()
            return out, seed


# --------------------------------------------------------------------------- fast: TI2V-5B
class WanEngine(_WanBase):
    """Wan 2.2 TI2V-5B: text-to-video and frames-to-video at 24 fps.

    dual   (2+ GPUs, e.g. Kaggle T4 x2): video model on GPU 0, VAE on GPU 1, text
           encoder parked in RAM and moved to GPU 1 only to encode new prompts.
    single (1 GPU, 16-24 GB): text encoder and video model take turns on the GPU,
           and the video model steps aside while the VAE decodes.
    big    (40 GB+): everything stays on one GPU.
    """
    name = "Wan 2.2 TI2V-5B (fast)"
    kind = "wan"
    fps_native = 24
    cfg = 5.0
    quality = {
        "draft": (20, 832, 480),
        "standard": (30, 1280, 704),
        "final": (40, 1280, 704),
    }

    def __init__(self, model_id: str | None = None):
        super().__init__()
        self.model_id = model_id or os.environ.get("SHOTLOOM_MODEL", "Wan-AI/Wan2.2-TI2V-5B-Diffusers")

    def warmup(self, log=print):
        if self.ready:
            return
        import torch
        from diffusers import AutoencoderKLWan, WanImageToVideoPipeline
        t0 = time.time()
        self.status = "loading..."
        n, vram = self._gpu_plan(log)
        if n >= 2:
            self.mode, self.vae_dev, self.te_work = "dual", torch.device("cuda:1"), torch.device("cuda:1")
        elif vram >= 40:
            self.mode, self.vae_dev, self.te_work = "big", self.dev, self.dev
        else:
            self.mode, self.vae_dev, self.te_work = "single", self.dev, self.dev
        log(f"GPUs: {n} x {torch.cuda.get_device_name(0)} ({vram:.0f} GB), "
            f"{str(self.dtype).split('.')[-1]}, memory plan: {self.mode}")
        self._load_text_encoder(self.model_id, log)
        log("loading VAE + video model (5B)...")
        vae = AutoencoderKLWan.from_pretrained(self.model_id, subfolder="vae", torch_dtype=torch.float32)
        i2v = WanImageToVideoPipeline.from_pretrained(
            self.model_id, vae=vae, text_encoder=None, torch_dtype=self.dtype)
        self._attach(i2v)
        self.ready = True
        self.status = f"ready on {torch.cuda.get_device_name(0)} x{n} ({self.mode})"
        log(f"model ready in {time.time() - t0:.0f}s")

    def _attach(self, i2v):
        from diffusers import WanPipeline
        self.i2v = i2v
        self.tokenizer, self.vae, self.video_processor = i2v.tokenizer, i2v.vae, i2v.video_processor
        self.t2v = WanPipeline(tokenizer=i2v.tokenizer, text_encoder=None, vae=i2v.vae,
                               scheduler=i2v.scheduler, transformer=i2v.transformer,
                               expand_timesteps=True)
        i2v.vae.enable_tiling()
        i2v.transformer.to(self.dev)
        i2v.vae.to(self.vae_dev)
        self._finish_setup([self.i2v, self.t2v])

    def _pipe(self, image_path):
        return self.i2v if image_path else self.t2v

    def _transformers(self):
        return [self.i2v.transformer]

    def _evict_for_text(self):
        return [self.i2v.transformer] if self.mode == "single" else []

    def _evict_for_decode(self):
        return [self.i2v.transformer] if self.mode == "single" else []


# --------------------------------------------------------------------------- cinematic: A14B
class WanCinemaEngine(_WanBase):
    """Wan 2.2 I2V-A14B, the strongest open Wan model, made to fit free GPUs:

    - two 14B experts (high-noise layout + low-noise detail) in 4-bit GGUF, ~9.7 GB each,
      one per T4 on Kaggle T4 x2;
    - lightx2v Lightning LoRAs: 4 steps and no CFG instead of 40 steps x 2;
    - 480p at 16 fps, motion-interpolated to 24 fps on output.
    Frames-to-video only: every shot needs a first frame.
    """
    name = "Wan 2.2 A14B Lightning (cinematic)"
    kind = "wan-cinema"
    fps_native = 16
    cfg = 1.0
    image_only = True
    quality = {
        "draft": (4, 640, 368),
        "standard": (4, 832, 480),
        "final": (6, 1024, 576),
    }
    decode_headroom_gb = 3.0

    def warmup(self, log=print):
        if self.ready:
            return
        import torch
        from diffusers import (AutoencoderKLWan, GGUFQuantizationConfig, UniPCMultistepScheduler,
                               WanImageToVideoPipeline, WanTransformer3DModel)
        from huggingface_hub import hf_hub_download
        from transformers import AutoTokenizer
        t0 = time.time()
        self.status = "loading..."
        n, vram = self._gpu_plan(log)
        if n >= 2:
            self.mode = "dual"
            self.dev2 = self.vae_dev = self.te_work = torch.device("cuda:1")
        elif vram >= 22:
            self.mode = "single"
            self.dev2 = self.vae_dev = self.te_work = self.dev
        else:
            raise RuntimeError("the cinematic engine needs 2 GPUs (Kaggle: GPU T4 x2) or one 24 GB GPU - "
                               "set ENGINE = 'fast' for single small GPUs")
        log(f"GPUs: {n} x {torch.cuda.get_device_name(0)} ({vram:.0f} GB), "
            f"{str(self.dtype).split('.')[-1]}, memory plan: {self.mode}")
        self._load_text_encoder(CINEMA_BASE, log)
        q = GGUFQuantizationConfig(compute_dtype=self.dtype)
        experts = []
        for sub, tag, dev in (("transformer", "HighNoise", self.dev), ("transformer_2", "LowNoise", self.dev2)):
            log(f"loading {tag.lower()} expert (14B, {CINEMA_QUANT}, ~10 GB; first run downloads it)...")
            path = hf_hub_download(CINEMA_GGUF_REPO, f"{tag}/Wan2.2-I2V-A14B-{tag}-{CINEMA_QUANT}.gguf")
            m = WanTransformer3DModel.from_single_file(
                path, quantization_config=q, config=CINEMA_BASE, subfolder=sub, torch_dtype=self.dtype)
            experts.append(m.to(dev))     # straight to its GPU: both experts + text encoder won't fit in RAM
            gc.collect()
        vae = AutoencoderKLWan.from_pretrained(CINEMA_BASE, subfolder="vae", torch_dtype=torch.float32)
        sched = UniPCMultistepScheduler.from_pretrained(CINEMA_BASE, subfolder="scheduler")
        tok = AutoTokenizer.from_pretrained(CINEMA_BASE, subfolder="tokenizer")
        pipe = WanImageToVideoPipeline(tokenizer=tok, text_encoder=None, vae=vae, scheduler=sched,
                                       transformer=experts[0], transformer_2=experts[1],
                                       boundary_ratio=0.9)
        log("adding Lightning 4-step LoRAs...")
        loras = [hf_hub_download(CINEMA_LORA_REPO, f"{CINEMA_LORA_DIR}/{f}_noise_model.safetensors")
                 for f in ("high", "low")]
        self._attach(pipe, loras)
        self.ready = True
        self.status = f"ready on {torch.cuda.get_device_name(0)} x{n} ({self.mode})"
        log(f"model ready in {time.time() - t0:.0f}s")

    def _attach(self, pipe, lora_paths=None, shift=None):
        """Lightning LoRAs, scheduler shift, device placement (high expert on GPU 0,
        low expert + VAE on GPU 1) and the cross-GPU hook for the low expert."""
        import torch
        from diffusers import UniPCMultistepScheduler
        shift = float(shift or os.environ.get("SHOTLOOM_CINEMA_SHIFT", 5.0))
        pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config, flow_shift=shift)
        if lora_paths:
            pipe.load_lora_weights(lora_paths[0], adapter_name="lightning")
            pipe.load_lora_weights(lora_paths[1], adapter_name="lightning", load_into_transformer_2=True)
            for tr in (pipe.transformer, pipe.transformer_2):     # LoRA math in the compute dtype
                for name, prm in tr.named_parameters():
                    if "lora_" in name and prm.dtype != self.dtype:
                        prm.data = prm.data.to(self.dtype)
        self.i2v = pipe
        self.tokenizer, self.vae, self.video_processor = pipe.tokenizer, pipe.vae, pipe.video_processor
        pipe.vae.enable_tiling()
        pipe.transformer.to(self.dev)
        pipe.transformer_2.to(self.dev2)
        pipe.vae.to(self.vae_dev)
        if self.dev2 != self.dev:
            from accelerate.hooks import AlignDevicesHook, add_hook_to_module
            add_hook_to_module(pipe.transformer_2,
                               AlignDevicesHook(execution_device=self.dev2, io_same_device=True))
        self._finish_setup([pipe])

    def _pipe(self, image_path):
        return self.i2v

    def _transformers(self):
        return [self.i2v.transformer, self.i2v.transformer_2]

    def _evict_for_text(self):
        # the text encoder borrows GPU 1 (or the only GPU) from the expert(s) living there
        if self.mode == "dual":
            return [self.i2v.transformer_2]
        return [self.i2v.transformer, self.i2v.transformer_2]

    def _evict_for_decode(self):
        return [self.i2v.transformer_2] if self.mode == "dual" else [self.i2v.transformer]


ENGINES = {"cinematic": WanCinemaEngine, "fast": WanEngine, "preview": PreviewEngine}


def make_engine(kind: str = "auto") -> BaseEngine:
    """auto: cinematic on 2+ GPUs or a 24 GB+ GPU, fast on smaller GPUs, preview on CPU."""
    kind = (kind or os.environ.get("SHOTLOOM_ENGINE", "auto")).lower()
    kind = {"wan": "fast", "wan-cinema": "cinematic", "a14b": "cinematic", "5b": "fast"}.get(kind, kind)
    if kind in ENGINES:
        return ENGINES[kind]()
    try:
        import torch
        import diffusers  # noqa
        if torch.cuda.is_available():
            n = torch.cuda.device_count()
            vram = torch.cuda.get_device_properties(0).total_memory / 1e9
            return WanCinemaEngine() if (n >= 2 or vram >= 22) else WanEngine()
    except Exception:
        pass
    return PreviewEngine()
