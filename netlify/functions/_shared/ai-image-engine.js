/**
 * Florisyn AI Core — shared creative engine, image generation (Phase 5 of
 * the AI-OS rebuild).
 *
 * The exact model that already generated all 286 Floral Library product
 * photos (see scripts/generate-floral-library-images.mjs) — proven working
 * on this Cloudflare account, just never called from a live request path
 * before. This turns that into a secure, server-side, tenant-aware
 * capability any authorized Florisyn workflow can call (Lily, Marketing
 * Command Center, Photo Studio, Website Builder X, product workflows) —
 * one shared implementation, not a copy per caller. Credentials never
 * leave the server; callers only ever get back a public image URL.
 */

import { cloudflareAiToken } from "../ai-assistant.js";
import { uploadWebsiteMedia, publicWebsiteMediaUrl } from "./website-media.js";

const IMAGE_MODEL_DEFAULT = "@cf/black-forest-labs/flux-1-schnell";

/** Real error, not a guess: distinguishes "not configured" from "the
 * provider call itself failed" so callers can show the right message. */
export function imageGenerationConfigured(env = process.env) {
  return Boolean(String(env.CLOUDFLARE_ACCOUNT_ID || "").trim() && cloudflareAiToken(env));
}

/**
 * Calls Cloudflare Workers AI (flux-1-schnell) for one image, uploads the
 * result through the existing website-media pipeline (same bucket, same
 * shop-scoped path convention, same RLS as every other florist-uploaded
 * image), and returns a usable public URL. Never throws — always returns
 * { ok, ... } so a failed image never takes down the rest of a job.
 */
export async function generateImage(client, shopId, { prompt, filename } = {}) {
  const cleanPrompt = String(prompt || "").trim().slice(0, 1200);
  if (!cleanPrompt) return { ok: false, stage: "config", error: "No image prompt provided." };
  if (!imageGenerationConfigured()) {
    return { ok: false, stage: "config", error: "Image generation is not configured (Cloudflare AI credentials missing)." };
  }

  const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = cloudflareAiToken();
  const model = process.env.CLOUDFLARE_IMAGE_MODEL || IMAGE_MODEL_DEFAULT;
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: cleanPrompt, steps: 8 })
    });
  } catch (error) {
    return { ok: false, stage: "provider", error: `Image generation request failed: ${String(error?.message || error).slice(0, 200)}` };
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    return { ok: false, stage: "provider", error: `Image generation returned a non-JSON response (${response.status}).` };
  }
  if (!response.ok || payload.success === false) {
    const detail = payload.errors?.[0]?.message || payload.errors?.[0]?.code || `Image generation failed (${response.status})`;
    return { ok: false, stage: "provider", error: detail };
  }
  const base64 = payload.result?.image;
  if (!base64) return { ok: false, stage: "provider", error: "Image generation returned no image data." };

  const uploaded = await uploadWebsiteMedia(client, shopId, {
    dataUrl: `data:image/jpeg;base64,${base64}`,
    filename: filename || "ai-generated-image.jpg"
  });
  if (!uploaded.ok) return { ok: false, stage: "upload", error: uploaded.error };

  return {
    ok: true,
    path: uploaded.path,
    url: publicWebsiteMediaUrl(client, uploaded.path),
    provider: "cloudflare",
    model,
    prompt: cleanPrompt
  };
}

/**
 * One bounded retry around generateImage() for the flyer background.
 *
 * Why this exists: when background generation fails, the flyer is still
 * created but with no photograph at all — and a flyer with no photograph
 * can never meet the "bright, happy, colourful floral image" standard no
 * matter what the renderer does with it. A single transient provider
 * failure was therefore enough to hand a florist a photo-less flyer.
 *
 * Deliberately bounded and deliberately narrow:
 *  - ONE retry, never a loop — a wedged or unconfigured provider must not
 *    turn one florist's click into unbounded spend or a hung request.
 *  - Skipped entirely when the provider is not configured, since a second
 *    identical call cannot succeed and would only add latency.
 *  - Retried ONLY for a `provider`-stage failure. generateImage also
 *    reports `config` failures (nothing to retry) and `upload` failures —
 *    and an upload failure means the image WAS generated and billed, then
 *    storage rejected it. Retrying that pays for a second image to hit the
 *    same storage error, so it is returned as-is.
 *  - The retry asks for a DIFFERENT composition (variationSeed via the
 *    caller's promptFor(attempt)), so a prompt the model handled badly
 *    isn't simply resent verbatim.
 *
 * Returns generateImage's own { ok, ... } shape, plus `attempts`.
 */
