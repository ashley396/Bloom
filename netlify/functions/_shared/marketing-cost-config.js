/**
 * Marketing Studio cost model — Section 14 of the build directive.
 *
 * Every number here is a placeholder pulled from third-party-aggregated,
 * publicly-unverified provider pricing pages (Stage A research) and is
 * DELIBERATELY isolated into named, re-pricable constants rather than
 * scattered through generation code — a wrong number is a one-line fix
 * here, never a re-architecture. NEVER treat these as verified: before any
 * real customer-facing cost estimate ships, confirm current pricing
 * directly against each provider's own current pricing page.
 *
 * Units match marketing_generation_usage.unit_type in the Stage B
 * migration: 'image' | 'second' | 'character' | 'request'.
 */

export const COST_CONFIG_VERSION = "unverified-2026-08-23";

export const COST_PER_UNIT_CENTS = Object.freeze({
  // Image generation — cost per image.
  image_standard: 4, // e.g. Cloudflare/standard diffusion tier
  image_premium: 8, // e.g. higher-fidelity image model

  // Generative video — cost per second of output.
  video_standard_second: 15,
  video_premium_second: 40,

  // AI Clone avatar video — cost per second (typically pricier than
  // generic generative video due to likeness/lip-sync processing).
  avatar_video_second: 50,

  // Voice generation/cloning — cost per 1,000 characters synthesized.
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
