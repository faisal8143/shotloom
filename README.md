# Shotloom

**An open-source AI video studio that runs on free GPUs.**
Write a shot list, generate clips from text or from a first frame, keep the best takes, extend shots,
and stitch everything under your narration into a finished film. Inspired by the workflow of hosted
tools like Google Flow, but local, free and yours to modify.

Powered by [Wan 2.2 TI2V-5B](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B-Diffusers) (Apache-2.0) through
🤗 Diffusers, with a Gradio web UI.

---

## Features

| | |
|---|---|
| **Projects & shot lists** | One folder per film. Import a whole shot list from CSV + images in one go. |
| **Text to video** | Prompt only → clip. |
| **Frames to video** | First frame + prompt → the image comes to life. |
| **Exact lengths** | Every clip is exactly 4, 6 or 8 s at 24 fps, 1080p – cuts land on your edit grid. |
| **16:9 and 9:16** | YouTube or Shorts/Reels per project. |
| **Camera presets** | Push in, pull out, pan, tilt, drift – added to the prompt for AI shots. |
| **Takes** | Generate several takes per shot, keep the one you like. |
| **Extend** | Starts a new shot on the last frame of the current one, for longer continuous action. |
| **Animate still (free)** | Smooth camera move over any image on CPU – no GPU, instant, unlimited. |
| **Batch** | Render the whole film unattended; stop and resume any time. |
| **Scenebuilder** | Chosen takes in order + your narration → one MP4. Missing shots get a still placeholder so the cut is never short. |
| **Preview engine** | The whole studio works without a GPU (clips become camera moves) – handy for planning on a laptop. |

## Quick start

### A. Free on Kaggle (no GPU needed on your side)
1. Upload `notebooks/shotloom_kaggle.ipynb` to [kaggle.com/code](https://www.kaggle.com/code) (*New Notebook → File → Import*).
2. Session options: **GPU T4 x2**, **Internet on** (phone-verified account required).
3. Add your project (or `shots.csv` + images) as an input dataset.
4. `MODE = "batch"` → *Save Version → Save & Run All*. It renders in the background; download `projects/<name>` from *Output*.
   Or `MODE = "studio"` for the web app with a private link.

### B. Your own NVIDIA GPU (16 GB+ VRAM, 32 GB RAM)
```bash
git clone https://github.com/faisal8143/shotloom.git
cd shotloom
pip install torch --index-url https://download.pytorch.org/whl/cu124   # pick your CUDA build
pip install -r requirements.txt
python app.py                # http://127.0.0.1:7860
```

### C. Any computer, no GPU (planning, stills, editing)
```bash
pip install gradio numpy pillow imageio-ffmpeg ftfy
python app.py --engine preview
```
Build the shot list, make still clips, assemble rough cuts – then send the project to Kaggle for the AI shots.

## Shot list CSV

```csv
shot_id,seconds,type,image,motion_prompt,camera_move,notes
S001,6,HERO,S001.png,"A man in a crimson coat walks across a rain-soaked street at night",,cold open
S002,4,STILL,S002.png,,push_in,
```

| column | meaning |
|---|---|
| `shot_id` | unique id, e.g. `S001` |
| `seconds` | 4, 6 or 8 |
| `type` | `HERO` / `AI` = generate AI video, `STILL` = camera move on the image |
| `image` | first frame file name (optional for AI shots → text-to-video) |
| `motion_prompt` | what moves: subject action + camera. Also accepts a `prompt` column. |
| `camera_move` | `auto`, `push_in`, `pull_out`, `pan_left`, `pan_right`, `tilt_up`, `tilt_down`, `push_in_left`, `push_in_right`, `drift_up`, `drift_down`, `static` |
| `notes` | free text |

See `examples/shots.csv`.

## Command line (headless)
```bash
python -m shotloom.cli import --project my-film --csv shots.csv --images ./images
python -m shotloom.cli batch  --project my-film --quality standard
python -m shotloom.cli build  --project my-film --audio narration.mp3
```

## Quality presets

| preset | generation size | steps | use |
|---|---|---|---|
| `draft` | 832×480 | 20 | look-dev, fast checks |
| `standard` | 1280×704 | 30 | default |
| `final` | 1280×704 | 40 | hero shots |

All output is upscaled/cropped to 1920×1080 (or 1080×1920).
The log prints the real time per clip on your hardware. On a T4, expect AI clips to take several minutes to tens of
minutes each depending on preset and length – plan heavy renders as batch runs.

## How it uses memory
- **2 GPUs** (Kaggle T4 x2): text encoder on GPU 1, video model on GPU 0 – no swapping.
- **1 GPU, 16–24 GB**: text encoder and video model take turns on the GPU; prompts are encoded once per batch.
- **40 GB+**: everything stays on one GPU.
- Older GPUs without bf16 (T4, P100) run the video model in fp16 and fall back to bf16 automatically if fp16 overflows.

Environment variables: `SHOTLOOM_HOME` (projects folder), `SHOTLOOM_ENGINE` (`auto|wan|preview`),
`SHOTLOOM_DTYPE` (`fp16|bf16|fp32`), `SHOTLOOM_MODEL` (any Diffusers Wan 2.2 TI2V checkpoint), `SHOTLOOM_PASSWORD`.

## Project layout
```
app.py                  web studio (Gradio)
shotloom/engines.py     Wan 2.2 engine + CPU preview engine
shotloom/studio.py      generate, animate still, extend, batch, build
shotloom/project.py     projects, shots, takes (plain JSON + folders)
shotloom/video.py       exact-length encoding, camera moves, assembly (ffmpeg)
shotloom/cli.py         headless commands
notebooks/              Kaggle launcher
```

## Roadmap
- Use both Kaggle GPUs for two clips at once
- First + last frame control
- Character reference images (consistent faces across shots)
- Lightning / distilled LoRAs for 4–8 step generation
- Upscaling and frame interpolation passes

Contributions welcome – open an issue or a pull request.

## Responsible use
Disclose AI-generated content where platforms require it, and don't use Shotloom to depict real people
without their consent or to mislead. You are responsible for what you generate (see the Wan 2.2 licence terms).

## Credits & licence
- Video model: [Wan 2.2](https://github.com/Wan-Video/Wan2.2) by the Wan team, Apache-2.0
- [🤗 Diffusers](https://github.com/huggingface/diffusers), [Gradio](https://github.com/gradio-app/gradio), [FFmpeg](https://ffmpeg.org)

Shotloom is released under the **Apache License 2.0** – see `LICENSE`.
