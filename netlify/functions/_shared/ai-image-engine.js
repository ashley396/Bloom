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
  if (!cleanPrompt) return { ok: false, error: "No image prompt provided." };
  if (!imageGenerationConfigured()) {
    return { ok: false, error: "Image generation is not configured (Cloudflare AI credentials missing)." };
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
    return { ok: false, error: `Image generation request failed: ${String(error?.message || error).slice(0, 200)}` };
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: `Image generation returned a non-JSON response (${response.status}).` };
  }
  if (!response.ok || payload.success === false) {
    const detail = payload.errors?.[0]?.message || payload.errors?.[0]?.code || `Image generation failed (${response.status})`;
    return { ok: false, error: detail };
  }
  const base64 = payload.result?.image;
  if (!base64) return { ok: false, error: "Image generation returned no image data." };

  const uploaded = await uploadWebsiteMedia(client, shopId, {
    dataUrl: `data:image/jpeg;base64,${base64}`,
    filename: filename || "ai-generated-image.jpg"
  });
  if (!uploaded.ok) return { ok: false, error: uploaded.error };

  return {
    ok: true,
    path: uploaded.path,
    url: publicWebsiteMediaUrl(client, uploaded.path),
    provider: "cloudflare",
    model,
    prompt: cleanPrompt
  };
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
const FLYER_BACKGROUND_COMPOSITIONS = [
  "Full-bleed florals sweeping in from all four edges in a soft luxurious border, leaving the center clear.",
  "A wide, airy composition with florals gathered along the lower edge and one upper corner, generous open space elsewhere.",
  "An elegant diagonal sweep of florals across one corner, the rest of the frame left softly out of focus.",
  "Florals framing the top and bottom edges only, a clean vertical channel of open space through the middle."
];

export function buildFlyerBackgroundPrompt({ visualBrief, occasion, brandColor, groundedFlowers = [], variationSeed = 0 } = {}) {
  const parts = [];
  parts.push(
    "Luxury editorial floral photography for a premium flower shop's marketing flyer — deep navy, ivory, blush, and muted gold tones, realistic and elegant florals, soft natural directional light, shallow depth of field, a composed, high-end magazine-quality look."
  );
  const compositionIndex = ((Number(variationSeed) || 0) % FLYER_BACKGROUND_COMPOSITIONS.length + FLYER_BACKGROUND_COMPOSITIONS.length) % FLYER_BACKGROUND_COMPOSITIONS.length;
  parts.push(FLYER_BACKGROUND_COMPOSITIONS[compositionIndex]);
  if (Array.isArray(groundedFlowers) && groundedFlowers.length) {
    parts.push(`Feature real, recognizable ${groundedFlowers.slice(0, 5).join(", ")} rendered photorealistically.`);
  } else if (visualBrief) {
    parts.push(visualBrief);
  }
  if (occasion) parts.push(`Mood/occasion: ${occasion}.`);
  parts.push(
    "Leave clear, softly out-of-focus or open negative space toward the center of the frame — this is where real text will be placed afterward, not by you."
  );
  if (brandColor) parts.push(`Color palette should read as premium and complement ${brandColor}.`);
  parts.push(NO_TEXT_DIRECTIVE);
  parts.push("No logos, no watermarks, no invented brand marks.");
  return parts.join(" ").slice(0, 1200);
}
