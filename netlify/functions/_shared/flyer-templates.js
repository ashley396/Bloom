/**
 * Tier-B flyer templates — the reliable fallback, not the primary engine.
 *
 * These fire only when a request has no aesthetic signal (a plain closing
 * notice, a phone number to call) or when AI background generation is
 * unavailable/fails. Everything here is a flat/gradient brand-color
 * ground plus a fixed, always-legible layout — the same guarantee a real
 * printed sign has: the text is always readable, no matter what.
 *
 * When a request DOES carry aesthetic signal ("luxurious Mother's Day
 * flyer with peonies"), the visual concept comes from AI image generation
 * instead (see _shared/ai-image-engine.js's buildBackgroundPrompt) — these
 * templates' layout regions (headline/body/cta/logo/contact placement,
 * text-legibility rules) are still reused by the client-side renderer on
 * top of that generated image; only the background source changes.
 */

export const ASPECT_RATIOS = Object.freeze({
  square: { width: 1080, height: 1080, label: "Instagram / Facebook square post" },
  story: { width: 1080, height: 1920, label: "Instagram / Facebook Story" },
  facebook_post: { width: 1200, height: 630, label: "Facebook feed post" },
  flyer: { width: 1275, height: 1650, label: "Printable flyer (US Letter, 150dpi)" },
  email_banner: { width: 1200, height: 400, label: "Email header graphic" }
});

/** Layout regions as ratios of the canvas (0–1), so one definition works
 * at every resolution in ASPECT_RATIOS above. `align` controls text
 * alignment inside the region; `emphasis` is a hint the renderer uses to
 * pick font weight/size, not a literal pixel size. */
const REGIONS_STANDARD = {
  headline: { x: 0.08, y: 0.1, w: 0.84, h: 0.22, align: "center", emphasis: "hero" },
  body: { x: 0.1, y: 0.36, w: 0.8, h: 0.28, align: "center", emphasis: "body" },
  cta: { x: 0.1, y: 0.68, w: 0.8, h: 0.12, align: "center", emphasis: "cta" },
  logo: { x: 0.5, y: 0.06, w: 0.2, h: 0.1, align: "center", emphasis: "logo", anchor: "top" },
  contact: { x: 0.1, y: 0.88, w: 0.8, h: 0.08, align: "center", emphasis: "footnote" }
};

const REGIONS_NOTICE = {
  // Built for exactly your example 3 — a closing time and a phone number
  // must both be unmissable, everything else is secondary.
  headline: { x: 0.06, y: 0.14, w: 0.88, h: 0.2, align: "center", emphasis: "hero" },
  body: { x: 0.06, y: 0.38, w: 0.88, h: 0.24, align: "center", emphasis: "hero" },
  cta: { x: 0.06, y: 0.66, w: 0.88, h: 0.16, align: "center", emphasis: "hero" },
  logo: { x: 0.5, y: 0.04, w: 0.16, h: 0.08, align: "center", emphasis: "logo", anchor: "top" },
  contact: { x: 0.06, y: 0.9, w: 0.88, h: 0.06, align: "center", emphasis: "footnote" }
};

export const FLYER_TEMPLATES = Object.freeze({
  notice: {
    id: "notice",
    label: "Store notice",
    description: "Closing times, hours changes, urgent operational messages — maximum legibility.",
    regions: REGIONS_NOTICE,
    palette: { background: "brand_primary", text: "auto", accent: "brand_primary" },
    occasions: ["closing", "hours", "notice", "announcement", "urgent"]
  },
  sale: {
    id: "sale",
    label: "Sale / promotion",
    description: "A discount or limited-time promotional graphic.",
    regions: REGIONS_STANDARD,
    palette: { background: "brand_gradient", text: "auto", accent: "brand_primary" },
    occasions: ["sale", "promotion", "discount", "special"]
  },
  holiday: {
    id: "holiday",
    label: "Holiday / seasonal",
    description: "A seasonal campaign graphic (Mother's Day, Valentine's, Christmas, etc).",
    regions: REGIONS_STANDARD,
    palette: { background: "brand_gradient", text: "auto", accent: "brand_primary" },
    occasions: ["mother's day", "valentine's", "christmas", "holiday", "wedding", "graduation", "homecoming"]
  },
  sympathy: {
    id: "sympathy",
    label: "Sympathy notice",
    description: "A quiet, respectful tone — muted palette, generous whitespace.",
    regions: REGIONS_STANDARD,
    palette: { background: "muted", text: "auto", accent: "muted" },
    occasions: ["sympathy", "memorial", "funeral"]
  },
  general: {
    id: "general",
    label: "General graphic",
    description: "Default for anything that doesn't match a more specific template.",
    regions: REGIONS_STANDARD,
    palette: { background: "brand_gradient", text: "auto", accent: "brand_primary" },
    occasions: []
  }
});

/** Picks the best-matching template by occasion keyword, falling back to
 * "general" — never throws, never returns nothing. */
export function pickFlyerTemplate({ occasion } = {}) {
  const needle = String(occasion || "").toLowerCase();
  if (needle) {
    for (const template of Object.values(FLYER_TEMPLATES)) {
      if (template.occasions.some((o) => needle.includes(o))) return template;
    }
  }
  return FLYER_TEMPLATES.general;
}

/** Picks the best-matching canvas size from a loose hint ("Facebook",
 * "Instagram Story", "printable flyer") — defaults to square, the safest
 * general-purpose size. */
export function pickAspectRatio(hint) {
  const needle = String(hint || "").toLowerCase();
  if (/story|reel/.test(needle)) return "story";
  if (/facebook (post|feed)|feed post/.test(needle)) return "facebook_post";
  if (/print|flyer|poster|sign/.test(needle)) return "flyer";
  if (/email/.test(needle)) return "email_banner";
  return "square";
}
