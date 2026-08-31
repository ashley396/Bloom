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
import { detectInventedTextOnPhoto } from "./florist-ai-vision.js";

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
    prompt: cleanPrompt,
    // Kept only for generateImageCheckingText's own vision-based QA pass
    // below — the pixels are already in memory here, so there's no reason
    // to re-download the just-uploaded file to inspect them. Not part of
    // this function's documented public contract; existing callers that
    // only read ok/path/url/provider/model/prompt are unaffected.
    imageDataUrl: `data:image/jpeg;base64,${base64}`
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

/**
 * One bounded retry around generateImage() specifically for invented text.
 *
 * Real, live-found failure: a florist's plain "make today's post" request
 * (no operational fact, never near the deterministic flyer renderer) came
 * back with a photo carrying invented, garbled pseudo-branding painted
 * into a corner despite NO_TEXT_DIRECTIVE being unconditional on every
 * prompt above. A prompt instruction is a statistical nudge to a
 * diffusion model, not a hard constraint, so wording alone cannot close
 * this — this actually inspects the generated pixels with a real vision
 * model (florist-ai-vision.js's detectInventedTextOnPhoto) and asks for
 * one fresh generation if it finds text, the same bounded-retry
 * discipline generateFlyerBackgroundWithRetry already uses for a
 * different failure mode (a failed provider call).
 *
 * Deliberately narrow: never fails the whole request over this — a
 * vision-check failure, or a second attempt that still shows text, still
 * returns the best photo actually generated. Blocking a real, otherwise-
 * usable photo over an imperfect QA pass would be a worse outcome than
 * shipping the same rare imperfection the check couldn't clear in two
 * tries.
 */
export async function generateImageCheckingText(client, shopId, { promptFor, filenameFor, maxAttempts = 2 } = {}) {
  let last = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const gen = await generateImage(client, shopId, {
      prompt: typeof promptFor === "function" ? promptFor(attempt) : promptFor,
      filename: typeof filenameFor === "function" ? filenameFor(attempt) : filenameFor
    });
    if (!gen.ok) return last ?? gen;
    last = gen;
    const check = await detectInventedTextOnPhoto({ dataUrl: gen.imageDataUrl });
    if (!check.hasText) return gen;
  }
  return last;
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
// Strong but COMPACT. Every character here is taken from the optional
// clauses — an earlier, wordier version pushed the required clauses past the
// cap on their own, which silently squeezed out the real-inventory grounding
// that keeps a flyer honest about what the shop actually stocks.
const NO_TEXT_DIRECTIVE =
  "ABSOLUTELY NO TEXT: no words, letters, numbers, captions, signage, labels, price tags, banners, watermarks or logos " +
  "anywhere. Invented lettering is always nonsense. A purely photographic scene with no writing of any kind.";

/** Ashley, shown a funeral post whose image had invented gibberish painted
 * across it and a flat arrangement: these posts "need to have ultra realistic
 * flower arrangements that match the post." Required on every photographic
 * prompt — a florist's own product photography is the product. */
const REALISM_DIRECTIVE =
  "Ultra-realistic photograph of genuine fresh flowers — accurate botanical detail, real petals, stems and foliage, " +
  "professional lighting, shallow depth of field. Not an illustration, painting, clip art, cartoon or 3D render.";

/**
 * Joins whole clauses to fit a provider's length cap, dropping OPTIONAL ones
 * from the end until the REQUIRED ones fit.
 *
 * Slicing the joined string is what this exists to prevent, and it was a real
 * shipped defect twice over: a long visual brief silently cut the no-text
 * guarantee off the end of the prompt, and the model then painted invented
 * words across a florist's post. Worse, a partial clause is not a no-op — the
 * model still reads half a sentence. Nothing is ever cut mid-clause here.
 */
export function composePrompt(clauses, cap = 1200) {
  const join = (list) => list.map((c) => c.text).join(" ");
  const kept = clauses.filter((c) => c && c.text);
  for (let i = kept.length - 1; i >= 0 && join(kept).length > cap; i--) {
    if (kept[i].optional) kept.splice(i, 1);
  }
  let out = join(kept);
  if (out.length > cap) {
    // Only reachable if the required clauses alone exceed the cap, which is
    // an authoring mistake here rather than caller input. Trim from the FRONT
    // so the no-text guarantee, which is last, is the last thing lost.
    out = out.slice(out.length - cap);
  }
  return out;
}
const required = (text) => ({ text, optional: false });
const optional = (text) => ({ text, optional: true });

/**
 * Shortens text to fit maxLen WITHOUT cutting a word in half — cuts at the
 * last space at or before the limit, never mid-word. Real, live-found
 * failure this exists to prevent: composePrompt's own all-or-nothing
 * per-CLAUSE dropping is right for a whole instruction (half of "ABSOLUTELY
 * NO TEXT" is worse than none), but wrong for the one clause that names the
 * actual subject of the photo — losing that ENTIRELY (a jaguar mascot post
 * regenerated with no jaguar in it at all) is worse than losing only its
 * trailing descriptive detail. If no space exists early enough, cuts at
 * maxLen outright rather than returning nothing.
 */
