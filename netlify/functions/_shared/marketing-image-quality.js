/**
 * Florisyn Marketing Studio — the one authoritative Marketing image
 * quality state machine (Batch 2, "Marketing image quality + provider
 * cost accounting"). Every scoped Marketing image-generation caller
 * routes through runMarketingImageQuality() instead of calling
 * generateImage()/assessGeneratedMarketingPhoto() directly.
 *
 * Real, live bug in the code this replaces
 * (ai-image-engine.js's generateImageCheckingText, still exported and
 * used by non-Marketing/legacy callers, deliberately left untouched):
 * assessGeneratedMarketingPhoto() itself already correctly returns
 * `ok: false` when the vision call throws or the image can't be prepared
 * — but generateImageCheckingText's own retry loop only ever checked
 * `check.accepted` (which assessGeneratedMarketingPhoto DEFAULTS TO
 * `true` on its own `ok:false` path, a deliberate "don't block a photo
 * over an unrelated QA outage" choice that made sense for its OTHER,
 * non-quality-gate callers) — so an inspection that never actually ran
 * was silently treated as a pass, and if BOTH attempts were still
 * rejected, the function returned the last (rejected) image anyway. This
 * machine reads `check.ok` and `check.accepted` itself rather than
 * trusting that combined default, so it can fail CLOSED instead:
 *   - `check.ok === false` (vision exception, unreadable image, an
 *     unparseable reply) is NEVER treated as accepted — it's "inspection
 *     unavailable," which can only ever resolve to FALLBACK or FAIL,
 *     never PASS.
 *   - A rejected candidate (`check.ok === true && check.accepted ===
 *     false`) gets exactly ONE bounded corrective retry, then — if still
 *     rejected — FALLBACK or FAIL. It is never shown to the florist.
 *
 * States:
 *   PASS     — a candidate was actually generated, actually inspected,
 *              the inspection was readable, and it met quality
 *              requirements.
 *   FALLBACK — no generated candidate could be used (rejected, inspection
 *              unavailable, provider failure, or retry budget exhausted)
 *              but a real, honest fallback exists and was used instead.
 *   FAIL     — no safe generated candidate AND no safe fallback exists.
 *              Nothing is returned as usable; the caller must not
 *              persist/display anything from this call.
 *
 * (RETRY is the per-attempt transition this machine passes through
 * internally — recorded on each entry in the returned `attempts` log —
 * never the function's own final, actionable return state, since a
 * caller needs one of PASS/FALLBACK/FAIL to actually act on.)
 */

import { generateImage } from "./ai-image-engine.js";
import { assessGeneratedMarketingPhoto } from "./florist-ai-vision.js";
import { reserveProviderCall, completeProviderCall, failProviderCall } from "./marketing-provider-usage.js";

export const IMAGE_QUALITY_STATE = Object.freeze({ PASS: "PASS", RETRY: "RETRY", FALLBACK: "FALLBACK", FAIL: "FAIL" });

