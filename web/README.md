# Shotloom Web

A Google-Flow-style AI video studio that runs in the browser. Write a shot, pick a model, get takes, extend from the last frame, arrange shots in a timeline and export one MP4.

Generation runs one of two ways, switched by the Model dropdown:

- **Free, shared** — open weights on a [Hugging Face Space](https://huggingface.co/spaces). No key, no card, no account needed; it spends the Space's free GPU quota (about 2 minutes a day per browser, ~5 minutes with a free Hugging Face token, ~40 with PRO).
- **Free, your own GPU** — the Shotloom studio in this repo's root, running on a free Kaggle or Colab GPU (or your own PC). Paste its share link and there is no daily quota at all: Kaggle alone gives about 30 GPU hours a week.
- **Paid** — [fal.ai](https://fal.ai) with **your own API key** (BYOK), for the strongest models.

| Model | Maker | Modes |
|---|---|---|
| **LTX Video (free)** | Lightricks, on a HF Space | text, image |
| **Any Space, or your own GPU (free)** | — | paste `owner/space` or `https://…gradio.live` |
| Veo 3.1 Fast | Google | text, image |
| Veo 3.1 | Google | text, image, ingredients (reference images) |
| Seedance 2.0 / 2.0 Mini | ByteDance | text, image (+ end frame) |
| Kling 3.0 Pro | Kuaishou | text, image |
| FLUX 3 Max / FLUX 3 Draft | Black Forest Labs | text, image (+ end frame) |
| LTX-2 Fast | Lightricks | text |
| **Any other fal video model** | — | paste its endpoint ID under *Custom* |

Shotloom reads each model's parameters from fal's own OpenAPI schema, so new models and new options appear without code changes.

Shotloom reads a Space's parameters from its own `/gradio_api/info`, the same way it reads fal models from fal's OpenAPI schema, so any running video Space can be driven without code changes. The studio in the repo root is a Gradio app too, which is why the same code can drive your own GPU.

### Unlimited: run the model on your own GPU

Nothing here trains a model - Wan 2.2 and LTX are open weights, already trained. What limits free generation is GPU time, so the way to make it unlimited is to bring your own GPU:

1. Open `notebooks/shotloom_kaggle.ipynb` on [Kaggle](https://www.kaggle.com/code) (free T4 x2, ~30 hours a week), keep `WEB_APP = True`, and run it.
2. It prints a `https://….gradio.live` link.
3. In Shotloom Web: **Model → Any Space, or your own GPU…** and paste that link.

Generation now runs on that GPU: no daily quota, no per-second billing. The same works for Colab, a rented GPU, or a PC with an NVIDIA card - anything that can run `python app.py --share`.

Two things to know: the share link is public while the session runs (so stop the session when you are done), and the studio must allow the browser to call it. `--share` opens its API to any origin for exactly this reason; running it locally instead, pass `--allow-origin https://your-shotloom-site`.

## Features

- **Projects → shots → takes**, saved in your browser (IndexedDB). No account, no database.
- **Start frame, end frame, ingredients** (drop, paste or click to add images).
- **Camera presets**: shot size, movement, lens, lighting. **Project look** applied to every prompt.
- **1–4 takes per click**, queue position and live render status, cancel, try again.
- **Extend**: new shot that starts from a take's last frame. **Frame**: start a new shot from any paused frame.
- **Scenebuilder timeline**, *Play film* preview, and **Export MP4**: joins the chosen takes in the browser with ffmpeg.wasm (mixed resolutions and missing audio are normalised automatically).
- Takes still rendering when you close the tab resume when you come back.

## Deploy free on Vercel

1. Fork or push this repo to GitHub.
2. On [vercel.com/new](https://vercel.com/new) import it and set **Root Directory** to `web`. Framework: Next.js (auto-detected).
3. Deploy. Open the URL and press **Generate** — the default model is free and needs no key.
4. Only for the paid models: open **Settings** and paste a key from [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys).

Optional: to let people use *your* fal account without seeing the key, add `FAL_KEY` and `SHOTLOOM_PASSWORD` as Vercel environment variables. The server key is only used for requests that carry the password.

## Run locally

```bash
cd web
npm install        # also copies ffmpeg.wasm into public/ffmpeg
npm run dev        # http://localhost:3000
```

Node 20+.

## Costs

Free models cost nothing. Hugging Face gives every visitor a small daily GPU allowance; when it runs out, the take fails with a message saying so and it resets 24 hours after the first render. Adding a free token in Settings raises the allowance and gives better queue priority.

The app itself is free. fal bills per second of generated video, roughly $0.04/s (LTX-2 Fast) to $0.40/s (Veo 3.1 with audio). Check each model's page on fal for current prices. Use FLUX 3 Draft or Seedance 2.0 Mini to block out shots cheaply, then re-render the keepers on a premium model.

## How it works

```
browser (Studio UI, IndexedDB, ffmpeg.wasm)
   │                                   │  free path: straight to the Space
   │  x-fal-key header                 ▼
   ▼                            <space>.hf.space/gradio_api/call/<api>
Next.js /api/fal/{submit,status,     (POST → event id, then one SSE stream
   result,cancel,schema}              held open until the clip is ready)
   │  Authorization: Key …
   ▼
fal queue  queue.fal.run/<endpoint>  →  video on fal's CDN
```

The free path deliberately skips our own server: a Space can take minutes and holds the connection open the whole time, which a serverless function on a free plan would cut off. The browser can wait. The cost is that a take does not survive closing the tab - it is marked failed with *Try again* - while fal takes still resume.

- `/api/fal/schema` turns fal's OpenAPI document into form fields (`lib/schema.ts`).
- `/api/hf/schema` does the same for a Space's `/gradio_api/info` (`lib/hf.ts`), including which of its endpoints to call and the order its parameters go in. A full studio exposes every button it has, so the endpoint is scored, not guessed. `lib/hf-client.ts` makes the call, uploads start frames and follows the event stream.
- `lib/plan.ts` picks the endpoint (text / image / ingredients) and builds the request.
- `/api/media` streams clips from fal's CDN (allow-listed hosts only) so the browser can grab frames and stitch the film.
- Status/result calls only follow URLs on fal's queue origin.

## Notes

- fal keeps generated files for a limited time. Download takes you want to keep, or export the film.
- Images are compressed to JPEG and sent inline. Vercel's free tier caps request bodies at ~4.5 MB, which fits a start frame, end frame and three ingredients.
- Your projects live in the browser you made them in. Clearing site data deletes them.
- Free Spaces are community-run: one can be asleep, busy or removed. Switch to the mirror entry, or paste another Space, if one stops answering.

## Tests

```bash
npm test          # schema parsing (fal + Spaces), request building, ffmpeg export commands
npm run typecheck

# the whole free path against a stand-in Space, no GPU quota spent:
node tests/mock-space.mjs 7860
SHOTLOOM_HF_BASE=http://127.0.0.1:7860 NEXT_PUBLIC_SHOTLOOM_HF_BASE=http://127.0.0.1:7860 \
  SHOTLOOM_TEST_MEDIA_ORIGIN=http://127.0.0.1:7860 npm run dev
```

## License

Apache-2.0