function truncateAtWordBoundary(text, maxLen) {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  // Only word-break if it doesn't throw away most of the budget doing so.
  return (lastSpace > maxLen * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
}

// occasion (currentItem.data.title, an API field with no length ceiling —
// no shipped UI sends a long one today, but nothing stops a direct API call
// from doing so) is the other variable-length, caller-controlled input this
// function embeds. Left unbounded, a long enough occasion string (alone, or
// combined with the fixed sympathy clause) could still force the WHOLE
// prompt over cap, and composePrompt's own last-resort fallback for that
// case (trim from the very front) doesn't respect clause boundaries — it
// would eat into REALISM_DIRECTIVE and the truncated visual_brief clause
// alike, losing the subject the same way this file's other fix exists to
// prevent. Capping it the same way (truncated at a word boundary, never
// dropped) keeps the "other required" budget genuinely bounded, so
// visual_brief's own computed budget is never squeezed to nothing by an
// unbounded occasion string.
const MAX_OCCASION_CLAUSE_CHARS = 200;

/**
 * Turns a structured creative_brief (see ai-creative-engine.js's
 * CREATIVE_BRIEF_SCHEMA) into one concrete clause an image-generation
 * prompt can use directly — the whole point of adding the structured
 * brief in the first place: visual_brief is prose written for a person,
 * this is the same concept an image model can act on without having to
 * parse a sentence for the parts that matter (subject/mood/lighting/
 * composition/style). Defensive — a creativeBrief can be null, or have
 * every field but primary_subject blank, and this only ever returns a
 * usable string, never a half sentence.
 */
function creativeBriefClause(creativeBrief) {
  if (!creativeBrief || !creativeBrief.primary_subject) return null;
  const parts = [String(creativeBrief.primary_subject).trim()];
  if (creativeBrief.mood) parts.push(`mood: ${creativeBrief.mood}`);
  if (creativeBrief.lighting) parts.push(`lighting: ${creativeBrief.lighting}`);
  if (creativeBrief.composition) parts.push(`composition: ${creativeBrief.composition}`);
  if (creativeBrief.floral_style) parts.push(`floral style: ${creativeBrief.floral_style}`);
  return `${parts.join("; ")}.`;
}

/** Turns campaign/post context into a concrete visual prompt — never a
 * vague placeholder, per the brief's own "no vague placeholders" rule for
 * florist-facing creative. `creativeBrief`, when present, describes the
 * SAME concept as `visualBrief` — see creativeBriefClause's docstring —
 * and is preferred over the raw prose because it's already broken into
 * the fields this function's own subject clause needs; `visualBrief`
 * alone is untouched for any caller that doesn't have a structured brief
 * yet (generateFlyerContent's flyer path, older persisted content). */
export function buildImagePrompt({ occasion, products = [], shopName, visualBrief, creativeBrief } = {}, cap = 1200) {
  const subjectText = creativeBriefClause(creativeBrief) || (visualBrief ? String(visualBrief) : null);
  const occasionClause = occasion
    ? truncateAtWordBoundary(`The arrangement must genuinely suit this occasion: ${occasion}.`, MAX_OCCASION_CLAUSE_CHARS)
    : null;
  const sympathyClause = SYMPATHY_OCCASION_RE.test(
    `${occasion || ""} ${visualBrief || ""} ${creativeBrief?.primary_subject || ""} ${creativeBrief?.floral_style || ""}`
  )
    ? "This is sympathy work: white, ivory and cream blooms with soft green foliage, restrained and dignified, gentle diffused light. Never bright, festive, vivid or celebratory."
    : null;

  const clauses = [required(REALISM_DIRECTIVE)];
  if (subjectText) {
    // A real, live-found failure: this clause used to be OPTIONAL, and it
    // is the ONLY thing in this whole function that ever describes the
    // actual subject of the photo. Every other clause here compounds across
    // repeated revisions (buildImageRevisionBrief's own "previous version,
    // for reference" wrapping) and can push the combined prompt over cap —
    // and composePrompt drops a too-long optional clause WHOLE, not
    // trimmed. That silently erased the real subject entirely (a jaguar
    // mascot post regenerated with no jaguar in it at all), leaving a
    // generic floral photo. Fixed to never let that happen: this clause is
    // REQUIRED, fitted to whatever budget is actually left after every
    // other required clause, truncated at a word boundary rather than
    // dropped — since the concrete subject is the FIRST thing
    // generateSocialPost's own prompt instructs the model to name in
    // visual_brief (or, now, creative_brief.primary_subject), keeping the
    // front of the string keeps the subject even when trailing descriptive
    // detail must be cut to fit.
    const otherRequired = [REALISM_DIRECTIVE, occasionClause, sympathyClause, NO_TEXT_DIRECTIVE].filter(Boolean);
    // +1 join space per clause already present, plus the join space this
    // clause itself will need once inserted.
    const otherLength = otherRequired.reduce((sum, c) => sum + c.length + 1, 0);
    const budget = Math.max(60, cap - otherLength);
    clauses.push(required(truncateAtWordBoundary(subjectText, budget)));
  } else {
    clauses.push(required("Professional florist marketing photograph, bright natural light, clean background."));
    if (products.length) clauses.push(optional(`Featuring: ${products.slice(0, 4).join(", ")}.`));
    if (shopName) clauses.push(optional(`Style suitable for ${shopName}'s social media and website.`));
  }
  // The occasion is what makes the arrangement match the post it illustrates —
  // a sympathy tribute for funeral work, not a generic bouquet. Required.
  if (occasionClause) clauses.push(required(occasionClause));
  if (sympathyClause) clauses.push(required(sympathyClause));
  clauses.push(required(NO_TEXT_DIRECTIVE));
  return composePrompt(clauses, cap);
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
  return composePrompt([
    optional(String(visualBrief || "Clean, softly lit neutral backdrop, professional product-photography studio.")),
    required("Empty background only — absolutely no flowers, bouquet, vase, product, people, or text in the frame."),
    required("Photographic, shallow depth of field, soft realistic lighting, no harsh shadows."),
    brandColor ? optional(`If a color choice isn't otherwise specified, lean toward tones that complement ${brandColor}.`) : null,
    required(NO_TEXT_DIRECTIVE)
  ].filter(Boolean));
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
// Sympathy, funeral and memorial work needs a different palette from a
// Valentine's promotion. Kept next to the prompt that uses it.
const SYMPATHY_OCCASION_RE =
  /\b(funeral|sympathy|memorial|bereave(?:d|ment)|condolence|casket|graveside|burial|cremation|wake|passed away|in memory|remembrance|celebration of life)\b/i;

const FLYER_BACKGROUND_COMPOSITIONS = [
  "Full-bleed florals sweeping in from all four edges in a soft luxurious border, leaving the lower portion of the frame clear.",
  "A wide, airy composition with florals gathered along the upper edge and one side, generous open space across the lower third.",
  "An elegant diagonal sweep of florals across the upper corner, the lower portion of the frame left softly out of focus and open.",
  "Florals framing the top edge and sides, a clean open channel of soft, evenly-lit space across the bottom third."
];

export function buildFlyerBackgroundPrompt({ visualBrief, occasion, brandColor, groundedFlowers = [], variationSeed = 0, creativeBrief } = {}) {
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
  // The bright, happy palette below exists for a real reason — every flyer
  // background once trended dark and gloomy, and Ashley's own spec is "happy,
  // colorful and floral". But it was REQUIRED on every prompt regardless of
  // what the flyer was for, so a post about funeral work came back with coral
  // and sunny-yellow spring flowers on it. Sympathy work gets a palette that
  // suits it; everything else keeps the bright default unchanged.
  const bereavement = SYMPATHY_OCCASION_RE.test(
    `${occasion || ""} ${visualBrief || ""} ${creativeBrief?.primary_subject || ""} ${creativeBrief?.floral_style || ""}`
  );
  const clauses = [
    required(
      bereavement
        ? "Luxury editorial floral photography for a premium flower shop's sympathy and funeral work — white, ivory and cream blooms with soft green foliage, restrained and dignified, gentle diffused natural daylight, realistic and elegant florals, shallow depth of field, a composed, high-end magazine-quality look. Calm and comforting, never bright, festive, vivid or celebratory, and never harsh, grim or funereal-black."
        : "Luxury editorial floral photography for a premium flower shop's marketing flyer — happy, colorful, rich and vivid floral tones (blush pink, coral, sunny yellow, fresh green, soft lavender, warm cream), bright natural daylight, realistic and elegant florals, shallow depth of field, a composed, high-end magazine-quality look. Never dark, moody, dull, gloomy, or desaturated."
    ),
    required(FLYER_BACKGROUND_COMPOSITIONS[compositionIndex])
  ];

  if (Array.isArray(groundedFlowers) && groundedFlowers.length) {
    clauses.push(optional(`Feature real, recognizable ${groundedFlowers.slice(0, 5).join(", ")} rendered photorealistically.`));
  } else {
    // creativeBrief, when present, describes the same concept as
    // visualBrief but already broken into concrete fields — see
    // creativeBriefClause's docstring above buildImagePrompt. Preferred
    // for the same reason; visualBrief alone still works for any caller
    // without a structured brief.
    const subjectClause = creativeBriefClause(creativeBrief) || (visualBrief ? String(visualBrief) : null);
    if (subjectClause) clauses.push(optional(subjectClause));
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
      "Critically important: the lower 55% of the frame must be a calm, uncluttered, softly out-of-focus backdrop — smooth, evenly lit, pale, with no flowers, foliage, stems, petals, vase or busy detail in it at all, so a large block of text placed there afterwards stays perfectly readable. Keep every bloom in the upper portion, sweeping in from the top and sides."
    )
  );
  if (brandColor) {
    clauses.push(optional(`Color palette should read as premium and complement ${brandColor}, while staying bright and colorful overall.`));
  }
  // No separate logo clause — NO_TEXT_DIRECTIVE already forbids logos and
  // watermarks, and two clauses saying it cost room the grounding needed.
  clauses.push(required(NO_TEXT_DIRECTIVE));

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