/**
 * @param {object} opts
 * @param {object} opts.client - the real (or fake, in tests) Supabase client.
 * @param {string} opts.shopId
 * @param {(attempt: number, priorAttempts: object[]) => string} opts.promptFor
 *   Builds the prompt for a given attempt. The CALLER is responsible for
 *   keeping the underlying visual_brief/creative_brief/canonical concept
 *   the SAME real subject across attempts (Part C: "do not create a new
 *   marketing concept") — this function only ever tells the caller WHY
 *   the prior attempt was rejected (via `priorAttempts[i].check.reason`),
 *   never rewrites the concept itself. Flower-grounding/visual-fiction
 *   sanitization of the underlying visual_brief/creative_brief is the
 *   CALLER's job (the same evaluateMarketingOutput component:
 *   "creative_scene" choke point Batch 1 already wired in before this
 *   function is ever reached) — never duplicated here.
 * @param {(attempt: number) => string} opts.filenameFor
 * @param {object} [opts.creativeBrief]
 * @param {string} [opts.visualBrief]
 * @param {string} [opts.occasion]
 * @param {(attempts: object[]) => Promise<{ok: boolean, kind: string, url?: string, path?: string, [k: string]: any} | null>} [opts.buildFallback]
 *   Attempts a real, honest fallback (a deterministic template, a real
 *   shop/library photo) when no generated candidate can be used. Must
 *   return `{ok: true, kind, ...}` for a usable fallback, or a falsy/
 *   `{ok:false}` value when none is available — this function then
 *   returns FAIL rather than inventing one. Receives the attempt log so a
 *   caller with a more selective fallback (Part D/QUALITY 8: "only an
 *   eligible real/library photo, never an unsafe image") can reason about
 *   why generation failed — though this function never calls it at all
 *   when every failure was a genuine, non-retryable infrastructure error
 *   (see hardInfraAttempt below); that always resolves to FAIL with the
 *   real error message instead, never a silent fallback.
 * @param {object} [opts.usage] - { traceId, operationId, jobId, contentItemId }
 *   threaded into every reserveProviderCall() this function makes.
 * @param {number} [opts.maxAttempts=2]
 * @param {boolean} [opts.failClosedOnInfraError=true] - When true (the
 *   default), a genuine non-retryable infrastructure failure (storage/
 *   config) skips buildFallback entirely and resolves to FAIL with the
 *   real error message. Set to false only for a caller with its own
 *   pre-existing, deliberate "always fall back, for any failure reason"
 *   design (e.g. the decorative flyer background's Tier A/Tier B
 *   template default) — never to hide a new bug.
 * @returns {Promise<{
 *   state: "PASS"|"FALLBACK"|"FAIL",
 *   gen: object|null,
 *   check: object|null,
 *   fallback: object|null,
 *   attempts: Array<{attempt:number, state:string, ok:boolean, error?:string, stage?:string, gen?:object, check?:object}>,
 *   rejectedAssetPaths: string[],
 *   error?: string
 * }>}
 */
