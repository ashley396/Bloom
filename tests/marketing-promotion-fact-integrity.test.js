import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  classifyPromotionFacts,
  buildCanonicalConcept,
  PROMOTION_FACTS_VERSION
} from "../netlify/functions/_shared/marketing-canonical-concept.js";
import {
  detectUnsupportedPromotionTerms,
  detectMissingPromotionOffer,
  stripUnsupportedPromotionTerms,
  fitCtaToLimit,
  buildDeterministicPromotionRescueContent,
  buildDeterministicCreativeRescueContent,
  buildDeterministicNoticeContent,
  normalizeDiscountWording,
  factsPreserved,
  evaluateMarketingOutput,
  buildCopyEvaluationDiagnostic,
  extractFactTokens,
  detectUnverifiedServiceAvailabilityClaim,
  detectInventedTemporalClaim,
  requestNeedsFlyerWording,
  PROMOTION_TERM_CODES
} from "../netlify/functions/_shared/marketing-content-revision.js";
import { _internalsForTesting, COPY_GUIDANCE_VERSION } from "../netlify/functions/_shared/ai-creative-engine.js";
import { GRAPHIC_TEXT_LIMITS_DEFAULT, buildDeterministicCreativeDirection, hasNoDrawableTextSlots } from "../netlify/functions/_shared/marketing-creative-direction.js";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// ---------------------------------------------------------------------------
// Test D — promotion fact-integrity + CTA layout (2026-09-14).
//
// The failed live run (item 4ac19c78, commit fb0cb39): for the exact prompt
// below the caption ended "Simply use code BLOOM20 at checkout to redeem
// your discount." and the on-image CTA read "Order online or call us at 20%
// off with code BLOOM20 this weekend!" — a coupon code, a checkout channel
// and an online-ordering channel the florist never supplied. Every detector
// passed both. The CTA was 65 characters against a 30-character contract and
// the renderer drew it anyway, overflowing into the contact line.
//
// This file proves: the structured promotion contract; the contract in
// both prompts (and no unverified sales-channel hint); the promotion-terms
// evaluator on caption AND flyer wording, blacklist plus contract
// comparison, with supplied/verified terms still allowed and "this weekend"
// still legal but never a delivery promise; the promotion rescue built only
// from the contract; the CTA contract enforced upstream and fail-safed in
// the renderer; the exact failed run end to end; and the untouched paths.
// ---------------------------------------------------------------------------

const SHOP = "Lilies in Bloom";
const PHONE = "606-506-4039";
const TEST_D_BRIEF = "Create a cute Facebook post for 20% off bouquets this weekend.";
const LIVE_CAPTION =
  "Treat someone special to a beautiful bouquet this weekend and enjoy 20% off! Whether it's a surprise for a loved one or a pick-me-up for a friend, our fresh flowers are the perfect way to show you care. Simply use code BLOOM20 at checkout to redeem your discount.";
const LIVE_FLYER = { headline: "20% Off Bouquets This Weekend", body: "", cta: "Order online or call us at 20% off with code BLOOM20 this weekend!" };
const CTA_LIMIT = GRAPHIC_TEXT_LIMITS_DEFAULT.ctaMaxChars;

const CONTRACT = classifyPromotionFacts({ requestText: TEST_D_BRIEF });
const CONCEPT = { audience: "general_local_customers", messageIntent: "general_everyday", promotionFacts: CONTRACT, ctaIntent: "call_shop" };
const SHOP_EVIDENCE = { name: SHOP, phone: PHONE };

function evalCaption(body, { concept = CONCEPT, request = TEST_D_BRIEF, isRetryAttempt = false } = {}) {
  return evaluateMarketingOutput({ route: "generate_content", request, shopEvidence: SHOP_EVIDENCE, canonicalConcept: concept, candidate: { headline: "", body, cta: "" }, component: "caption", isRetryAttempt });
}
function evalFlyer(candidate, { concept = CONCEPT, request = TEST_D_BRIEF, isRetryAttempt = false } = {}) {
  return evaluateMarketingOutput({ route: "generate_content", request, shopEvidence: SHOP_EVIDENCE, canonicalConcept: concept, candidate, component: "flyer_text", isRetryAttempt, graphicTextLimits: { ctaMaxChars: CTA_LIMIT } });
}
function codesOf(text, { contract = CONTRACT, request = TEST_D_BRIEF, verifiedCapabilities = null } = {}) {
  return detectUnsupportedPromotionTerms({ generatedText: text, requestText: request, promotionFacts: contract, verifiedCapabilities }).map((v) => v.code);
}

// ---------------------------------------------------------------------------
// Part 1 — the contract.
// ---------------------------------------------------------------------------

test("Part 1: the exact Test D prompt resolves to the promotion contract Ashley specified — 20% off / bouquets / this weekend / no code / no channel / no restrictions", () => {
  assert.deepEqual(CONTRACT, {
    version: PROMOTION_FACTS_VERSION,
    discount: { type: "percent", value: "20", text: "20% off" },
    product: "bouquets",
    timing: "this weekend",
    promoCode: null,
    redemptionChannel: null,
    restrictions: []
  });
  assert.equal(CONTRACT.restrictions.length, 0);
});

test("Part 1: supplied terms are captured verbatim — a code, an in-store channel, a dollar discount, restrictions — and a non-promotion has no contract at all", () => {
  const withCode = classifyPromotionFacts({ requestText: "Post about 15% off roses this week with code ROSE15." });
  assert.equal(withCode.discount.text, "15% off");
  assert.equal(withCode.product, "roses");
  assert.equal(withCode.timing, "this week");
  assert.equal(withCode.promoCode, "ROSE15");
  const amount = classifyPromotionFacts({ requestText: "$5 off any arrangement in store only, excludes weddings, while supplies last." });
  assert.deepEqual(amount.discount, { type: "amount", value: "5", text: "$5 off" });
  assert.equal(amount.product, "arrangement");
  assert.equal(amount.redemptionChannel, "in_store");
  assert.ok(amount.restrictions.some((r) => /excludes weddings/i.test(r)));
  assert.ok(amount.restrictions.some((r) => /while supplies last/i.test(r)));
  const bogo = classifyPromotionFacts({ requestText: "Buy one get one free on bouquets Saturday" });
  assert.equal(bogo.discount.type, "bogo");
  assert.equal(bogo.timing, "saturday");
  // Lowercase prose "code" is never a code; no code word → null.
  assert.equal(classifyPromotionFacts({ requestText: "20% off bouquets, our code word is kindness" }).promoCode, null);
  assert.equal(classifyPromotionFacts({ requestText: "Create a Facebook post encouraging people to send flowers today." }), null);
  assert.equal(classifyPromotionFacts({ requestText: "Create a birthday Facebook post for a friend turning 40." }), null);
});

test("Part 1: a verified online capability may establish the channel (trusted shop facts), the model never can", () => {
  const verified = classifyPromotionFacts({ requestText: TEST_D_BRIEF, verifiedCapabilities: { onlineOrdering: true } });
  assert.equal(verified.redemptionChannel, "online");
  const unverified = classifyPromotionFacts({ requestText: TEST_D_BRIEF, verifiedCapabilities: { onlineOrdering: false } });
  assert.equal(unverified.redemptionChannel, null);
});

test("Part 1: buildCanonicalConcept carries promotionFacts (null for a non-promotion) without touching any identity field", () => {
  const promo = buildCanonicalConcept({ requestText: TEST_D_BRIEF, occasionTitle: TEST_D_BRIEF, platform: "facebook", contentType: "image_post", assetType: "flyer", objective: "promotion" });
  assert.equal(promo.promotionIntent, "real_promotion");
  assert.deepEqual(promo.promotionFacts, CONTRACT);
  const plain = buildCanonicalConcept({ requestText: "Create a Facebook post encouraging people to send flowers today.", occasionTitle: "t", platform: "facebook", contentType: "image_post", assetType: "flyer", objective: "awareness" });
  assert.equal(plain.promotionFacts, null);
  assert.equal(plain.promotionIntent, "not_promotion");
});

