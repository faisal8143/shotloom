# Shotloom

**An open-source cinematic AI video studio that runs on free GPUs.**
Write a shot list, animate your keyframes with the strongest open video model, keep the best takes, extend shots,
and stitch everything under your narration into a graded, film-finished MP4. Inspired by the workflow of hosted
tools like Google Flow, but free, local and yours to modify.

Powered by [Wan 2.2](https://github.com/Wan-Video/Wan2.2) (Apache-2.0) through 🤗 Diffusers, with a Gradio web UI.

---

## Two ways to run it

| | **Python studio** (this folder) | **[Shotflow — web app](web/)** |
|---|---|---|
| Models | Wan 2.2, open weights | free Hugging Face Spaces, **this studio on your own GPU**, or any fal.ai model (Veo 3.1, Seedance 2.0, Kling 3.0, FLUX 3, LTX-2) |
| Runs on | free Kaggle T4 x2, or your own GPU | any browser; renders happen wherever you point it |
| Cost | free (your time and a free GPU) | free on a Space or your own GPU; pay per second only on fal.ai, with **your own** key |
| Hosting | Kaggle notebook or local | free on Vercel (set **Root Directory** to `web`) |
| Quality | as far as free hardware goes | the same models hosted tools use |

Same ideas in both: shots, takes, extend, cinematographer presets, scenebuilder, one finished MP4.
See **[web/README.md](web/README.md)** for the web app.

### Browser timeline, your own GPU, no limits

The two halves join up: run this studio with `--share` (the Kaggle notebook does it for you, with `WEB_APP = True`)
and paste the `gradio.live` link into Shotflow (model pill → **Any Space, or your own GPU…**). The browser keeps
the projects, shots, takes and MP4 export; the rendering happens on your free Kaggle GPU. No daily quota and nothing
to pay - the only budget is GPU hours, about 30 a week on Kaggle.

Locally it is the same thing: `python app.py --share`, or
`python app.py --allow-origin https://your-shotloom-site` if you would rather not open a public link.

---

## Features

| | |
|---|---|
| **Cinematic engine** | Wan 2.2 **I2V-A14B** (the strongest open Wan model) + Lightning 4-step LoRAs, 4-bit GGUF – fits the free Kaggle T4 x2. |
| **Fast engine** | Wan 2.2 **TI2V-5B** – text-to-video and frames-to-video on a single 16 GB GPU. |
| **Projects & shot lists** | One folder per film. Import a whole shot list from CSV + images in one go. |
| **Cinematographer presets** | Shot size, lens and lighting per shot, plus camera moves; the UI shows the exact prompt the model receives. |
| **Looks + film finish** | Project looks (cinematic film, noir, teal & orange, documentary, 70s, cold corporate) set prompt style *and* colour grade; export adds grain, vignette and optional 2.39:1 letterbox. |
| **Exact lengths** | Every clip is exactly 4, 6 or 8 s at 24 fps, 1080p – cuts land on your edit grid. 16 fps model output is motion-interpolated to 24 fps. |
| **16:9 and 9:16** | YouTube or Shorts/Reels per project. |
| **Takes** | Generate several takes per shot, keep the one you like. |
| **Extend** | Starts a new shot on the last frame of the current one, for longer continuous action. |
| **Animate still (free)** | Smooth sub-pixel camera move over any image on CPU – no GPU, instant, unlimited. |
| **Batch** | Render the whole film unattended; stop and resume any time. |
| **Scenebuilder** | Chosen takes in order + your narration → one finished MP4. Missing shots get a still placeholder so the cut is never short. |
| **Preview engine** | The whole studio works without a GPU (clips become camera moves) – plan on a laptop, render on Kaggle. |

## How it compares

Hosted models like Veo 3, Seedance 2 and Kling 3 are larger and run on paid data-centre GPUs; a free open model on a
free T4 will not match them shot for shot. Shotloom closes as much of the gap as free hardware allows: the best open
model in a form that fits, image-first workflow (your keyframes set the look), cinematographer prompts, and a
consistent grade and film finish across every shot.

## Quick start

### A. Free on Kaggle (no GPU needed on your side)
1. Upload `notebooks/shotloom_kaggle.ipynb` to [kaggle.com/code](https://www.kaggle.com/code) (*File → Import Notebook*).
2. *Settings*: **GPU T4 x2**, **internet on** (phone-verified account required).
3. In the settings cell set `ENGINE` (`cinematic` or `fast`), `MODE` and your own `PASSWORD`.
4. **Run All**. `studio` prints a private `gradio.live` link (login `shotloom` + your password);
   `batch` renders a project you uploaded as a dataset in the background (*Save Version → Save & Run All*).

### B. Your own NVIDIA GPU
```bash
git clone https://github.com/faisal8143/shotloom.git
cd shotloom
pip install torch --index-url https://download.pytorch.org/whl/cu124   # pick your CUDA build
pip install -r requirements.txt
python app.py --engine cinematic     # 2 GPUs or one 24 GB GPU; use --engine fast on a 16 GB card
```

### C. Any computer, no GPU (planning, stills, editing)
```bash
pip install gradio numpy pillow imageio-ffmpeg ftfy
python app.py --engine preview
```

## Engines

| | cinematic | fast |
|---|---|---|
| model | Wan 2.2 I2V-A14B (2 × 14B experts), Q4_K_M GGUF + Lightning LoRAs | Wan 2.2 TI2V-5B |
| input | first frame + prompt | prompt, or first frame + prompt |
| steps | 4 (no CFG) | 20 / 30 / 40 |
| resolution | 640×368 / 832×480 / 1024×576 → 1080p | 832×480 / 1280×704 → 1080p |
| hardware | Kaggle T4 x2, or one 24 GB GPU | one 16 GB GPU |
| first download | ~33 GB | ~34 GB |

The log prints the real time per clip on your hardware. Free T4s are slow – plan big renders as batch runs.

## Shot list CSV

```csv
shot_id,seconds,type,image,motion_prompt,camera_move,shot_size,lens,lighting,notes
S001,6,HERO,S001.png,"The courier hesitates at the vault door, then pushes it open",push_in,wide,anamorphic,low-key noir,cold open
S002,4,STILL,S002.png,,pan_left,,,,
```

| column | meaning |
|---|---|
| `shot_id` | unique id, e.g. `S001` |
| `seconds` | 4, 6 or 8 |
| `type` | `HERO` / `AI` = AI video, `STILL` = camera move on the image |
| `image` | first frame file name; blank = an image named after the shot id, if there is one |
| `motion_prompt` | what moves and how the camera moves. Also accepts a `prompt` column. |
| `camera_move` | `auto`, `push_in`, `pull_out`, `pan_left`, `pan_right`, `tilt_up`, `tilt_down`, `push_in_left`, `push_in_right`, `drift_up`, `drift_down`, `static` |
| `shot_size` / `lens` / `lighting` | optional presets, see `shotloom/looks.py` |
| `notes` | free text |

## Command line (headless)
```bash
python -m shotloom.cli import --project my-film --csv shots.csv --images ./images
python -m shotloom.cli batch  --project my-film --engine cinematic --quality standard
python -m shotloom.cli build  --project my-film --audio narration.mp3
```

## How it uses memory
- **cinematic, Kaggle T4 x2**: high-noise expert on GPU 0, low-noise expert + VAE on GPU 1; the text encoder lives in
  RAM and borrows GPU 1 only to encode new prompts (prompts are cached).
- **fast, T4 x2**: video model on GPU 0, VAE on GPU 1. **fast, one 16–24 GB GPU**: models take turns on the GPU.
- GPUs without bf16 (T4, P100) compute in fp16 and switch to bf16 automatically if fp16 overflows.

Environment variables: `SHOTLOOM_HOME`, `SHOTLOOM_ENGINE` (`auto|cinematic|fast|preview`), `SHOTLOOM_DTYPE`,
`SHOTLOOM_PASSWORD`, `SHOTLOOM_CINEMA_QUANT` (e.g. `Q5_K_M`), `SHOTLOOM_CINEMA_SHIFT`, `SHOTLOOM_MODEL`.

## Development
```bash
pip install pytest torch diffusers transformers peft gguf
pytest          # runs both engines end to end on CPU with tiny random-weight Wan models
```

## Project layout
```
app.py                  web studio (Gradio)
shotloom/engines.py     cinematic (A14B) + fast (5B) engines, CPU preview engine
shotloom/looks.py       shot size / lens / lighting presets and project looks
shotloom/studio.py      generate, animate still, extend, batch, build + finish
shotloom/project.py     projects, shots, takes (plain JSON + folders)
shotloom/video.py       exact-length encoding, interpolation, camera moves, LUT grade, assembly (ffmpeg)
shotloom/cli.py         headless commands
notebooks/              Kaggle launcher
tests/                  CPU tests with tiny Wan models
```

## Roadmap
- First + last frame control
- Character reference images (consistent faces across shots)
- AI upscaling pass (Real-ESRGAN) and RIFE frame interpolation
- Two clips at once on the fast engine (one per GPU)

Contributions welcome – open an issue or a pull request.

## Responsible use
Disclose AI-generated content where platforms require it, and don't use Shotloom to depict real people
without their consent or to mislead. You are responsible for what you generate (see the Wan 2.2 licence terms).

## Credits & licence
- Video models: [Wan 2.2](https://github.com/Wan-Video/Wan2.2) by the Wan team, Apache-2.0
- 4-bit GGUF experts: [QuantStack/Wan2.2-I2V-A14B-GGUF](https://huggingface.co/QuantStack/Wan2.2-I2V-A14B-GGUF)
- Lightning LoRAs: [lightx2v/Wan2.2-Lightning](https://huggingface.co/lightx2v/Wan2.2-Lightning)
- [🤗 Diffusers](https://github.com/huggingface/diffusers), [Gradio](https://github.com/gradio-app/gradio), [FFmpeg](https://ffmpeg.org)

Shotloom is released under the **Apache License 2.0** – see `LICENSE`.