export async function runMarketingImageQuality({
  client,
  shopId,
  promptFor,
  filenameFor,
  creativeBrief = null,
  visualBrief = null,
  occasion = null,
  buildFallback = null,
  usage = {},
  maxAttempts = 2,
  // Some callers have their own, pre-existing, deliberately-reviewed
  // "never fail the whole request over a photo, for ANY reason" design —
  // e.g. generate_content's decorative-flyer background, which has always
  // fallen back to its brand-palette template (Tier B) regardless of
  // WHY the photo failed (missing credentials, a provider error, a budget
  // cap, or a storage error). Preserving that exact existing behavior
  // (CLAUDE.md: preserve existing features unless the defect requires
  // changing them) means a hard infra failure there must still reach
  // buildFallback like any other failure. Callers whose photo is the
  // whole point of the post (a plain image-post) want the opposite: a
  // genuine, actionable infra bug (a storage RLS denial) must never be
  // silently absorbed into "ship with no photo" — it should FAIL with
  // the real error so the incident is visible. That is the default here.
  failClosedOnInfraError = true
} = {}) {
  const attempts = [];
  const rejectedAssetPaths = [];
  const { traceId = null, operationId = null, jobId = null, contentItemId = null } = usage;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const prompt = typeof promptFor === "function" ? promptFor(attempt, attempts) : promptFor;

    const imageReservation = await reserveProviderCall(client, {
      shopId,
      jobId,
      contentItemId,
      purpose: "image",
      operation: "image_generation",
      unitType: "image",
      units: 1,
      traceId,
      operationId,
      attemptIndex: attempt
    });
    if (!imageReservation.ok) {
      // Fail-closed ledger (Part F): a reservation write failing means we
      // must never make the provider call it would have accounted for.
      attempts.push({ attempt, state: "RETRY", ok: false, error: `usage reservation failed: ${imageReservation.error}` });
      continue;
    }

    const gen = await generateImage(client, shopId, {
      prompt,
      filename: typeof filenameFor === "function" ? filenameFor(attempt) : filenameFor
    });
    if (!gen.ok) {
      await failProviderCall(client, imageReservation.usageId, { error: gen.error });
      attempts.push({ attempt, state: "RETRY", ok: false, error: gen.error, stage: gen.stage });
      // A "config" (misconfigured credentials/prompt) or "upload" (the
      // image WAS generated and billed, then storage itself rejected it —
      // see generateFlyerBackgroundWithRetry's own docstring for this
      // exact distinction) failure is not a transient provider hiccup a
      // second attempt could plausibly fix — it's the same hard failure
      // again, burning another real provider spend for nothing. Stop
      // immediately rather than exhausting the retry budget.
      if (gen.stage === "config" || gen.stage === "upload") break;
      continue;
    }
    await completeProviderCall(client, imageReservation.usageId, { providerRequestId: gen.path || null });

    const visionReservation = await reserveProviderCall(client, {
      shopId,
      jobId,
      contentItemId,
      purpose: "vision",
      operation: "vision_inspection",
      unitType: "request",
      units: 1,
      traceId,
      operationId,
      attemptIndex: attempt
    });
    if (!visionReservation.ok) {
      // Generated, but the inspection itself can't be accounted for — the
      // image was already billed above (real spend already happened),
      // but this candidate must still never be treated as inspected/
      // passed. Never make the vision provider call without its own
      // reservation.
      attempts.push({ attempt, state: "RETRY", ok: false, gen, error: `vision reservation failed: ${visionReservation.error}` });
      rejectedAssetPaths.push(gen.path);
      continue;
    }

    let check;
    let visionThrew = null;
    try {
      check = await assessGeneratedMarketingPhoto({ dataUrl: gen.imageDataUrl }, { creativeBrief, visualBrief, occasion });
    } catch (error) {
      visionThrew = error;
      check = { ok: false, hasText: false, accepted: false, readable: false, reason: null };
    }

    // The critical fix: read check.ok/check.readable directly rather than
    // trusting assessGeneratedMarketingPhoto's own accepted:true default
    // on its ok:false (or unparseable-reply) path — a deliberate, correct
    // choice FOR ITS OTHER non-gate callers, wrong for this one. A vision
    // exception, an image-preparation failure, or a genuinely unreadable
    // reply is NEVER a pass here.
    if (!check.ok || check.readable === false) {
      await failProviderCall(client, visionReservation.usageId, {
        error: visionThrew ? String(visionThrew?.message || visionThrew).slice(0, 300) : "vision inspection unavailable or unreadable"
      });
      attempts.push({ attempt, state: "RETRY", ok: false, gen, check, error: !check.ok ? "vision_unavailable" : "vision_unreadable" });
      rejectedAssetPaths.push(gen.path);
      continue;
    }
    await completeProviderCall(client, visionReservation.usageId, { providerRequestId: check.model || null });

    if (check.accepted) {
      return { state: IMAGE_QUALITY_STATE.PASS, gen, check, fallback: null, attempts: [...attempts, { attempt, state: "PASS", ok: true, gen, check }], rejectedAssetPaths };
    }

    // Genuinely inspected and rejected — this candidate must never be
    // shown, whether or not a retry follows.
    attempts.push({ attempt, state: "RETRY", ok: false, gen, check });
    rejectedAssetPaths.push(gen.path);
  }

  // Every attempt exhausted with no accepted candidate. A rejected image
  // is never displayed/persisted from here on — only a real fallback, or
  // an explicit, honest FAIL.
  //
  // A genuine, non-retryable infrastructure failure (storage/config —
  // never a quality rejection) must NOT be silently absorbed into "ship
  // with a template instead." That would turn a real, actionable bug
  // (e.g. a storage RLS policy denying every authenticated upload) into
  // a quiet, permanent no-photo experience — masking the incident instead
  // of surfacing it. Skip buildFallback entirely and fail with the real
  // underlying error so the caller can report it honestly.
  const hardInfraAttempt = attempts.find((a) => a.stage === "config" || a.stage === "upload");
  if (hardInfraAttempt && failClosedOnInfraError) {
    return {
      state: IMAGE_QUALITY_STATE.FAIL,
      gen: null,
      check: null,
      fallback: null,
      attempts,
      rejectedAssetPaths,
      error: hardInfraAttempt.error
    };
  }

  if (typeof buildFallback === "function") {
    let fallback = null;
    try {
      fallback = await buildFallback(attempts);
    } catch (error) {
      fallback = null;
    }
    if (fallback && fallback.ok) {
      return { state: IMAGE_QUALITY_STATE.FALLBACK, gen: null, check: null, fallback, attempts, rejectedAssetPaths };
    }
  }
  return { state: IMAGE_QUALITY_STATE.FAIL, gen: null, check: null, fallback: null, attempts, rejectedAssetPaths };
}
