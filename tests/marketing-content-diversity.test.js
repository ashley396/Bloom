import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMarketingDiversity } from "../netlify/functions/_shared/marketing-content-diversity.js";

// Batch 5 ("Repair recent-content diversity + brand-memory learning"),
// Part D/E: the one deterministic diversity evaluator — structured field
// comparisons and normalized-text comparisons only, never a free-form AI
// similarity call and never a raw word-overlap score.

function historyEntry(overrides = {}) {
  return {
    contentItemId: overrides.contentItemId || "item-old",
    platform: overrides.platform || "facebook",
    objective: overrides.objective ?? "awareness",
    occasionCategory: overrides.occasionCategory ?? "general",
    primarySubjectClass: overrides.primarySubjectClass ?? "floral_arrangement",
    captionOpeningPattern: overrides.captionOpeningPattern ?? "fresh flowers just arrived for the",
    normalizedCaptionText: overrides.normalizedCaptionText ?? "fresh flowers just arrived for the weekend order yours today",
    ctaIntent: overrides.ctaIntent ?? "visit_shop",
    ctaText: overrides.ctaText ?? "visit us today",
    creativeFamily: overrides.creativeFamily ?? "plain_photo_post",
    visualDirection: overrides.visualDirection ?? { photoStrategy: "subject_forward" },
    assetRoute: overrides.assetRoute ?? "ai_generated_photo",
    templateFamily: overrides.templateFamily ?? null,
    conceptFingerprint: overrides.conceptFingerprint ?? "awareness|general|floral_arrangement|visit_shop|plain_photo_post"
  };
}

function concept(overrides = {}) {
  return {
    objective: "awareness",
    occasionCategory: "general",
    primarySubjectClass: "floral_arrangement",
    ctaIntent: "visit_shop",
    creativeFamily: "plain_photo_post",
    visualDirection: { photoStrategy: "subject_forward" },
    ...overrides
  };
}

