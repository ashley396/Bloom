/**
 * Marketing-only image-provider registry + router (Batch 6, Part E/F).
 *
 * Mirrors the existing marketing-clone-providers.js pattern (selectClone
 * Provider / buildConfiguredCloneProviderRegistry) applied to Marketing
 * image generation — never a universal Florisyn AI provider framework
 * (Part E's own explicit instruction), and never a second accounting path
 * (Part G: every real call still goes through marketing-provider-usage.js
 * via the caller, marketing-image-quality.js — this module never calls
 * reserveProviderCall/completeProviderCall itself).
 *
 * Two adapters can now appear here: Cloudflare (Batch 6) and OpenAI
 * GPT-Image-2 (Batch 1 of the Hybrid Marketing Studio work, Part 4) — the
 * OpenAI one only when a real OPENAI_API_KEY is actually configured. This
 * registry recognizing OpenAI is NOT the same as live traffic being
 * routed to it: as of Batch 1, no caller (marketing-image-quality.js or
 * anywhere else) selects the OpenAI provider for a real Marketing Studio
 * generation yet (Part 12) — that activation is a separate, future,
 * explicitly-approved change. The router below already considers
 * capability/cost/budget so that activation is a call-site change, not a
 * routing rewrite.
 */

import { createCloudflareMarketingImageProvider, PROVIDER_NAME as CLOUDFLARE_PROVIDER_NAME } from "./marketing-image-provider-cloudflare.js";
import { createOpenAiMarketingImageProvider, PROVIDER_NAME as OPENAI_PROVIDER_NAME } from "./marketing-image-provider-openai.js";

/**
 * Builds the real registry from environment credentials — a provider only
 * ever appears once it is genuinely configured (real credentials present),
 * exactly like buildConfiguredCloneProviderRegistry(). An unconfigured
 * environment returns {}, so selectMarketingImageProvider() correctly
 * finds nothing and callers get an honest "not configured" outcome —
 * never a fabricated success.
 *
 * @param {object} [env] - defaults to process.env.
 * @returns {Record<string, object>} keyed by provider name.
 */
export function buildConfiguredMarketingImageProviderRegistry(env = process.env) {
  const registry = {};
  const cloudflare = createCloudflareMarketingImageProvider(env);
  if (cloudflare.configured()) registry[CLOUDFLARE_PROVIDER_NAME] = cloudflare;
  const openai = createOpenAiMarketingImageProvider(env);
  if (openai.configured()) registry[OPENAI_PROVIDER_NAME] = openai;
  return registry;
}

/**
 * Selects one eligible provider from the registry, or null when none
 * qualifies — an honest "nothing eligible" is always preferred over
 * fabricating a fallback provider that doesn't exist (Part F).
 *
 * Considers, in order, exactly the factors Part F names as the minimum
 * required set: configured (the registry itself only ever contains
 * configured providers — see above), requested quality tier, aspect-ratio
 * capability, estimated cost against a remaining-budget ceiling when the
 * caller supplies one. Availability/fallback-eligibility is the caller's
 * own concern (marketing-image-quality.js's own retry loop already owns
 * "did THIS attempt fail, try again/fall back") — this function answers
 * "which provider is even eligible for the request," not "did the call
 * succeed."
 *
 * @param {object} [criteria]
 * @param {string|null} [criteria.aspectRatio]
 * @param {string} [criteria.qualityTier]
 * @param {number|null} [criteria.estimatedBudgetRemainingCents] - when
 *   supplied, a provider whose estimated cost exceeds this is skipped.
 *   Omitted (null) means "no budget ceiling considered here" — Batch 2's
 *   own pre-flight checkMonthlyBudgetForRequest already gates the whole
 *   request before generation is attempted at all; this is a second,
 *   provider-selection-time consideration for a future caller that wants
 *   it, not a replacement for that existing gate.
 * @param {Record<string, object>} [registry]
 * @returns {object|null}
 */
export function selectMarketingImageProvider({ aspectRatio = null, qualityTier = "standard", estimatedBudgetRemainingCents = null } = {}, registry = {}) {
  for (const provider of Object.values(registry)) {
    if (!provider) continue;
    const caps = provider.capabilities();
    if (aspectRatio && Array.isArray(caps?.aspectRatios) && !caps.aspectRatios.includes(aspectRatio)) continue;
    if (qualityTier && Array.isArray(caps?.qualityTiers) && !caps.qualityTiers.includes(qualityTier)) continue;
    if (estimatedBudgetRemainingCents != null) {
      const cost = provider.estimateCost({ qualityTier });
      if (cost?.cents != null && cost.cents > estimatedBudgetRemainingCents) continue;
    }
    return provider;
  }
  return null;
}