test("Part 1: the discount phrase is a fact token, so revisions must keep it verbatim", () => {
  assert.deepEqual(extractFactTokens(TEST_D_BRIEF), ["20% off"]);
  assert.equal(factsPreserved("Take 20% off bouquets this weekend.", "This weekend every bouquet is 20% off at Lilies in Bloom."), true);
  assert.equal(factsPreserved("Take 20% off bouquets this weekend.", "This weekend every bouquet is 25% off at Lilies in Bloom."), false);
});

// ---------------------------------------------------------------------------
// Part 2 — generation grounding.
// ---------------------------------------------------------------------------

test("Part 2: both prompts carry the contract with every unsupplied term spelled out as NONE / do not invent; the flyer prompt no longer offers 'Order online' as an example CTA and states the CTA limit", () => {
  const { buildSocialPostTask, buildFlyerContentTask, promotionFactsLine } = _internalsForTesting;
  const line = promotionFactsLine(CONTRACT);
  assert.match(line, /PROMOTION CONTRACT/);
  assert.match(line, /Discount: "20% off" — state it EXACTLY/);
  assert.match(line, /Product scope: "bouquets"/);
  assert.match(line, /Timing: "this weekend" — promotion timing only; never a delivery/);
  assert.match(line, /Promo code: NONE — do NOT invent a code/);
  assert.match(line, /Redemption channel: NONE supplied or verified — do NOT mention online ordering, a website, 'at checkout'/);
  assert.match(line, /Restrictions: NONE — do NOT invent exclusions/);
  for (const banned of ["coupon/promo codes", '"at checkout"', "online ordering", "website redemption", "in-store-only", "minimum purchase", "buy-one-get-one", "free delivery", "limited quantities", '"while supplies last"', "exclusions", "expiration or specific dates", '"today only"', "same-day delivery", "additional discount"]) {
    assert.ok(line.includes(banned), `contract line must name: ${banned}`);
  }
  assert.equal(promotionFactsLine(null), "");

  const social = buildSocialPostTask({ channel: "facebook", occasion: TEST_D_BRIEF, shop: { name: SHOP }, requestText: TEST_D_BRIEF, concept: { promotionFacts: CONTRACT, messageIntent: "general_everyday", userTemporalIntent: "this_weekend" } });
  assert.match(social, /PROMOTION CONTRACT/);
  const flyer = buildFlyerContentTask({ occasion: TEST_D_BRIEF, shop: { name: SHOP }, requestText: TEST_D_BRIEF, concept: { promotionFacts: CONTRACT, ctaMaxChars: CTA_LIMIT, objective: "promotion" } });
  assert.match(flyer, /PROMOTION CONTRACT/);
  assert.match(flyer, new RegExp(`cta: the one action line, at most ${CTA_LIMIT} characters`));
  assert.doesNotMatch(flyer, /\(a phone number to call, "Order online," "Stop by today," etc\)/, "the old generic sales-channel example is gone");
  assert.match(flyer, /no "Order online," no website, no checkout/, "online ordering is now explicitly forbidden unless supplied/verified");
  // A supplied code is passed through exactly.
  assert.match(promotionFactsLine(classifyPromotionFacts({ requestText: "15% off roses with code ROSE15" })), /Promo code: "ROSE15" — use it exactly/);
  // Non-promotions get no contract line at all — untouched prompts.
  const plain = buildSocialPostTask({ channel: "facebook", occasion: "t", shop: { name: SHOP }, requestText: "Create a Facebook post encouraging people to send flowers today.", concept: { promotionFacts: null, messageIntent: "send_flowers" } });
  assert.doesNotMatch(plain, /PROMOTION CONTRACT/);
  assert.equal(_internalsForTesting.buildSocialPostPromptContext({ promotionFacts: CONTRACT }).promotionContractIncluded, true);
  assert.equal(_internalsForTesting.buildSocialPostPromptContext({}).promotionContractIncluded, false);
  assert.equal(COPY_GUIDANCE_VERSION, "2026-09-14.v4");
});

// ---------------------------------------------------------------------------
// Part 3 — the evaluator.
// ---------------------------------------------------------------------------

test("Part 3/6: the live caption and the live on-image wording are now REJECTED, on their own, with specific promotion-term codes; the repaired text keeps 20% off / bouquets / this weekend", () => {
  const cap = evalCaption(LIVE_CAPTION);
  assert.equal(cap.decision, "retry");
  assert.deepEqual(cap.promotionTermCodes, ["promotion_code_invented", "promotion_checkout_invented"]);
  assert.ok(cap.reasonCodes.every((c) => c === "unsupported_promotion_term"));
  assert.ok(cap.repairedBy.includes("stripUnsupportedPromotionTerms"));
  assert.doesNotMatch(cap.safeCandidate.body, /BLOOM20|checkout|online/i);
  assert.match(cap.safeCandidate.body, /20% off/);
  assert.match(cap.safeCandidate.body, /this weekend/);

  const fl = evalFlyer(LIVE_FLYER);
  assert.equal(fl.decision, "retry");
  assert.deepEqual(fl.promotionTermCodes, ["promotion_code_invented", "promotion_online_ordering_invented"]);
  assert.ok(fl.reasonCodes.includes("flyer_cta_too_long"), "the 65-char CTA is a rejection reason, not advice");
  assert.equal(fl.safeCandidate.headline, "20% Off Bouquets This Weekend", "the exact headline survives");
  assert.equal(fl.safeCandidate.cta, "", "the invented CTA sentence is removed, never kept as a truncated fragment");
  assert.ok(fl.reasons.some((r) => /at most 30/.test(r)), "the retry is told the real limit");
});

test("Part 6: adversarial generated copy is rejected when unsupported — codes, checkout, online, today only, BOGO, while supplies last, free delivery, altered discount, invented restrictions", () => {
  const cases = [
    ["Use code BLOOM20 for 20% off bouquets this weekend.", "promotion_code_invented"],
    ["Enter code FLOWERS20 at checkout for 20% off bouquets this weekend.", "promotion_code_invented"],
    ["Enter code FLOWERS20 at checkout for 20% off bouquets this weekend.", "promotion_checkout_invented"],
    ["Order online for 20% off bouquets this weekend.", "promotion_online_ordering_invented"],
    ["Shop 20% off bouquets on our website this weekend.", "promotion_online_ordering_invented"],
    ["20% off bouquets today only.", "promotion_urgency_invented"],
    ["Buy one get one free on bouquets this weekend.", "promotion_bogo_invented"],
    ["20% off bouquets this weekend while supplies last.", "promotion_urgency_invented"],
    ["Free delivery this weekend on all bouquets, 20% off.", "promotion_free_delivery_invented"],
    ["Take 25% off bouquets this weekend.", "promotion_discount_altered"],
    ["Take $10 off bouquets this weekend.", "promotion_discount_altered"],
    ["20% off bouquets this weekend, plus an extra 10% off for members.", "promotion_discount_altered"],
    ["20% off bouquets this weekend, excludes wedding orders.", "promotion_restriction_invented"],
    ["20% off bouquets this weekend with a minimum purchase of $50.", "promotion_restriction_invented"],
    ["20% off bouquets this weekend, in-store only.", "promotion_restriction_invented"],
    ["20% off bouquets this weekend — hurry, limited quantities!", "promotion_urgency_invented"]
  ];
  for (const [text, code] of cases) {
    const codes = codesOf(text);
    assert.ok(codes.includes(code), `expected ${code} for "${text}", got ${JSON.stringify(codes)}`);
    assert.ok(PROMOTION_TERM_CODES.includes(code));
  }
  // And the strip removes exactly the offending sentence, keeping the offer.
  const stripped = stripUnsupportedPromotionTerms({ generatedText: "Take 20% off bouquets this weekend at Lilies in Bloom. Use code BLOOM20 at checkout.", requestText: TEST_D_BRIEF, promotionFacts: CONTRACT });
  assert.equal(stripped.text, "Take 20% off bouquets this weekend at Lilies in Bloom.");
  assert.equal(stripped.removed.length, 1);
});