// Part D #1 / Part P #8: identical/near-identical opening line detected.
test("evaluateMarketingDiversity: an identical opening line against a recent real post triggers a retry", () => {
  const result = evaluateMarketingDiversity({
    candidate: { body: "Fresh flowers just arrived for the community garden opening — a completely different topic." },
    canonicalConcept: concept({ occasionCategory: "birthday" }), // concept differs so ONLY the opening-line check should fire
    recentHistory: [historyEntry()]
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.repeatedSignals.includes("opening_line"));
});

// Part D #8 / Part P #7: same normalized caption text — and never
// double-counted when only one real history entry matches.
test("evaluateMarketingDiversity: an essentially identical full caption is detected, and counted exactly once", () => {
  const result = evaluateMarketingDiversity({
    candidate: { body: "Fresh flowers just arrived for the weekend, order yours today!!" },
    canonicalConcept: concept({ occasionCategory: "birthday" }),
    recentHistory: [historyEntry()]
  });
  assert.equal(result.decision, "retry");
  const captionReasons = result.reasons.filter((r) => /essentially identical/.test(r));
  assert.equal(captionReasons.length, 1, "one matching recent entry must produce exactly one caption-text reason, never duplicated");
  assert.equal(result.recentMatches.filter((m) => m.signal === "caption_text").length, 1);
});

// Part D #2 / Part P #9: repeated CTA pattern.
test("evaluateMarketingDiversity: the same CTA intent three times in a row (including this one) triggers a retry", () => {
  const result = evaluateMarketingDiversity({
    candidate: { body: "A brand new, totally different opening about something else entirely.", cta: "Come see us" },
    canonicalConcept: concept({ occasionCategory: "wedding_event", primarySubjectClass: "people_or_lifestyle" }),
    recentHistory: [historyEntry({ ctaIntent: "visit_shop", ctaText: "come see us" }), historyEntry({ ctaIntent: "visit_shop", contentItemId: "item-older" })]
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.repeatedSignals.includes("cta_intent"));
});

test("evaluateMarketingDiversity: the same CTA intent only twice (not three) in a row does not trigger a retry on its own", () => {
  const result = evaluateMarketingDiversity({
    candidate: { body: "A brand new, totally different opening about something else entirely." },
    canonicalConcept: concept({ occasionCategory: "wedding_event", primarySubjectClass: "people_or_lifestyle", creativeFamily: "designed_flyer" }),
    recentHistory: [historyEntry({ ctaIntent: "visit_shop" })]
  });
  assert.equal(result.decision, "pass");
});

// Part D #3 / Part P #10: repeated objective too many times in a row.
test("evaluateMarketingDiversity: the same objective three times in a row (including this one) triggers a retry", () => {
  const result = evaluateMarketingDiversity({
    candidate: { body: "A brand new, totally different opening about something else entirely." },
    canonicalConcept: concept({ objective: "promotion", occasionCategory: "holiday_seasonal", primarySubjectClass: "people_or_lifestyle" }),
    recentHistory: [historyEntry({ objective: "promotion" }), historyEntry({ objective: "promotion", contentItemId: "item-older" })]
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.repeatedSignals.includes("objective"));
});

// Part D #4 / Part P #11: repeated subject/concept.
test("evaluateMarketingDiversity: the exact same concept fingerprint as a recent real post triggers a retry", () => {
  const result = evaluateMarketingDiversity({
    candidate: { body: "A brand new, totally different opening about something else entirely." },
    canonicalConcept: concept(),
    recentHistory: [historyEntry()]
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.repeatedSignals.includes("concept_fingerprint"));
});

test("evaluateMarketingDiversity: the same primary subject class three times in a row triggers a retry", () => {
  const result = evaluateMarketingDiversity({
    candidate: { body: "A brand new, totally different opening about something else entirely." },
    canonicalConcept: concept({ objective: "promotion", occasionCategory: "holiday_seasonal", ctaIntent: "order_now", creativeFamily: "designed_flyer" }),
    recentHistory: [historyEntry({ primarySubjectClass: "floral_arrangement" }), historyEntry({ primarySubjectClass: "floral_arrangement", contentItemId: "item-older" })]
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.repeatedSignals.includes("primary_subject_class"));
});

// Part D #5 / Part P #12: repeated creative family.
test("evaluateMarketingDiversity: the same creative family three times in a row triggers a retry", () => {
  const result = evaluateMarketingDiversity({
    candidate: { body: "A brand new, totally different opening about something else entirely." },
    canonicalConcept: concept({ objective: "promotion", occasionCategory: "holiday_seasonal", primarySubjectClass: "people_or_lifestyle", ctaIntent: "order_now" }),
    recentHistory: [historyEntry({ creativeFamily: "plain_photo_post" }), historyEntry({ creativeFamily: "plain_photo_post", contentItemId: "item-older" })]
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.repeatedSignals.includes("creative_family"));
});

// Part D #7 / Part P #13: repeated template family.
test("evaluateMarketingDiversity: the same flyer template three times in a row triggers a retry", () => {
  const result = evaluateMarketingDiversity({
    candidate: { body: "A brand new, totally different opening about something else entirely." },
    canonicalConcept: concept({ objective: "promotion", occasionCategory: "holiday_seasonal", primarySubjectClass: "people_or_lifestyle", ctaIntent: "order_now", creativeFamily: "designed_flyer" }),
    templateFamily: "template-a",
    recentHistory: [historyEntry({ templateFamily: "template-a" }), historyEntry({ templateFamily: "template-a", contentItemId: "item-older" })]
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.repeatedSignals.includes("template_family"));
});

// Part D #6: repeated visual composition, where structurally detectable.
test("evaluateMarketingDiversity: the same visual composition (photoStrategy) three times in a row triggers a retry", () => {
  const result = evaluateMarketingDiversity({
    candidate: { body: "A brand new, totally different opening about something else entirely." },
    canonicalConcept: concept({ objective: "promotion", occasionCategory: "holiday_seasonal", primarySubjectClass: "people_or_lifestyle", ctaIntent: "order_now", creativeFamily: "designed_flyer", visualDirection: { photoStrategy: "calm_backdrop" } }),
    recentHistory: [historyEntry({ visualDirection: { photoStrategy: "calm_backdrop" } }), historyEntry({ visualDirection: { photoStrategy: "calm_backdrop" }, contentItemId: "item-older" })]
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.repeatedSignals.includes("visual_direction"));
});

// Part P #14: genuinely different concepts pass cleanly.
test("evaluateMarketingDiversity: a genuinely different post (different opening, subject, objective, CTA, format) passes cleanly", () => {
  const result = evaluateMarketingDiversity({
    candidate: { body: "Big news — our new wedding collection just launched, come see the whole lineup.", cta: "Book a consultation" },
    canonicalConcept: concept({ objective: "promotion", occasionCategory: "wedding_event", primarySubjectClass: "people_or_lifestyle", ctaIntent: "contact_general", creativeFamily: "designed_flyer", visualDirection: { photoStrategy: "calm_backdrop" } }),
    recentHistory: [historyEntry()]
  });
  assert.equal(result.decision, "pass");
  assert.deepEqual(result.reasons, []);
});

// Part D / Part P #15: common florist vocabulary alone must never trigger
// repetition — two captions sharing ordinary words but differing in
// actual structure/opening/concept must both pass.
test("evaluateMarketingDiversity: shared ordinary vocabulary (flowers, beautiful, arrangement, local, order) alone never triggers a retry", () => {
  const result = evaluateMarketingDiversity({
    candidate: { body: "Our local shop just finished a beautiful arrangement — order one for someone special today.", cta: "Order now" },
    canonicalConcept: concept({ objective: "promotion", occasionCategory: "anniversary", primarySubjectClass: "floral_arrangement", ctaIntent: "order_now", creativeFamily: "designed_flyer" }),
    recentHistory: [
      historyEntry({
        captionOpeningPattern: "beautiful flowers make every",
        normalizedCaptionText: "beautiful flowers make every local celebration better order from our shop",
        objective: "awareness",
        occasionCategory: "general",
        creativeFamily: "plain_photo_post",
        conceptFingerprint: "awareness|general|floral_arrangement|visit_shop|plain_photo_post"
      })
    ]
  });
  assert.equal(result.decision, "pass", `ordinary shared vocabulary must never trigger a retry on its own: ${JSON.stringify(result.reasons)}`);
});

// Empty/no history must never itself be a reason to retry.
test("evaluateMarketingDiversity: an empty recent history always passes — nothing to repeat", () => {
  const result = evaluateMarketingDiversity({ candidate: { body: "Anything at all." }, canonicalConcept: concept(), recentHistory: [] });
  assert.equal(result.decision, "pass");
});
