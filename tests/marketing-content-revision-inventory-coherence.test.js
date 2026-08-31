import test from "node:test";
import assert from "node:assert/strict";
import {
  detectUnverifiedInventoryStateClaim,
  stripUnverifiedInventoryClaims,
  detectConceptCoherenceMismatch,
  requestSignalsRealPromotion,
  BEREAVEMENT_CONTEXT_RE
} from "../netlify/functions/_shared/marketing-content-revision.js";

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