test("Part 6: the same terms are ALLOWED when the florist supplied them or a trusted capability verifies them", () => {
  const codeContract = classifyPromotionFacts({ requestText: "20% off bouquets this weekend with code BLOOM20" });
  assert.deepEqual(codesOf("Use code BLOOM20 for 20% off bouquets this weekend.", { contract: codeContract, request: "20% off bouquets this weekend with code BLOOM20" }), []);
  assert.ok(codesOf("Use code FLOWERS20 for 20% off bouquets this weekend.", { contract: codeContract, request: "20% off bouquets this weekend with code BLOOM20" }).includes("promotion_code_altered"));

  const onlineReq = "20% off bouquets this weekend, order online";
  const onlineContract = classifyPromotionFacts({ requestText: onlineReq });
  assert.equal(onlineContract.redemptionChannel, "online");
  assert.deepEqual(codesOf("Order online and take 20% off bouquets this weekend at checkout.", { contract: onlineContract, request: onlineReq }), []);

  const verifiedContract = classifyPromotionFacts({ requestText: TEST_D_BRIEF, verifiedCapabilities: { onlineOrdering: true } });
  assert.deepEqual(codesOf("Order online for 20% off bouquets this weekend.", { contract: verifiedContract, verifiedCapabilities: { onlineOrdering: true } }), []);

  const restrictedReq = "20% off bouquets this weekend, excludes wedding orders, while supplies last";
  const restricted = classifyPromotionFacts({ requestText: restrictedReq });
  assert.deepEqual(codesOf("20% off bouquets this weekend. Excludes wedding orders. While supplies last!", { contract: restricted, request: restrictedReq }), []);

  const freeDeliveryReq = "20% off bouquets this weekend with free delivery";
  assert.deepEqual(codesOf("Free delivery this weekend with 20% off bouquets.", { contract: classifyPromotionFacts({ requestText: freeDeliveryReq }), request: freeDeliveryReq }), []);

  const dollarReq = "$5 off arrangements this week";
  assert.deepEqual(codesOf("Take $5 off any arrangement this week.", { contract: classifyPromotionFacts({ requestText: dollarReq }), request: dollarReq }), []);
});

test("Part 3: 'this weekend' remains legal because the florist supplied it — and still never becomes a delivery/availability promise (existing detector, untouched)", () => {
  assert.deepEqual(codesOf("Take 20% off bouquets this weekend at Lilies in Bloom."), []);
  assert.deepEqual(detectInventedTemporalClaim({ generatedText: "Take 20% off bouquets this weekend.", requestText: TEST_D_BRIEF }), []);
  assert.ok(detectUnverifiedServiceAvailabilityClaim({ generatedText: "Same-day delivery on all bouquets this weekend.", requestText: TEST_D_BRIEF }).length > 0);
  const evaluated = evalCaption("Take 20% off bouquets this weekend. Same-day delivery available all weekend.");
  assert.ok(evaluated.reasonCodes.includes("unverified_service_availability_claim"));
  assert.doesNotMatch(evaluated.safeCandidate.body, /same-day/i);
});

test("Part 3: dropping or burying the supplied offer is also a rejection (promotion_offer_missing)", () => {
  const missing = evalCaption("Treat someone special to a beautiful bouquet this weekend from Lilies in Bloom.");
  assert.ok(missing.promotionTermCodes.includes("promotion_offer_missing"));
  assert.equal(detectMissingPromotionOffer({ generatedText: "Enjoy 20% off every bouquet this weekend.", promotionFacts: CONTRACT }), null);
  assert.equal(detectMissingPromotionOffer({ generatedText: "anything", promotionFacts: null }), null);
});

test("Part 3: the promotion checks never run without a contract — a non-promotion caption mentioning 'online' is judged exactly as before", () => {
  const plain = evalCaption("Your sister just finished her first week at a new job. Send flowers today and share the moment online.", { concept: { audience: "general_local_customers", messageIntent: "send_flowers" } });
  assert.deepEqual(plain.promotionTermCodes, []);
  assert.ok(!plain.checksRun.includes("detectUnsupportedPromotionTerms"));
});

test("Part 3: diagnostics carry the promotion sub-codes (codes only, never text)", () => {
  const d = buildCopyEvaluationDiagnostic({ attempt: 1, evalResult: evalCaption(LIVE_CAPTION), diversityEval: { decision: "pass", repeatedSignals: [] }, selected: false, rescueFired: true });
  assert.deepEqual(d.promotionTermCodes, ["promotion_code_invented", "promotion_checkout_invented"]);
  assert.ok(!JSON.stringify(d).includes("BLOOM20"));
});

// ---------------------------------------------------------------------------
// Part 4 — the deterministic promotion rescue.
// ---------------------------------------------------------------------------

test("Part 4: the promotion rescue uses only the contract — exact discount, product, timing; verified phone CTA within the limit; invents nothing", () => {
  const r = buildDeterministicPromotionRescueContent({ shopName: SHOP, shopPhone: PHONE, ctaIntent: "call_shop", promotionFacts: CONTRACT });
  assert.equal(r.headline, "20% Off Bouquets This Weekend");
  assert.equal(r.body, "Lilies in Bloom is taking 20% off bouquets this weekend.");
  assert.equal(r.cta, `Call ${PHONE}`);
  assert.ok(r.cta.length <= CTA_LIMIT);
  assert.ok(r.headline.length <= GRAPHIC_TEXT_LIMITS_DEFAULT.headlineMaxChars);
  assert.equal(r.caption, `Lilies in Bloom is taking 20% off bouquets this weekend. Call ${PHONE} to order.`);
  assert.equal(r.kind, "creative_rescue");
  assert.deepEqual(codesOf(`${r.headline}. ${r.body} ${r.caption}`), []);
  assert.equal(detectMissingPromotionOffer({ generatedText: r.caption, promotionFacts: CONTRACT }), null);
  assert.doesNotMatch(`${r.headline} ${r.body} ${r.cta} ${r.caption}`, /code|online|checkout|deliver|only|exclud|minimum|supplies|hurry/i);
  // No call CTA when the concept did not ask for one; no phone → no CTA.
  assert.equal(buildDeterministicPromotionRescueContent({ shopName: SHOP, shopPhone: PHONE, ctaIntent: "visit_shop", promotionFacts: CONTRACT }).cta, "");
  assert.equal(buildDeterministicPromotionRescueContent({ shopName: SHOP, shopPhone: null, ctaIntent: null, promotionFacts: CONTRACT }).cta, "");
  // Supplied code and restrictions are carried verbatim.
  const withTerms = buildDeterministicPromotionRescueContent({ shopName: SHOP, shopPhone: PHONE, promotionFacts: classifyPromotionFacts({ requestText: "20% off bouquets this weekend with code BLOOM20, excludes weddings" }) });
  assert.match(withTerms.body, /Use code BLOOM20\./);
  assert.match(withTerms.body, /excludes weddings/i);
});

test("Part 4: the general creative rescue defers to the promotion rescue whenever a contract exists, and is byte-for-byte unchanged otherwise (Birthday / Sympathy / self-purchase / send_flowers)", () => {
  const promo = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: PHONE, ctaIntent: "call_shop", audience: "general_local_customers", occasionCategory: "general", namedCampaign: "none", messageIntent: "general_everyday", promotionFacts: CONTRACT });
  assert.equal(promo.promotion, true);
  assert.equal(promo.body, "Lilies in Bloom is taking 20% off bouquets this weekend.");
  assert.doesNotMatch(promo.body, /moments that matter|makes it easy/);
  const birthday = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: PHONE, ctaIntent: "call_shop", audience: "general_local_customers", occasionCategory: "birthday", namedCampaign: "birthday" });
  assert.equal(birthday.body, "Lilies in Bloom has birthday flowers ready to make someone's day feel special.");
  const sympathy = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: PHONE, ctaIntent: "call_shop", audience: "funeral_families", occasionCategory: "sympathy", namedCampaign: "sympathy" });
  assert.equal(sympathy.body, "Lilies in Bloom helps families choose funeral and sympathy flowers with care.");
  const selfPurchase = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: PHONE, ctaIntent: "call_shop", audience: "self_purchase", occasionCategory: "general", namedCampaign: "none" });
  assert.equal(selfPurchase.body, "You don't need a reason to bring home flowers from Lilies in Bloom — sometimes wanting them is reason enough.");
  const sendFlowers = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: PHONE, ctaIntent: "call_shop", audience: "general_local_customers", occasionCategory: "general", namedCampaign: "none", messageIntent: "send_flowers", userTemporalIntent: "today" });
  assert.equal(sendFlowers.body, "Lilies in Bloom makes it easy to send someone flowers today.");
});

