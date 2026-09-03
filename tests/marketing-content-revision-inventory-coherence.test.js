import test from "node:test";
import assert from "node:assert/strict";
import {
  detectUnverifiedInventoryStateClaim,
  stripUnverifiedInventoryClaims,
  detectUnverifiedServiceAvailabilityClaim,
  stripUnverifiedServiceAvailabilityClaims,
  detectConceptCoherenceMismatch,
  requestSignalsRealPromotion,
  requestSignalsIntentionalInventoryUse,
  sanitizeUngroundedFlowerNames,
  evaluateMarketingOutput,
  BEREAVEMENT_CONTEXT_RE
} from "../netlify/functions/_shared/marketing-content-revision.js";
import { loadGroundedInventory, buildInventoryGroundingBrief } from "../netlify/functions/_shared/marketing-inventory-grounding.js";

/**
 * Phase 3 live acceptance-test fix. Real, live-found failure (real
 * Cloudflare provider, real "Lilies in Bloom" shop, zero real inventory
 * rows on file): "Create today's Facebook post" produced a caption
 * claiming "our latest shipment of gorgeous Freedom roses" and a flyer
 * independently claiming sympathy/funeral work ("Thinking of You...
 * standing spray or casket flowers") — two invented claims (a fabricated
 * shipment/variety, and an invented occasion) from a single generic
 * request. These tests cover the deterministic detectors built to catch
 * both, per the forensic trace's approved fix plan.
 */

// ---------------------------------------------------------------------------
// detectUnverifiedInventoryStateClaim / stripUnverifiedInventoryClaims
// ---------------------------------------------------------------------------

test("REGRESSION A: the exact live failure — a bare business-state claim with a specific invented flower, empty inventory, generic request — is caught", () => {
  const violations = detectUnverifiedInventoryStateClaim({
    generatedText:
      "We're thrilled to welcome our latest shipment of gorgeous Freedom roses to the studio! Our expert florists are busy crafting stunning arrangements featuring these beautiful blooms, paired with delicate Leatherleaf ferns and vibrant alstroemeria.",
    requestText: "Create today's Facebook post",
    verifiedFlowerNames: []
  });
  assert.ok(violations.length > 0, "the invented shipment/variety claim must be caught");
  assert.match(violations[0], /latest shipment/i);
});

test("REGRESSION B: an empty-inventory shop is never told to claim it's OUT of stock either — that's an equally invented business-state claim in the other direction", () => {
  // The fix is "no verified claim either way," not "assume the worst" —
  // detectUnverifiedInventoryStateClaim only flags a POSITIVE claim of
  // stock/shipment; it must never be interpreted as licensing an
  // "out of stock" claim, which this function was never asked to produce
  // and never should.
  const violations = detectUnverifiedInventoryStateClaim({
    generatedText: "We are out of stock and have no flowers available right now.",
    requestText: "Create today's Facebook post",
    verifiedFlowerNames: []
  });
  assert.deepEqual(violations, [], "an 'out of stock' claim isn't a current-stock claim this detector targets — it's a separate, equally unsupported claim the prompt itself must never invite either way");
});

test("SAFE: generic flower language never trips this — 'fresh flowers can brighten someone's day' and similar", () => {
  for (const text of [
    "Fresh flowers can brighten someone's day.",
    "Send someone a little beauty today.",
    "Nothing says thank you like a beautiful bouquet.",
    "Our roses are looking gorgeous today." // a bare possessive opinion, no availability verb
  ]) {
    const violations = detectUnverifiedInventoryStateClaim({ generatedText: text, requestText: "Create today's Facebook post", verifiedFlowerNames: [] });
    assert.deepEqual(violations, [], `must never flag generic language: "${text}"`);
  }
});

test("NOT SAFE: Ashley's own exact worked examples of unverified current-stock claims", () => {
  for (const text of [
    "We have Freedom roses.",
    "Our alstroemeria just arrived.",
    "We're featuring fresh peonies today.",
    "Back in stock: ranunculus."
  ]) {
    const violations = detectUnverifiedInventoryStateClaim({ generatedText: text, requestText: "Create today's Facebook post", verifiedFlowerNames: [] });
    assert.ok(violations.length > 0, `must flag: "${text}"`);
  }
});

