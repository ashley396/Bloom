import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalConcept, classifyOccasionCategory, classifyNamedCampaign, classifyCreativeMode, classifyCopyVoice } from "../netlify/functions/_shared/marketing-canonical-concept.js";
import { requestNeedsFlyerWording, buildDeterministicCreativeRescueContent, evaluateMarketingOutput } from "../netlify/functions/_shared/marketing-content-revision.js";
import { buildDeterministicCreativeDirection, validateCreativeDirection } from "../netlify/functions/_shared/marketing-creative-direction.js";
import { routeMarketingEngine, ENGINES } from "../netlify/functions/_shared/marketing-engine-router.js";

// Funeral/Sympathy creative-preservation batch (approved on top of
// e5365ff — the personal-occasion routing review): the Funeral/Sympathy
// live acceptance test proved canonical sympathy classification was
// always correct, but two downstream product-quality gaps produced a
// generic, occasion-blind result: (1) sympathy_elegance unconditionally
// forced exact_layout regardless of whether exact wording was actually
// needed, and (2) the deterministic rescue's occasion table had no
// sympathy entry. This file proves both are fixed, without touching
// canonical classification, evaluator thresholds, or sympathy's own
// visual safeguards.

const SHOP = { name: "Lilies in Bloom", phone: "6065064039" };
const SYMPATHY_REQUEST = "Create a comforting Facebook post letting families know we can help with funeral flowers.";

// ---------------------------------------------------------------------------
// PART 1 — ordinary sympathy social request stays Premium-Creative/
// subject-forward eligible; genuine sympathy flyer/fact requests remain
// exact-layout.
// ---------------------------------------------------------------------------

test("ordinary sympathy social request: canonical classification is unchanged (occasionCategory/namedCampaign/audience/creativeMode/copyVoice all correct)", () => {
  const concept = buildCanonicalConcept({ requestText: SYMPATHY_REQUEST, isSympathy: true, objective: "operational", photoStrategy: "subject_forward", styleTier: "generated" });
  assert.equal(concept.occasionCategory, "sympathy");
  assert.equal(concept.namedCampaign, "sympathy");
  assert.equal(concept.audience, "funeral_families");
  assert.equal(concept.creativeMode, "sympathy_elegance");
  assert.deepEqual(concept.copyVoice, ["compassionate", "elegant"]);
});

test("ordinary sympathy social request: requestNeedsFlyerWording() is false", () => {
  assert.equal(requestNeedsFlyerWording(SYMPATHY_REQUEST), false);
});

test("ordinary sympathy social request: routeMarketingEngine grants premium_ai_creative eligibility, exactly like any other ordinary creative occasion", () => {
  const concept = buildCanonicalConcept({ requestText: SYMPATHY_REQUEST, isSympathy: true, objective: "operational", photoStrategy: "subject_forward", styleTier: "generated" });
  const decision = routeMarketingEngine({ canonicalConcept: concept, verifiedOfferFactsPresent: false });
  assert.equal(decision.engine, ENGINES.PREMIUM_AI_CREATIVE);
  assert.match(decision.reason, /ordinary_creative:sympathy_elegance/);
});

test("ordinary sympathy social request: the emotional/visual treatment stays sympathy-appropriate — quiet, respectful, never celebratory — even though the structural family is now photo_forward_social", () => {
  const concept = buildCanonicalConcept({ requestText: SYMPATHY_REQUEST, isSympathy: true, objective: "operational", photoStrategy: "subject_forward", styleTier: "generated" });
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept, shopBrand: {} });
  assert.equal(direction.visualMood, "quiet_respectful");
  assert.equal(direction.paletteMood, "neutral_blush_ivory");
  assert.notEqual(direction.visualMood, "bright_joyful");
  assert.notEqual(direction.visualMood, "playful_energetic");
  assert.notEqual(direction.visualMood, "bold_celebratory");
});