// ---------------------------------------------------------------------------
// Part 5 — the CTA contract.
// ---------------------------------------------------------------------------

test("Part 5: fitCtaToLimit keeps a fitting CTA, keeps a fitting first clause, falls back to the verified phone, else nothing — never shrinks, never cuts mid-word, never invents", () => {
  assert.equal(fitCtaToLimit("Call 606-506-4039", CTA_LIMIT, { shopPhone: PHONE }), "Call 606-506-4039");
  assert.equal(fitCtaToLimit("Call 606-506-4039 to place an order today", CTA_LIMIT, { shopPhone: PHONE }), "Call 606-506-4039");
  assert.equal(fitCtaToLimit("Stop by this weekend, and bring a friend along for the fun of it!", CTA_LIMIT, {}), "Stop by this weekend");
  const fallback = fitCtaToLimit("A very long call to action sentence that has no useful clause boundary anywhere inside it at all", CTA_LIMIT, { shopPhone: PHONE, ctaIntent: "call_shop" });
  assert.equal(fallback, `Call ${PHONE}`);
  assert.equal(fitCtaToLimit("A very long call to action sentence that has no useful clause boundary anywhere inside it at all", CTA_LIMIT, { shopPhone: null }), "");
  assert.equal(fitCtaToLimit("", CTA_LIMIT, {}), "");
  assert.equal(fitCtaToLimit("Anything", 0, {}), "Anything", "no limit → unchanged");
});

test("Part 5: in the evaluator, an oversized CTA is a rejection reason on flyer_text only, the promotion strip runs BEFORE the fit (so an invented clause is never 'kept because it fits'), and the kept draft complies", () => {
  const long = evalFlyer({ headline: "20% Off Bouquets This Weekend", body: "", cta: "Stop by this weekend, and take 20% off every bouquet in the shop while you're here" });
  assert.ok(long.reasonCodes.includes("flyer_cta_too_long"));
  assert.ok(long.repairedBy.includes("fitCtaToLimit"));
  assert.equal(long.safeCandidate.cta, "Stop by this weekend");
  assert.ok(long.safeCandidate.cta.length <= CTA_LIMIT);
  // The live CTA: strip removes the whole invented sentence; nothing is left to fit.
  const live = evalFlyer(LIVE_FLYER);
  assert.equal(live.safeCandidate.cta, "");
  assert.ok(!live.safeCandidate.cta.includes("Order online"));
  // No limit supplied → no CTA check (backward compatible); caption never checks it.
  const noLimit = evaluateMarketingOutput({ route: "generate_content", request: TEST_D_BRIEF, shopEvidence: SHOP_EVIDENCE, canonicalConcept: CONCEPT, candidate: { headline: "h", body: "Take 20% off bouquets this weekend.", cta: "Stop by this weekend, and take 20% off every bouquet in the shop while you're here" }, component: "flyer_text" });
  assert.ok(!noLimit.reasonCodes.includes("flyer_cta_too_long"));
  assert.ok(!noLimit.checksRun.includes("checkCtaLength"));
});

test("Part 5: fitCtaToLimit keeps the clause that carries the shop's phone — the fact, not the filler", () => {
  assert.equal(fitCtaToLimit("Need to place an order? Call 606-506-4039.", CTA_LIMIT, { shopPhone: PHONE }), "Call 606-506-4039");
  assert.equal(fitCtaToLimit("Call 606-506-4039 or stop by the shop this weekend for a look around", CTA_LIMIT, { shopPhone: PHONE }), "Call 606-506-4039");
});

test("Part 5/8: an over-limit CTA is ADVISORY — an exact-facts flyer (a closing time, a real phone) is retried once, then keeps its real headline/body with a fitted CTA; it is never thrown into the generic rescue", async () => {
  const closingBrief = "Create a Facebook post letting customers know Lilies in Bloom will close at 2:30 today. Need to place an order? Call 606-506-4039.";
  assert.equal(requestNeedsFlyerWording(closingBrief), true, "sanity: exact-facts designed-flyer branch");
  const closingCaption = "Heads up — Lilies in Bloom will close at 2:30 PM today. Need to place an order? Call 606-506-4039.";
  const longCtaFlyer = { headline: "CLOSING EARLY", body: "Lilies in Bloom will close at 2:30 today.", cta: "Need to place an order? Call 606-506-4039." };
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const calls = { social: 0, flyer: 0 };
  globalThis.fetch = async (url, options) => {
    const body = String(options?.body || "");
    if (String(url).includes("flux")) return { ok: true, json: async () => ({ success: true, result: { image: Buffer.from("fake-jpeg-bytes").toString("base64") } }) };
    if (body.includes(SOCIAL_MARKER)) { calls.social++; return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify({ platform: "facebook", headline: "Closing early today!", body: closingCaption, cta: "Call 606-506-4039", visual_brief: "A bright shot of the shop's flower display.", objective: "operational", hashtags: [], asset_requirements: [], brand_traits_used: [], visual_traits_used: [] }) } }) }; }
    if (body.includes(FLYER_MARKER)) { calls.flyer++; return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(longCtaFlyer) } }) }; }
    return { ok: true, json: async () => ({ success: true, result: { response: "{}" } }) };
  };
  try {
    const client = createFakeSupabaseClient(responsesFor(closingBrief), { storage: createFakeSupabaseStorage({}) });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, res.body);
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const content = assetInsert.payload.content;
    assert.equal(calls.flyer, 2, "the over-limit CTA earned exactly one bounded retry");
    assert.equal(content.creative_rescue_used, undefined, "NEVER the generic rescue for a CTA-length-only fault");
    assert.equal(content.headline, "CLOSING EARLY", "the real headline survives");
    assert.match(content.body, /2:30/, "the real closing time survives");
    assert.equal(content.cta, "Call 606-506-4039", "the CTA is fitted to the phone-bearing clause");
    assert.ok(content.cta.length <= CTA_LIMIT);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Part 5/7: the renderer's fail-safe never draws a CTA beyond the contract — deriveCtaText suppresses it outright rather than shrinking or truncating", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "public/flyer-renderer.js"), "utf8");
  const sandbox = { module: { exports: {} }, globalThis: {} };
  vm.runInNewContext(source, sandbox);
  const renderer = sandbox.module.exports;
  assert.equal(typeof renderer.deriveCtaText, "function");
  assert.equal(renderer.deriveCtaText("Call 606-506-4039", CTA_LIMIT), "Call 606-506-4039");
  assert.equal(renderer.deriveCtaText(LIVE_FLYER.cta, CTA_LIMIT), null, "the 65-char live CTA is suppressed, not drawn");
  assert.equal(renderer.deriveCtaText("x".repeat(31), 30), null);
  assert.equal(renderer.deriveCtaText("x".repeat(30), 30), "x".repeat(30));
  assert.equal(renderer.deriveCtaText("x".repeat(31), undefined), null, "default ceiling is the 30-char contract");
  assert.equal(renderer.deriveCtaText("", CTA_LIMIT), null);
  // The draw path is gated on it (static proof; pixel-level lives in the Playwright suite).
  assert.match(source, /var ctaText = deriveCtaText\(content\.cta, cd\.graphicTextLimits && cd\.graphicTextLimits\.ctaMaxChars\);/);
  assert.match(source, /activeRoles\.indexOf\("cta"\) !== -1 && roleRects\.cta && ctaText\)/);
  assert.match(source, /drawContact\(targetCtx, contactRect, brand, styleFor\(contactRect\), ctaText,/, "the contact footer reads the same gated CTA, so it cannot be fed the oversized one");
});

