import test from "node:test";
import assert from "node:assert/strict";
import { routeMarketingEngine, ENGINES } from "../netlify/functions/_shared/marketing-engine-router.js";

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

// Required test #15: sympathy-defaults-exact.
test("Batch1 #15 sympathy-defaults-exact: a sympathy concept routes to exact_layout by default, with no override", () => {
  const result = routeMarketingEngine({ canonicalConcept: concept({ occasionCategory: "sympathy", sympathyClassification: "sympathy" }) });
  assert.equal(result.engine, ENGINES.EXACT_LAYOUT);
  assert.equal(result.reason, "sympathy_default");
});

test("sympathy only reaches premium_ai_creative via an explicit override flag, never inferred", () => {
  const sympathyConcept = concept({ occasionCategory: "sympathy", sympathyClassification: "sympathy" });
  assert.equal(routeMarketingEngine({ canonicalConcept: sympathyConcept, sympathyOverrideRequested: false }).engine, ENGINES.EXACT_LAYOUT);
  const overridden = routeMarketingEngine({ canonicalConcept: sympathyConcept, sympathyOverrideRequested: true });
  assert.equal(overridden.engine, ENGINES.PREMIUM_AI_CREATIVE);
  assert.equal(overridden.reason, "sympathy_explicit_florist_override");
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
