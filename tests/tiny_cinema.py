"""Tiny Wan 2.2 I2V-A14B stand-ins, saved the way the real downloads are:
experts as GGUF files in the original Wan key layout (like QuantStack's), and
Lightning LoRAs as safetensors in the lightx2v/Kijai layout. Loading them goes
through exactly the same diffusers code the real engine uses."""
import json
import os

import numpy as np
import torch

from tiny_wan import TEXT_DIM, FakeTokenizer

A14B_TRANSFORMER = dict(
    patch_size=(1, 2, 2), num_attention_heads=2, attention_head_dim=16, in_channels=36,
    out_channels=16, text_dim=TEXT_DIM, freq_dim=32, ffn_dim=64, num_layers=2,
    cross_attn_norm=True, qk_norm="rms_norm_across_heads", eps=1e-6, image_dim=None,
    rope_max_seq_len=64)

# diffusers name -> original Wan name (inverse of diffusers' single-file converter)
_TO_ORIGINAL = [
    ("condition_embedder.time_embedder.linear_1", "time_embedding.0"),
    ("condition_embedder.time_embedder.linear_2", "time_embedding.2"),
    ("condition_embedder.text_embedder.linear_1", "text_embedding.0"),
    ("condition_embedder.text_embedder.linear_2", "text_embedding.2"),
    ("condition_embedder.time_proj", "time_projection.1"),
    ("attn1", "self_attn"), ("attn2", "cross_attn"),
    (".to_out.0.", ".o."), (".to_q.", ".q."), (".to_k.", ".k."), (".to_v.", ".v."),
    ("ffn.net.0.proj", "ffn.0"), ("ffn.net.2", "ffn.2"), ("proj_out", "head.head"),
]


def to_original(key):
    for a, b in _TO_ORIGINAL:
        key = key.replace(a, b)
    if key == "scale_shift_table":
        return "head.modulation"
    key = key.replace(".scale_shift_table", ".modulation")
    # diffusers swaps norm2/norm3 when converting, so swap back
    return key.replace("norm2", "norm_tmp").replace("norm3", "norm2").replace("norm_tmp", "norm3")


def write_gguf(model, path):
    import gguf
    w = gguf.GGUFWriter(path, arch="wan")
    for k, v in model.state_dict().items():
        arr = v.detach().float().numpy()
        name = to_original(k)
        if arr.ndim == 2 and arr.shape[-1] % 32 == 0:
            q = gguf.quants.quantize(arr, gguf.GGMLQuantizationType.Q8_0)
            w.add_tensor(name, q, raw_dtype=gguf.GGMLQuantizationType.Q8_0)
        else:
            w.add_tensor(name, arr.astype(np.float32))
    w.write_header_to_file(); w.write_kv_data_to_file(); w.write_tensors_to_file(); w.close()
    return path


def write_lora(model, path, rank=4, scale=0.05):
    """lightx2v-style LoRA: diffusion_model.blocks.N.<layer>.lora_down/lora_up."""
    from safetensors.torch import save_file
    g = torch.Generator().manual_seed(1)
    sd = {}
    for k, v in model.state_dict().items():
        if not k.endswith(".weight") or v.ndim != 2 or not k.startswith("blocks."):
            continue
        if not any(s in k for s in ("attn1", "attn2", "ffn")):
            continue
        base = to_original(k)[: -len(".weight")]
        out_f, in_f = v.shape
        sd[f"diffusion_model.{base}.lora_down.weight"] = torch.randn(rank, in_f, generator=g) * scale
        sd[f"diffusion_model.{base}.lora_up.weight"] = torch.randn(out_f, rank, generator=g) * scale
    save_file({k: t.to(torch.bfloat16) for k, t in sd.items()}, path)
    return path


def build(tmp, dtype=torch.float32):
    """Returns (pipe, lora_paths) assembled exactly like WanCinemaEngine.warmup."""
    from diffusers import (AutoencoderKLWan, GGUFQuantizationConfig, UniPCMultistepScheduler,
                           WanImageToVideoPipeline, WanTransformer3DModel)
    cfg_dir = os.path.join(tmp, "base")
    paths, loras = [], []
    for i, sub in enumerate(("transformer", "transformer_2")):
        torch.manual_seed(10 + i)
        m = WanTransformer3DModel(**A14B_TRANSFORMER)
        os.makedirs(os.path.join(cfg_dir, sub), exist_ok=True)
        m.save_config(os.path.join(cfg_dir, sub))
        paths.append(write_gguf(m, os.path.join(tmp, f"{sub}.gguf")))
        loras.append(write_lora(m, os.path.join(tmp, f"{sub}_lora.safetensors")))
    q = GGUFQuantizationConfig(compute_dtype=dtype)
    experts = [WanTransformer3DModel.from_single_file(p, quantization_config=q, config=cfg_dir,
                                                      subfolder=sub, torch_dtype=dtype)
               for p, sub in zip(paths, ("transformer", "transformer_2"))]
    torch.manual_seed(0)
    vae = AutoencoderKLWan(base_dim=8, z_dim=16, dim_mult=[1, 1, 1, 1], num_res_blocks=1,
                           attn_scales=[], temperal_downsample=[False, True, True], dropout=0.0,
                           latents_mean=[0.0] * 16, latents_std=[1.0] * 16)
    sched = UniPCMultistepScheduler(prediction_type="flow_prediction", use_flow_sigmas=True,
                                    flow_shift=3.0, num_train_timesteps=1000)
    pipe = WanImageToVideoPipeline(tokenizer=FakeTokenizer(), text_encoder=None, vae=vae,
                                   scheduler=sched, transformer=experts[0], transformer_2=experts[1],
                                   boundary_ratio=0.9)
    return pipe, loras
