// Copies the ffmpeg.wasm browser files into public/ffmpeg so the film export
// runs from the same origin (browsers refuse cross-origin workers).
// Runs automatically after `npm install` (locally and on Vercel).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "ffmpeg");
mkdirSync(out, { recursive: true });

const files = [
  ["@ffmpeg/ffmpeg/dist/umd/ffmpeg.js", "ffmpeg.js"],
  ["@ffmpeg/ffmpeg/dist/umd/814.ffmpeg.js", "814.ffmpeg.js"],
  ["@ffmpeg/core/dist/umd/ffmpeg-core.js", "ffmpeg-core.js"],
  ["@ffmpeg/core/dist/umd/ffmpeg-core.wasm", "ffmpeg-core.wasm"],
];

let copied = 0;
for (const [src, dest] of files) {
  const from = join(root, "node_modules", src);
  if (!existsSync(from)) {
    console.warn(`[shotloom] missing ${src} - film export will be unavailable`);
    continue;
  }
  copyFileSync(from, join(out, dest));
  copied++;
}
console.log(`[shotloom] copied ${copied}/${files.length} ffmpeg.wasm files to public/ffmpeg`);
