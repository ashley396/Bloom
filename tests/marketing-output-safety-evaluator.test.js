import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMarketingOutput,
  detectVisualFictionLeakage,
  stripVisualFictionLeakage,
  detectCtaCoherenceMismatch,
  detectInventedTemporalClaim,
  stripInventedTemporalClaims,
  findHollowSentences,
  detectWeakMarketingCopy,
  detectWeakMarketingCopyReasonCodes,
  buildDeterministicCreativeRescueContent,
  buildCopyEvaluationDiagnostic
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

// ---------------------------------------------------------------------------
// Self-purchase POLICY REDESIGN (2026-09-06, third live-found recurrence):
// three separate controlled live runs each proved audience threading,
// diversity, temporal safety, and creative routing all worked correctly,
// yet the caption still fell to deterministic rescue via
// weak_copy_hollow_sentence — each time on genuinely valid but differently-
// phrased self-purchase copy. Two earlier rounds patched this with a
// growing allowlist regex (SELF_PURCHASE_COPY_INTENT_RE); each was
// defeated by the next live phrasing. That regex is now REMOVED. The fix
// instead recognizes that hollow-sentence/specific-detail detection is
// simply the wrong heuristic for self_purchase copy — findHollowSentences
// now exempts the ENTIRE audience from this one check, never requiring a
// sentence to positively match any fixed phrase list. Genuine filler is
// still caught by the separate FILLER_PHRASES check; every other detector
// (length, fabricated numbers, inventory/service/temporal/visual-fiction
// safety, sympathy/funeral checks, shop-name fixation, diversity) is
// completely unaffected and still runs unconditionally.
// ---------------------------------------------------------------------------

test("findHollowSentences: self_purchase audience is now exempt from hollow-sentence detection entirely, even with no named flower/product/recipient", () => {
  const hollow = findHollowSentences(
    "Every day is a wonderful opportunity to add a little more joy into your life.",
    "Lilies in Bloom",
    { audience: "self_purchase" }
  );
  assert.equal(hollow.length, 0);
});

test("findHollowSentences: the exact live-found rhetorical phrasing that previously only passed by matching a specific allowlist entry now passes with no allowlist involved at all", () => {
  // This sentence uses "give yourself" and a rhetorical "why wait"
  // framing — the SAME live-found phrasing that took two rounds of regex
  // patching to cover under the old design. Under the new design it
  // needs no matching pattern whatsoever; the whole heuristic simply
  // doesn't apply to this audience.
  const hollow = findHollowSentences(
    "Why wait for someone special to bring you flowers? Sometimes the best gift is the one you give yourself.",
    "Lilies in Bloom",
    { audience: "self_purchase" }
  );
  assert.equal(hollow.length, 0);
});

test("findHollowSentences: the same self_purchase exemption is NOT extended to a different (recipient-oriented) audience — the existing rule is unchanged there", () => {
  const hollow = findHollowSentences(
    "Every day is a wonderful opportunity to add a little more joy into your life.",
    "Lilies in Bloom",
    { audience: "gift_buyers" }
  );
  assert.equal(hollow.length, 1);
});

test("findHollowSentences: no audience supplied at all behaves exactly as before — hollow sentences are still flagged", () => {
  const hollow = findHollowSentences("Every day is a wonderful opportunity to add a little more joy into your life.", "Lilies in Bloom");
  assert.equal(hollow.length, 1);
});

// Five materially different self-purchase phrasings, deliberately NOT
// chosen to match any specific regex pattern — proving the new policy is
// genuinely general, not a broader allowlist in disguise. None of these
// name a flower, product, or recipient.
const VARIED_SELF_PURCHASE_PHRASINGS = [
  "You don't need a special occasion to bring flowers home. Treat yourself to something beautiful — you deserve it just because.",
  "Why wait for someone special to bring you flowers? Sometimes the best gift is the one you give yourself.",
  "There is something quietly wonderful about choosing a little beauty for no reason at all.",
  "Some days call for nothing more than a small, unplanned kindness toward yourself.",
  "It doesn't take an event on the calendar to justify bringing something lovely into your own space."
];

for (const [i, body] of VARIED_SELF_PURCHASE_PHRASINGS.entries()) {
  test(`evaluateMarketingOutput end to end: varied self-purchase phrasing #${i + 1} passes cleanly with no phrase-specific allowlisting`, () => {
    const result = evaluateMarketingOutput({
      route: "generate_content",
      request: "Give me a cute post about buying yourself flowers.",
      shopEvidence: { name: "Lilies in Bloom" },
      canonicalConcept: { audience: "self_purchase" },
      candidate: { headline: null, body, cta: "" },
      component: "caption"
    });
    assert.equal(result.reasons.length, 0, `expected a clean pass for: "${body}"`);
    assert.equal(result.decision, "pass");
  });
}

