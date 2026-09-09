import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalConcept, classifyMessageIntent, classifyUserTemporalIntent, classifyAudience } from "../netlify/functions/_shared/marketing-canonical-concept.js";
import {
  requestNeedsFlyerWording,
  buildDeterministicCreativeRescueContent,
  detectUnverifiedServiceAvailabilityClaim,
  stripUnverifiedServiceAvailabilityClaims,
  detectInventedTemporalClaim
} from "../netlify/functions/_shared/marketing-content-revision.js";
import { buildDeterministicCreativeDirection, validateCreativeDirection } from "../netlify/functions/_shared/marketing-creative-direction.js";
import { routeMarketingEngine, ENGINES } from "../netlify/functions/_shared/marketing-engine-router.js";

// Test C ("everyday social creative architecture fix") — the real,
// live-found gap this batch closes: "Create a Facebook post encouraging
// people to send flowers today" classified correctly (occasionCategory
// "general", creativeMode "everyday_floral") but still got the full
// designed-flyer treatment on-image (forced headline/CTA/phone block)
// purely because everyday_floral had no photoStrategy-aware structural
// carve-out the way sympathy_elegance/personal_celebration already do,
// AND its deterministic rescue had no signal capable of preserving the
// ordinary "send flowers"/"today" intent, falling back to the same fully
// generic "moments that matter... brighten someone's day" wording every
// unclassified request produced.

const SHOP = { shopName: "Lilies in Bloom", shopPhone: "6065064039" };

