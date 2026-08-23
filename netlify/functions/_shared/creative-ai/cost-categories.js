/**
 * Cost categorization + quality-tier description — the taxonomy layer
 * this pass's directive asked for, sitting alongside (not replacing)
 * marketing-cost-config.js's existing COST_PER_UNIT_CENTS/
 * estimateCostCents(), which remain the single source of truth for
 * actual per-unit pricing.
 *
 * Two deliberate design choices:
 *
 * 1. No provider price is hard-coded into any business-logic branch here
 *    — this file only classifies *which bucket* a cost belongs to and
 *    *describes* what BEST_QUALITY/BALANCED/LOWEST_COST would mean for a
 *    capability. Actual prices still live only in marketing-cost-
 *    config.js's COST_PER_UNIT_CENTS.
 *
 * 2. `describeQualityTierOptions()` is READ-ONLY / informational. There is
 *    deliberately NO function here that automatically switches a person's
 *    avatar or voice provider based on a quality/cost preference — doing
 *    so would silently change a real person's likeness/voice without
 *    their consent, which the master directive explicitly forbids.
 *    Avatar/voice provider selection remains exactly what it already is:
 *    selectAvatarProvider()/selectVoiceProvider() in creative-ai/
 *    avatar-engine.js/voice-engine.js, which only ever return the one
 *    explicitly-configured adapter — never an auto-picked one.
 */

/** Parent grouping: every capability that actually calls an external AI
 * provider is a "generation" cost; transformation (deterministic media
 * processing) and publishing (posting to a platform) are not. */
export const COST_CATEGORY_GROUP = Object.freeze({
  GENERATION: "generation",
  NON_GENERATION: "non_generation"
});

export const COST_CATEGORY = Object.freeze({
  VOICE: "voice",
  AVATAR: "avatar",
  VIDEO: "video",
  IMAGE: "image",
  COPY: "copy",
  TRANSFORMATION: "transformation",
  PUBLISHING: "publishing"
});

const CATEGORY_GROUP_MAP = Object.freeze({
  [COST_CATEGORY.VOICE]: COST_CATEGORY_GROUP.GENERATION,
  [COST_CATEGORY.AVATAR]: COST_CATEGORY_GROUP.GENERATION,
  [COST_CATEGORY.VIDEO]: COST_CATEGORY_GROUP.GENERATION,
  [COST_CATEGORY.IMAGE]: COST_CATEGORY_GROUP.GENERATION,
  [COST_CATEGORY.COPY]: COST_CATEGORY_GROUP.GENERATION,
  [COST_CATEGORY.TRANSFORMATION]: COST_CATEGORY_GROUP.NON_GENERATION,
  [COST_CATEGORY.PUBLISHING]: COST_CATEGORY_GROUP.NON_GENERATION
});

/** Same `purpose` values marketing-cost-config.js's estimateCostCents()
 * already accepts, mapped onto the category taxonomy above — kept as a
 * separate, small lookup rather than modifying estimateCostCents() itself,
 * so existing callers/tests of that function are completely unaffected. */
const PURPOSE_TO_CATEGORY = Object.freeze({
  avatar_video: COST_CATEGORY.AVATAR,
  voice: COST_CATEGORY.VOICE,
  video: COST_CATEGORY.VIDEO,
  image: COST_CATEGORY.IMAGE,
  copy: COST_CATEGORY.COPY
});

export function categorizeCostPurpose(purpose) {
  const category = PURPOSE_TO_CATEGORY[purpose];
  if (!category) return null;
  return { category, group: CATEGORY_GROUP_MAP[category] };
}

export const QUALITY_TIER = Object.freeze({
  BEST_QUALITY: "BEST_QUALITY",
  BALANCED: "BALANCED",
  LOWEST_COST: "LOWEST_COST"
});

/**
 * Read-only, informational tier descriptions per capability — NOT a
 * selector, NOT a price table. `providerNote` describes what each tier
 * would mean for a HUMAN to choose deliberately (e.g. in a future UI
 * control), never an instruction for code to auto-switch anything.
 */
const QUALITY_TIER_DESCRIPTIONS = Object.freeze({
  [COST_CATEGORY.IMAGE]: {
    [QUALITY_TIER.BEST_QUALITY]: { providerNote: "Higher-fidelity image model tier (e.g. a 'pro' tier of the same model family already in use).", relativeCostBand: "higher" },
    [QUALITY_TIER.BALANCED]: { providerNote: "The model tier currently wired (fast/distilled).", relativeCostBand: "current" },
    [QUALITY_TIER.LOWEST_COST]: { providerNote: "No lower-cost image tier is currently configured.", relativeCostBand: "current" }
  },
  [COST_CATEGORY.VIDEO]: {
    [QUALITY_TIER.BEST_QUALITY]: { providerNote: "A higher-fidelity generative-video provider/tier, once one is connected — none is connected today.", relativeCostBand: "unconnected" },
    [QUALITY_TIER.BALANCED]: { providerNote: "No general video provider is connected today (ai-video-provider.js has zero real adapters registered).", relativeCostBand: "unconnected" },
    [QUALITY_TIER.LOWEST_COST]: { providerNote: "Same — nothing connected to compare against yet.", relativeCostBand: "unconnected" }
  },
  [COST_CATEGORY.AVATAR]: {
    [QUALITY_TIER.BEST_QUALITY]: { providerNote: "HeyGen Avatar V (multi-outfit/scene) — not yet migrated to; same vendor, different endpoint tier.", relativeCostBand: "higher, unconfirmed" },
    [QUALITY_TIER.BALANCED]: { providerNote: "HeyGen Photo Avatar Group (current, lower-confidence flow).", relativeCostBand: "current" },
    [QUALITY_TIER.LOWEST_COST]: { providerNote: "Same as BALANCED — HeyGen is the only configured avatar adapter today.", relativeCostBand: "current" }
  },
  [COST_CATEGORY.VOICE]: {
    [QUALITY_TIER.BEST_QUALITY]: { providerNote: "ElevenLabs (current) — independently ranked highest for clone fidelity in this pass's research.", relativeCostBand: "current, higher than Cartesia" },
    [QUALITY_TIER.BALANCED]: { providerNote: "ElevenLabs (current).", relativeCostBand: "current" },
    [QUALITY_TIER.LOWEST_COST]: { providerNote: "A second VoiceEngine adapter (e.g. Cartesia) is not yet registered — would need to be added and would still require explicit consent before ever being used for someone's existing cloned voice identity.", relativeCostBand: "unconnected" }
  },
  [COST_CATEGORY.TRANSFORMATION]: {
    [QUALITY_TIER.BEST_QUALITY]: { providerNote: "Deterministic center-crop/thumbnail/caption-burn — no quality tiers apply; a future AI-reframe capability (not implemented) would be the only quality axis here.", relativeCostBand: "free/local once execution infra exists" },
    [QUALITY_TIER.BALANCED]: { providerNote: "Same as BEST_QUALITY — transformation is deterministic, not model-quality-tiered.", relativeCostBand: "free/local once execution infra exists" },
    [QUALITY_TIER.LOWEST_COST]: { providerNote: "Same as BEST_QUALITY.", relativeCostBand: "free/local once execution infra exists" }
  }
});

/** Purely descriptive — returns what each tier means today for a given
 * category, or throws for an unknown category. Never mutates state, never
 * picks a provider, never touches a person's existing avatar/voice. */
export function describeQualityTierOptions(category) {
  const descriptions = QUALITY_TIER_DESCRIPTIONS[category];
  if (!descriptions) throw new Error(`describeQualityTierOptions: no tier descriptions for category "${category}".`);
  return descriptions;
}
