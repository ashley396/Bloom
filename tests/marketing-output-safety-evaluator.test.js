import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMarketingOutput,
  detectVisualFictionLeakage,
  stripVisualFictionLeakage,
  detectCtaCoherenceMismatch,
  detectInventedTemporalClaim,
  stripInventedTemporalClaims
} from "../netlify/functions/_shared/marketing-content-revision.js";

/**
 * Batch 1 rebuild (evaluateMarketingOutput + the visual-fiction boundary +
 * CTA coherence) — the one authoritative Marketing output-safety
 * evaluator. Every check it runs reuses an existing, independently-tested
 * detector from marketing-content-revision.js; nothing here duplicates
 * detector logic. These tests cover the new pieces directly, plus the four
 * live-failure regressions this batch is built to close end to end through
 * the evaluator itself.
 */

// ---------------------------------------------------------------------------
// detectVisualFictionLeakage / stripVisualFictionLeakage (scene-fact tests)
// ---------------------------------------------------------------------------

test("SCENE FACT: 'on our marble counter' is flagged with no verified evidence", () => {
  const violations = detectVisualFictionLeakage({
    generatedText: "Come see our beautiful bouquets on our marble counter today!"
  });
  assert.ok(violations.length > 0);
  assert.match(violations[0], /marble counter/i);
});

test("SCENE FACT: 'in our cooler' is flagged", () => {
  const violations = detectVisualFictionLeakage({ generatedText: "Fresh stems are waiting in our cooler right now." });
  assert.ok(violations.length > 0);
});

test("SCENE FACT: 'outside our storefront' is flagged", () => {
  const violations = detectVisualFictionLeakage({ generatedText: "We set up a beautiful display outside our storefront this morning." });
  assert.ok(violations.length > 0);
});

test("SCENE FACT: 'our delivery van' is flagged", () => {
  const violations = detectVisualFictionLeakage({ generatedText: "These are loaded onto our delivery van and ready to go." });
  assert.ok(violations.length > 0);
});

test("SCENE FACT: 'at today's wedding' is flagged", () => {
  const violations = detectVisualFictionLeakage({ generatedText: "These arrangements were featured at today's wedding." });
  assert.ok(violations.length > 0);
});

test("SCENE FACT: 'on display in our shop' is flagged", () => {
  const violations = detectVisualFictionLeakage({ generatedText: "Come see them on display in our shop this week." });
  assert.ok(violations.length > 0);
});

test("SAFE: a generic, non-possessive opinion about the same nouns is never flagged", () => {
  for (const text of [
    "Marble counters make such a beautiful display surface for fresh flowers.",
    "Weddings are one of our favorite occasions to arrange for.",
    "A cooler keeps stems fresh for days.",
    "Delivery vans are how most florists get flowers to your door."
  ]) {
    const violations = detectVisualFictionLeakage({ generatedText: text });
    assert.deepEqual(violations, [], `must never flag: "${text}"`);
  }
});

test("EVIDENCE: a confirmed physical detail supplied by the caller is never flagged", () => {
  const violations = detectVisualFictionLeakage({
    generatedText: "Come see our beautiful bouquets on our marble counter today!",
    shopEvidence: { confirmedPhysicalDetails: ["on our marble counter"] }
  });
  assert.deepEqual(violations, []);
});

test("stripVisualFictionLeakage removes only the offending sentence, keeping the rest", () => {
  const result = stripVisualFictionLeakage({
    generatedText: "Happy Friday! These are loaded onto our delivery van and ready to go. Stop by and see us today."
  });
  assert.ok(result.removed.length > 0);
  assert.doesNotMatch(result.text, /delivery van/i);
  assert.match(result.text, /Happy Friday/);
  assert.match(result.text, /Stop by and see us today/);
});

test("stripVisualFictionLeakage is a no-op when nothing is flagged", () => {
  const original = "Fresh flowers can brighten someone's day.";
  const result = stripVisualFictionLeakage({ generatedText: original });
  assert.equal(result.text, original);
  assert.deepEqual(result.removed, []);
});

// ---------------------------------------------------------------------------
// detectCtaCoherenceMismatch
// ---------------------------------------------------------------------------

test("CTA coherence: an operational objective with a celebratory/promotional CTA is flagged", () => {
  const mismatch = detectCtaCoherenceMismatch({
    concept: { objective: "operational" },
    ctaText: "Don't miss this amazing sale — order now!",
    requestText: "We're closing early today"
  });
  assert.ok(mismatch);
});