test("EVIDENCE (real inventory): a named flower that IS on the shop's real, verified inventory is never flagged", () => {
  const violations = detectUnverifiedInventoryStateClaim({
    generatedText: "We have Garden Roses in the shop this week.",
    requestText: "Create today's Facebook post",
    verifiedFlowerNames: ["Garden Rose"]
  });
  assert.deepEqual(violations, []);
});

test("REGRESSION G: an explicit florist-supplied fact licenses the exact same claim, even with different exact wording", () => {
  // 'I have 40 roses I need to sell' -> 'Fresh Roses Just Arrived!' is a
  // reasonable creative embellishment of a REAL supplied fact, not an
  // invention — the real live regression this fix's first draft caused
  // and had to be corrected for.
  const violations = detectUnverifiedInventoryStateClaim({
    generatedText: "Fresh Roses Just Arrived! We've got 40 gorgeous fresh roses ready for their forever vase.",
    requestText: "I have 40 roses I need to sell — a bright, romantic bouquet post for Facebook",
    verifiedFlowerNames: []
  });
  assert.deepEqual(violations, [], "a flower the florist's own request named/quantified must never be flagged, even if the model's exact claim-verb differs");
});

test("REGRESSION G (explicit shipment fact): 'We just received 50 red roses. Make a post.' licenses the model repeating that exact supplied fact", () => {
  const violations = detectUnverifiedInventoryStateClaim({
    generatedText: "We just received 50 gorgeous red roses! Stop by today to see them.",
    requestText: "We just received 50 red roses. Make a post.",
    verifiedFlowerNames: []
  });
  assert.deepEqual(violations, []);
});

test("REGRESSION F: an educational/general request about a named flower is never flagged just for discussing it (no current-stock claim is made)", () => {
  const violations = detectUnverifiedInventoryStateClaim({
    generatedText: "Roses have long symbolized love and devotion — a rose's color even carries its own meaning, from passionate red to friendship's yellow.",
    requestText: "Make an educational post about roses",
    verifiedFlowerNames: []
  });
  assert.deepEqual(violations, [], "discussing a flower educationally, with no claim the shop currently has it, must never be flagged");
});

test("a bare state-claim with no flower name at all still requires the request to supply an equivalent fact", () => {
  const violations = detectUnverifiedInventoryStateClaim({
    generatedText: "Our latest shipment just arrived — come see what's new!",
    requestText: "Create today's Facebook post",
    verifiedFlowerNames: []
  });
  assert.ok(violations.length > 0);
});

test("stripUnverifiedInventoryClaims removes only the offending sentence, keeping the rest of the copy intact", () => {
  const result = stripUnverifiedInventoryClaims({
    generatedText: "Happy Monday! Our latest shipment of Freedom roses just arrived. Stop by and see us today.",
    requestText: "Create today's Facebook post",
    verifiedFlowerNames: []
  });
  assert.ok(result.removed.length > 0);
  assert.doesNotMatch(result.text, /Freedom roses/);
  assert.match(result.text, /Happy Monday/);
  assert.match(result.text, /Stop by and see us today/);
});

test("stripUnverifiedInventoryClaims is a no-op when nothing is flagged", () => {
  const original = "Send someone a little beauty today.";
  const result = stripUnverifiedInventoryClaims({ generatedText: original, requestText: "x", verifiedFlowerNames: [] });
  assert.equal(result.text, original);
  assert.deepEqual(result.removed, []);
});

// ---------------------------------------------------------------------------
// requestSignalsRealPromotion (objective validation, requirement 9-I)
// ---------------------------------------------------------------------------

test("requestSignalsRealPromotion: a real discount/sale request is recognized", () => {
  assert.equal(requestSignalsRealPromotion("20% off all bouquets this weekend"), true);
  assert.equal(requestSignalsRealPromotion("Special offer for Mother's Day"), true);
});

