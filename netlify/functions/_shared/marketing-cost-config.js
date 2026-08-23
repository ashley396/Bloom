/**
 * Marketing Studio cost model — Section 14 of the build directive.
 *
 * `avatar_video_second` was updated 2026-08-23 from HeyGen's own current
 * API pricing (~$0.017–$0.067/sec depending on quality tier) — real, but
 * still sourced from third-party-aggregated pricing summaries around that
 * figure, not a verified invoice. Every other number here remains a
 * third-party-aggregated placeholder from Stage A research. All of them
 * are DELIBERATELY isolated into named, re-pricable constants rather than
 * scattered through generation code — a wrong number is a one-line fix
 * here, never a re-architecture. NEVER treat these as fully verified:
 * before any real customer-facing cost estimate ships, confirm current
 * pricing directly against each provider's own current pricing page.
 *
 * Units match marketing_generation_usage.unit_type in the Stage B
 * migration: 'image' | 'second' | 'character' | 'request'.
 */

export const COST_CONFIG_VERSION = "partially-verified-2026-08-23";

export const COST_PER_UNIT_CENTS = Object.freeze({
  // Image generation — cost per image.
  image_standard: 4, // e.g. Cloudflare/standard diffusion tier
  image_premium: 8, // e.g. higher-fidelity image model

  // Generative video (non-avatar b-roll, e.g. Veo/Kling/Runway) — cost
  // per second of output.
  video_standard_second: 8,
  video_premium_second: 40,

  // AI Clone avatar video (HeyGen) — cost per second. Updated from
  // HeyGen's own real per-second API pricing (~$0.017–$0.067/sec ≈
  // 1.7–6.7 cents/sec); 3 cents/sec is a mid-tier estimate, not the
  // Digital Twin 4K ceiling (~6.7 cents/sec) or the cheapest tier.
  avatar_video_second: 3,

  // Voice generation/cloning (ElevenLabs) — cost per 1,000 characters
  // synthesized. Not independently re-verified in the 2026-08-23 pass —
  // ElevenLabs prices by monthly minute-allowance tiers rather than a
  // clean per-character rate, so this stays the original Stage A
  // estimate until real usage data replaces it.
  voice_per_1000_chars: 30,

  // Text/copy generation — cost per request (LLM copy calls are cheap
  // relative to media generation; modeled per-request, not per-token, to
  // keep the ledger simple until real usage data says otherwise).
  copy_request: 1
});

/**
 * Pre-generation cost estimate (Section 14: "never accidentally subsidize
 * unlimited expensive generation"). Always call this BEFORE starting a
 * generation job and record the result to marketing_generation_usage with
 * status: 'estimated' — the actual provider cost, once known, gets a
 * second row with status: 'actual' rather than overwriting the estimate,
 * so the estimate-vs-actual gap stays visible for tuning these constants.
 */
export function estimateCostCents({ purpose, unitType, units }) {
  const key =
    purpose === "avatar_video" && unitType === "second"
      ? "avatar_video_second"
      : purpose === "voice" && unitType === "character"
      ? "voice_per_1000_chars"
      : purpose === "copy"
      ? "copy_request"
      : purpose === "video" && unitType === "second"
      ? "video_standard_second"
      : purpose === "image"
      ? "image_standard"
      : null;
  if (!key) return null;
  const perUnit = COST_PER_UNIT_CENTS[key];
  const unitCount = key === "voice_per_1000_chars" ? Math.ceil((Number(units) || 0) / 1000) : Number(units) || 0;
  return Math.round(perUnit * Math.max(unitCount, key === "copy_request" ? 1 : 0));
}

/**
 * Configurable monthly per-tenant allowance, expressed in the internal
 * Founding Beta target from Section 9 (~90 pieces/month: 30 image posts,
 * 30 Reels/shorts, 30 ~60s videos). Kept as data, not a hard-coded limit
 * baked into business logic — a real per-shop budget cap (Section 14)
 * reads and overrides this default, it never falls back to unlimited.
 */
export const DEFAULT_MONTHLY_ALLOWANCE = Object.freeze({
  image_posts: 30,
  reels_or_shorts: 30,
  long_form_videos: 30
});