test("CTA coherence: invented urgency with no real promotion is flagged", () => {
  const mismatch = detectCtaCoherenceMismatch({
    concept: { objective: "awareness" },
    ctaText: "Hurry, sale ends today!",
    requestText: "Create today's Facebook post"
  });
  assert.ok(mismatch);
});

test("CTA coherence: a real promotion's urgent CTA is never flagged", () => {
  const mismatch = detectCtaCoherenceMismatch({
    concept: { objective: "promotion" },
    ctaText: "20% off today only!",
    requestText: "20% off all bouquets today only"
  });
  assert.equal(mismatch, null);
});

test("CTA coherence: a plain factual CTA is never flagged", () => {
  const mismatch = detectCtaCoherenceMismatch({
    concept: { objective: "operational" },
    ctaText: "Call 606-506-4039",
    requestText: "We're closing early today"
  });
  assert.equal(mismatch, null);
});

// ---------------------------------------------------------------------------
// evaluateMarketingOutput — component: "creative_scene"
// ---------------------------------------------------------------------------

test("evaluateMarketingOutput (creative_scene): an ungrounded flower is a REPAIR, not a retry", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    inventoryEvidence: [],
    candidate: "A romantic arrangement of garden roses on a marble counter.",
    component: "creative_scene"
  });
  assert.equal(result.decision, "repair");
  assert.equal(result.repaired, true);
  assert.doesNotMatch(result.safeCandidate, /garden roses/i);
  assert.ok(result.checksRun.includes("sanitizeUngroundedFlowerNames"));
});

test("evaluateMarketingOutput (creative_scene): a clean, generic scene is a PASS", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    candidate: "A lush arrangement of mixed fresh flowers on a bright counter.",
    component: "creative_scene"
  });
  assert.equal(result.decision, "pass");
  assert.equal(result.repaired, false);
});

// ---------------------------------------------------------------------------
// evaluateMarketingOutput — text components: pass / repair / retry / reject
// ---------------------------------------------------------------------------

test("evaluateMarketingOutput: a clean caption is PASS", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    shopEvidence: { name: "Lilies in Bloom", phone: "606-506-4039" },
    candidate: { headline: "A Little Beauty Today", body: "Stop by and treat yourself to something fresh.", cta: "Visit us today" },
    component: "caption"
  });
  assert.equal(result.decision, "pass");
  assert.equal(result.repaired, false);
  assert.deepEqual(result.reasons, []);
});

test("evaluateMarketingOutput: a fabricated phone number is caught by detectWeakMarketingCopy's own placeholder check (RETRY), with the deterministic repair always ready as a fallback", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Closing early today",
    shopEvidence: { name: "Lilies in Bloom", phone: "606-506-4039" },
    candidate: { headline: "Closing Early", body: "We're closing early today.", cta: "Call (555) 555-5555" },
    component: "flyer_text"
  });
  // detectWeakMarketingCopy already flags a placeholder/fabricated number
  // as its own reason (this is pre-existing behavior, not new) — so this
  // is a RETRY, not a silent repair. safeCandidate is still always
  // populated with the deterministically-substituted real number, ready
  // to use if the caller decides not to retry (or after a retry that's
  // still no better).
  assert.equal(result.decision, "retry");
  assert.equal(result.repaired, true);
  assert.match(result.safeCandidate.cta, /606-506-4039/);
  assert.doesNotMatch(result.safeCandidate.cta, /555-555-5555/);
});

test("a candidate with NO weakness/inventory/fiction/closure issues but a merely-cosmetic strip need is REPAIR — e.g. an inventory claim naming a flower the request itself already supplied never even reaches `reasons`", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "I have 40 roses I need to sell — a bright, romantic bouquet post for Facebook",
    shopEvidence: { name: "Lilies in Bloom" },
    candidate: { headline: "Fresh Roses Just Arrived!", body: "We've got 40 gorgeous fresh roses ready for their forever vase.", cta: "Visit us today" },
    component: "caption"
  });
  assert.equal(result.decision, "pass");
});