test("ordinary sympathy social request: all on-image text slots are false — no headline/brand/phone/CTA/supporting/service text forced onto the image merely because the occasion is sympathy", () => {
  const concept = buildCanonicalConcept({ requestText: SYMPATHY_REQUEST, isSympathy: true, objective: "operational", ctaText: "Call 606-506-4039", photoStrategy: "subject_forward", styleTier: "generated" });
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept, shopBrand: {} });
  assert.deepEqual(direction.graphicTextSlots, { brand: false, headline: false, supportingLine: false, serviceDetail: false, cta: false, phone: false });
  assert.equal(direction.hierarchyDepth, "headline_only");
  assert.equal(direction.occasionTreatment, "photo_forward_social", "the creative direction's own label must honestly reflect the structural family actually used, not silently claim sympathy_elegance while behaving like photo_forward_social");
});

test("genuine sympathy flyer/ad requests with real fact/layout requirements are UNCHANGED — still exact-layout, still the full designed-flyer treatment", () => {
  for (const text of [
    "Make a funeral flower flyer with our phone number 606-506-4039.",
    "Create a sympathy poster that says We're Here When You Need Us.",
    "Make an ad for funeral flowers with our shop name, phone number and address."
  ]) {
    assert.equal(requestNeedsFlyerWording(text), true, `"${text}" must still require exact-layout`);
  }

  // The exact-layout branch's own concept (photoStrategy "calm_backdrop")
  // must still get the full sympathy_elegance family — real shop name/
  // phone/service-detail slots, exactly as before this batch.
  const exactLayoutConcept = buildCanonicalConcept({
    requestText: "Make a funeral flower flyer with our phone number 606-506-4039.",
    isSympathy: true,
    objective: "operational",
    ctaText: "Call 606-506-4039",
    photoStrategy: "calm_backdrop",
    styleTier: "generated"
  });
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: exactLayoutConcept, shopBrand: {} });
  assert.equal(direction.occasionTreatment, "sympathy_elegance");
  assert.equal(direction.graphicTextSlots.brand, true);
  assert.equal(direction.graphicTextSlots.headline, true);
  assert.equal(direction.graphicTextSlots.serviceDetail, true, "sympathy's own dedicated 4-role hierarchy (the one family that legitimately earns a service-detail slot) must survive for a genuine exact-layout sympathy flyer");
});

test("sympathy's own visual safeguards remain fully active regardless of which structural family it resolved to — a candidate that somehow carried a celebratory mood is still clamped back", () => {
  const { direction, errors } = validateCreativeDirection(
    { occasionTreatment: "sympathy_elegance", visualMood: "bold_celebratory", paletteMood: "vibrant_seasonal", compositionFamily: "banner_led", bannerStyle: "ribbon_banner", ornamentalDensity: "rich" },
    { canonicalConcept: { occasionCategory: "sympathy", sympathyClassification: "sympathy", visualDirection: { photoStrategy: "subject_forward" } } }
  );
  assert.equal(direction.visualMood, "quiet_respectful");
  assert.equal(direction.paletteMood, "neutral_blush_ivory");
  assert.equal(direction.bannerStyle, "none");
  assert.equal(direction.ornamentalDensity, "light");
  assert.ok(errors.some((e) => /visualMood/.test(e)));
});

// ---------------------------------------------------------------------------
// PART 2 — sympathy-aware deterministic rescue.
// ---------------------------------------------------------------------------

test("rescue: sympathy explicitly references funeral/sympathy floral help, never the generic fallback", () => {
  const rescue = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, occasionCategory: "sympathy", namedCampaign: "sympathy" });
  assert.match(rescue.headline, /funeral|sympathy/i);
  assert.match(rescue.body, /funeral|sympathy/i);
  assert.match(rescue.body, new RegExp(SHOP.name));
  assert.doesNotMatch(rescue.body, /brighten someone'?s day/i);
  assert.doesNotMatch(rescue.body, /moments that matter/i);
  assert.doesNotMatch(rescue.headline, /beautiful blooms for every occasion/i);
});

