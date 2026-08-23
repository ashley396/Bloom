/**
 * Deterministic follow-up edits for a visual asset — "make the phone
 * number bigger," "use less pink," "use a white background instead."
 *
 * These are common, narrow, and safe to handle without a fresh AI call:
 * cheaper, instant, and — unlike re-prompting an LLM for a resize —
 * guaranteed not to drift the rest of the design. When a message doesn't
 * match anything here, the caller falls back to a full re-classification
 * (still linked via parent_asset_id, just a real new generation).
 */

const SIZE_UP = /\b(bigger|larger|increase|bump up)\b/;
const SIZE_DOWN = /\b(smaller|reduce|shrink)\b/;
const TARGET_CTA = /\b(phone|number|cta|call|contact)\b/;
const TARGET_HEADLINE = /\b(headline|title)\b/;
const TARGET_BODY = /\bbody\b/;
const TARGET_BARE_TEXT = /\btext\b/;

const COLOR_WORDS = [
  "pink", "red", "blue", "green", "yellow", "purple", "orange", "black", "white",
  "cream", "blush", "burgundy", "gold", "silver", "neon", "navy", "teal", "brown"
];

function scaleTargets(text) {
  const targets = new Set();
  if (TARGET_CTA.test(text)) targets.add("cta");
  if (TARGET_HEADLINE.test(text)) targets.add("headline");
  if (TARGET_BODY.test(text)) targets.add("body");
  if (!targets.size && TARGET_BARE_TEXT.test(text)) {
    targets.add("cta");
    targets.add("headline");
    targets.add("body");
  }
  return targets;
}

/**
 * Returns a plain deltas object, or null if the message doesn't match any
 * known deterministic revision pattern (caller should treat null as "run
 * a full revision instead"). Never throws.
 */
export function parseRevisionDeltas(message) {
  const text = String(message || "").toLowerCase();
  if (!text.trim()) return null;

  const deltas = { scale: {}, colorsAdd: [], colorsRemove: [], backgroundHint: null };
  let matched = false;

  if (SIZE_UP.test(text) || SIZE_DOWN.test(text)) {
    const direction = SIZE_UP.test(text) ? 1 : -1;
    for (const target of scaleTargets(text)) {
      deltas.scale[target] = direction;
      matched = true;
    }
  }

  for (const color of COLOR_WORDS) {
    if (new RegExp(`\\bless ${color}\\b`).test(text) || new RegExp(`\\b(no|remove|without) ${color}\\b`).test(text)) {
      deltas.colorsRemove.push(color);
      matched = true;
    }
    if (new RegExp(`\\bmore ${color}\\b`).test(text) || new RegExp(`\\buse ${color}( background| color)?( instead)?\\b`).test(text)) {
      deltas.colorsAdd.push(color);
      matched = true;
    }
  }

  const backgroundMatch = text.match(/use an? ([a-z][a-z\s]{2,40}?) background instead/);
  if (backgroundMatch) {
    deltas.backgroundHint = backgroundMatch[1].trim();
    matched = true;
  }

  return matched ? deltas : null;
}

const SCALE_STEPS = ["small", "normal", "large", "x-large", "xx-large"];

function stepScale(current = "normal", direction = 0) {
  const idx = Math.max(0, SCALE_STEPS.indexOf(current));
  const next = Math.min(SCALE_STEPS.length - 1, Math.max(0, idx + direction));
  return SCALE_STEPS[next];
}

/**
 * Applies parsed deltas to a flyer/background asset's own `style` block
 * (created with sensible defaults on first generation — see
 * defaultVisualStyle() below) — pure, no AI call, no I/O. Returns a new
 * style object; never mutates the one passed in.
 */
export function applyRevisionDeltas(style, deltas) {
  const next = {
    scale: { ...(style?.scale || {}) },
    paletteExclude: [...new Set(style?.paletteExclude || [])],
    paletteInclude: [...new Set(style?.paletteInclude || [])]
  };
  for (const [target, direction] of Object.entries(deltas.scale || {})) {
    next.scale[target] = stepScale(next.scale[target] || "normal", direction);
  }
  for (const color of deltas.colorsRemove || []) {
    next.paletteInclude = next.paletteInclude.filter((c) => c !== color);
    if (!next.paletteExclude.includes(color)) next.paletteExclude.push(color);
  }
  for (const color of deltas.colorsAdd || []) {
    next.paletteExclude = next.paletteExclude.filter((c) => c !== color);
    if (!next.paletteInclude.includes(color)) next.paletteInclude.push(color);
  }
  return next;
}

export function defaultVisualStyle() {
  return { scale: { headline: "normal", body: "normal", cta: "normal" }, paletteExclude: [], paletteInclude: [] };
}
