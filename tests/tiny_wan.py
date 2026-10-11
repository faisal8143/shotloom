"""Tiny random-weight Wan 2.2 components with the real architectures, so the
engine's code paths run on a CPU in seconds (no downloads, no GPU)."""
import torch

TEXT_DIM = 32


class FakeTokenizer:
    """Stands in for the umt5 tokenizer: same call signature and outputs."""

    def __call__(self, texts, padding="max_length", max_length=512, truncation=True,
                 add_special_tokens=True, return_attention_mask=True, return_tensors="pt"):
        ids = torch.zeros(len(texts), max_length, dtype=torch.long)
        mask = torch.zeros(len(texts), max_length, dtype=torch.long)
        for i, t in enumerate(texts):
            toks = [3 + (ord(c) % 60) for c in t][: max_length - 1] + [1]
            ids[i, : len(toks)] = torch.tensor(toks)
            mask[i, : len(toks)] = 1
        return type("Tok", (), {"input_ids": ids, "attention_mask": mask})()


def text_encoder():
    from transformers import UMT5Config, UMT5EncoderModel
    torch.manual_seed(0)
    cfg = UMT5Config(vocab_size=64, d_model=TEXT_DIM, num_layers=1, num_heads=2, d_kv=16,
                     d_ff=64, relative_attention_num_buckets=8)
    return UMT5EncoderModel(cfg).to(torch.bfloat16).eval()


def ti2v_5b_parts(dtype=torch.float32):
    """Same layout as Wan2.2-TI2V-5B (48-ch latents, 16x VAE, expand_timesteps)."""
    from diffusers import AutoencoderKLWan, UniPCMultistepScheduler, WanTransformer3DModel
    torch.manual_seed(0)
    transformer = WanTransformer3DModel(
        patch_size=(1, 2, 2), num_attention_heads=2, attention_head_dim=16, in_channels=48,
        out_channels=48, text_dim=TEXT_DIM, freq_dim=16, ffn_dim=64, num_layers=1,
        cross_attn_norm=True, qk_norm="rms_norm_across_heads", eps=1e-6, image_dim=None,
        rope_max_seq_len=64).to(dtype)
    vae = AutoencoderKLWan(
        base_dim=8, decoder_base_dim=8, z_dim=48, dim_mult=[1, 1, 1, 1], num_res_blocks=1,
        attn_scales=[], temperal_downsample=[False, True, True], dropout=0.0, is_residual=True,
        in_channels=12, out_channels=12, patch_size=2, scale_factor_spatial=16,
        scale_factor_temporal=4, latents_mean=[0.0] * 48, latents_std=[1.0] * 48)
    sched = UniPCMultistepScheduler(prediction_type="flow_prediction", use_flow_sigmas=True,
                                    flow_shift=5.0, num_train_timesteps=1000)
    return transformer, vae, sched


def ti2v_pipeline(dtype=torch.float32):
    from diffusers import WanImageToVideoPipeline
    tr, vae, sched = ti2v_5b_parts(dtype)
    return WanImageToVideoPipeline(tokenizer=FakeTokenizer(), text_encoder=None, vae=vae,
                                   scheduler=sched, transformer=tr, expand_timesteps=True)