test("REGRESSION I: a generic request with no real promotion signal is NOT a promotion", () => {
  assert.equal(requestSignalsRealPromotion("Create today's Facebook post"), false);
  assert.equal(requestSignalsRealPromotion("I have 40 roses I need to sell"), false);
});

// ---------------------------------------------------------------------------
// detectConceptCoherenceMismatch (the "one concept" contract, requirement 7)
// ---------------------------------------------------------------------------

test("REGRESSION H: the exact live failure shape — sympathy flyer + non-sympathy caption — is caught", () => {
  const mismatch = detectConceptCoherenceMismatch({
    concept: { objective: "seasonal_occasion", isSympathy: false },
    captionText: "We're thrilled to welcome our latest shipment of gorgeous roses to the studio!",
    flyerText: "Thinking of You. Our team is here to help you create a lovely standing spray or casket flowers for the service.",
    requestText: "Create today's Facebook post"
  });
  assert.ok(mismatch, "a sympathy flyer paired with a non-sympathy caption must be flagged");
  assert.match(mismatch, /sympathy/i);
});

test("REGRESSION D: a genuine sympathy request producing sympathy language on BOTH sides is never flagged — no false positive on real sympathy work", () => {
  const mismatch = detectConceptCoherenceMismatch({
    concept: { objective: "awareness", isSympathy: true },
    captionText: "With deepest sympathy — our thoughts are with the Smith family. We're honored to help with flowers for the service.",
    flyerText: "In Loving Memory. Standing sprays and casket flowers, made with care for the Smith family.",
    requestText: "Flowers for the Smith family, they just lost their dad"
  });
  assert.equal(mismatch, null, "a genuinely sympathy request must never be flagged just for having sympathy language on both sides");
});

test("operational objective + celebratory/promotional flyer copy is flagged", () => {
  const mismatch = detectConceptCoherenceMismatch({
    concept: { objective: "operational", isSympathy: false },
    captionText: "Closing at 2:30 today.",
    flyerText: "We're SO excited to celebrate with you — don't miss this amazing 20% off sale!",
    requestText: "We're closing at 2:30 today"
  });
  assert.ok(mismatch, "an operational notice must never pair with celebratory/promotional flyer language");
});

test("REGRESSION I (coherence side): a 'promotion' objective with no real promotion evidence in the request is flagged", () => {
  const mismatch = detectConceptCoherenceMismatch({
    concept: { objective: "promotion", isSympathy: false },
    captionText: "Fresh flowers can brighten someone's day.",
    flyerText: "Send someone a little beauty today.",
    requestText: "Create today's Facebook post"
  });
  assert.ok(mismatch, "a promotion objective must be supported by a real sale/discount in the request");
  assert.match(mismatch, /promotion/i);
});

test("a real promotion objective WITH real evidence in the request is never flagged", () => {
  const mismatch = detectConceptCoherenceMismatch({
    concept: { objective: "promotion", isSympathy: false },
    captionText: "20% off all bouquets this weekend only!",
    flyerText: "Save 20% this weekend — treat yourself or someone special.",
    requestText: "20% off all bouquets this weekend"
  });
  assert.equal(mismatch, null);
});

test("named-flower subject mismatch: caption and flyer naming completely different flowers is flagged", () => {
  const mismatch = detectConceptCoherenceMismatch({
    concept: { objective: "awareness", isSympathy: false },
    captionText: "Our garden roses are looking gorgeous this week.",
    flyerText: "Beautiful tulips, fresh for spring.",
    requestText: "Create today's Facebook post"
  });
  assert.ok(mismatch, "two sides naming entirely different flowers must be flagged");
});

test("named-flower check never fires when only ONE side names a specific flower — that's common and fine", () => {
  const mismatch = detectConceptCoherenceMismatch({
    concept: { objective: "awareness", isSympathy: false },
    captionText: "Our garden roses are looking gorgeous this week.",
    flyerText: "Stop by and see us today.",
    requestText: "Create today's Facebook post"
  });
  assert.equal(mismatch, null);
});