test("evaluateMarketingOutput end to end: recipient-oriented (gift_buyers) requests still use the existing hollow-sentence rule — the same universal copy is rejected without the self_purchase audience", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Surprise her with flowers for no reason.",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { audience: "gift_buyers" },
    candidate: {
      headline: null,
      body: "You don't need a special occasion to bring flowers home. Treat yourself to something beautiful — you deserve it just because.",
      cta: ""
    },
    component: "caption"
  });
  assert.ok(result.reasons.length > 0);
});

test("evaluateMarketingOutput: genuine canned filler still fails via weak_copy_filler_phrase for self_purchase — the exemption never touches FILLER_PHRASES", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Give me a cute post about buying yourself flowers.",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { audience: "self_purchase" },
    candidate: {
      headline: null,
      body: "We understand the importance of celebrating every moment with beautiful flowers. Whether you're looking for something classic or bold, we've got you covered.",
      cta: ""
    },
    component: "caption"
  });
  assert.ok(result.reasons.length > 0);
  assert.ok(result.weakCopyReasonCodes.includes("weak_copy_filler_phrase"));
  assert.ok(!result.weakCopyReasonCodes.includes("weak_copy_hollow_sentence"));
});

test("evaluateMarketingOutput: an overlong self_purchase caption still fails via weak_copy_too_long", () => {
  const longCopy =
    "Our roses are looking stunning in the shop this week. Tulips add a wonderful splash of color to any arrangement we make. " +
    "Carnations bring a lasting pop of color that lasts for weeks on end. Daisies give a cheerful, casual touch to any bouquet you choose. " +
    "Peonies smell absolutely incredible in person when you visit the shop. Orchids make an elegant centerpiece for any dinner table setting. " +
    "Lilies round out our beautiful current selection of fresh, seasonal blooms perfectly this month.";
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Give me a cute post about buying yourself flowers.",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { audience: "self_purchase" },
    candidate: { headline: null, body: longCopy, cta: "" },
    component: "caption"
  });
  assert.ok(result.reasons.length > 0);
  assert.ok(result.weakCopyReasonCodes.includes("weak_copy_too_long"));
});

test("evaluateMarketingOutput: an invented current-stock inventory claim still fails/repairs for self_purchase — unaffected by the hollow-sentence exemption", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Give me a cute post about buying yourself flowers.",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { audience: "self_purchase" },
    candidate: { headline: null, body: "We just got a fresh shipment of peonies in — treat yourself to one today.", cta: "" },
    component: "caption"
  });
  assert.ok(result.reasons.some((r) => /fresh shipment/i.test(r)));
  assert.doesNotMatch(result.safeCandidate.body, /fresh shipment/i);
});

test("evaluateMarketingOutput: a self_purchase caption with an invented temporal claim is still flagged and repaired — temporal safety and the new hollow-sentence policy compose correctly", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Give me a cute post about buying yourself flowers.",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { audience: "self_purchase" },
    candidate: { headline: null, body: "Self-care Sunday is here. Treat yourself to something beautiful — you deserve it just because.", cta: "" },
    component: "caption"
  });
  assert.ok(result.reasons.some((r) => /Sunday/.test(r)));
  assert.doesNotMatch(result.safeCandidate.body, /Sunday/);
  // The self-purchase sentence itself must survive the repair untouched —
  // only the invented-temporal sentence is stripped, and it is NOT also
  // flagged as hollow now that the exemption is audience-wide.
  assert.match(result.safeCandidate.body, /Treat yourself/);
  assert.ok(!result.weakCopyReasonCodes.includes("weak_copy_hollow_sentence"));
});

test("evaluateMarketingOutput: sympathy content is completely unaffected by the self_purchase hollow-sentence exemption (audience never self_purchase)", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "We need sympathy flowers for the Johnson family, their mother passed away.",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { audience: "funeral_families" },
    candidate: {
      headline: "With Sympathy",
      body: "With Deepest Sympathy — the Johnson family is in our thoughts during this loss. We're here to help however we can.",
      cta: "Call to arrange delivery"
    },
    component: "caption"
  });
  assert.equal(result.reasons.filter((r) => /pictured or acted on/.test(r)).length, 0);
});