// ---------------------------------------------------------------------------
// Part 6 — the exact failed run, end to end through the real handler.
// ---------------------------------------------------------------------------

function floristDeps(client) {
  return { florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
function responsesFor(brief) {
  const fixed = [
    { data: { id: "item-1", content_type: "image_post", title: brief, brief, status: "idea" }, error: null },
    { data: [{ id: "item-1", status: "generating" }], error: null },
    { data: [{ id: "variant-1", platform: "facebook" }], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: { name: SHOP, phone: PHONE, logo_url: null }, error: null },
    { data: null, error: null },
    { data: null, error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null }
  ];
  const filler = Array.from({ length: 26 }, (_, i) => ({ data: { id: `x${i}` }, error: null }));
  return [...fixed, ...filler];
}
const SOCIAL_MARKER = "You are writing the ACTUAL, FINISHED social media post";
const FLYER_MARKER = "FINISHED text content for a flyer";

/** Drives generate_content with a fetch mock that returns the LIVE failing
 * texts on every attempt (so the retry can't quietly fix it), and records
 * every provider call by task. */
async function runTestD({ captionBodies, flyerCopies, captionCta = "" }) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const calls = { social: 0, flyer: 0, image: 0, other: 0 };
  const flyerPrompts = [];
  globalThis.fetch = async (url, options) => {
    const body = String(options?.body || "");
    if (String(url).includes("flux")) {
      calls.image++;
      return { ok: true, json: async () => ({ success: true, result: { image: Buffer.from("fake-jpeg-bytes").toString("base64") } }) };
    }
    if (body.includes(SOCIAL_MARKER)) {
      const text = captionBodies[Math.min(calls.social, captionBodies.length - 1)];
      calls.social++;
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify({ platform: "facebook", headline: "Sale", body: text, cta: captionCta, visual_brief: "A lush mixed-flower arrangement on a pastel background.", hashtags: [], asset_requirements: [], brand_traits_used: [], visual_traits_used: [] }) } }) };
    }
    if (body.includes(FLYER_MARKER)) {
      flyerPrompts.push(body);
      const copy = flyerCopies[Math.min(calls.flyer, flyerCopies.length - 1)];
      calls.flyer++;
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(copy) } }) };
    }
    calls.other++;
    return { ok: true, json: async () => ({ success: true, result: { response: "{}" } }) };
  };
  try {
    const storage = createFakeSupabaseStorage({});
    const client = createFakeSupabaseClient(responsesFor(TEST_D_BRIEF), { storage });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const variantUpdate = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
    return { res, body: JSON.parse(res.body), calls, client, flyerPrompts, content: assetInsert?.payload?.content || null, variant: variantUpdate?.payload || null };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Part 6 (real handler, exact failed run): with the model returning the LIVE invented texts on every attempt, the shipped caption and on-image wording preserve 20% off / bouquets / this weekend and carry no code, checkout, online, restriction, altered discount, or invented date; the CTA respects the 30-char contract; call budgets unchanged", async () => {
  assert.equal(requestNeedsFlyerWording(TEST_D_BRIEF), true, "sanity: the designed-flyer (exact-facts) branch, as in the live run");
  const { res, body, calls, content, variant } = await runTestD({ captionBodies: [LIVE_CAPTION], flyerCopies: [LIVE_FLYER] });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(calls.social, 2, "caption: attempt + exactly one bounded retry");
  // Both caption attempts carried invented terms → the promotion rescue
  // ships, and (pre-existing design) the flyer wording REUSES that rescue
  // instead of spending its own provider calls.
  assert.equal(calls.flyer, 0, "flyer wording reuses the caption rescue — no extra provider call");

  const caption = body.copy.body;
  const INVENTED = /BLOOM20|code|coupon|checkout|online|website|exclud|minimum|supplies|limited|today only|bogo|buy one|free delivery|same-day|\b25%|\$\d+ off/i;
  assert.match(caption, /20% off/);
  assert.match(caption, /bouquets/i);
  assert.match(caption, /this weekend/i);
  assert.doesNotMatch(caption, INVENTED, `caption must carry no invented term: ${caption}`);
  assert.equal(body.copy.creative_rescue_used, true, "both identical invented attempts are rejected → the promotion rescue ships");
  assert.equal(variant.caption, caption);

  assert.ok(content, "the flyer asset was persisted");
  const onImage = `${content.headline} ${content.body} ${content.cta}`;
  assert.match(content.headline, /20% Off Bouquets/);
  assert.match(onImage, /this weekend/i);
  assert.doesNotMatch(onImage, INVENTED, `on-image wording must carry no invented term: ${onImage}`);
  assert.ok(String(content.cta).length <= CTA_LIMIT, `persisted CTA (${content.cta}) must respect the ${CTA_LIMIT}-char contract`);
  assert.equal(content.creative_rescue_used, true);
  assert.equal(content.creative_direction.graphicTextLimits.ctaMaxChars, CTA_LIMIT);
  assert.equal(content.creative_direction.graphicTextSlots.headline, true, "a designed promotional layout still shows visible offer text");
  assert.equal(content.creative_direction.occasionTreatment, "promotional_feature");
  assert.deepEqual(content.canonical_concept.promotionFacts, CONTRACT, "the persisted concept carries the contract");
});

test("Part 6 (real handler): a compliant caption but the LIVE invented on-image wording on every flyer attempt → the flyer wording is retried once, rejected, and rescued from the contract; the persisted CTA respects the 30-char contract", async () => {
  const goodCaption = "Make this weekend count — 20% off bouquets at Lilies in Bloom. Pick one up for someone who deserves it.";
  // The caption itself asks customers to call (ctaIntent call_shop). The
  // flyer rescue gates its call CTA on that intent; with a caption that
  // never asked for a call, the flyer rescue's CTA would be "" (the
  // caption rescue, called with no ctaIntent, allows the call CTA — the
  // pre-existing generic-rescue behavior, unchanged here).
  const { res, body, calls, content, flyerPrompts } = await runTestD({ captionBodies: [goodCaption], flyerCopies: [LIVE_FLYER], captionCta: `Call ${PHONE}` });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(calls.social, 1);
  assert.equal(calls.flyer, 2, "flyer wording: attempt + exactly one bounded retry, never a third");
  assert.ok(flyerPrompts.every((p) => /PROMOTION CONTRACT/.test(p)), "the contract reached every flyer-wording prompt");
  assert.ok(/at most 30/.test(flyerPrompts[1]), "the retry was told the real CTA limit");
  assert.equal(body.copy.creative_rescue_used, undefined, "the caption itself shipped as AI copy");
  assert.equal(content.creative_rescue_used, true, "the on-image wording was rescued from the contract");
  const onImage = `${content.headline} ${content.body} ${content.cta}`;
  assert.doesNotMatch(onImage, /BLOOM20|code|online|checkout/i, onImage);
  assert.match(content.headline, /20% Off Bouquets/);
  assert.match(onImage, /this weekend/i);
  assert.ok(String(content.cta).length <= CTA_LIMIT);
  assert.equal(content.cta, `Call ${PHONE}`);
});

test("Part 6/7 (real handler): a GOOD contract-compliant caption and a fitting on-image CTA ship as real AI copy — no rescue, offer visible, CTA within contract", async () => {
  const goodCaption = "Make this weekend count — 20% off bouquets at Lilies in Bloom. Pick one up for someone who deserves it.";
  const goodFlyer = { headline: "20% Off Bouquets This Weekend", body: "Every bouquet, all weekend.", cta: `Call ${PHONE}` };
  const { res, body, content } = await runTestD({ captionBodies: [goodCaption], flyerCopies: [goodFlyer] });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(body.copy.creative_rescue_used, undefined, "no rescue for compliant copy");
  assert.equal(body.copy.body, goodCaption);
  assert.equal(content.headline, goodFlyer.headline);
  assert.equal(content.cta, goodFlyer.cta);
  assert.equal(content.creative_rescue_used, undefined);
  assert.ok(content.cta.length <= CTA_LIMIT);
});