function concept(requestText, overrides = {}) {
  return buildCanonicalConcept({
    requestText,
    occasionTitle: requestText,
    platform: "facebook",
    contentType: "image_post",
    assetType: "flyer",
    objective: "awareness",
    photoStrategy: "subject_forward",
    styleTier: "generated",
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// Part 1/6: subject-forward structural behavior — must NOT automatically
// become a flyer.
// ---------------------------------------------------------------------------

const ORDINARY_SUBJECT_FORWARD_REQUESTS = [
  "Create a Facebook post encouraging people to send flowers today.",
  "Send someone flowers today.",
  "Brighten someone's day with flowers.",
  "Create a cute everyday flower post."
];

for (const requestText of ORDINARY_SUBJECT_FORWARD_REQUESTS) {
  test(`subject-forward structural behavior: "${requestText}" stays a photo-forward social post, never an automatic flyer`, () => {
    const c = concept(requestText);
    assert.equal(requestNeedsFlyerWording(requestText), false, "an ordinary everyday social request never needs exact graphic wording");

    const routed = routeMarketingEngine({ canonicalConcept: c });
    assert.equal(routed.engine, ENGINES.PREMIUM_AI_CREATIVE, "subject-forward Premium Creative eligible, exactly like any other ordinary occasion");

    const direction = buildDeterministicCreativeDirection({ canonicalConcept: c, shopBrand: {} });
    assert.equal(direction.occasionTreatment, "photo_forward_social");
    assert.equal(direction.graphicTextSlots.headline, false, "no automatic headline");
    assert.equal(direction.graphicTextSlots.brand, false, "no automatic brand overlay");
    assert.equal(direction.graphicTextSlots.phone, false, "no automatic phone");
    assert.equal(direction.graphicTextSlots.cta, false, "no automatic CTA block");
    assert.equal(direction.graphicTextSlots.supportingLine, false);
    assert.equal(direction.graphicTextSlots.serviceDetail, false);
    assert.equal(direction.bannerStyle, "none", "no flyer banner");
    // Everyday floral mood preserved — warm/inviting/tasteful, never the
    // family's own brighter/more playful bare default, and never a
    // celebratory/promotional mood invented from nothing.
    assert.equal(direction.visualMood, "warm_inviting");
    assert.equal(direction.paletteMood, "classic_brand");

    const { valid, errors } = validateCreativeDirection(direction, { canonicalConcept: c });
    assert.equal(valid, true, `must already be fully valid: ${errors.join("; ")}`);
  });
}

// ---------------------------------------------------------------------------
// Part 6: exact-layout controls — must still remain exact-layout. Real
// flyer/poster/fact-heavy requests never reach the subject-forward
// structural switch at all; requestNeedsFlyerWording() rules them out of
// that branch entirely, upstream, unaffected by this batch.
// ---------------------------------------------------------------------------

const EXACT_LAYOUT_REQUESTS = [
  "Make a flyer for 20% off bouquets today.",
  "Create a poster that says Order Homecoming Flowers by September 15.",
  "Let customers know we close at 2 PM today.",
  "Make an ad with our phone number and address."
];

for (const requestText of EXACT_LAYOUT_REQUESTS) {
  test(`exact-layout control: "${requestText}" still requires exact graphic wording, unaffected by the subject-forward fix`, () => {
    assert.equal(requestNeedsFlyerWording(requestText), true);
  });
}

// A genuine everyday flyer (calm_backdrop — real exact-wording need)
// keeps the full designed-flyer treatment, completely unaffected by the
// subject-forward switch above — proves the fix is structural-presentation
// only, never a weakening of when exact layout is actually required.
test("a genuine everyday flyer request (calm_backdrop) keeps the full designed-flyer treatment", () => {
  const c = concept("Create today's Facebook post for Lilies in Bloom", { photoStrategy: "calm_backdrop" });
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: c, shopBrand: {} });
  assert.equal(direction.occasionTreatment, "everyday_floral");
  assert.equal(direction.graphicTextSlots.headline, true);
  assert.equal(direction.graphicTextSlots.supportingLine, true);
});

// ---------------------------------------------------------------------------
// Part 6: message-intent classification — must not collapse into the same
// signal. "send flowers" and "send flowers today" deliberately share the
// SAME messageIntent (send_flowers is a message shape, independent of
// temporal framing) but are distinguished by the separate
// userTemporalIntent signal — the two together never collapse into one
// tuple shared with self_purchase/brighten_day/generic.
// ---------------------------------------------------------------------------

test("message-intent classification: send flowers / send flowers today / self purchase / brighten someone's day / generic everyday resolve to distinct (messageIntent, userTemporalIntent) signals", () => {
  const cases = [
    { text: "Send someone flowers.", expect: { messageIntent: "send_flowers", userTemporalIntent: null } },
    { text: "Send someone flowers today.", expect: { messageIntent: "send_flowers", userTemporalIntent: "today" } },
    { text: "Treat yourself to flowers today.", expect: { messageIntent: "self_purchase", userTemporalIntent: "today" } },
    { text: "Brighten someone's day with flowers.", expect: { messageIntent: "brighten_day", userTemporalIntent: null } },
    { text: "Create a cute everyday flower post.", expect: { messageIntent: "general_everyday", userTemporalIntent: null } }
  ];
  const seen = new Set();
  for (const { text, expect } of cases) {
    const audience = classifyAudience({ requestText: text });
    const messageIntent = classifyMessageIntent({ requestText: text, audience });
    const userTemporalIntent = classifyUserTemporalIntent({ requestText: text });
    assert.equal(messageIntent, expect.messageIntent, `messageIntent for "${text}"`);
    assert.equal(userTemporalIntent, expect.userTemporalIntent, `userTemporalIntent for "${text}"`);
    seen.add(`${messageIntent}|${userTemporalIntent}`);
  }
  assert.equal(seen.size, cases.length, "every case must produce a genuinely distinct combined signal");
});

test("self_purchase always wins over send_flowers/brighten_day even when the text also contains those words", () => {
  // "for yourself" is a self-purchase signal that could plausibly also
  // read as gifting language — self_purchase must still win, matching
  // this codebase's established self-purchase precedence everywhere else.
  const audience = classifyAudience({ requestText: "Buy flowers for yourself today, you deserve it." });
  assert.equal(audience, "self_purchase");
  assert.equal(classifyMessageIntent({ requestText: "Buy flowers for yourself today, you deserve it.", audience }), "self_purchase");
});

// ---------------------------------------------------------------------------
// Part 6: temporal safety — user-supplied "today" may survive into copy;
// unsupported business claims must still be rejected/stripped. Existing
// detectors (detectInventedTemporalClaim, detectUnverifiedServiceAvailability
// Claim) are completely UNMODIFIED in their own semantics — this batch only
// adds one narrow regex alternative to the latter (see below) to close a
// real gap found while verifying this exact requirement.
// ---------------------------------------------------------------------------

test("temporal safety: bare 'today' in generated copy is never treated as an invented temporal claim", () => {
  const requestText = "Send someone flowers today.";
  const violations = detectInventedTemporalClaim({ generatedText: "Send someone flowers today from Lilies in Bloom.", requestText });
  assert.deepEqual(violations, [], "today is self-referential, never a checkable invented claim — unchanged, pre-existing behavior");
});

test("temporal safety: unsupported same-day delivery / availability / order-cutoff claims are still detected and stripped even when the request itself supplied 'today'", () => {
  const requestText = "Send someone flowers today.";
  const unsafeCandidates = [
    "Same-day delivery available on every order.",
    "We can deliver today.",
    "We can deliver flowers today.",
    "Order by 2 PM for delivery today."
  ];
  for (const candidate of unsafeCandidates) {
    const violations = detectUnverifiedServiceAvailabilityClaim({ generatedText: candidate, requestText });
    assert.ok(violations.length > 0, `must flag: "${candidate}"`);
    const stripped = stripUnverifiedServiceAvailabilityClaims({ generatedText: candidate, requestText });
    assert.equal(stripped.text, "", `must strip the entire unsupported sentence: "${candidate}"`);
  }
});

test("temporal safety: ordinary product/CTA copy that merely mentions 'today'/'available'/'ready' near flowers is never falsely flagged", () => {
  const requestText = "Send someone flowers today.";
  const safeCandidates = [
    "Send someone flowers today from Lilies in Bloom.",
    "Peonies are available now while supplies last.",
    "Fresh blooms are ready for pickup today.",
    "Call 606-506-4039 to place an order."
  ];
  for (const candidate of safeCandidates) {
    assert.deepEqual(detectUnverifiedServiceAvailabilityClaim({ generatedText: candidate, requestText }), [], `must NOT flag: "${candidate}"`);
  }
});

// ---------------------------------------------------------------------------
// Part 6: rescue — force deterministic rescue across every required case.
// ---------------------------------------------------------------------------

test("rescue: everyday send_flowers + today preserves the message and the temporal framing, invents nothing", () => {
  const rescue = buildDeterministicCreativeRescueContent({
    ...SHOP,
    ctaIntent: "call_shop",
    audience: "general_local_customers",
    occasionCategory: "general",
    namedCampaign: "none",
    messageIntent: "send_flowers",
    userTemporalIntent: "today"
  });
  assert.match(rescue.body, /\bsend\b[\s\S]*\bflowers?\b/i);
  assert.match(rescue.body, /\btoday\b/i);
  assert.doesNotMatch(rescue.body, /same[\s-]?day|available|deliver|order by/i, "never invents a business fact");
});

test("rescue: everyday send_flowers without a temporal signal preserves the message, invents no day it wasn't given", () => {
  const rescue = buildDeterministicCreativeRescueContent({
    ...SHOP,
    ctaIntent: "call_shop",
    audience: "general_local_customers",
    occasionCategory: "general",
    namedCampaign: "none",
    messageIntent: "send_flowers",
    userTemporalIntent: null
  });
  assert.match(rescue.body, /\bsend\b[\s\S]*\bflowers?\b/i);
  assert.doesNotMatch(rescue.body, /\btoday\b|\btonight\b|\btomorrow\b/i, "no day invented when the request never supplied one");
});

test("rescue: brighten_day only ever fires when the florist's own request supplied that framing, and echoes it back honestly", () => {
  const rescue = buildDeterministicCreativeRescueContent({
    ...SHOP,
    ctaIntent: "call_shop",
    audience: "general_local_customers",
    occasionCategory: "general",
    namedCampaign: "none",
    messageIntent: "brighten_day",
    userTemporalIntent: null
  });
  assert.match(rescue.headline, /brighten/i);
  assert.match(rescue.body, /brighten.*day/i);
});

test("rescue: self_purchase remains byte-for-byte unchanged by this batch, regardless of messageIntent/userTemporalIntent being passed", () => {
  const withoutNewFields = buildDeterministicCreativeRescueContent({
    ...SHOP,
    ctaIntent: "call_shop",
    audience: "self_purchase",
    occasionCategory: "general",
    namedCampaign: "none"
  });
  const withNewFields = buildDeterministicCreativeRescueContent({
    ...SHOP,
    ctaIntent: "call_shop",
    audience: "self_purchase",
    occasionCategory: "general",
    namedCampaign: "none",
    messageIntent: "self_purchase",
    userTemporalIntent: "today"
  });
  assert.deepEqual(withNewFields, withoutNewFields, "self-purchase rescue must be completely unaffected by the new signals");
  assert.equal(withoutNewFields.headline, "Flowers, Just Because");
  assert.equal(withoutNewFields.body, "You don't need a reason to bring home flowers from Lilies in Bloom — sometimes wanting them is reason enough.");
});

test("rescue: Birthday remains occasion-aware, completely unaffected by the new messageIntent layer", () => {
  const rescue = buildDeterministicCreativeRescueContent({
    ...SHOP,
    ctaIntent: "call_shop",
    audience: "general_local_customers",
    occasionCategory: "birthday",
    namedCampaign: "birthday",
    messageIntent: "send_flowers",
    userTemporalIntent: "today"
  });
  assert.equal(rescue.headline, "Birthday Blooms, Ready to Celebrate");
  assert.equal(rescue.body, "Lilies in Bloom has birthday flowers ready to make someone's day feel special.");
});

test("rescue: Sympathy remains occasion-aware, completely unaffected by the new messageIntent layer", () => {
  const rescue = buildDeterministicCreativeRescueContent({
    ...SHOP,
    ctaIntent: "call_shop",
    audience: "funeral_families",
    occasionCategory: "sympathy",
    namedCampaign: "sympathy",
    messageIntent: "general_everyday",
    userTemporalIntent: null
  });
  assert.equal(rescue.headline, "Funeral & Sympathy Flowers");
  assert.equal(rescue.body, "Lilies in Bloom helps families choose funeral and sympathy flowers with care.");
});

test("rescue: generic/no message intent remains the safe, pre-existing generic fallback, unchanged", () => {
  const rescue = buildDeterministicCreativeRescueContent({
    ...SHOP,
    ctaIntent: "call_shop",
    audience: "general_local_customers",
    occasionCategory: "general",
    namedCampaign: "none",
    messageIntent: "general_everyday",
    userTemporalIntent: null
  });
  assert.equal(rescue.headline, "Beautiful Blooms, Thoughtfully Arranged");
  assert.equal(rescue.body, "Lilies in Bloom designs flowers for the moments that matter — a little something to brighten someone's day.");
});

test("rescue: calling buildDeterministicCreativeRescueContent with no messageIntent/userTemporalIntent at all (old call shape) behaves exactly as before this batch", () => {
  const rescue = buildDeterministicCreativeRescueContent({
    ...SHOP,
    ctaIntent: "call_shop",
    audience: "general_local_customers",
    occasionCategory: "general",
    namedCampaign: "none"
  });
  assert.equal(rescue.headline, "Beautiful Blooms, Thoughtfully Arranged");
  assert.equal(rescue.body, "Lilies in Bloom designs flowers for the moments that matter — a little something to brighten someone's day.");
});