export async function generateFlyerBackgroundWithRetry(client, shopId, { promptFor, filenameFor } = {}) {
  const maxAttempts = imageGenerationConfigured() ? 2 : 1;
  let last = { ok: false, stage: "config", error: "Image generation was not attempted." };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await generateImage(client, shopId, {
      prompt: typeof promptFor === "function" ? promptFor(attempt) : promptFor,
      filename: typeof filenameFor === "function" ? filenameFor(attempt) : filenameFor
    });
    if (last.ok) return { ...last, attempts: attempt + 1 };
    if (last.stage !== "provider") return { ...last, attempts: attempt + 1 };
  }
  return { ...last, attempts: maxAttempts };
}

// A real, live-found failure mode: the AI image model (a diffusion model,
// which cannot reliably spell) was asked — via visual_brief — to paint
// legible words onto a marketing image, and produced garbled nonsense
// instead of the real business text. This is now the ONE place every
// marketing-post image prompt passes through, so the guarantee holds
// regardless of what any caller's visual_brief happens to say: important
// wording (a closing time, a phone number, a price, an announcement) never
// goes to this function at all — it's routed to the deterministic flyer
// path (generateFlyerContent + public/flyer-renderer.js) instead — and a
// plain photo-only request never asks this model to render any words
// either. Unconditional, not left to the model to decide.
const NO_TEXT_DIRECTIVE =
  "No legible text, words, letters, numbers, or signage anywhere in the image — a purely photographic/visual scene only.";

/** Turns campaign/post context into a concrete visual prompt — never a
 * vague placeholder, per the brief's own "no vague placeholders" rule for
 * florist-facing creative. */
export function buildImagePrompt({ occasion, products = [], shopName, visualBrief } = {}) {
  const parts = [];
  if (visualBrief) parts.push(visualBrief);
  else {
    parts.push("Professional florist marketing photograph, bright natural light, clean background.");
    if (occasion) parts.push(`Theme: ${occasion}.`);
    if (products.length) parts.push(`Featuring: ${products.slice(0, 4).join(", ")}.`);
    if (shopName) parts.push(`Style suitable for ${shopName}'s social media and website.`);
  }
  parts.push(NO_TEXT_DIRECTIVE);
  return parts.join(" ").slice(0, 1200);
}

/**
 * Visual Creation Studio: a backdrop-ONLY prompt, distinct from
 * buildImagePrompt() above (which produces a full marketing photo that
 * may include products). The client already has a real, segmented cutout
 * of the florist's actual arrangement (photo-studio.js's cutout — genuine
 * background removal, not a fake "edit") and composites it over whatever
 * background this returns. Generating a SECOND arrangement here would
 * double up on flowers in the final composite, so the prompt explicitly
 * excludes any subject — this call's only job is the empty backdrop.
 */
export function buildBackgroundPrompt({ visualBrief, brandColor } = {}) {
  const parts = [];
  parts.push(visualBrief || "Clean, softly lit neutral backdrop, professional product-photography studio.");
  parts.push("Empty background only — absolutely no flowers, bouquet, vase, product, people, or text in the frame.");
  parts.push("Photographic, shallow depth of field, soft realistic lighting, no harsh shadows.");
  if (brandColor) parts.push(`If a color choice isn't otherwise specified, lean toward tones that complement ${brandColor}.`);
  return parts.join(" ").slice(0, 1200);
}

/**
 * Flyer Tier A background — the opposite exclusion from
 * buildBackgroundPrompt() above: THIS prompt actively wants real,
 * photographic flowers (there is no separate cutout being composited over
 * it — public/flyer-renderer.js draws Florisyn's own deterministic text
 * directly on top of whatever this returns, in negative space the prompt
 * is explicitly asked to leave). Never asks the model to spell anything —
 * NO_TEXT_DIRECTIVE is unconditional here exactly like buildImagePrompt(),
 * for the same live-defect reason (a diffusion model can't spell; the
 * renderer, not the model, is the only thing allowed to own the real
 * words). `groundedFlowers` should only ever be real shop inventory/recipe
 * names — passing anything else would mean the image plausibly depicts
 * flowers as "in stock" that aren't; when omitted, the prompt stays
 * general-seasonal and never implies specific availability.
 */