// ---------------------------------------------------------------------------
// Part 8 — untouched paths.
// ---------------------------------------------------------------------------

test("Part 8: Test C photo-forward routing is untouched — no contract, no promotion checks, still text-free", () => {
  const brief = "Create a Facebook post encouraging people to send flowers today.";
  assert.equal(classifyPromotionFacts({ requestText: brief }), null);
  const concept = buildCanonicalConcept({ requestText: brief, occasionTitle: brief, platform: "facebook", contentType: "image_post", assetType: "flyer", objective: "awareness", photoStrategy: "subject_forward", styleTier: "generated" });
  assert.equal(concept.promotionFacts, null);
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept, shopBrand: {} });
  assert.equal(direction.occasionTreatment, "photo_forward_social");
  assert.equal(hasNoDrawableTextSlots(direction), true);
});

// ---------------------------------------------------------------------------
// Independent-review additions (2026-09-14).
// ---------------------------------------------------------------------------

test("review 1: the deterministic notice/rescue CTA (36 chars) meets the on-image contract at the handoff — fitted to the phone, never silently dropped by the renderer", async () => {
  const notice = buildDeterministicNoticeContent({ requestText: "We are closing early at 3 PM today.", shopName: SHOP, shopPhone: PHONE });
  assert.ok(notice.cta.length > CTA_LIMIT, `sanity: the deterministic notice CTA is over the limit as shipped (${notice.cta})`);
  assert.equal(fitCtaToLimit(notice.cta, CTA_LIMIT, { shopPhone: null, ctaIntent: "none" }), `Call ${PHONE}`, "the phone FACT is kept regardless of intent");
  // Through the real handler: a plain operational notice persists a CTA within the contract that still carries the phone.
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async (url) => (String(url).includes("flux")
    ? { ok: true, json: async () => ({ success: true, result: { image: Buffer.from("fake-jpeg-bytes").toString("base64") } }) }
    : { ok: true, json: async () => ({ success: true, result: { response: "{}" } }) });
  try {
    const client = createFakeSupabaseClient(responsesFor("We are closing early at 3 PM today."), { storage: createFakeSupabaseStorage({}) });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, res.body);
    const content = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert")).payload.content;
    assert.ok(content.cta.length <= CTA_LIMIT, content.cta);
    assert.match(content.cta, /606-506-4039/, "the phone survives on the graphic's CTA");
    assert.match(content.body, /closing early/i, "the notice's real wording is untouched");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("review 1: the renderer frees the CTA slot when it suppresses an over-limit CTA (no empty reserved rect), and the contact footer still carries the profile phone", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "public/flyer-renderer.js"), "utf8");
  assert.match(source, /var ctaText = deriveCtaText\(content\.cta, cd\.graphicTextLimits && cd\.graphicTextLimits\.ctaMaxChars\);\s*\r?\n\s*var activeRoles = depthRoles\.filter\(function \(r\) \{ return r !== "serviceDetail" && slots\[r\] && !\(r === "cta" && !ctaText\); \}\);/);
  const sandbox = { module: { exports: {} }, globalThis: {} };
  vm.runInNewContext(source, sandbox);
  const parts = sandbox.module.exports.contactLineParts({ shopName: SHOP, phone: PHONE }, null);
  assert.ok(parts.includes(PHONE), "with the CTA suppressed the footer shows the profile phone again");
});

test("review 2: revise_content runs the promotion contract and the CTA contract too (all four evaluators)", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "netlify/functions/marketing-studio.js"), "utf8");
  const contractSites = source.split("classifyPromotionFacts({ requestText: `${currentItem.data.brief} ${instruction}` })").length - 1;
  assert.equal(contractSites, 4, "three caption revision evaluators + the flyer_text revision evaluator");
  assert.match(source, /component: "flyer_text",\s*\r?\n\s*isRetryAttempt: true,\s*\r?\n\s*graphicTextLimits: \{ ctaMaxChars: GRAPHIC_TEXT_LIMITS_DEFAULT\.ctaMaxChars \}/, "the flyer_text revision enforces the CTA limit");
});

test("review 3/5: worded discounts resolve to the same contract as digits, and stay within the offer", () => {
  assert.equal(normalizeDiscountWording("twenty percent off bouquets"), "20% off bouquets");
  assert.equal(normalizeDiscountWording("half off bouquets"), "50% off bouquets");
  assert.equal(normalizeDiscountWording("five dollars off bouquets"), "$5 off bouquets");
  assert.equal(normalizeDiscountWording("Save 20% on bouquets"), "20% off bouquets");
  for (const req of ["twenty percent off bouquets this weekend", "Save 20% on bouquets this weekend", "20 percent off bouquets this weekend"]) {
    const c = classifyPromotionFacts({ requestText: req });
    assert.ok(c, req);
    assert.deepEqual(c.discount, { type: "percent", value: "20", text: "20% off" }, req);
    assert.equal(c.timing, "this weekend", req);
  }
  assert.deepEqual(classifyPromotionFacts({ requestText: "half off bouquets Saturday" }).discount, { type: "percent", value: "50", text: "50% off" });
  assert.deepEqual(classifyPromotionFacts({ requestText: "five dollars off any bouquet this week" }).discount, { type: "amount", value: "5", text: "$5 off" });
  // The evaluator agrees with the florist's wording either way.
  assert.deepEqual(codesOf("Take twenty percent off bouquets this weekend."), []);
  assert.equal(detectMissingPromotionOffer({ generatedText: "Enjoy twenty percent off every bouquet this weekend.", promotionFacts: CONTRACT }), null);
  assert.ok(codesOf("Half off bouquets this weekend.").includes("promotion_discount_altered"));
  assert.ok(codesOf("Two for one on bouquets this weekend.").includes("promotion_bogo_invented"));
});

test("review 4: product and timing parse sensibly — never 'this weekend' as the product, ranges and 'through the end of the month' intact, a dollar condition kept as a supplied restriction", () => {
  assert.equal(classifyPromotionFacts({ requestText: "20% off this weekend" }).product, null);
  assert.equal(classifyPromotionFacts({ requestText: "bouquets are 20% off this weekend" }).product, "bouquets");
  assert.equal(classifyPromotionFacts({ requestText: "20% off bouquets through the end of the month" }).timing, "through the end of the month");
  assert.equal(classifyPromotionFacts({ requestText: "20% off bouquets Friday 9/19 through Sunday 9/21" }).timing, "friday 9/19 through sunday 9/21");
  assert.equal(classifyPromotionFacts({ requestText: "20% off bouquets Saturday and Sunday" }).timing, "saturday and sunday");
  const over = classifyPromotionFacts({ requestText: "20% off any bouquet over $40 this weekend" });
  assert.equal(over.product, "bouquet");
  assert.ok(over.restrictions.some((r) => /over \$40/i.test(r)), JSON.stringify(over.restrictions));
  assert.deepEqual(codesOf("20% off any bouquet over $40 this weekend at Lilies in Bloom.", { contract: over, request: "20% off any bouquet over $40 this weekend" }), []);
  const noProduct = buildDeterministicPromotionRescueContent({ shopName: SHOP, shopPhone: PHONE, promotionFacts: classifyPromotionFacts({ requestText: "20% off this weekend" }) });
  assert.equal(noProduct.headline, "20% Off This Weekend");
  assert.equal(noProduct.body, "Lilies in Bloom is taking 20% off this weekend.");
  // A product too long for the headline: the offer alone is cut at a WORD boundary, never mid-word.
  const long = buildDeterministicPromotionRescueContent({ shopName: SHOP, shopPhone: PHONE, promotionFacts: classifyPromotionFacts({ requestText: "20% off premium garden style bridal bouquets this weekend" }) });
  assert.equal(long.headline, "20% Off Premium Garden Style Bridal");
  assert.ok(long.headline.length <= 42);
  const sat = classifyPromotionFacts({ requestText: "20% off bouquets Saturday only, delivery available" });
  assert.equal(sat.product, "bouquets", "a weekday never becomes part of the product");
});

