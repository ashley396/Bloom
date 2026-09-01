/**
 * Marketing image-provider adapter: Cloudflare Workers AI (Batch 6, "Preview
 * path + CI + provider cleanup + live-readiness", Part E).
 *
 * Deliberately a thin ADAPTER over the existing, already-tested
 * generateImage() in ai-image-engine.js — never a second, competing
 * implementation of the real fetch/upload logic. ai-image-engine.js stays
 * exactly as it is (it's the shared engine every non-Marketing caller —
 * Photo Studio, Website Builder X — also uses; Part O says do not harden
 * all of Photo Studio in this batch), and this file is the narrow,
 * Marketing-only seam that lets marketing-image-quality.js ask "which
 * provider, and is it eligible for this request" instead of hardcoding
 * "Cloudflare, always" the way it implicitly did before.
 *
 * Interface (see marketing-image-providers.js for the registry/router):
 *   { name, configured(), capabilities(), estimateCost(), generate(...) }
 * generate() takes { client, shopId } in addition to Part E's own spec
 * ({ prompt, aspectRatio, qualityTier, traceId }) because the real,
 * durable result of a Marketing image call has always been a website-media
 * upload, not just provider bytes — generateImage() already owns that
 * upload step and this adapter has no reason to duplicate it.
 */

import { generateImage, imageGenerationConfigured } from "./ai-image-engine.js";
import { estimateCostCents } from "./marketing-cost-config.js";

export const PROVIDER_NAME = "cloudflare";

// Cloudflare's flux-1-schnell call (ai-image-engine.js's generateImage)
// does not itself vary its output aspect ratio or offer a premium/
// standard quality selector — one real model, one real quality tier.
// Listed explicitly (not "anything goes") so the router's capability
// check is a real, honest gate rather than always trivially true, and so
// a future second provider's own narrower capabilities are what actually
// differentiates routing — not a silent assumption every provider can do
// everything.
const CAPABILITIES = Object.freeze({
  aspectRatios: Object.freeze(["1:1", "4:5", "9:16", "16:9"]),
  qualityTiers: Object.freeze(["standard"])
});

/**
 * @param {object} [env] - defaults to process.env; a test may pass a
 *   fake env object instead of mutating real process.env.
 */
export function createCloudflareMarketingImageProvider(env = process.env) {
  return Object.freeze({
    name: PROVIDER_NAME,

    /** Real capability check — genuine credentials present, never a guess. */
    configured() {
      return imageGenerationConfigured(env);
    },

    /** Never mutated by a caller — the same fixed, honest capability set
     * every request is checked against. */
    capabilities() {
      return CAPABILITIES;
    },

    /** Reuses the ONE existing Marketing cost model (marketing-cost-
     * config.js) — never a second, competing cost figure for the same
     * real image call. qualityTier is accepted for interface parity with
     * a future provider that might price tiers differently; Cloudflare
     * has exactly one tier today, so it's ignored beyond validating it's
     * "standard".
     */
    estimateCost({ qualityTier = "standard" } = {}) {
      if (!CAPABILITIES.qualityTiers.includes(qualityTier)) return null;
      const cents = estimateCostCents({ purpose: "image", unitType: "image", units: 1 });
      return cents == null ? null : { cents, currency: "USD" };
    },

    /**
     * @param {object} params
     * @param {import('@supabase/supabase-js').SupabaseClient} params.client
     * @param {string} params.shopId
     * @param {string} params.prompt
     * @param {string} [params.filename]
     * @param {string|null} [params.aspectRatio] - accepted for interface
     *   parity; not yet forwarded to generateImage() since Cloudflare's
     *   own call has no aspect-ratio parameter today (see CAPABILITIES).
     * @param {string} [params.qualityTier]
     * @param {string|null} [params.traceId] - echoed back on the result
     *   for the caller's own usage-ledger/log correlation; this adapter
     *   makes no separate provider call of its own to attach it to.
     * @returns {Promise<object>} generateImage()'s own real { ok, path,
     *   url, provider, model, prompt, imageDataUrl, ... } shape, with
     *   providerName/traceId added — never a reshaped/fabricated result.
     */
    async generate({ client, shopId, prompt, filename, aspectRatio = null, qualityTier = "standard", traceId = null } = {}) {
      const result = await generateImage(client, shopId, { prompt, filename });
      return { ...result, providerName: PROVIDER_NAME, traceId, aspectRatio, qualityTier };
    }
  });
}