test("rescue: sympathy wording never invents a death, a named deceased, a grieving customer, a specific service, availability, inventory, prices, or discounts", () => {
  const rescue = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, occasionCategory: "sympathy", namedCampaign: "sympathy" });
  const text = `${rescue.headline} ${rescue.body}`;
  assert.doesNotMatch(text, /passed away|funeral of|memorial for|in loving memory of/i, "must not invent a specific death or named deceased");
  assert.doesNotMatch(text, /same[- ]day|available (today|now)|in stock|we have\b/i, "must not invent availability/inventory");
  assert.doesNotMatch(text, /\$\d|\d+%\s*off|discount|guarantee/i, "must not invent a price, discount, or guarantee");
  assert.doesNotMatch(text, /funeral home/i, "must not invent a funeral-home relationship");
});

test("rescue: sympathy is not addressed as though the reader is personally grieving — it states what the shop offers, not a message to a known bereaved customer", () => {
  const rescue = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, occasionCategory: "sympathy", namedCampaign: "sympathy" });
  assert.doesNotMatch(rescue.body, /\byour loss\b|\byour family'?s loss\b|\bsorry for your loss\b/i);
});

test("rescue: forced deterministic rescue across sympathy, birthday, anniversary, get_well, self_purchase, and generic/no occasion each preserve the appropriate intent", () => {
  const cases = [
    { occasionCategory: "sympathy", namedCampaign: "sympathy", audience: null, mustMatch: /funeral|sympathy/i },
    { occasionCategory: "birthday", namedCampaign: "birthday", audience: null, mustMatch: /birthday/i },
    { occasionCategory: "anniversary", namedCampaign: "anniversary", audience: null, mustMatch: /anniversary/i },
    { occasionCategory: "get_well", namedCampaign: "get_well", audience: null, mustMatch: /get.well|recovery|comfort/i },
    { occasionCategory: null, namedCampaign: null, audience: "self_purchase", mustMatch: /reason enough|don'?t need a reason/i },
    { occasionCategory: "general", namedCampaign: "none", audience: null, mustMatch: /moments that matter/i }
  ];
  for (const { occasionCategory, namedCampaign, audience, mustMatch } of cases) {
    const rescue = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, occasionCategory, namedCampaign, audience });
    assert.match(`${rescue.headline} ${rescue.body}`, mustMatch, `occasion ${occasionCategory || audience} did not preserve its own intent: "${rescue.headline} ${rescue.body}"`);
  }
});

test("rescue: self-purchase behavior is preserved BYTE-FOR-BYTE by this batch too — unaffected by adding sympathy support", () => {
  const rescue = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, audience: "self_purchase" });
  assert.equal(rescue.headline, "Flowers, Just Because");
  assert.equal(rescue.body, `You don't need a reason to bring home flowers from ${SHOP.name} — sometimes wanting them is reason enough.`);
});

// ---------------------------------------------------------------------------
// PART 3 — on-image rescue never forces text when graphicTextSlots are
// false; existing renderer gating remains authoritative.
// ---------------------------------------------------------------------------

test("on-image rescue: rescue wording is composed independently of graphicTextSlots — assigning sympathy rescue headline/body/cta strings never itself flips a text slot on", () => {
  const concept = buildCanonicalConcept({ requestText: SYMPATHY_REQUEST, isSympathy: true, objective: "operational", ctaText: "Call 606-506-4039", photoStrategy: "subject_forward", styleTier: "generated" });
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept, shopBrand: {} });
  // The renderer's only real input is creative_direction.graphicTextSlots
  // (marketing-studio.js/public/flyer-renderer.js) — rescue only ever sets
  // string content fields (headline/body/cta), which this same direction
  // object proves stay irrelevant to slot visibility.
  const rescue = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, occasionCategory: "sympathy", namedCampaign: "sympathy", ctaIntent: "call_shop" });
  assert.ok(rescue.headline && rescue.body && rescue.cta, "rescue still produces real content for the caption/asset record");
  assert.deepEqual(direction.graphicTextSlots, { brand: false, headline: false, supportingLine: false, serviceDetail: false, cta: false, phone: false }, "graphicTextSlots for a subject-forward sympathy concept stay all-false regardless of what rescue text exists");
});