test("evaluateMarketingOutput: weak/hollow copy is RETRY on first look, REJECT on the retry attempt", () => {
  const badCandidate = { headline: "h", body: "We understand the importance of quality service. Whether you're looking for flowers or gifts, we've got you covered.", cta: "Contact us today to discuss your needs" };
  const first = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    shopEvidence: { name: "Lilies in Bloom" },
    candidate: badCandidate,
    component: "caption"
  });
  assert.equal(first.decision, "retry");
  assert.ok(first.safeCandidate, "safeCandidate is always populated as a best-effort fallback, even on retry");
  assert.ok(first.reasons.length > 0);

  const second = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    shopEvidence: { name: "Lilies in Bloom" },
    candidate: badCandidate,
    component: "caption",
    isRetryAttempt: true
  });
  assert.equal(second.decision, "reject");
  assert.ok(second.reasons.length > 0, "a reject still carries its reasons for logging, even though the caller must never display safeCandidate as-is");
});

test("evaluateMarketingOutput: an invented sympathy mismatch on a non-sympathy request is RETRY", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Make me a post to remind everyone that flowers say I care",
    shopEvidence: { name: "Lilies in Bloom" },
    candidate: { headline: "With Sympathy", body: "To express their love and condolences in the most delicate moments.", cta: "Call us" },
    component: "caption"
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.reasons.some((r) => /sympathy|funeral/i.test(r)));
});

test("evaluateMarketingOutput: a permanent-closure misread on a temporary-closure request is RETRY", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Closing early today at 2:30, call 606-506-4039",
    shopEvidence: { name: "Lilies in Bloom", phone: "606-506-4039" },
    candidate: { headline: "Farewell", body: "It is with a mix of sadness and gratitude that we announce we will be closing our doors for good.", cta: "Thank you for the memories" },
    component: "flyer_text"
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.reasons.some((r) => /permanent closure/i.test(r)));
});

test("evaluateMarketingOutput (flyer_text): a concept coherence mismatch (sympathy flyer + non-sympathy caption) is RETRY", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { objective: "seasonal_occasion", isSympathy: false, captionExcerpt: "We're thrilled to welcome our latest flowers to the studio!" },
    candidate: { headline: "Thinking of You", body: "Our team is here to help you create a lovely standing spray or casket flowers for the service.", cta: "Call us" },
    component: "flyer_text"
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.reasons.some((r) => /sympathy/i.test(r)));
});

test("evaluateMarketingOutput (flyer_text): a CTA coherence mismatch alone is RETRY", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "We're closing early today",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { objective: "operational", isSympathy: false, captionExcerpt: "Closing early today." },
    candidate: { headline: "Closing Early", body: "We're closing early today.", cta: "Don't miss this amazing sale, order now!" },
    component: "flyer_text"
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.reasons.some((r) => /CTA/i.test(r)));
});

// ---------------------------------------------------------------------------
// REGRESSION A: weak generic visual pattern / pink-circle regression
// ---------------------------------------------------------------------------

test("REGRESSION A: a shop-name-fixated, hollow post with nothing specific to this florist is RETRY", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Make today's post for Lilies in Bloom",
    shopEvidence: { name: "Lilies in Bloom" },
    candidate: {
      headline: "Lily Time!",
      body: "Our lily collection is looking stunning, with gorgeous Asiatic and Oriental varieties on display. Lilies, lilies, lilies!",
      cta: "Come see our lilies"
    },
    component: "caption"
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.reasons.some((r) => /framed entirely around/i.test(r)));
});

// ---------------------------------------------------------------------------
// REGRESSION B: invented latest-shipment Freedom roses + accidental funeral
// content from a single generic request — the original Phase 3 live
// failure, now proven end to end through the shared evaluator.
// ---------------------------------------------------------------------------

test("REGRESSION B: the exact live failure shape — invented shipment claim (caption) + accidental funeral content (flyer) — both caught by the evaluator", () => {
  const captionResult = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    shopEvidence: { name: "Lilies in Bloom", phone: "606-506-4039" },
    inventoryEvidence: [],
    candidate: {
      headline: "New Arrivals!",
      body: "We're thrilled to welcome our latest shipment of gorgeous Freedom roses to the studio!",
      cta: "Stop by today"
    },
    component: "caption"
  });
  // An unverified inventory-state claim earns a real model retry (exactly
  // like the pre-existing behavior it replaces) — but safeCandidate is
  // still always populated with the deterministically-stripped fallback,
  // so the invented claim is never shown either way.
  assert.equal(captionResult.decision, "retry");
  assert.ok(captionResult.reasons.some((r) => /shipment|Freedom rose|business.*inventory fact/i.test(r)));
  assert.doesNotMatch(captionResult.safeCandidate.body, /latest shipment|Freedom rose/i);

  const flyerResult = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    shopEvidence: { name: "Lilies in Bloom", phone: "606-506-4039" },
    canonicalConcept: { objective: "awareness", isSympathy: false, captionExcerpt: "We're thrilled to welcome our latest shipment of gorgeous roses to the studio!" },
    candidate: {
      headline: "Thinking of You",
      body: "Our team is here to help you create a lovely standing spray or casket flowers for the service.",
      cta: "Call us"
    },
    component: "flyer_text"
  });
  assert.equal(flyerResult.decision, "retry");
  assert.ok(flyerResult.reasons.some((r) => /sympathy/i.test(r)));
});

