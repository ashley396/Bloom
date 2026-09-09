/**
 * Pure Marketing engine router (Hybrid Marketing Studio, Batch 1, Part 9).
 *
 * Decides which rendering engine a request WOULD use if Premium AI
 * Creative (OpenAI) were ever activated: "exact_layout" (Florisyn's
 * existing deterministic Canvas renderer) or "premium_ai_creative"
 * (OpenAI GPT-Image-2, once live). NOT ACTIVATED — nothing in
 * marketing-studio.js or any other live call site calls this yet (Part
 * 12). This file exists so the decision logic is real and tested ahead of
 * that future activation, not invented at activation time under time
 * pressure.
 *
 * A PURE function only (Ashley's own explicit instruction: "Do not add an
 * AI classifier"). No network call, no model call, no randomness — every
 * input is a signal this codebase already computes deterministically:
 * buildCanonicalConcept()'s own real output (marketing-canonical-
 * concept.js) and resolveOccasionTreatment() (marketing-creative-
 * direction.js) — reused exactly, never re-derived or duplicated here.
 *
 * Every branch below fails closed to exact_layout when a signal is
 * missing, unverified, or unrecognized — a wrong guess toward the
 * cheaper/riskier engine is never acceptable; a wrong guess toward the
 * safe deterministic renderer costs nothing but a slightly less
 * decorative image.
 */

import { resolveOccasionTreatment } from "./marketing-creative-direction.js";

export const ENGINES = Object.freeze({
  EXACT_LAYOUT: "exact_layout",
  PREMIUM_AI_CREATIVE: "premium_ai_creative"
});

// FACT_REQUIREMENT_KEYS (marketing-canonical-concept.js) that, when
// present on a concept, mean this request carries an exact business-
// critical fact (hours, a specific date, a delivery-service claim) —
// Ashley's own instruction: "exact hours/time/date/price/business-
// critical notice → exact_layout," regardless of occasion treatment.
// `phone_number` is deliberately excluded — a phone number alone appears
// on almost every flyer and is not itself the kind of fact this rule is
// about (the operational_notice/promotional_feature checks below already
// cover the cases that actually matter for phone-adjacent claims like
// same-day delivery).
export const BUSINESS_CRITICAL_FACT_KEYS = Object.freeze(["shop_hours", "event_date", "delivery_service"]);

/**
 * @param {object} params
 * @param {object|null} params.canonicalConcept - buildCanonicalConcept()'s
 *   own real output. Required — a missing/invalid concept fails closed to
 *   exact_layout rather than guessing.
 * @param {boolean} [params.verifiedOfferFactsPresent] - true only when the
 *   promotion's own offer facts (discount, dates, terms) have ALREADY
 *   passed the fact-safety evaluator (evaluateMarketingOutput) — a
 *   deterministic signal the caller computes and passes in, never
 *   inferred here. An unverified promotion must never route to Premium AI
 *   Creative, where the image model could invent the offer's specifics.
 * @returns {{ engine: "exact_layout"|"premium_ai_creative", reason: string }}
 */