// ---------------------------------------------------------------------------
// PART 4 — existing fact/temporal/inventory/funeral safety detectors
// remain fully active for sympathy; sympathy never inherits playful/
// celebratory copy voice.
// ---------------------------------------------------------------------------

test("safety: existing funeral/bereavement-framing, invented-inventory, and invented-temporal-claim detectors remain fully active for sympathy — unchanged by this batch", () => {
  const bereavementMismatch = evaluateMarketingOutput({
    route: "generate_content",
    request: "Create a fun post about our spring bouquets.",
    shopEvidence: SHOP,
    candidate: { headline: "In Loving Memory", body: "We offer condolences and sympathy arrangements for your loss.", cta: "Call us" },
    canonicalConcept: { audience: "general_local_customers", occasionCategory: "general" },
    component: "caption"
  });
  assert.ok(bereavementMismatch.reasonCodes.includes("weak_marketing_copy"));
  assert.ok(bereavementMismatch.weakCopyReasonCodes.includes("weak_copy_invented_bereavement_framing"));

  const inventedInventory = evaluateMarketingOutput({
    route: "generate_content",
    request: SYMPATHY_REQUEST,
    shopEvidence: SHOP,
    inventoryEvidence: [],
    candidate: { headline: "Funeral Flowers", body: "We just got a fresh shipment of white lilies in today for funeral arrangements.", cta: "Call to order" },
    canonicalConcept: { audience: "funeral_families", occasionCategory: "sympathy" },
    component: "caption"
  });
  assert.ok(inventedInventory.repairedBy.includes("stripUnverifiedInventoryClaims"));

  const inventedTemporal = evaluateMarketingOutput({
    route: "generate_content",
    request: SYMPATHY_REQUEST,
    shopEvidence: SHOP,
    candidate: { headline: "Funeral Flowers", body: "This Saturday, let us help your family with funeral flowers.", cta: "Call to order" },
    canonicalConcept: { audience: "funeral_families", occasionCategory: "sympathy" },
    component: "caption"
  });
  assert.ok(inventedTemporal.repairedBy.includes("stripInventedTemporalClaims"));
});

test("safety: weak_copy_filler_phrase still fires for sympathy copy — this batch does not weaken or exempt sympathy from copy-quality evaluation", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: SYMPATHY_REQUEST,
    shopEvidence: SHOP,
    candidate: {
      headline: "We're Here For You",
      body: "We understand the importance of honoring your loved one. Our experienced florists create beautiful, meaningful arrangements for every step of the way.",
      cta: "Contact us today to discuss your needs"
    },
    canonicalConcept: { audience: "funeral_families", occasionCategory: "sympathy" },
    component: "caption"
  });
  assert.ok(result.weakCopyReasonCodes.includes("weak_copy_filler_phrase"));
});

test("classification: sympathy never inherits playful/celebratory copyVoice — classifyCopyVoice's sympathy branch is untouched and always wins first", () => {
  const copyVoice = classifyCopyVoice({ creativeMode: "sympathy_elegance", namedCampaign: "sympathy", occasionCategory: "sympathy", sympathyClassification: "sympathy", requestText: "Create a fun, playful comforting Facebook post letting families know we can help with funeral flowers." });
  assert.deepEqual(copyVoice, ["compassionate", "elegant"]);
  assert.ok(!copyVoice.includes("playful"));
  assert.ok(!copyVoice.includes("celebratory"));
});

test("classification: sympathy always wins creativeMode over any other signal (playful text, promotion intent) — unaffected by this batch", () => {
  const occasionCategory = classifyOccasionCategory({ requestText: "Fun playful funeral flower sale, 20% off!", isSympathy: true });
  const namedCampaign = classifyNamedCampaign({ requestText: "Fun playful funeral flower sale, 20% off!", isSympathy: true, occasionCategory });
  const creativeMode = classifyCreativeMode({ occasionCategory, namedCampaign, sympathyClassification: "sympathy", promotionIntent: "real_promotion", requestText: "Fun playful funeral flower sale, 20% off!" });
  assert.equal(creativeMode, "sympathy_elegance");
});