test("REGRESSION H: an ordinary, coherent post (both sides agree) is never flagged", () => {
  const mismatch = detectConceptCoherenceMismatch({
    concept: { objective: "seasonal_occasion", isSympathy: false },
    captionText: "Our spring tulips just make us so happy — come see them in person!",
    flyerText: "Fresh Spring Tulips. Stop by the shop today.",
    requestText: "Post about our spring tulips"
  });
  assert.equal(mismatch, null);
});

// ---------------------------------------------------------------------------
// Phase 3 FINAL SAFETY PATCH: present-tense business use/availability
// claims ("we're crafting with X," "our bouquets feature X," "using X")
// require the same evidence as an explicit state-claim ("just arrived,"
// "back in stock") — the real staging re-test's own observed output
// (empty verified inventory) survived the first fix because the model
// never used one of the previously-recognized claim verbs.
// ---------------------------------------------------------------------------

test("REGRESSION (staging re-test, exact observed flyer sentence): a present-tense 'crafting arrangements using X' claim with an unverified flower is caught even with no 'we have'/'just arrived' wording at all", () => {
  const violations = detectUnverifiedInventoryStateClaim({
    generatedText:
      "Our expert florists are busy crafting stunning arrangements using a mix of fresh flowers, including peonies, alstroemeria, and spray roses.",
    requestText: "Create today's Facebook post",
    verifiedFlowerNames: []
  });
  assert.ok(violations.length > 0, "a present-tense composition claim naming unverified flowers must be caught");
  assert.match(violations[0], /peonies|alstroemeria|spray roses/i);
});

test("REGRESSION (staging re-test, exact observed caption sentence): the caption's own present-tense variant of the same claim is caught", () => {
  const violations = detectUnverifiedInventoryStateClaim({
    generatedText:
      "Our expert florists are busy crafting stunning arrangements using a mix of fresh peonies, delicate alstroemeria, and vibrant spray roses.",
    requestText: "Create today's Facebook post",
    verifiedFlowerNames: []
  });
  assert.ok(violations.length > 0);
});

test("NOT SAFE (staging re-test's exact required examples): present-tense business-use/availability claims naming a specific flower all require evidence", () => {
  for (const text of [
    "We're crafting arrangements with peonies today.",
    "Our bouquets feature spray roses.",
    "We have alstroemeria available.",
    "We're using fresh hydrangeas this week."
  ]) {
    const violations = detectUnverifiedInventoryStateClaim({ generatedText: text, requestText: "Create today's Facebook post", verifiedFlowerNames: [] });
    assert.ok(violations.length > 0, `must flag: "${text}"`);
  }
});

test("SAFE (unchanged): generic/educational flower language is never flagged by the broadened business-use verbs either", () => {
  for (const text of [
    "Roses are a classic choice for anniversaries.",
    "Peonies have a soft, romantic look.",
    "Fresh flowers can brighten someone's day.",
    "Our roses are looking gorgeous today."
  ]) {
    const violations = detectUnverifiedInventoryStateClaim({ generatedText: text, requestText: "Create today's Facebook post", verifiedFlowerNames: [] });
    assert.deepEqual(violations, [], `must never flag: "${text}"`);
  }
});

test("SAFE (unchanged): REGRESSION F's educational sentence with an incidental, unrelated 'carries' is still never flagged by the broadened verbs", () => {
  // 'a rose's color even carries its own meaning' contains 'carries', but
  // in a completely unrelated sense (not a business stock claim) — the
  // broadened business-use verb set deliberately excludes bare
  // 'carries'/'carry'/'have'/'has' for exactly this reason.
  const violations = detectUnverifiedInventoryStateClaim({
    generatedText:
      "Roses have long symbolized love and devotion — a rose's color even carries its own meaning, from passionate red to friendship's yellow.",
    requestText: "Make an educational post about roses",
    verifiedFlowerNames: []
  });
  assert.deepEqual(violations, []);
});