// ---------------------------------------------------------------------------
// REGRESSION C: invented present-tense peonies/alstroemeria/spray-roses
// usage claim with zero verified inventory.
// ---------------------------------------------------------------------------

test("REGRESSION C: present-tense 'crafting arrangements using peonies/alstroemeria/spray roses' with no verified inventory is RETRY, with the invented claim never surviving in safeCandidate either way", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    shopEvidence: { name: "Lilies in Bloom" },
    inventoryEvidence: [],
    candidate: {
      headline: "Fresh Today",
      body: "Our expert florists are busy crafting stunning arrangements using a mix of fresh flowers, including peonies, alstroemeria, and spray roses.",
      cta: "Stop by today"
    },
    component: "caption"
  });
  assert.equal(result.decision, "retry");
  assert.doesNotMatch(result.safeCandidate.body, /peonies|alstroemeria|spray roses/i);

  // The same claim, once the model rewrites it clean, is a straightforward PASS.
  const clean = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    shopEvidence: { name: "Lilies in Bloom" },
    inventoryEvidence: [],
    candidate: { headline: "A Little Beauty Today", body: "There's something so lovely about a fresh bouquet — stop by and treat yourself today.", cta: "Visit us today" },
    component: "caption",
    isRetryAttempt: true
  });
  assert.equal(clean.decision, "pass");
});

// ---------------------------------------------------------------------------
// REGRESSION D: a generated marble-counter scene detail becoming "on our
// marble counter" in customer-facing wording.
// ---------------------------------------------------------------------------

test("REGRESSION D: a generated marble-counter scene detail asserted as fact in the caption earns a retry, and never survives in safeCandidate either way", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    shopEvidence: { name: "Lilies in Bloom" },
    creativeScene: "A bright, romantic arrangement of mixed flowers on a marble counter.",
    candidate: {
      headline: "Fresh Today",
      body: "Come see our beautiful bouquets on our marble counter today!",
      cta: "Visit us today"
    },
    component: "caption"
  });
  assert.equal(result.decision, "retry");
  assert.doesNotMatch(result.safeCandidate.body, /marble counter/i);
});

test("REGRESSION D: the same marble-counter detail is fine to keep in the creative_scene field itself (it's the image's own visual concept, not a business claim)", () => {
  // detectVisualFictionLeakage/evaluateMarketingOutput's text-component path
  // targets CLAIM sentences in customer-facing wording — the visual_brief/
  // creative_brief field describing the photo itself is a different
  // component ("creative_scene"), evaluated only for ungrounded flower
  // names, never for scene-detail language (that's the whole point of the
  // boundary: scene detail is fine THERE, never as an asserted fact
  // elsewhere).
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    candidate: "A bright, romantic arrangement of mixed flowers on a marble counter.",
    component: "creative_scene"
  });
  assert.equal(result.decision, "pass");
});

// ---------------------------------------------------------------------------
// Preservation checks (Part 10 / Part 6 of the fix commit at 63b4dfa) —
// proving evaluateMarketingOutput doesn't regress prior, already-shipped
// behavior when used as the single evaluation path.
// ---------------------------------------------------------------------------

test("PRESERVED: generic post + empty inventory names no flower species (creative_scene)", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    inventoryEvidence: [],
    candidate: "A romantic arrangement of garden roses.",
    component: "creative_scene"
  });
  assert.equal(result.decision, "repair");
  assert.doesNotMatch(result.safeCandidate, /garden roses/i);
});

test("PRESERVED: explicit florist-requested flower names remain allowed", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Make a post about pink roses.",
    inventoryEvidence: [],
    candidate: "A vibrant arrangement of pink roses.",
    component: "creative_scene"
  });
  assert.equal(result.decision, "pass");
  assert.match(result.safeCandidate, /pink roses/i);
});

