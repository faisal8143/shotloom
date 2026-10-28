// Rough cost of a generation, shown before you press send.
// Rates are fal's published prices, checked October 2026. They change, so the
// UI always says "≈" and links to fal for the real number.

type Params = Record<string, unknown>;

export function seconds(v: unknown, fallback = 5): number {
  if (v === "auto" || v === undefined || v === null || v === "") return fallback;
  const n = parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const res = (p: Params) => String(p.resolution ?? "").toLowerCase();
const audioOn = (p: Params) => p.generate_audio !== false;

/** fal's "token" pricing (Seedance): width × height × seconds × 24 / 1024 tokens. */
function tokenRate(perThousand: number, r: string) {
  const px: Record<string, number> = { "480p": 854 * 480, "720p": 1280 * 720, "1080p": 1920 * 1080 };
  return ((px[r] ?? px["720p"]) * 24) / 1024 / 1000 * perThousand;
}

const promo = (until: string, now: Date) => now < new Date(until);

/** Per-second price of a video model, given its (default-filled) parameters. */
export function perSecond(modelKey: string, p: Params, now = new Date()): number | undefined {
  const r = res(p);
  switch (modelKey) {
    case "ltx-free":
    case "ltx-free-alt":
      return 0;
    case "veo31-lite":
      return r === "1080p" ? (audioOn(p) ? 0.08 : 0.05) : audioOn(p) ? 0.05 : 0.03;
    case "veo31-fast":
      return r === "4k" ? (audioOn(p) ? 0.35 : 0.3) : audioOn(p) ? 0.15 : 0.1;
    case "veo31":
      return r === "4k" ? (audioOn(p) ? 0.6 : 0.4) : audioOn(p) ? 0.4 : 0.2;
    case "seedance2":
      return tokenRate(0.014, r || "720p");
    case "seedance2-mini":
      return tokenRate(0.007, r || "720p");
    case "kling3-pro":
      return audioOn(p) ? 0.168 : 0.112;
    case "flux3-max": {
      const on = promo("2026-11-08", now);
      return r === "1080p" ? (on ? 0.0725 : 0.29) : on ? 0.0425 : 0.17;
    }
    case "flux3-draft":
      return 0.06;
    case "ltx2-fast":
      return r.includes("2160") ? 0.16 : r.includes("1440") ? 0.08 : 0.04;
    case "h3-max": {
      const on = promo("2026-11-01", now);
      if (r.startsWith("1080")) return on ? 0.104 : 0.16;
      if (r.startsWith("480")) return on ? 0.0325 : 0.05;
      return on ? 0.052 : 0.08;
    }
    default:
      return undefined;
  }
}

/** Per-image price of an image model. */
export function perImage(modelKey: string, p: Params): number | undefined {
  if (modelKey === "flux-schnell") return 0.002;
  if (modelKey === "nano-banana-21") return res(p) === "4k" ? 0.07 : 0.04;
  return undefined;
}

/** Estimated dollars for `count` outputs, or undefined when we don't know the model's price. */
export function estimate(modelKey: string, kind: "video" | "image", p: Params, count: number, now = new Date()): number | undefined {
  if (kind === "image") {
    const each = perImage(modelKey, p);
    return each === undefined ? undefined : each * count;
  }
  const rate = perSecond(modelKey, p, now);
  if (rate === undefined) return undefined;
  const len = seconds(p.duration ?? p.duration_ui ?? p.num_seconds, modelKey.startsWith("veo") ? 8 : 5);
  return rate * len * count;
}

export function formatUsd(v: number | undefined): string {
  if (v === undefined) return "";
  if (v === 0) return "Free";
  if (v < 0.01) return "< $0.01";
  return "≈ $" + (v < 1 ? v.toFixed(2) : v.toFixed(2));
}