test("EVIDENCE: a present-tense use claim naming a flower that IS verified is never flagged", () => {
  const violations = detectUnverifiedInventoryStateClaim({
    generatedText: "Our expert florists are crafting arrangements using fresh garden roses this week.",
    requestText: "Create today's Facebook post",
    verifiedFlowerNames: ["Garden Rose"]
  });
  assert.deepEqual(violations, []);
});

test("stripUnverifiedInventoryClaims removes the exact observed staging-failure sentence, keeping the rest intact", () => {
  const result = stripUnverifiedInventoryClaims({
    generatedText:
      "Happy Tuesday! Our expert florists are busy crafting stunning arrangements using a mix of fresh flowers, including peonies, alstroemeria, and spray roses. Stop by today.",
    requestText: "Create today's Facebook post",
    verifiedFlowerNames: []
  });
  assert.ok(result.removed.length > 0);
  assert.doesNotMatch(result.text, /peonies|alstroemeria|spray roses/i);
  assert.match(result.text, /Happy Tuesday/);
  assert.match(result.text, /Stop by today/);
});

// ---------------------------------------------------------------------------
// requestSignalsIntentionalInventoryUse (product rule: verified inventory
// alone is never a license to name a flower — the request must actually
// signal this post is meant to be inventory-driven)
// ---------------------------------------------------------------------------

test("requestSignalsIntentionalInventoryUse: a generic request never signals inventory intent", () => {
  assert.equal(requestSignalsIntentionalInventoryUse("Create today's Facebook post"), false);
});

test("requestSignalsIntentionalInventoryUse: 'promote something I actually have in stock' signals real inventory intent", () => {
  assert.equal(requestSignalsIntentionalInventoryUse("Promote something I actually have in stock."), true);
});

test("requestSignalsIntentionalInventoryUse: explicit possession ('I have 40 roses') signals real inventory intent", () => {
  assert.equal(requestSignalsIntentionalInventoryUse("I have 40 roses I need to sell"), true);
});

// ---------------------------------------------------------------------------
// sanitizeUngroundedFlowerNames (product rule: Lily must not independently
// choose/name a specific flower species in creative_brief.primary_subject
// or visual_brief unless the florist named it or verified inventory
// supports it AND the request signals real inventory intent)
// ---------------------------------------------------------------------------

test("sanitizeUngroundedFlowerNames: an ungrounded named flower is replaced with generic wording, nothing invented in its place", () => {
  const result = sanitizeUngroundedFlowerNames({
    text: "A romantic arrangement of garden roses on a marble counter.",
    requestText: "Create today's Facebook post",
    verifiedFlowerNames: []
  });
  assert.deepEqual(result.removed.map((r) => r.toLowerCase()), ["garden roses"]);
  assert.doesNotMatch(result.text, /garden roses/i);
  assert.match(result.text, /arrangement of flowers/i);
});

test("sanitizeUngroundedFlowerNames: 'Make a post about pink roses' — the florist's own request names roses, so roses are allowed", () => {
  const result = sanitizeUngroundedFlowerNames({
    text: "A romantic arrangement of pink roses on a marble counter.",
    requestText: "Make a post about pink roses.",
    verifiedFlowerNames: []
  });
  assert.deepEqual(result.removed, []);
  assert.match(result.text, /pink roses/i);
});

test("sanitizeUngroundedFlowerNames: verified inventory alone (no inventory-intent request) never licenses a flower name", () => {
  const result = sanitizeUngroundedFlowerNames({
    text: "A cheerful arrangement of garden roses for a general awareness post.",
    requestText: "Create a fun post for our page",
    verifiedFlowerNames: ["Garden Rose"],
    inventoryIntentConfirmed: false
  });
  assert.ok(result.removed.length > 0, "verified stock is not itself a license to name it in an unrelated post");
  assert.doesNotMatch(result.text, /garden roses/i);
});

