/**
 * AI-content disclosure policy — provider-independent compliance layer,
 * covering Marketing Studio's 7 publishing destinations (must match
 * marketing-social-providers.js's SUPPORTED_PLATFORMS exactly).
 *
 * Research date: 2026-08. Each platform's policy below is sourced from
 * that platform's own current help-center/policy language where it
 * surfaced, cross-checked against multiple independent aggregator
 * sources otherwise — see
 * docs/production/FLORISYN_CREATIVE_AI_CAPABILITY_MATRIX.md §1 for the
 * full source list. Confidence is marked per platform; LOWER-confidence
 * entries deliberately default to the more conservative (disclosure
 * required) posture rather than assuming a permissive one — "fail closed"
 * applies to the policy data itself, not just the enforcement code.
 *
 * This module NEVER invents a disclosure mechanism a platform doesn't
 * actually expose. Where no API-level disclosure field could be
 * confirmed, `mechanism` is 'no_api_mechanism_confirmed' and
 * `disclosureNote` says so explicitly — Florisyn's publishing pipeline
 * must not silently claim a checkbox exists that hasn't been verified
 * against that platform's real API.
 */

export const PLATFORM_DISCLOSURE_POLICY = Object.freeze({
  facebook: {
    requiresDisclosureForAIContent: true,
    autoDetects: false,
    mechanism: "native_label",
    disclosureNote: "Meta's AI-information label system covers realistic synthetic/altered media; required for political/social-issue content and available platform-wide.",
    confidence: "MEDIUM",
    policyVersion: "meta-ai-info-labels-2026"
  },
  instagram: {
    requiresDisclosureForAIContent: true,
    autoDetects: false,
    mechanism: "native_label",
    disclosureNote: "Same Meta AI-information label policy as Facebook.",
    confidence: "MEDIUM",
    policyVersion: "meta-ai-info-labels-2026"
  },
  tiktok: {
    requiresDisclosureForAIContent: true,
    autoDetects: true,
    mechanism: "native_label",
    disclosureNote: "TikTok requires visible AI-content labels AND auto-detects via C2PA Content Credentials even without self-disclosure — unlabeled realistic synthetic content risks reduced distribution or removal regardless of Florisyn's own labeling.",
    confidence: "HIGH",
    policyVersion: "tiktok-ai-labeling-2026"
  },
  linkedin: {
    requiresDisclosureForAIContent: true,
    autoDetects: false,
    mechanism: "creator_disclosure",
    disclosureNote: "LinkedIn's 2026 'Keeping conversations real' policy requires disclosing when AI materially generated/transformed content. No dedicated structured API field for this was confirmed — treat as a caption/description-text disclosure until LinkedIn's API is independently verified to expose one.",
    confidence: "MEDIUM",
    policyVersion: "linkedin-keeping-conversations-real-2026"
  },
  pinterest: {
    requiresDisclosureForAIContent: true,
    autoDetects: true,
    mechanism: "no_api_mechanism_confirmed",
    disclosureNote: "Pinterest's 'Gen AI labels' auto-detect AI-generated/AI-touched-up Pins via metadata + classifiers. Whether the Pin-creation API exposes a field for Florisyn to proactively SET this metadata (vs. Pinterest's own classifier detecting it after the fact) was not confirmed this pass — do not claim a disclosure mechanism Florisyn hasn't verified exists.",
    confidence: "LOW",
    policyVersion: "pinterest-gen-ai-labels-2026"
  },
  google_business: {
    requiresDisclosureForAIContent: true,
    autoDetects: false,
    mechanism: "no_api_mechanism_confirmed",
    disclosureNote: "No clear, platform-specific AI-disclosure policy for Business Profile posts (as opposed to ads) was found this research pass. Treated conservatively as disclosure-required with no confirmed API mechanism — re-verify directly against Google Business Profile's current posting policy before Florisyn ever publishes AI-generated video/avatar content here.",
    confidence: "LOW",
    policyVersion: "unverified-2026"
  },
  youtube: {
    requiresDisclosureForAIContent: true,
    autoDetects: false,
    mechanism: "native_label",
    disclosureNote: "YouTube requires labeling realistic altered/synthetic content depicting real people/places, via the 'Altered or synthetic content' toggle in video details. Does not affect monetization/recommendations per YouTube's own stated policy.",
    confidence: "HIGH",
    policyVersion: "youtube-altered-synthetic-content-2026"
  }
});

/** Content-provenance flags this module reasons over — matches the
 * columns added to marketing_platform_variants in this pass's migration. */
const AI_TRIGGER_FLAGS = ["avatarUsed", "voiceUsed", "generativeVideoUsed", "generativeImageUsed"];

/**
 * Pure function: does this specific piece of content, on this specific
 * platform, require a disclosure — and if so, by what mechanism? Never
 * touches a database or network. `humanEdited` alone (no AI flags set)
 * never triggers a requirement — ordinary manual editing isn't synthetic
 * media. Any of the AI trigger flags being true does, deliberately
 * conservative (fail closed) even for platforms whose own policy language
 * is ambiguous about voice-only or image-only content.
 */
export function determineDisclosureRequirement({
  platform,
  avatarUsed = false,
  voiceUsed = false,
  generativeVideoUsed = false,
  generativeImageUsed = false,
  humanEdited = false
} = {}) {
  const policy = PLATFORM_DISCLOSURE_POLICY[platform];
  if (!policy) {
    throw new Error(`determineDisclosureRequirement: unknown platform "${platform}".`);
  }

  const flags = { avatarUsed, voiceUsed, generativeVideoUsed, generativeImageUsed };
  const aiUsed = AI_TRIGGER_FLAGS.some((key) => flags[key]);

  if (!aiUsed) {
    return {
      required: false,
      mechanism: null,
      policyVersion: policy.policyVersion,
      reason: humanEdited ? "human_edited_only_no_ai" : "no_ai_used"
    };
  }

  return {
    required: policy.requiresDisclosureForAIContent,
    mechanism: policy.mechanism,
    autoDetects: policy.autoDetects,
    policyVersion: policy.policyVersion,
    confidence: policy.confidence,
    note: policy.disclosureNote,
    reason: "ai_content_present"
  };
}

/**
 * The actual fail-closed publish gate: given a marketing_platform_variants
 * row (already carrying the disclosure columns this pass's migration
 * adds), decide whether publishing may proceed. This is what
 * marketing-studio.js's run_publishing_queue calls before ever reaching
 * provider.publish() — see the AI_DISCLOSURE_REQUIRED error it throws
 * when this returns allowed:false.
 */
export function enforcePrePublishDisclosureGate(variant = {}) {
  if (!variant.ai_disclosure_required) {
    return { allowed: true };
  }
  if (variant.disclosure_applied) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "ai_disclosure_required_but_not_applied",
    message: "This content requires an AI-content disclosure that has not been recorded as applied. Publishing is blocked until disclosure_applied is set (see set_content_disclosure)."
  };
}