test("PRESERVED: verified inventory alone does not force a flower into a post", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create a fun post for our page",
    inventoryEvidence: [{ name: "Garden Rose" }],
    candidate: "A cheerful arrangement of garden roses.",
    component: "creative_scene"
  });
  assert.equal(result.decision, "repair");
  assert.doesNotMatch(result.safeCandidate, /rose/i);
});

test("PRESERVED: inventory intent + verified inventory may use the flower", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Promote something I actually have in stock.",
    inventoryEvidence: [{ name: "Garden Rose" }],
    candidate: "A cheerful arrangement of garden roses.",
    component: "creative_scene"
  });
  assert.equal(result.decision, "pass");
  assert.match(result.safeCandidate, /garden roses/i);
});

test("PRESERVED: empty inventory does not mean out of stock", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    inventoryEvidence: [],
    candidate: { headline: "h", body: "We are out of stock and have no flowers available right now.", cta: "Visit us" },
    component: "caption"
  });
  // Not a current-stock claim this evaluator targets in either direction —
  // must pass through untouched.
  assert.equal(result.decision, "pass");
});

test("PRESERVED: genuine sympathy behavior remains correct end to end", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Flowers for the Smith family, they just lost their dad",
    shopEvidence: { name: "Lilies in Bloom" },
    candidate: {
      headline: "With Sympathy",
      body: "Our thoughts are with the family — we're honored to help with flowers for the service.",
      cta: "Call us"
    },
    component: "caption"
  });
  assert.equal(result.decision, "pass");
});

test("PRESERVED: unsupported promotion remains blocked", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create today's Facebook post",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { objective: "promotion", isSympathy: false, captionExcerpt: "Fresh flowers can brighten someone's day." },
    candidate: { headline: "Big Sale", body: "Send someone a little beauty today.", cta: "Shop the sale now" },
    component: "flyer_text"
  });
  assert.equal(result.decision, "retry");
  assert.ok(result.reasons.some((r) => /promotion/i.test(r)));
});

test("PRESERVED: exact operational facts remain preserved (a fabricated number is repaired, not the real one)", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Closing at 2:30 today, call 606-506-4039",
    shopEvidence: { name: "Lilies in Bloom", phone: "606-506-4039" },
    candidate: { headline: "Closing Early", body: "We're closing at 2:30 today.", cta: "Call 606-506-4039" },
    component: "flyer_text"
  });
  assert.equal(result.decision, "pass");
  assert.match(result.safeCandidate.body, /2:30/);
  assert.match(result.safeCandidate.cta, /606-506-4039/);
});

test("PRESERVED: hour-only times such as 3 PM remain exact", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Opening late tomorrow at 3 PM",
    shopEvidence: { name: "Lilies in Bloom" },
    candidate: { headline: "Opening Late Tomorrow", body: "We're opening at 3 PM tomorrow.", cta: "See you then" },
    component: "flyer_text"
  });
  assert.equal(result.decision, "pass");
  assert.match(result.safeCandidate.body, /3 PM/i);
});

// ---------------------------------------------------------------------------
// detectInventedTemporalClaim / stripInventedTemporalClaims — real,
// live-found failure: a self-purchase caption for a Saturday request
// ("Give me a cute post about buying yourself flowers.") invented
// "Self-care Sunday" out of nothing. Deterministic, general fix — never a
// one-off ban on the word "Sunday."
// ---------------------------------------------------------------------------