test("review 5: no false positives on non-offer percentages, sharing online, or 'no coupon needed'", () => {
  assert.deepEqual(codesOf("Every bouquet is 100% fresh and 20% off this weekend."), []);
  assert.deepEqual(codesOf("Tag us online with your 20% off bouquet pics this weekend."), []);
  assert.deepEqual(codesOf("No coupon needed — just 20% off bouquets this weekend."), []);
  assert.deepEqual(codesOf("Share this post online and take 20% off bouquets this weekend."), []);
});

test("review 6: coverage — bare code tokens, sites/apps/DMs, invented weekdays and expiries, 'this weekend only', delivery promises", () => {
  const cases = [
    ["Just say BLOOM20 for 20% off bouquets this weekend.", "promotion_code_invented"],
    ["Message us FLOWERS-20 and take 20% off bouquets this weekend.", "promotion_code_invented"],
    ["20% off bouquets this weekend on our site.", "promotion_online_ordering_invented"],
    ["Order via our app for 20% off bouquets this weekend.", "promotion_online_ordering_invented"],
    ["Order through Instagram DMs for 20% off bouquets this weekend.", "promotion_online_ordering_invented"],
    ["Tap the link in our bio for 20% off bouquets this weekend.", "promotion_online_ordering_invented"],
    ["20% off bouquets Saturday and Sunday.", "promotion_date_invented"],
    ["20% off bouquets, expires 9/21.", "promotion_date_invented"],
    ["20% off bouquets, valid through Sunday.", "promotion_date_invented"],
    ["20% off bouquets this weekend only.", "promotion_urgency_invented"],
    ["20% off bouquets for a limited time this weekend.", "promotion_urgency_invented"],
    ["We deliver all weekend long — 20% off bouquets this weekend.", "promotion_delivery_claim_invented"],
    ["Get them delivered right to their door this weekend, 20% off bouquets.", "promotion_delivery_claim_invented"],
    ["Bouquets are available all weekend at 20% off.", "promotion_delivery_claim_invented"],
    ["20% off bouquets this weekend, limited to 3 per order.", "promotion_restriction_invented"],
    ["20% off bouquets this weekend, walk-ins only.", "promotion_restriction_invented"],
    ["20% off bouquets this weekend, free vase with every bouquet.", "promotion_restriction_invented"]
  ];
  for (const [text, code] of cases) {
    const codes = codesOf(text);
    assert.ok(codes.includes(code), `expected ${code} for "${text}", got ${JSON.stringify(codes)}`);
  }
  // Supplied weekday / delivery / "only" stay legal.
  const satReq = "20% off bouquets Saturday only, delivery available";
  const satContract = classifyPromotionFacts({ requestText: satReq });
  assert.deepEqual(codesOf("20% off bouquets Saturday only — delivery available.", { contract: satContract, request: satReq }), []);
});

test("review 8: a supplied lowercase or hyphenated code works end to end, and a case-changed generated code still counts as the supplied one", () => {
  const lower = classifyPromotionFacts({ requestText: "20% off bouquets this weekend, use code bloom20" });
  assert.equal(lower.promoCode, "bloom20");
  assert.deepEqual(codesOf("Use code BLOOM20 for 20% off bouquets this weekend.", { contract: lower, request: "20% off bouquets this weekend, use code bloom20" }), []);
  assert.ok(codesOf("Use code ROSE15 for 20% off bouquets this weekend.", { contract: lower, request: "20% off bouquets this weekend, use code bloom20" }).includes("promotion_code_altered"));
  const hyphen = classifyPromotionFacts({ requestText: "20% off bouquets this weekend with code BLOOM-20" });
  assert.equal(hyphen.promoCode, "BLOOM-20");
  assert.deepEqual(codesOf("Use code BLOOM-20 this weekend for 20% off bouquets.", { contract: hyphen, request: "20% off bouquets this weekend with code BLOOM-20" }), []);
  assert.match(_internalsForTesting.promotionFactsLine(lower), /Promo code: "bloom20" — use it exactly/);
  assert.match(buildDeterministicPromotionRescueContent({ shopName: SHOP, shopPhone: PHONE, promotionFacts: lower }).body, /Use code bloom20\./);
  assert.equal(classifyPromotionFacts({ requestText: "20% off bouquets, our code word is kindness" }).promoCode, null);
});

// ---------------------------------------------------------------------------
// Second independent review (2026-09-14, round 2).
// ---------------------------------------------------------------------------

test("round 2 (1): 'Save 20% on X', '$5 off on X' and a BOGO keep their product; the prompt never says NONE for a named product", () => {
  assert.equal(classifyPromotionFacts({ requestText: "Save 20% on bouquets this weekend" }).product, "bouquets");
  assert.equal(classifyPromotionFacts({ requestText: "Save $5 on bouquets this weekend" }).product, "bouquets");
  assert.equal(classifyPromotionFacts({ requestText: "20% off on bouquets this weekend" }).product, "bouquets");
  const bogo = classifyPromotionFacts({ requestText: "Buy one get one free on bouquets Saturday" });
  assert.equal(bogo.discount.type, "bogo");
  assert.equal(bogo.product, "bouquets");
  assert.equal(bogo.timing, "saturday");
  assert.match(_internalsForTesting.promotionFactsLine(bogo), /Product scope: "bouquets"/);
  assert.equal(buildDeterministicPromotionRescueContent({ shopName: SHOP, shopPhone: PHONE, promotionFacts: bogo }).headline, "Buy One Get One Free Bouquets Saturday");
});

test("round 2 (2): a redemption channel or checkout the florist HERSELF supplied is allowed through — and stripped from nothing", () => {
  const cases = [
    ["20% off bouquets this weekend with code BLOOM20 at checkout", "Use code BLOOM20 at checkout for 20% off bouquets this weekend."],
    ["20% off bouquets this weekend, DM us to order", "DM us to order — 20% off bouquets this weekend."],
    ["20% off bouquets this weekend at www.liliesinbloom.com", "Order at www.liliesinbloom.com for 20% off bouquets this weekend."],
    ["20% off bouquets this weekend, link in bio to order", "Tap the link in bio to order 20% off bouquets this weekend."],
    ["20% off bouquets this weekend on our site", "20% off bouquets this weekend on our site."]
  ];
  for (const [request, text] of cases) {
    const contract = classifyPromotionFacts({ requestText: request });
    assert.deepEqual(codesOf(text, { contract, request }), [], `${request} → ${text}`);
    assert.equal(stripUnsupportedPromotionTerms({ generatedText: text, requestText: request, promotionFacts: contract }).removed.length, 0, text);
  }
  assert.equal(classifyPromotionFacts({ requestText: "20% off bouquets this weekend, DM us to order" }).redemptionChannel, "online");
  // …while the same wording with NOTHING supplied is still rejected.
  assert.ok(codesOf("Order at liliesinbloom.com for 20% off bouquets this weekend.").includes("promotion_online_ordering_invented"));
});

test("round 2 (3): timing is the promotion window, never when to post, never prose", () => {
  assert.equal(classifyPromotionFacts({ requestText: "Create a post today for 20% off bouquets this weekend" }).timing, "this weekend");
  assert.equal(classifyPromotionFacts({ requestText: "I need a post for tomorrow: 20% off bouquets this weekend" }).timing, "this weekend");
  assert.equal(classifyPromotionFacts({ requestText: "This weekend, take 20% off bouquets" }).timing, "this weekend");
  assert.equal(classifyPromotionFacts({ requestText: "20% off bouquets until they're gone" }).timing, null);
  assert.equal(classifyPromotionFacts({ requestText: "20% off bouquets through our app" }).timing, null);
  assert.equal(classifyPromotionFacts({ requestText: "20% off bouquets until Sunday" }).timing, "until sunday");
  assert.equal(classifyPromotionFacts({ requestText: "20% off bouquets through Mother's Day" }).timing, "through mother's day");
  const dozen = classifyPromotionFacts({ requestText: "20% off 1/2 dozen roses this weekend" });
  assert.equal(dozen.timing, "this weekend");
});

