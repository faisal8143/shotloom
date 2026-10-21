# Shotloom Web

A Google-Flow-style AI video studio that runs in the browser. Write a shot, pick a model, get takes, extend from the last frame, arrange shots in a timeline and export one MP4.

Video generation runs on [fal.ai](https://fal.ai) with **your own API key** (BYOK). One studio, many models:

| Model | Maker | Modes |
|---|---|---|
| Veo 3.1 Fast | Google | text, image |
| Veo 3.1 | Google | text, image, ingredients (reference images) |
| Seedance 2.0 / 2.0 Mini | ByteDance | text, image (+ end frame) |
| Kling 3.0 Pro | Kuaishou | text, image |
| FLUX 3 Max / FLUX 3 Draft | Black Forest Labs | text, image (+ end frame) |
| LTX-2 Fast | Lightricks | text |
| **Any other fal video model** | — | paste its endpoint ID under *Custom* |

Shotloom reads each model's parameters from fal's own OpenAPI schema, so new models and new options appear without code changes.

> The GPU-free, zero-cost path (open-source Wan 2.2 on Kaggle) is the Python studio in the repo root. This web app is the hosted, pay-per-second path with the strongest models.

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
3. Deploy. Open the URL, click **Add fal key**, paste a key from [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys).

Optional: to let people use *your* fal account without seeing the key, add `FAL_KEY` and `SHOTLOOM_PASSWORD` as Vercel environment variables. The server key is only used for requests that carry the password.

## Run locally

```bash
cd web
npm install        # also copies ffmpeg.wasm into public/ffmpeg
npm run dev        # http://localhost:3000
```

Node 20+.

## Costs

The app is free. fal bills per second of generated video, roughly $0.04/s (LTX-2 Fast) to $0.40/s (Veo 3.1 with audio). Check each model's page on fal for current prices. Use FLUX 3 Draft or Seedance 2.0 Mini to block out shots cheaply, then re-render the keepers on a premium model.

## How it works

```
browser (Studio UI, IndexedDB, ffmpeg.wasm)
   │  x-fal-key header
   ▼
Next.js routes /api/fal/{submit,status,result,cancel,schema}, /api/media
   │  Authorization: Key …
   ▼
fal queue  queue.fal.run/<endpoint>  →  video on fal's CDN
```

- `/api/fal/schema` turns fal's OpenAPI document into form fields (`lib/schema.ts`).
- `lib/plan.ts` picks the endpoint (text / image / ingredients) and builds the request.
- `/api/media` streams clips from fal's CDN (allow-listed hosts only) so the browser can grab frames and stitch the film.
- Status/result calls only follow URLs on fal's queue origin.

## Notes

- fal keeps generated files for a limited time. Download takes you want to keep, or export the film.
- Images are compressed to JPEG and sent inline. Vercel's free tier caps request bodies at ~4.5 MB, which fits a start frame, end frame and three ingredients.
- Your projects live in the browser you made them in. Clearing site data deletes them.

## Tests

```bash
npm test          # schema parsing, request building, ffmpeg export commands (uses local ffmpeg if installed)
npm run typecheck
```

## License

Apache-2.0