export function routeMarketingEngine({ canonicalConcept = null, verifiedOfferFactsPresent = false } = {}) {
  if (!canonicalConcept || typeof canonicalConcept !== "object") {
    return { engine: ENGINES.EXACT_LAYOUT, reason: "no_canonical_concept_fail_closed" };
  }

  // Reuses resolveOccasionTreatment() exactly as Creative Direction itself
  // does — never a second, independently-derived business-fact inference.
  const occasionTreatment = resolveOccasionTreatment({
    occasionCategory: canonicalConcept.occasionCategory,
    sympathyClassification: canonicalConcept.sympathyClassification,
    promotionIntent: canonicalConcept.promotionIntent
  });

  // Funeral/Sympathy creative-preservation batch (routing review, real
  // live-found failure): sympathy used to force exact_layout unconditionally
  // here, regardless of what the florist actually asked for — an ordinary
  // "let families know we can help with funeral flowers" social post got
  // an unwanted on-image headline/brand/phone/CTA it never needed, and its
  // caption/on-image text still had to survive the SAME copy-quality bar
  // as every other occasion (this router never touched that).
  //
  // The real, general distinction Ashley drew: occasion TREATMENT (the
  // dignified, restrained, non-celebratory tone/mood sympathy_elegance
  // still owns — see marketing-creative-direction.js's own
  // sympathy_elegance family constraints, completely unchanged by this
  // fix) is not the same question as whether EXACT graphic wording is
  // required. That second question already has its own real, existing
  // answer this router's own caller computes before ever reaching this
  // function: requestNeedsFlyerWording() (marketing-content-revision.js)
  // — a phone number, a price, a date, an explicit "flyer"/"poster"/"ad"
  // request, a discount, an operational notice. marketing-studio.js only
  // ever calls this router from its subject-forward branch, which by
  // construction never runs at all unless requestNeedsFlyerWording()
  // already returned false for this exact request — so a genuine sympathy
  // flyer/ad request ("make a funeral flower flyer with our phone number
  // 606-506-4039," "create a sympathy poster that says We're Here When You
  // Need Us") never reaches this router in the first place; it takes the
  // deterministic exact-layout branch directly, unaffected by anything
  // below. Sympathy is therefore now folded into the SAME "ordinary
  // creative" bucket as everyday_floral/seasonal_feature/elegant_editorial/
  // boutique_floral below — eligible for Premium AI Creative exactly like
  // any other occasion once it's already established that no exact wording
  // is required, never inferred from occasion alone. The now-obsolete
  // `sympathyOverrideRequested` parameter (dead the moment sympathy stopped
  // needing an override to reach premium) has been removed cleanly rather
  // than left as unused policy code.

  // An operational notice (closing early, changed hours, order deadline)
  // is always exact — see .claude/rules/marketing-studio.md's own
  // deterministic-notice-wording rule; the image model has no role here.
  if (occasionTreatment === "operational_notice") {
    return { engine: ENGINES.EXACT_LAYOUT, reason: "operational_notice" };
  }

  // Any concept carrying an exact business-critical fact requirement
  // (hours, a specific event date, a delivery-service claim) routes exact
  // regardless of its occasion treatment.
  const factRequirements = Array.isArray(canonicalConcept.factRequirements) ? canonicalConcept.factRequirements : [];
  const businessCriticalFacts = factRequirements.filter((key) => BUSINESS_CRITICAL_FACT_KEYS.includes(key));
  if (businessCriticalFacts.length) {
    return { engine: ENGINES.EXACT_LAYOUT, reason: `business_critical_fact_requirement:${businessCriticalFacts.join(",")}` };
  }

  // A real promotion may reach Premium AI Creative, but ONLY once its own
  // offer facts are already verified. An unverified promotion fails closed
  // to exact_layout — the deterministic renderer only ever draws facts
  // that were actually grounded, so it can never invent an offer's terms
  // the way an ungoverned image-model prompt could.
  if (occasionTreatment === "promotional_feature") {
    return verifiedOfferFactsPresent
      ? { engine: ENGINES.PREMIUM_AI_CREATIVE, reason: "verified_promotion" }
      : { engine: ENGINES.EXACT_LAYOUT, reason: "unverified_promotion_fails_closed" };
  }

  // Ordinary everyday/seasonal/boutique/elegant/sympathy creative — Ashley's
  // own instruction: these route to Premium AI Creative once exact-wording
  // necessity has already been ruled out (see this function's own comment
  // above for exactly how that's established before this router ever
  // runs). resolveOccasionTreatment() itself only ever returns
  // "everyday_floral" or "seasonal_feature" here today for a request that
  // reaches this router (operational_notice/promotional_feature are
  // handled by the branches above, and sympathy_elegance now joins this
  // bucket rather than being special-cased); "elegant_editorial" and
  // "boutique_floral" are included for forward compatibility with a
  // future explicit-override path (see marketing-creative-direction.js's
  // own OCCASION_TREATMENTS comment) and are currently unreachable
  // through this function alone — listed honestly, not to claim they're
  // reachable today.
  if (["everyday_floral", "seasonal_feature", "elegant_editorial", "boutique_floral", "sympathy_elegance"].includes(occasionTreatment)) {
    return { engine: ENGINES.PREMIUM_AI_CREATIVE, reason: `ordinary_creative:${occasionTreatment}` };
  }

  // Any occasion treatment this router doesn't explicitly recognize fails
  // closed to the deterministic renderer rather than guessing.
  return { engine: ENGINES.EXACT_LAYOUT, reason: `unrecognized_occasion_treatment:${occasionTreatment}` };
}