test("round 2 (4): product never captures prose", () => {
  assert.equal(classifyPromotionFacts({ requestText: "Offer 20% off to anyone who mentions this post" }).product, null);
  assert.equal(classifyPromotionFacts({ requestText: "20% off if you mention this post this weekend" }).product, null);
  assert.equal(classifyPromotionFacts({ requestText: "20% off storewide this weekend" }).product, null);
});

test("round 2 (5): code checks never fire on 'PROMO ALERT', a QR code, a dress code, or 'skip the coupon' — and still catch real codes", () => {
  assert.deepEqual(codesOf("PROMO ALERT: 20% off bouquets this weekend!"), []);
  assert.deepEqual(codesOf("WEEKEND PROMO SALE — 20% off bouquets."), []);
  assert.deepEqual(codesOf("Scan the QR code below for 20% off bouquets this weekend."), []);
  assert.deepEqual(codesOf("Skip the coupon — just 20% off bouquets this weekend."), []);
  assert.ok(codesOf("Use code BLOOM20 for 20% off bouquets this weekend.").includes("promotion_code_invented"));
  assert.ok(codesOf("Promo code: BLOOM20 — 20% off bouquets this weekend.").includes("promotion_code_invented"));
  assert.ok(codesOf("Mention promo BLOOM20 for 20% off bouquets this weekend.").includes("promotion_code_invented"));
});

test("round 2 (6): delivery checks catch promises, not ordinary florist words", () => {
  for (const ok of [
    "Bouquets are 20% off this weekend and gift cards are available too.",
    "We're delivering smiles this weekend — 20% off bouquets.",
    "Pick up or delivery — 20% off bouquets this weekend."
  ]) assert.deepEqual(codesOf(ok), [], ok);
  for (const bad of [
    "We deliver all weekend long — 20% off bouquets this weekend.",
    "Get them delivered right to their door this weekend, 20% off bouquets.",
    "Bouquets are available all weekend at 20% off.",
    "20% off bouquets this weekend, delivery available."
  ]) assert.ok(codesOf(bad).includes("promotion_delivery_claim_invented"), bad);
});

test("round 2 (7): factsPreserved compares discounts by meaning and lets the florist's own instruction change one", () => {
  assert.equal(factsPreserved("Take 20% off bouquets this weekend.", "Bouquets are twenty percent off this weekend."), true);
  assert.equal(factsPreserved("Take 20% off bouquets this weekend.", "Take 25% off bouquets this weekend."), false);
  assert.equal(factsPreserved("Take 20% off bouquets this weekend.", "Take 25% off bouquets this weekend.", { instruction: "make it 25% off" }), true);
  assert.equal(factsPreserved("Call 606-506-4039 for 20% off.", "Call 606-506-4040 for 25% off.", { instruction: "make it 25% off" }), false, "a phone number never changes on the back of a discount instruction");
});

test("round 2 (8/11): on a revision, 'supplied' means the brief + instruction — an older prior text can't launder an invented term; a promotion-only concept never triggers the coherence checks", () => {
  const promotionFacts = CONTRACT;
  const priorText = "20% off bouquets this weekend. Order online today.";
  const base = { route: "revise_content", request: `${TEST_D_BRIEF} make it more cheerful ${priorText}`, shopEvidence: SHOP_EVIDENCE, inventoryEvidence: [], candidate: { headline: "", body: "Brighten a weekend — 20% off bouquets at Lilies in Bloom. Order online today.", cta: "" }, component: "caption", isRetryAttempt: true };
  const laundered = evaluateMarketingOutput({ ...base, canonicalConcept: { promotionFacts } });
  assert.deepEqual(laundered.promotionTermCodes, [], "without promotionRequestText the prior text in `request` supplies the term (the asymmetry the review found)");
  const strict = evaluateMarketingOutput({ ...base, canonicalConcept: { promotionFacts, promotionRequestText: `${TEST_D_BRIEF} make it more cheerful` } });
  assert.ok(strict.promotionTermCodes.includes("promotion_online_ordering_invented"));
  // A legacy asset with no stored concept: only the contract rides along, and the CTA/concept coherence checks stay off exactly as before.
  const legacy = evaluateMarketingOutput({ route: "revise_content", request: "warm it up", shopEvidence: SHOP_EVIDENCE, inventoryEvidence: [], candidate: { headline: "Spring Is Here", body: "Fresh tulips at Lilies in Bloom.", cta: "Don't miss out" }, canonicalConcept: { promotionFacts: null, promotionRequestText: "warm it up" }, component: "flyer_text", isRetryAttempt: true, graphicTextLimits: { ctaMaxChars: CTA_LIMIT } });
  assert.ok(!legacy.checksRun.includes("detectCtaCoherenceMismatch"));
  assert.ok(!legacy.reasonCodes.includes("cta_coherence_mismatch"));
  const withConcept = evaluateMarketingOutput({ route: "revise_content", request: "warm it up", shopEvidence: SHOP_EVIDENCE, inventoryEvidence: [], candidate: { headline: "Spring Is Here", body: "Fresh tulips at Lilies in Bloom.", cta: "Don't miss out" }, canonicalConcept: { ...CONCEPT, promotionFacts: null, promotionRequestText: "warm it up" }, component: "flyer_text", isRetryAttempt: true, graphicTextLimits: { ctaMaxChars: CTA_LIMIT } });
  assert.ok(withConcept.checksRun.includes("detectCtaCoherenceMismatch"), "a real concept still runs the coherence checks");
  const source = fs.readFileSync(path.join(process.cwd(), "netlify/functions/marketing-studio.js"), "utf8");
  assert.equal(source.split("promotionRequestText: `${currentItem.data.brief} ${instruction}`").length - 1, 4, "all four revision evaluators name the promotion request text");
});

test("round 2 (10/12/16): the CTA fit keeps its own verb; 'up to 20%' alters the offer; a headline cut on an exact word boundary keeps the word", () => {
  assert.equal(fitCtaToLimit("Text 606-506-4039 to order for the weekend sale", CTA_LIMIT, { shopPhone: PHONE }), "Text 606-506-4039");
  assert.equal(fitCtaToLimit("Need to place an order? Call 606-506-4039.", CTA_LIMIT, { shopPhone: PHONE }), "Call 606-506-4039");
  assert.ok(codesOf("Save up to 20% on bouquets this weekend.").includes("promotion_discount_altered"));
  assert.ok(codesOf("Free vase with purchase this weekend — 20% off bouquets.").includes("promotion_restriction_invented"));
  // "20% Off Premium Garden Style Bridal Bouq" is 41 chars + "uets" — cut at the boundary keeps "Bridal"; a 42-char exact fit keeps every word.
  const exact = buildDeterministicPromotionRescueContent({ shopName: SHOP, shopPhone: PHONE, promotionFacts: classifyPromotionFacts({ requestText: "20% off premium garden style bridal bouquets" }) });
  assert.equal(exact.headline, "20% Off Premium Garden Style Bridal Bouquets".length <= 42 ? "20% Off Premium Garden Style Bridal Bouquets" : "20% Off Premium Garden Style Bridal");
});

test("Part 8: operational notices and non-promotion requests carry no contract and no promotion checks", () => {
  for (const brief of ["We are closing early at 3 PM today.", "Create a gentle Facebook post letting families know we can help with funeral flowers.", "Create a birthday Facebook post for a friend turning 40."]) {
    assert.equal(classifyPromotionFacts({ requestText: brief }), null, brief);
  }
});
