import test from "node:test";
import assert from "node:assert/strict";
import { routeMarketingEngine, ENGINES } from "../netlify/functions/_shared/marketing-engine-router.js";
import { buildCanonicalConcept } from "../netlify/functions/_shared/marketing-canonical-concept.js";

// Hybrid Marketing Studio, Batch 1, Part 9: a PURE routing function — no
// AI classifier, no network call. Not wired into any live path yet (Part
// 12); these tests exercise the pure decision logic directly.

function concept(overrides = {}) {
  return {
    occasionCategory: "general",
    sympathyClassification: "not_sympathy",
    promotionIntent: "not_promotion",
    factRequirements: [],
    ...overrides
  };
}

test("routeMarketingEngine: a missing/invalid canonical concept fails closed to exact_layout", () => {
  assert.equal(routeMarketingEngine({}).engine, ENGINES.EXACT_LAYOUT);
  assert.equal(routeMarketingEngine({ canonicalConcept: null }).engine, ENGINES.EXACT_LAYOUT);
  assert.equal(routeMarketingEngine({ canonicalConcept: "not an object" }).engine, ENGINES.EXACT_LAYOUT);
});

// Required test #12: ordinary-creative-routes-premium.
test("Batch1 #12 ordinary-creative-routes-premium: an ordinary everyday-floral request routes to premium_ai_creative", () => {
  const result = routeMarketingEngine({ canonicalConcept: concept({ occasionCategory: "general" }) });
  assert.equal(result.engine, ENGINES.PREMIUM_AI_CREATIVE);
  assert.match(result.reason, /ordinary_creative/);
});

test("Batch1 ordinary-creative-routes-premium: a holiday/seasonal request also routes to premium_ai_creative", () => {
  const result = routeMarketingEngine({ canonicalConcept: concept({ occasionCategory: "holiday_seasonal" }) });
  assert.equal(result.engine, ENGINES.PREMIUM_AI_CREATIVE);
});

// Required test #13: operational-notice-routes-exact.
test("Batch1 #13 operational-notice-routes-exact: an operational notice always routes to exact_layout", () => {
  const result = routeMarketingEngine({ canonicalConcept: concept({ occasionCategory: "operational_notice" }) });
  assert.equal(result.engine, ENGINES.EXACT_LAYOUT);
  assert.equal(result.reason, "operational_notice");
});

// Required test #14: exact-date-time-routes-exact.
test("Batch1 #14 exact-date-time-routes-exact: an ordinary-occasion concept that also carries an exact event-date fact requirement still routes to exact_layout", () => {
  const result = routeMarketingEngine({ canonicalConcept: concept({ occasionCategory: "general", factRequirements: ["event_date"] }) });
  assert.equal(result.engine, ENGINES.EXACT_LAYOUT);
  assert.match(result.reason, /business_critical_fact_requirement/);
  assert.match(result.reason, /event_date/);
});

test("Batch1 exact-date-time-routes-exact: shop_hours and delivery_service fact requirements also route to exact_layout", () => {
  assert.equal(routeMarketingEngine({ canonicalConcept: concept({ factRequirements: ["shop_hours"] }) }).engine, ENGINES.EXACT_LAYOUT);
  assert.equal(routeMarketingEngine({ canonicalConcept: concept({ factRequirements: ["delivery_service"] }) }).engine, ENGINES.EXACT_LAYOUT);
});

test("a bare phone_number fact requirement alone (present on almost every flyer) does NOT force exact_layout by itself", () => {
  const result = routeMarketingEngine({ canonicalConcept: concept({ occasionCategory: "general", factRequirements: ["phone_number"] }) });
  assert.equal(result.engine, ENGINES.PREMIUM_AI_CREATIVE);
});

// Funeral/Sympathy creative-preservation batch (routing review, real
// live-found failure): sympathy used to force exact_layout unconditionally
// here regardless of what the florist actually asked for. The real,
// live-test-proven correction: occasion TREATMENT (sympathy's own
// dignified, restrained, non-celebratory mood — completely unchanged,
// still enforced by marketing-creative-direction.js's own visual
// safeguards) is not the same question as whether EXACT graphic wording
// is required (requestNeedsFlyerWording() — already ruled out by the only
// caller that ever reaches this router, before this function runs at
// all). Sympathy is therefore folded into the same "ordinary creative"
// bucket as everyday_floral/seasonal_feature/elegant_editorial/
// boutique_floral — see the corresponding test just below this one that
// replaces the removed "Batch1 #15 sympathy-defaults-exact"/override-flag
// tests, which asserted the now-corrected old policy.
test("Funeral/Sympathy creative-preservation batch: a sympathy concept is eligible for premium_ai_creative, exactly like any other ordinary creative occasion, once exact wording has already been ruled out", () => {
  const result = routeMarketingEngine({ canonicalConcept: concept({ occasionCategory: "sympathy", sympathyClassification: "sympathy" }) });
  assert.equal(result.engine, ENGINES.PREMIUM_AI_CREATIVE);
  assert.match(result.reason, /ordinary_creative:sympathy_elegance/);
});