test("evaluateMarketingOutput: deterministic rescue still fires for a self_purchase candidate that genuinely fails an unrelated safety detector (filler phrase), and the rescue is still self-purchase-aware", () => {
  // Confirms Part 2: rescue remains a true last resort for genuine
  // failures — it is never bypassed by the hollow-sentence exemption,
  // and when it does fire for self_purchase it still uses the
  // audience-aware rescue content, not the generic gifting-adjacent one.
  const evalResult = evaluateMarketingOutput({
    route: "generate_content",
    request: "Give me a cute post about buying yourself flowers.",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { audience: "self_purchase" },
    candidate: {
      headline: null,
      body: "We understand the importance of celebrating every moment with beautiful flowers. Whether you're looking for something classic or bold, we've got you covered.",
      cta: ""
    },
    component: "caption"
  });
  assert.ok(evalResult.reasons.length > 0, "a genuine filler-phrase failure must still produce reasons for the caller to rescue against");
  const rescue = buildDeterministicCreativeRescueContent({ shopName: "Lilies in Bloom", shopPhone: "6065064039", audience: "self_purchase" });
  assert.doesNotMatch(rescue.body, /brighten someone's day/);
  assert.doesNotMatch(rescue.body, /moments that matter/);
});

test("buildDeterministicCreativeRescueContent: self_purchase audience produces self-purchase-aware wording, never the generic gifting-adjacent rescue", () => {
  const rescue = buildDeterministicCreativeRescueContent({ shopName: "Lilies in Bloom", shopPhone: "6065064039", audience: "self_purchase" });
  assert.doesNotMatch(rescue.body, /brighten someone's day/);
  assert.doesNotMatch(rescue.body, /moments that matter/);
  assert.match(rescue.body, /Lilies in Bloom/);
});

test("buildDeterministicCreativeRescueContent: no audience (or a non-self_purchase audience) still produces the original generic rescue wording — unchanged", () => {
  const rescueNoAudience = buildDeterministicCreativeRescueContent({ shopName: "Lilies in Bloom", shopPhone: "6065064039" });
  assert.match(rescueNoAudience.body, /moments that matter/);
  const rescueOtherAudience = buildDeterministicCreativeRescueContent({ shopName: "Lilies in Bloom", shopPhone: "6065064039", audience: "gift_buyers" });
  assert.match(rescueOtherAudience.body, /moments that matter/);
});

test("buildDeterministicCreativeRescueContent: self_purchase rescue never hard-codes a specific shop — works generically with no shop name supplied", () => {
  const rescue = buildDeterministicCreativeRescueContent({ audience: "self_purchase" });
  assert.doesNotMatch(rescue.body, /brighten someone's day/);
  assert.ok(rescue.body.length > 0);
});

test("evaluateMarketingOutput: diagnostic weakCopyReasonCodes correctly identifies a genuine self_purchase failure by its real sub-code, never hollow_sentence for valid universal copy", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Give me a cute post about buying yourself flowers.",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { audience: "self_purchase" },
    candidate: { headline: null, body: "You don't need a special occasion to bring flowers home. Treat yourself to something beautiful — you deserve it just because.", cta: "" },
    component: "caption"
  });
  assert.deepEqual(result.weakCopyReasonCodes, []);
});

// ---------------------------------------------------------------------------
// Observability fix (2026-09-06 live-found gap): the latest live run proved
// we could not reconstruct why a self-purchase caption fell to rescue — no
// reason codes, no retry record, nothing. buildCopyEvaluationDiagnostic is
// the structured, no-raw-text shape persisted for each attempt onto its own
// marketing_generation_usage row.
// ---------------------------------------------------------------------------

test("buildCopyEvaluationDiagnostic: reports reason codes, repairedBy, and diversity decision straight from the evaluator's own return values", () => {
  const evalResult = evaluateMarketingOutput({
    route: "generate_content",
    request: "Give me a cute post about buying yourself flowers",
    shopEvidence: { name: "Lilies in Bloom", phone: "606-506-4039" },
    canonicalConcept: { audience: "self_purchase" },
    candidate: { headline: null, body: "Self-care Sunday is here. Treat yourself to something beautiful — you deserve it just because.", cta: "" },
    component: "caption"
  });
  const diagnostic = buildCopyEvaluationDiagnostic({
    attempt: 1,
    evalResult,
    diversityEval: { decision: "pass", repeatedSignals: [] },
    selected: true,
    rescueFired: false
  });
  assert.equal(diagnostic.attempt, 1);
  assert.ok(diagnostic.reasonCodes.includes("invented_temporal_claim"));
  assert.ok(diagnostic.repairedBy.includes("stripInventedTemporalClaims"));
  assert.equal(diagnostic.diversityDecision, "pass");
  assert.equal(diagnostic.selected, true);
  assert.equal(diagnostic.rescueFired, false);
});