test("sanitizeUngroundedFlowerNames: verified inventory WITH real inventory-driven intent licenses the flower name", () => {
  const result = sanitizeUngroundedFlowerNames({
    text: "A cheerful arrangement of garden roses.",
    requestText: "Promote something I actually have in stock.",
    verifiedFlowerNames: ["Garden Rose"],
    inventoryIntentConfirmed: true
  });
  assert.deepEqual(result.removed, []);
  assert.match(result.text, /garden roses/i);
});

test("sanitizeUngroundedFlowerNames: a no-op when nothing is ungrounded", () => {
  const original = "A lush arrangement of mixed fresh flowers on a marble counter.";
  const result = sanitizeUngroundedFlowerNames({ text: original, requestText: "Create today's Facebook post", verifiedFlowerNames: [] });
  assert.equal(result.text, original);
  assert.deepEqual(result.removed, []);
});

// ---------------------------------------------------------------------------
// Batch 1 (Hybrid Marketing Studio prep), Part 2 — detectUnverifiedService
// AvailabilityClaim / stripUnverifiedServiceAvailabilityClaims
//
// The architecture audit found no detector for invented service/business-
// state claims like "same-day delivery" or "open now" — only shipment/
// restock-shaped language (detectUnverifiedInventoryStateClaim, above)
// was covered. These tests reproduce the exact live-observed failure
// (a flyer CTA fixture that generated a same-day-delivery claim from
// nothing but a real phone number) and pin the new detector's behavior.
// ---------------------------------------------------------------------------