test("detectInventedTemporalClaim: an invented day-of-week with nothing in the request supporting it is flagged", () => {
  const violations = detectInventedTemporalClaim({
    generatedText: "Self-care Sunday just got a whole lot brighter. Take a moment to indulge in the simple pleasure of buying yourself flowers.",
    requestText: "Give me a cute post about buying yourself flowers."
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /Self-care Sunday/);
});

test("detectInventedTemporalClaim: 'tonight'/'tomorrow' and 'this weekend' are all caught the same way when unsupported", () => {
  for (const text of [
    "There's no better night than tonight to buy yourself flowers.",
    "Stop by tomorrow and pick out something beautiful.",
    "This weekend is the perfect time to buy yourself flowers."
  ]) {
    const violations = detectInventedTemporalClaim({ generatedText: text, requestText: "Give me a cute post about buying yourself flowers." });
    assert.ok(violations.length > 0, `expected a violation for: ${text}`);
  }
});

test("detectInventedTemporalClaim: bare 'today' is deliberately NOT flagged — idiomatic CTA urgency ('order today', 'visit us today'), never a checkably-false claim the way a specific weekday is", () => {
  const violations = detectInventedTemporalClaim({
    generatedText: "Treat yourself today with a beautiful bouquet.",
    requestText: "Give me a cute post about buying yourself flowers."
  });
  assert.equal(violations.length, 0);
});

test("detectInventedTemporalClaim: an invented calendar date is caught the same way", () => {
  const violations = detectInventedTemporalClaim({
    generatedText: "Mark your calendar for March 3rd and treat yourself to something beautiful.",
    requestText: "Give me a cute post about buying yourself flowers."
  });
  assert.ok(violations.length > 0);
});

test("detectInventedTemporalClaim: SUPPORTED — when the florist's own request already names a day/date/relative-day, the same class of temporal language is never flagged", () => {
  const violations = detectInventedTemporalClaim({
    generatedText: "Closing early today — call ahead if you need anything.",
    requestText: "Lilies in Bloom will close early today, call 606-506-4039 to place an order."
  });
  assert.equal(violations.length, 0);
});

test("detectInventedTemporalClaim: a request that already carries an explicit date (e.g. a real event reminder) never gets that date stripped", () => {
  const violations = detectInventedTemporalClaim({
    generatedText: "Homecoming is September 19th — order your flowers soon!",
    requestText: "Remind students and parents the Homecoming Dance is September 19th, flowers need to be ordered as soon as possible."
  });
  assert.equal(violations.length, 0);
});

test("detectInventedTemporalClaim: an ordinary sentence with no temporal language at all is never flagged", () => {
  const violations = detectInventedTemporalClaim({
    generatedText: "Buy yourself the flowers. You don't need a special occasion — a beautiful bouquet is reason enough.",
    requestText: "Give me a cute post about buying yourself flowers."
  });
  assert.equal(violations.length, 0);
});

test("stripInventedTemporalClaims: removes only the invented-temporal sentence, keeps the rest of the caption intact", () => {
  const result = stripInventedTemporalClaims({
    generatedText: "Self-care Sunday just got a whole lot brighter. Take a moment to indulge in the simple pleasure of buying yourself flowers. You deserve it!",
    requestText: "Give me a cute post about buying yourself flowers."
  });
  assert.equal(result.removed.length, 1);
  assert.doesNotMatch(result.text, /Sunday/);
  assert.match(result.text, /buying yourself flowers/);
  assert.match(result.text, /You deserve it/);
});

test("evaluateMarketingOutput end to end: the exact live-diagnosed 'Self-care Sunday' caption is flagged and deterministically repaired", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Give me a cute post about buying yourself flowers.",
    shopEvidence: { name: "Lilies in Bloom" },
    candidate: {
      headline: "Beautiful Blooms, Thoughtfully Arranged",
      body: "Self-care Sunday just got a whole lot brighter. Take a moment to indulge in the simple pleasure of buying yourself flowers. You deserve it!",
      cta: ""
    },
    component: "caption"
  });
  assert.ok(result.reasons.some((r) => /Self-care Sunday/.test(r)));
  assert.doesNotMatch(result.safeCandidate.body, /Sunday/);
});

test("evaluateMarketingOutput: PRESERVED — an operational notice's own real day (e.g. 'closing today') survives the new temporal check untouched", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Lilies in Bloom will close early today, call 606-506-4039 to place an order.",
    shopEvidence: { name: "Lilies in Bloom", phone: "606-506-4039" },
    candidate: { headline: "Closing Early Today", body: "We're closing early today — call ahead if you need anything.", cta: "Call 606-506-4039" },
    component: "flyer_text"
  });
  assert.equal(result.decision, "pass");
  assert.match(result.safeCandidate.body, /today/i);
});

test("evaluateMarketingOutput: PRESERVED — a real named-event/campaign date the request itself supplied (Homecoming, September 19th) is never stripped", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Remind students and parents the Homecoming Dance is September 19th, flowers need to be ordered as soon as possible.",
    shopEvidence: { name: "Lilies in Bloom" },
    candidate: {
      headline: "Homecoming Is Almost Here",
      body: "Homecoming is September 19th — order your flowers soon so you're ready!",
      cta: "Order now"
    },
    component: "flyer_text"
  });
  assert.doesNotMatch(result.safeCandidate.body, /^$/);
  assert.match(result.safeCandidate.body, /September 19th/);
});