test("buildCopyEvaluationDiagnostic: never carries the candidate's own generated text — only codes, counts, and booleans", () => {
  const rawText = "Self-care Sunday is here. Treat yourself to something beautiful — you deserve it just because.";
  const evalResult = evaluateMarketingOutput({
    route: "generate_content",
    request: "Give me a cute post about buying yourself flowers",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { audience: "self_purchase" },
    candidate: { headline: null, body: rawText, cta: "" },
    component: "caption"
  });
  const diagnostic = buildCopyEvaluationDiagnostic({
    attempt: 1,
    evalResult,
    diversityEval: { decision: "retry", repeatedSignals: ["concept_fingerprint"] },
    selected: false,
    rescueFired: true
  });
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(serialized, /Self-care Sunday/);
  assert.doesNotMatch(serialized, /Treat yourself/);
  assert.deepEqual(JSON.parse(serialized), {
    diagnosticVersion: 2,
    attempt: 1,
    reasonCodes: ["invented_temporal_claim"],
    weakCopyReasonCodes: [],
    // Test D: which promotion-term checks fired — none for a non-promotion.
    promotionTermCodes: [],
    repairedBy: ["stripInventedTemporalClaims"],
    diversityDecision: "retry",
    diversityRepeatedSignals: ["concept_fingerprint"],
    selected: false,
    rescueFired: true,
    blockingReasonCount: 1,
    // Test C copy-observability follow-up: the profile is counts/ratios/
    // booleans only (the raw-text assertions above still hold over it).
    // sentenceCategoryCounts is the raw per-sentence classification;
    // hollowSentenceCount is what the rule actually counts after the
    // self_purchase exemption — hence hollow:1 here but count 0.
    copyProfile: {
      sentenceCount: 2,
      substantiveSentenceCount: 1,
      hollowSentenceCount: 0,
      hollowRatio: 0,
      hollowThresholdMet: false,
      commercialSpecificityMatched: false,
      humanSituationalSpecificityMatched: false,
      sentenceCategoryCounts: { short: 1, commercial: 0, human_situational: 0, both: 0, hollow: 1 },
      signalCounts: { personReference: 1, relationalAction: 0, commercialDetail: 0 },
      fillerPhraseHitCount: 0,
      selfPurchaseExempt: true,
      wordCount: 15,
      // Test C writer-quality fix: shape is recorded for every attempt but
      // only APPLICABLE to the everyday gifting intents — not self-purchase.
      everydayShape: { applicable: false, substantiveSentenceLimit: 3, wordLimit: 80, exceeded: false }
    },
    prompt: null,
    retryFeedbackVersion: null
  });
});

test("buildCopyEvaluationDiagnostic: a clean, passing candidate reports empty reason codes and no repair", () => {
  const evalResult = evaluateMarketingOutput({
    route: "generate_content",
    request: "Give me a cute post about buying yourself flowers",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { audience: "self_purchase" },
    candidate: { headline: null, body: "You don't need a special occasion to bring flowers home — sometimes wanting them is reason enough.", cta: "" },
    component: "caption"
  });
  const diagnostic = buildCopyEvaluationDiagnostic({ attempt: 1, evalResult, diversityEval: { decision: "pass", repeatedSignals: [] }, selected: true, rescueFired: false });
  assert.deepEqual(diagnostic.reasonCodes, []);
  assert.deepEqual(diagnostic.repairedBy, []);
  assert.equal(diagnostic.rescueFired, false);
});

test("buildCopyEvaluationDiagnostic: missing evalResult/diversityEval degrade to safe empty defaults rather than throwing", () => {
  const diagnostic = buildCopyEvaluationDiagnostic({ attempt: 2, evalResult: null, diversityEval: null, selected: false, rescueFired: true });
  assert.deepEqual(diagnostic, {
    diagnosticVersion: 2,
    attempt: 2,
    reasonCodes: [],
    weakCopyReasonCodes: [],
    promotionTermCodes: [],
    repairedBy: [],
    diversityDecision: null,
    diversityRepeatedSignals: [],
    selected: false,
    rescueFired: true,
    blockingReasonCount: 0,
    // Test C copy-observability follow-up: absent inputs degrade to null,
    // never to a partial or invented profile/prompt record.
    copyProfile: null,
    prompt: null,
    retryFeedbackVersion: null
  });
});