test("REGRESSION B: the exact fixture failure — 'CALL 606-506-4039 FOR SAME-DAY DELIVERY.' is rejected with no evidence", () => {
  const violations = detectUnverifiedServiceAvailabilityClaim({
    generatedText: "CALL 606-506-4039 FOR SAME-DAY DELIVERY.",
    requestText: "Create today's Facebook post for Lilies in Bloom",
    verifiedServiceSignals: []
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /SAME-DAY DELIVERY/i);
});

test("detectUnverifiedServiceAvailabilityClaim: SUPPORTED — the florist's own request explicitly says same-day delivery", () => {
  const violations = detectUnverifiedServiceAvailabilityClaim({
    generatedText: "Call 606-506-4039 for same-day delivery on all orders placed before noon.",
    requestText: "Make a post letting people know we offer same-day delivery.",
    verifiedServiceSignals: []
  });
  assert.deepEqual(violations, []);
});

test("detectUnverifiedServiceAvailabilityClaim: SUPPORTED — a verified shop-configuration signal (future source, empty today) licenses the claim", () => {
  const violations = detectUnverifiedServiceAvailabilityClaim({
    generatedText: "Same-day delivery is available for local orders.",
    requestText: "Create a general post",
    verifiedServiceSignals: ["same-day delivery"]
  });
  assert.deepEqual(violations, []);
});

test("detectUnverifiedServiceAvailabilityClaim: catches 'open now'/'open today' with no evidence", () => {
  const violations = detectUnverifiedServiceAvailabilityClaim({
    generatedText: "We're open now, come on by!",
    requestText: "Create a fun post for our page"
  });
  assert.equal(violations.length, 1);
});

test("detectUnverifiedServiceAvailabilityClaim: catches 'walk-ins welcome' with no evidence", () => {
  const violations = detectUnverifiedServiceAvailabilityClaim({
    generatedText: "Walk-ins welcome all week long.",
    requestText: "Create a fun post for our page"
  });
  assert.equal(violations.length, 1);
});

test("detectUnverifiedServiceAvailabilityClaim: never over-blocks ordinary copy with no actual service-state claim", () => {
  const safe = [
    "Fresh flowers can brighten someone's day.",
    "Order today and make someone smile.",
    "Call us for a free consultation.",
    "Our doors are always open to new ideas.",
    "Send someone a little beauty today.",
    // Batch 1 independent-review finding: an earlier draft of
    // SERVICE_AVAILABILITY_SIGNAL_RE matched bare "available (now|today)"
    // / "ready (now|today)" regardless of what they were describing —
    // these are real, ordinary PRODUCT-availability marketing sentences,
    // never a service/delivery/pickup claim, and must never be flagged.
    "Peonies are available now while supplies last.",
    "Our tulips are available now for a limited time.",
    "Get your flowers ready now for the big day.",
    "Fresh, seasonal blooms are ready for pickup today."
  ];
  for (const text of safe) {
    const violations = detectUnverifiedServiceAvailabilityClaim({ generatedText: text, requestText: "Create a fun post" });
    assert.deepEqual(violations, [], `should not flag: "${text}"`);
  }
});

test("detectUnverifiedServiceAvailabilityClaim: still catches a real service-availability claim anchored to delivery/pickup/order, not just any 'available'/'ready'", () => {
  const unsafe = [
    "Pickup is available now.",
    "Delivery is available today.",
    "Your order is ready today, come pick it up!"
  ];
  for (const text of unsafe) {
    const violations = detectUnverifiedServiceAvailabilityClaim({ generatedText: text, requestText: "Create a fun post" });
    assert.equal(violations.length, 1, `should flag: "${text}"`);
  }
});

test("stripUnverifiedServiceAvailabilityClaims: removes only the offending sentence, keeps the rest", () => {
  const result = stripUnverifiedServiceAvailabilityClaims({
    generatedText: "Beautiful blooms for every occasion. Call 606-506-4039 for same-day delivery.",
    requestText: "Create today's Facebook post"
  });
  assert.equal(result.removed.length, 1);
  assert.doesNotMatch(result.text, /same-day delivery/i);
  assert.match(result.text, /Beautiful blooms/);
});

test("evaluateMarketingOutput: the exact fixture CTA is rejected/repaired through the real authoritative safety path, not a parallel evaluator", () => {
  const outcome = evaluateMarketingOutput({
    request: "Create today's Facebook post for Lilies in Bloom",
    shopEvidence: { name: "Lilies in Bloom", phone: "606-506-4039" },
    inventoryEvidence: [],
    candidate: { headline: "Beautiful Blooms", body: "Fresh arrangements for every occasion.", cta: "CALL 606-506-4039 FOR SAME-DAY DELIVERY." },
    component: "flyer_text"
  });
  assert.ok(outcome.checksRun.includes("detectUnverifiedServiceAvailabilityClaim"));
  assert.notEqual(outcome.decision, "pass");
  assert.ok(outcome.reasons.some((r) => /same-day delivery/i.test(r)) || (outcome.repaired && !/same-day delivery/i.test(outcome.safeCandidate.cta || "")));
});

// ---------------------------------------------------------------------------
// Batch 1, Part 3 — pin "unknown inventory" semantics (never "out of stock")
// ---------------------------------------------------------------------------

function fakeInventoryQueryClient(rows) {
  const query = {
    select() { return query; },
    eq() { return query; },
    is() { return query; },
    gt() { return query; },
    order() { return query; },
    limit() { return query; },
    data: rows,
    error: null
  };
  return { from: () => query };
}

test("Part 3 pin: zero real inventory rows returns items:[] (unknown), never an 'out of stock' marker anywhere in the result", async () => {
  const client = fakeInventoryQueryClient([]);
  const result = await loadGroundedInventory(client, "shop-1");
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, []);
  assert.equal(JSON.stringify(result).toLowerCase().includes("out of stock"), false);
});

test("Part 3 pin: buildInventoryGroundingBrief([]) is honestly 'not grounded' — never asserted as verified zero stock", () => {
  const brief = buildInventoryGroundingBrief([]);
  assert.equal(brief.grounded, false);
  assert.equal(brief.summaryText, null);
  assert.deepEqual(brief.sources, []);
});

test("Part 3 pin: a real query error also degrades to items:[] (unknown/unavailable-to-check), never a fabricated stock claim", async () => {
  const client = { from: () => ({ select() { return this; }, eq() { return this; }, is() { return this; }, gt() { return this; }, order() { return this; }, limit() { return this; }, data: null, error: { message: "connection reset" } }) };
  const result = await loadGroundedInventory(client, "shop-1");
  assert.equal(result.ok, false);
  assert.deepEqual(result.items, []);
});