// A small, real set of distinct composition instructions — not just relying
// on the model's own stochastic sampling to make "Regenerate image"
// produce something actually different. variationSeed picks a different
// entry each call (generate_content always uses index 0; revise_content's
// "Regenerate image" passes a fresh seed each time), so two calls for the
// same flyer ask for a genuinely different photograph, not just a re-roll
// of the same instruction and hoping the model varies it.
// Real, live-found failure (Ashley's third real branch-deploy test, visual
// review): every flyer background trended dark/moody by construction —
// "deep navy... muted gold tones" was baked into every single prompt
// regardless of shop or occasion, no matter what the on-image band/text
// color did. This is the actual root cause of "gloomy, dull or plain
// images," independent of and upstream from any text-treatment fix in
// public/flyer-renderer.js. Fixed to match her explicit spec: "happy,
// colorful and floral. Bright and naturally lit... premium and
// realistic... rich but realistic color... luxury florist styling."
const FLYER_BACKGROUND_COMPOSITIONS = [
  "Full-bleed florals sweeping in from all four edges in a soft luxurious border, leaving the lower portion of the frame clear.",
  "A wide, airy composition with florals gathered along the upper edge and one side, generous open space across the lower third.",
  "An elegant diagonal sweep of florals across the upper corner, the lower portion of the frame left softly out of focus and open.",
  "Florals framing the top edge and sides, a clean open channel of soft, evenly-lit space across the bottom third."
];

export function buildFlyerBackgroundPrompt({ visualBrief, occasion, brandColor, groundedFlowers = [], variationSeed = 0 } = {}) {
  const compositionIndex =
    (((Number(variationSeed) || 0) % FLYER_BACKGROUND_COMPOSITIONS.length) + FLYER_BACKGROUND_COMPOSITIONS.length) %
    FLYER_BACKGROUND_COMPOSITIONS.length;

  // Every clause is a whole, self-contained instruction, tagged with
  // whether it may be dropped to fit the provider's length cap.
  //
  // Two real regressions taught this shape. Slicing the JOINED string cut
  // directives off mid-word — first the unconditional no-text guarantee
  // (the one thing stopping a diffusion model painting garbled words on a
  // customer's flyer), and then, once the tail was reserved, the calm-text-
  // area instruction itself, on inputs as ordinary as a 101-character
  // visual brief. A half-sentence is worse than no sentence: the model
  // still reads it. So nothing is ever sliced — the OPTIONAL clauses are
  // dropped whole, last-listed first, until the required ones fit.
  const required = (text) => ({ text, optional: false });
  const optional = (text) => ({ text, optional: true });

  const clauses = [
    required(
      "Luxury editorial floral photography for a premium flower shop's marketing flyer — happy, colorful, rich and vivid floral tones (blush pink, coral, sunny yellow, fresh green, soft lavender, warm cream), bright natural daylight, realistic and elegant florals, shallow depth of field, a composed, high-end magazine-quality look. Never dark, moody, dull, gloomy, or desaturated."
    ),
    required(FLYER_BACKGROUND_COMPOSITIONS[compositionIndex])
  ];

  if (Array.isArray(groundedFlowers) && groundedFlowers.length) {
    clauses.push(optional(`Feature real, recognizable ${groundedFlowers.slice(0, 5).join(", ")} rendered photorealistically.`));
  } else if (visualBrief) {
    clauses.push(optional(String(visualBrief)));
  }
  if (occasion) clauses.push(optional(`Mood/occasion: ${occasion}.`));

  // The renderer's own text regions (public/flyer-renderer.js /
  // flyer-templates.js) all live in the LOWER portion of the frame, never
  // the center. Strengthened after a real live review: "open space" alone
  // still came back with petals and foliage scattered through the lower
  // half, and a busy text area is the single biggest cause of hard-to-read
  // wording on the finished flyer. The renderer's per-region contrast is
  // insurance, not a substitute for a genuinely calm area, so the
  // composition itself has to reserve one. REQUIRED — this is the whole
  // point of the instruction and must never be the thing that gets cut.
  clauses.push(
    required(
      "Critically important: the lower 55% of the frame must be a calm, uncluttered, softly out-of-focus backdrop — smooth, evenly lit, pale, with no flowers, foliage, stems, petals, vase or busy detail in it at all, so a large block of text placed there afterwards stays perfectly readable. Keep every bright, colorful bloom in the upper portion, sweeping in from the top and sides."
    )
  );
  if (brandColor) {
    clauses.push(optional(`Color palette should read as premium and complement ${brandColor}, while staying bright and colorful overall.`));
  }
  clauses.push(required(NO_TEXT_DIRECTIVE));
  clauses.push(required("No logos, no watermarks, no invented brand marks."));

  const join = (list) => list.map((c) => c.text).join(" ");
  const kept = clauses.slice();
  // Drop optional clauses from the end until the whole prompt fits.
  for (let i = kept.length - 1; i >= 0 && join(kept).length > 1200; i--) {
    if (kept[i].optional) kept.splice(i, 1);
  }
  let out = join(kept);
  if (out.length > 1200) {
    // Only reachable if the REQUIRED clauses alone exceed the cap, which
    // would be an authoring mistake in this file rather than caller input.
    // Trim from the front so the no-text guarantee is the last thing lost.
    out = out.slice(out.length - 1200);
  }
  return out;
}