// ---------------------------------------------------------------------------
// Sub-reason-code granularity fix (2026-09-06 live-found gap, second
// occurrence): a real live run's two rejected caption attempts both
// reported the same coarse "weak_marketing_copy" code, and there was no
// way to tell which of detectWeakMarketingCopy's nine internal checks
// actually fired without reading the raw candidate text. These tests
// prove each check now reports its own distinct, stable sub-code via
// detectWeakMarketingCopyReasonCodes, while detectWeakMarketingCopy's own
// existing string-reason contract is completely unchanged.
// ---------------------------------------------------------------------------

test("detectWeakMarketingCopyReasonCodes: a filler-phrase caption reports weak_copy_filler_phrase only", () => {
  const codes = detectWeakMarketingCopyReasonCodes(
    "Make a nice post for the shop",
    "We understand the importance of celebrating every moment with beautiful flowers.",
    { shopName: "Lilies in Bloom" }
  );
  assert.deepEqual(codes, ["weak_copy_filler_phrase"]);
});

test("detectWeakMarketingCopyReasonCodes: a hollow-sentence caption (no filler phrases) reports weak_copy_hollow_sentence only", () => {
  const codes = detectWeakMarketingCopyReasonCodes(
    "Make a nice post for the shop",
    "Every day is a wonderful opportunity to add a little more joy into your life. Life is full of small moments that deserve to be appreciated fully.",
    { shopName: "Lilies in Bloom" }
  );
  assert.deepEqual(codes, ["weak_copy_hollow_sentence"]);
});

test("detectWeakMarketingCopyReasonCodes: an overlong caption (specific, non-filler, non-hollow content) reports weak_copy_too_long only", () => {
  const longSpecificCopy =
    "Our roses are looking stunning in the shop this week. Tulips add a wonderful splash of color to any arrangement we make. " +
    "Carnations bring a lasting pop of color that lasts for weeks on end. Daisies give a cheerful, casual touch to any bouquet you choose. " +
    "Peonies smell absolutely incredible in person when you visit the shop. Orchids make an elegant centerpiece for any dinner table setting. " +
    "Lilies round out our beautiful current selection of fresh, seasonal blooms perfectly this month.";
  const codes = detectWeakMarketingCopyReasonCodes("Make a nice post for the shop", longSpecificCopy, { shopName: "Lilies in Bloom" });
  assert.deepEqual(codes, ["weak_copy_too_long"]);
});

test("detectWeakMarketingCopyReasonCodes: a caption with multiple independent problems reports each of their distinct sub-codes", () => {
  const fillerAndLongCopy =
    "We understand the importance of celebrating every moment with beautiful flowers. Whether you're looking for something classic or bold, we've got you covered. " +
    "Our experienced florists create meaningful arrangements for any occasion you can imagine. High-quality blooms make all the difference in every single bouquet. " +
    "We're here to support you every step of the way, always. Contact us today to discuss your needs for your very next celebration.";
  const codes = detectWeakMarketingCopyReasonCodes("Make a nice post for the shop", fillerAndLongCopy, { shopName: "Lilies in Bloom" });
  assert.ok(codes.includes("weak_copy_filler_phrase"));
  assert.ok(codes.includes("weak_copy_too_long"));
});

test("detectWeakMarketingCopyReasonCodes: genuinely valid self-purchase copy reports no weak-copy sub-codes at all", () => {
  const codes = detectWeakMarketingCopyReasonCodes(
    "Give me a cute post about buying yourself flowers",
    "You don't need a special occasion to bring flowers home — sometimes wanting them is reason enough.",
    { shopName: "Lilies in Bloom", audience: "self_purchase" }
  );
  assert.deepEqual(codes, []);
});

test("evaluateMarketingOutput: an invented temporal claim and a weak-copy filler phrase in the SAME candidate are both reported, independently, in their own reasonCodes arrays", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Give me a cute post about buying yourself flowers",
    shopEvidence: { name: "Lilies in Bloom" },
    canonicalConcept: { audience: "self_purchase" },
    candidate: { headline: null, body: "Self-care Sunday is here. We understand the importance of treating yourself well.", cta: "" },
    component: "caption"
  });
  assert.ok(result.reasonCodes.includes("invented_temporal_claim"), "the top-level reasonCodes must still report the temporal-safety hit");
  assert.ok(result.reasonCodes.includes("weak_marketing_copy"), "the top-level reasonCodes must still report the coarse weak-copy hit, unchanged");
  assert.ok(result.weakCopyReasonCodes.includes("weak_copy_filler_phrase"), "the new fine-grained array must identify the specific weak-copy check that fired");
  assert.doesNotMatch(result.safeCandidate.body, /Sunday/);
});