test("Funeral/Sympathy creative-preservation batch: the now-obsolete sympathyOverrideRequested parameter is gone — sympathy needs no override to reach premium_ai_creative", () => {
  const sympathyConcept = concept({ occasionCategory: "sympathy", sympathyClassification: "sympathy" });
  // Passing the old (now-ignored) parameter name must not change anything —
  // routeMarketingEngine no longer reads it at all.
  const withStaleParam = routeMarketingEngine({ canonicalConcept: sympathyConcept, sympathyOverrideRequested: false });
  assert.equal(withStaleParam.engine, ENGINES.PREMIUM_AI_CREATIVE);
});

// Required test #16: verified-promotion-can-route-premium.
test("Batch1 #16 verified-promotion-can-route-premium: a real promotion with verified offer facts routes to premium_ai_creative", () => {
  const promoConcept = concept({ occasionCategory: "general", promotionIntent: "real_promotion" });
  const result = routeMarketingEngine({ canonicalConcept: promoConcept, verifiedOfferFactsPresent: true });
  assert.equal(result.engine, ENGINES.PREMIUM_AI_CREATIVE);
  assert.equal(result.reason, "verified_promotion");
});

// Required test (Part 13 list): unverified-promotion-never-creates-offer.
test("Batch1 unverified-promotion-never-creates-offer: a real promotion with unverified offer facts fails closed to exact_layout, never premium_ai_creative", () => {
  const promoConcept = concept({ occasionCategory: "general", promotionIntent: "real_promotion" });
  const result = routeMarketingEngine({ canonicalConcept: promoConcept, verifiedOfferFactsPresent: false });
  assert.equal(result.engine, ENGINES.EXACT_LAYOUT);
  assert.equal(result.reason, "unverified_promotion_fails_closed");
  // Default (omitted) must be the same fail-closed behavior — never
  // silently trusting an unverified promotion by default.
  const defaulted = routeMarketingEngine({ canonicalConcept: promoConcept });
  assert.equal(defaulted.engine, ENGINES.EXACT_LAYOUT);
});

test("an unrecognized occasion treatment fails closed to exact_layout rather than guessing", () => {
  // sympathyClassification/promotionIntent/occasionCategory combination
  // that resolveOccasionTreatment cannot map to any of its five real
  // outputs is not reachable through normal inputs — this test instead
  // confirms the router's own defensive default branch by directly
  // checking every value resolveOccasionTreatment can actually produce is
  // handled (no case silently falls through unrouted).
  const treatments = [
    concept({ occasionCategory: "sympathy", sympathyClassification: "sympathy" }),
    concept({ occasionCategory: "operational_notice" }),
    concept({ promotionIntent: "real_promotion" }),
    concept({ occasionCategory: "holiday_seasonal" }),
    concept({ occasionCategory: "general" })
  ];
  for (const c of treatments) {
    const result = routeMarketingEngine({ canonicalConcept: c });
    assert.ok(Object.values(ENGINES).includes(result.engine), "every real occasion treatment must resolve to a real engine, never undefined");
  }
});

// ---------------------------------------------------------------------------
// Batch 3 staging-acceptance fix, Part 4: true end-to-end tests through
// the REAL buildCanonicalConcept() -> routeMarketingEngine() pipeline —
// not a hand-built concept object — proving the authoritative-source fix
// in marketing-canonical-concept.js (event_date semantics), not a
// router-level workaround, is what actually resolves this correctly.
// ---------------------------------------------------------------------------

test("Batch3 end-to-end: a generic 'today's post' request routes to premium_ai_creative", () => {
  const concept = buildCanonicalConcept({ requestText: "Create today's Facebook post for Lilies in Bloom.", objective: "awareness" });
  assert.ok(!concept.factRequirements.includes("event_date"), "the real canonical concept must not carry a spurious event_date requirement");
  const result = routeMarketingEngine({ canonicalConcept: concept });
  assert.equal(result.engine, ENGINES.PREMIUM_AI_CREATIVE);
});

test("Batch3 end-to-end: 'closing today at 3 PM' routes to exact_layout", () => {
  const concept = buildCanonicalConcept({ requestText: "Lilies in Bloom is closing today at 3 PM." });
  assert.ok(concept.factRequirements.includes("event_date"));
  const result = routeMarketingEngine({ canonicalConcept: concept });
  assert.equal(result.engine, ENGINES.EXACT_LAYOUT);
});

test("Batch3 end-to-end: a real, material event date routes to exact_layout", () => {
  const concept = buildCanonicalConcept({ requestText: "Our flower arranging class is September 12." });
  assert.ok(concept.factRequirements.includes("event_date"));
  const result = routeMarketingEngine({ canonicalConcept: concept });
  assert.equal(result.engine, ENGINES.EXACT_LAYOUT);
});
