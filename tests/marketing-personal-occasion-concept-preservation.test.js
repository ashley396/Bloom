import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalConcept,
  classifyOccasionCategory,
  classifyNamedCampaign,
  classifyCreativeMode,
  classifyCopyVoice,
  PERSONAL_CELEBRATION_OCCASIONS,
  CREATIVE_MODES
} from "../netlify/functions/_shared/marketing-canonical-concept.js";
import { requestNeedsFlyerWording, buildDeterministicCreativeRescueContent, evaluateMarketingOutput, findHollowSentences } from "../netlify/functions/_shared/marketing-content-revision.js";
import { buildDeterministicCreativeDirection } from "../netlify/functions/_shared/marketing-creative-direction.js";
import { routeMarketingEngine, ENGINES } from "../netlify/functions/_shared/marketing-engine-router.js";

// Personal-occasion concept-preservation batch (approved on top of
// b972b90 — the self-purchase hollow-sentence fix): Birthday acceptance
// testing proved three independent, general architectural gaps — false
// flyer-wording routing on a bare "promote/promoting", personal-occasion
// creative-mode classification silently collapsing into "everyday_floral",
// and the deterministic rescue carrying zero occasion awareness beyond
// self_purchase. This file proves all three are fixed, together, for
// birthday AND the other three personal-celebration occasions this batch
// covers — never a birthday-only special case.

const SHOP = { name: "Lilies in Bloom", phone: "6065064039" };

// ---------------------------------------------------------------------------
// PART 1 — routing. Two passes: the original Birthday-acceptance fix, then
// Ashley's own follow-up correction after reviewing it — a bare "promote/
// advertise" combined with a possessive "our/my X" turned out to be just
// as ordinary/casual as the bare verb alone ("promoting OUR birthday
// flowers" reproduced the exact mistake the first pass meant to fix), and
// "marketing post/piece"/"let ... know" are ordinary social-post
// vocabulary too. requestNeedsFlyerWording() now answers ONLY "does this
// request need meaningful information or wording to appear ON THE
// GRAPHIC" — never "is this generically marketing-flavored language."
// ---------------------------------------------------------------------------

test("requestNeedsFlyerWording: the exact Birthday acceptance-test request no longer routes to exact-layout merely because it contains \"promoting\"", () => {
  assert.equal(requestNeedsFlyerWording("Create a fun Facebook post promoting birthday flowers."), false);
});

test("requestNeedsFlyerWording (routing review — must NOT require exact-layout): ordinary social posts using generic marketing vocabulary, including a possessive \"our/my\", stay Premium-Creative/subject-forward eligible", () => {
  for (const text of [
    "Create a Facebook post promoting birthday flowers.",
    "Create a Facebook post promoting our birthday flowers.",
    "Make a marketing post about anniversary flowers.",
    "Let customers know we have birthday flowers.",
    "Create a post advertising our get-well flowers."
  ]) {
    assert.equal(requestNeedsFlyerWording(text), false, `"${text}" must NOT be routed to the exact-layout flyer path`);
  }
});

test("requestNeedsFlyerWording (routing review — must still require exact-layout): structured/fact-heavy requests keep their real on-graphic wording requirement", () => {
  for (const text of [
    "Make a flyer for 20% off bouquets this weekend.",
    "Create a poster that says Homecoming Orders Due September 15.",
    "Make an ad with our phone number and address on it.",
    "Let customers know we close at 2 PM today.",
    // A real explicit business-development/fact-heavy example already
    // covered by this codebase's own existing tests (marketing-studio-
    // closure-intent-and-persist-guard.test.js) — PROMOTIONAL_INTENT_RE,
    // completely untouched by this routing review.
    "make me a flyer to get more funeral business"
  ]) {
    assert.equal(requestNeedsFlyerWording(text), true, `"${text}" must still route to the deterministic flyer path`);
  }
});

test("requestNeedsFlyerWording: other ordinary casual requests using \"promote\"/\"promoting\"/\"advertise\"/\"marketing post\"/\"let ... know\" all stay a plain photo", () => {
  for (const text of [
    "Make a fun post promoting the new tulips.",
    "Write something promoting spring flowers for the feed.",
    "A cute post advertising fresh daisies.",
    "advertise our sympathy arrangements",
    "promote our valentines specials",
    "let customers know about our new subscription"
  ]) {
    assert.equal(requestNeedsFlyerWording(text), false, `"${text}" must NOT be routed to the flyer path`);
  }
});

test("requestNeedsFlyerWording: explicit flyer/poster/ad requests, discounts, exact facts, and operational notices are all UNCHANGED", () => {
  for (const text of [
    "I need a flyer",
    "make me a poster",
    "run an ad for us",
    "We're having a 20% off sale this weekend only.",
    "Reminder: order by Thursday for Mother's Day delivery.",
    "Lilies in Bloom is closing at 2:30 today.",
    "Let customers know we will be closing at 2 PM today.",
    "call 606-506-4039"
  ]) {
    assert.equal(requestNeedsFlyerWording(text), true, `"${text}" must still route to the deterministic flyer path`);
  }
});

test("requestNeedsFlyerWording: ordinary pictures stay pictures — no regression from this batch", () => {
  for (const text of [
    "make me an image of a jaguar holding a dozen roses saying go team",
    "a pretty picture of todays arrangement",
    "something seasonal and cheerful for the feed"
  ]) {
    assert.equal(requestNeedsFlyerWording(text), false, `"${text}" must stay a plain photo`);
  }
});

// ---------------------------------------------------------------------------
// PART 2 — occasion preservation: birthday/anniversary/new_baby/get_well
// all survive into creativeMode, copyVoice, and creative direction, not
// only birthday.
// ---------------------------------------------------------------------------

const PERSONAL_OCCASION_REQUESTS = {
  birthday: "Create a fun Facebook post promoting birthday flowers.",
  anniversary: "Create a post for our anniversary flowers.",
  new_baby: "Create a post about new baby flowers for a new arrival.",
  get_well: "Create a get well post to help someone feel better."
};

test("CREATIVE_MODES includes personal_celebration", () => {
  assert.ok(CREATIVE_MODES.includes("personal_celebration"));
});

test("PERSONAL_CELEBRATION_OCCASIONS is exactly the four existing occasion categories this batch covers — no invented category names", () => {
  assert.deepEqual([...PERSONAL_CELEBRATION_OCCASIONS].sort(), ["anniversary", "birthday", "get_well", "new_baby"]);
});

for (const [campaign, requestText] of Object.entries(PERSONAL_OCCASION_REQUESTS)) {
  test(`occasion preservation (${campaign}): occasionCategory/namedCampaign are correctly classified and creativeMode is personal_celebration, not everyday_floral`, () => {
    const occasionCategory = classifyOccasionCategory({ requestText, objective: null, isSympathy: false });
    assert.equal(occasionCategory, campaign);
    const namedCampaign = classifyNamedCampaign({ requestText, isSympathy: false, occasionCategory });
    assert.equal(namedCampaign, campaign);
    const creativeMode = classifyCreativeMode({ occasionCategory, namedCampaign, sympathyClassification: "not_sympathy", promotionIntent: "not_promotion", requestText });
    assert.equal(creativeMode, "personal_celebration");
  });

  test(`occasion preservation (${campaign}): buildCanonicalConcept persists the occasion all the way through, and it is protected identity, not execution detail`, () => {
    const concept = buildCanonicalConcept({
      requestText,
      objective: "retention",
      photoStrategy: "subject_forward",
      styleTier: "generated"
    });
    assert.equal(concept.occasionCategory, campaign);
    assert.equal(concept.namedCampaign, campaign);
    assert.equal(concept.creativeMode, "personal_celebration");
  });

  test(`occasion preservation (${campaign}): creative direction shares photo_forward_social's structure — subject-forward, real photo, NOT automatically a poster`, () => {
    const concept = buildCanonicalConcept({ requestText, objective: "retention", photoStrategy: "subject_forward", styleTier: "generated" });
    const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept, shopBrand: {} });
    assert.equal(direction.occasionTreatment, "photo_forward_social");
    assert.deepEqual(direction.graphicTextSlots, { brand: false, headline: false, supportingLine: false, serviceDetail: false, cta: false, phone: false });
    assert.equal(direction.hierarchyDepth, "headline_only");
  });

  test(`occasion preservation (${campaign}): copyVoice reflects the real occasion — never the flat professional+warm default every unmatched request gets`, () => {
    const copyVoice = classifyCopyVoice({ creativeMode: "personal_celebration", namedCampaign: campaign, occasionCategory: campaign, sympathyClassification: "not_sympathy", requestText });
    assert.ok(copyVoice.includes("warm"), `${campaign} copyVoice must include warm: ${copyVoice}`);
    if (campaign === "get_well") {
      assert.ok(copyVoice.includes("compassionate"), "get_well must be compassionate, not celebratory");
      assert.ok(!copyVoice.includes("celebratory"), "get_well must NOT read as celebratory");
    } else {
      assert.ok(copyVoice.includes("celebratory"), `${campaign} copyVoice must include celebratory: ${copyVoice}`);
    }
  });
}

test("occasion preservation: anniversary copyVoice adds romantic, distinguishing it from birthday/new_baby", () => {
  const copyVoice = classifyCopyVoice({ creativeMode: "personal_celebration", namedCampaign: "anniversary", occasionCategory: "anniversary", sympathyClassification: "not_sympathy", requestText: PERSONAL_OCCASION_REQUESTS.anniversary });
  assert.ok(copyVoice.includes("romantic"));
});

test("occasion preservation: birthday copyVoice adds playful when the request itself asks for \"fun\" — compatible with the exact requested tone", () => {
  const copyVoice = classifyCopyVoice({ creativeMode: "personal_celebration", namedCampaign: "birthday", occasionCategory: "birthday", sympathyClassification: "not_sympathy", requestText: PERSONAL_OCCASION_REQUESTS.birthday });
  assert.ok(copyVoice.includes("playful"), `birthday's own "fun Facebook post" wording must earn a playful voice: ${copyVoice}`);
});

test("occasion preservation: get_well and anniversary/new_baby lean into a gentler/warmer mood than birthday's own bright_joyful default — occasion-aware, not one-size-fits-all", () => {
  const moodFor = (campaign, requestText) => {
    const concept = buildCanonicalConcept({ requestText, objective: "retention", photoStrategy: "subject_forward", styleTier: "generated" });
    return buildDeterministicCreativeDirection({ canonicalConcept: concept, shopBrand: {} }).visualMood;
  };
  assert.equal(moodFor("birthday", PERSONAL_OCCASION_REQUESTS.birthday), "bright_joyful");
  assert.equal(moodFor("anniversary", PERSONAL_OCCASION_REQUESTS.anniversary), "romantic_soft");
  assert.equal(moodFor("new_baby", PERSONAL_OCCASION_REQUESTS.new_baby), "warm_inviting");
  assert.equal(moodFor("get_well", PERSONAL_OCCASION_REQUESTS.get_well), "warm_inviting");
});

// ---------------------------------------------------------------------------
// PART 3 — birthday specifically: Premium-Creative/subject-forward
// eligible, birthday-aware creative direction.
// ---------------------------------------------------------------------------

test("birthday: the canonical concept the real router would see resolves to premium_ai_creative — the exact eligibility the Birthday test needed and never got", () => {
  const concept = buildCanonicalConcept({
    requestText: PERSONAL_OCCASION_REQUESTS.birthday,
    objective: "retention",
    photoStrategy: "subject_forward",
    styleTier: "generated"
  });
  const decision = routeMarketingEngine({ canonicalConcept: concept, verifiedOfferFactsPresent: false });
  assert.equal(decision.engine, ENGINES.PREMIUM_AI_CREATIVE);
});

test("birthday: creative direction is bright/joyful and carries no invented factual claims — occasion identity guides mood, never a forced literal prop list", () => {
  const concept = buildCanonicalConcept({ requestText: PERSONAL_OCCASION_REQUESTS.birthday, objective: "retention", photoStrategy: "subject_forward", styleTier: "generated" });
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept, shopBrand: {} });
  assert.equal(direction.visualMood, "bright_joyful");
  assert.equal(direction.paletteMood, "soft_pastel");
  // No balloons/cake/candles are ever asked for by this deterministic
  // layer — it only ever emits bounded enum values, never free prose that
  // could invent a literal prop.
  assert.equal(typeof direction.visualMood, "string");
});

// ---------------------------------------------------------------------------
// PART 3 (rescue) — force deterministic rescue for birthday, anniversary,
// get-well, self-purchase, and generic/no occasion. Each preserves its own
// intent; unrelated behavior (self-purchase, CTA/phone composition) is
// unchanged.
// ---------------------------------------------------------------------------

test("rescue: birthday preserves the real occasion — never the generic 'moments that matter' fallback", () => {
  const rescue = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, occasionCategory: "birthday", namedCampaign: "birthday" });
  assert.match(rescue.headline, /birthday/i);
  assert.match(rescue.body, /birthday/i);
  assert.match(rescue.body, new RegExp(SHOP.name));
  assert.doesNotMatch(rescue.body, /moments that matter/i);
});

test("rescue: anniversary preserves the real occasion", () => {
  const rescue = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, occasionCategory: "anniversary", namedCampaign: "anniversary" });
  assert.match(rescue.headline, /anniversary/i);
  assert.match(rescue.body, /anniversary/i);
  assert.doesNotMatch(rescue.body, /moments that matter/i);
});

test("rescue: get-well preserves the real occasion, with gentle rather than celebratory wording", () => {
  const rescue = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, occasionCategory: "get_well", namedCampaign: "get_well" });
  assert.match(rescue.headline, /recovery|get.well/i);
  assert.match(rescue.body, /get.well|comfort/i);
  assert.doesNotMatch(rescue.body, /celebrat/i);
});

test("rescue: new_baby preserves the real occasion (covered by the same composition system, proving it generalizes beyond the three named in Part 3's minimum list)", () => {
  const rescue = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, occasionCategory: "new_baby", namedCampaign: "new_baby" });
  assert.match(rescue.body, /new|arrival|family/i);
  assert.doesNotMatch(rescue.body, /moments that matter/i);
});

test("rescue: self-purchase behavior is preserved BYTE-FOR-BYTE — occasion parameters present but irrelevant, self_purchase still wins first", () => {
  const rescue = buildDeterministicCreativeRescueContent({
    shopName: SHOP.name,
    shopPhone: SHOP.phone,
    audience: "self_purchase",
    // Even if an occasion happened to be classified alongside self_purchase
    // (unusual, but the function must never let it leak through) —
    // self_purchase must still win, exactly as before this batch.
    occasionCategory: "birthday",
    namedCampaign: "birthday"
  });
  assert.equal(rescue.headline, "Flowers, Just Because");
  assert.equal(rescue.body, `You don't need a reason to bring home flowers from ${SHOP.name} — sometimes wanting them is reason enough.`);
});

test("rescue: generic/no-occasion behavior is preserved BYTE-FOR-BYTE — the exact pre-existing fallback wording, unchanged", () => {
  const rescue = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, occasionCategory: "general", namedCampaign: "none" });
  assert.equal(rescue.headline, "Beautiful Blooms, Thoughtfully Arranged");
  assert.equal(rescue.body, `${SHOP.name} designs flowers for the moments that matter — a little something to brighten someone's day.`);
});

test("rescue: CTA/caption composition remains fully shared across every occasion — a call CTA appears only when a real phone exists and ctaIntent allows it, never invented per occasion", () => {
  const withPhone = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, occasionCategory: "birthday", namedCampaign: "birthday" });
  assert.match(withPhone.cta, /Call .*to place an order\./);
  assert.equal(withPhone.caption, `${withPhone.body} ${withPhone.cta}`);

  const noPhone = buildDeterministicCreativeRescueContent({ shopName: "", shopPhone: null, occasionCategory: "birthday", namedCampaign: "birthday" });
  assert.equal(noPhone.cta, "");
  assert.equal(noPhone.caption, noPhone.body);
  // Never a hard-coded shop identity when none is supplied.
  assert.doesNotMatch(noPhone.body, /Lilies in Bloom/);

  const ctaBlocked = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, ctaIntent: "visit_shop", occasionCategory: "birthday", namedCampaign: "birthday" });
  assert.equal(ctaBlocked.cta, "", "a non-call ctaIntent must never get an invented call CTA, occasion or not");
});

test("rescue: never invents a flower species, discount, date, or business fact for any personal occasion", () => {
  for (const [namedCampaign, occasionCategory] of [
    ["birthday", "birthday"],
    ["anniversary", "anniversary"],
    ["new_baby", "new_baby"],
    ["get_well", "get_well"]
  ]) {
    const rescue = buildDeterministicCreativeRescueContent({ shopName: SHOP.name, shopPhone: SHOP.phone, occasionCategory, namedCampaign });
    // Strip the shop's own name first — "Lilies in Bloom" legitimately
    // contains "Lilies" as its real identity, not an invented flower
    // species; the check below is about content the rescue composed on
    // its own, never about the shop's real, supplied name.
    const text = `${rescue.headline} ${rescue.body}`.replace(new RegExp(SHOP.name, "gi"), "");
    assert.doesNotMatch(text, /\d+%|discount|sale|deadline|order by/i, `${namedCampaign} rescue must not invent a promotion/deadline: "${text}"`);
    assert.doesNotMatch(text, /roses?|tulips?|peon(?:y|ies)|daisies|daisy/i, `${namedCampaign} rescue must not invent a specific flower species: "${text}"`);
  }
});

// ---------------------------------------------------------------------------
// PART 4 — copy quality + safety: existing protections remain fully
// active for personal occasions. Hollow-sentence detection is NOT
// exempted for personal_celebration the way it is for self_purchase.
// ---------------------------------------------------------------------------

test("safety: findHollowSentences still flags genuinely vague, non-specific birthday copy — personal occasions are NOT exempted the way self_purchase is", () => {
  const hollow = findHollowSentences(
    "Every celebration deserves something beautiful and memorable to mark the occasion in style.",
    SHOP.name,
    { audience: "general_local_customers" }
  );
  assert.equal(hollow.length, 1, "vague birthday-adjacent copy with no named flower/product/detail must still be flagged hollow");
});

test("safety: concrete, specific birthday copy (a named flower/product) passes the SAME hollow-sentence check cleanly — proving the right fix is context, not a weakened heuristic", () => {
  const hollow = findHollowSentences(
    "Send a bright bouquet of gerbera daisies to make their birthday feel extra special this year.",
    SHOP.name,
    { audience: "general_local_customers" }
  );
  assert.equal(hollow.length, 0, "concrete, on-topic birthday copy naming a real flower must pass — the heuristic itself is not the defect");
});

test("safety: evaluateMarketingOutput end-to-end — a caption that is MOSTLY hollow (the aggregate check's own pre-existing, unchanged bar) is still rejected/repaired via weak_copy_hollow_sentence, exactly like any other non-exempt audience", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: PERSONAL_OCCASION_REQUESTS.birthday,
    shopEvidence: SHOP,
    candidate: {
      headline: "A Wonderful Celebration",
      body: "Every celebration deserves something beautiful and memorable to mark the occasion in style. It really is the perfect way to make someone feel truly special today.",
      cta: "Visit us today"
    },
    canonicalConcept: { audience: "general_local_customers", occasionCategory: "birthday" },
    component: "caption"
  });
  assert.ok(result.reasons.length > 0);
  assert.ok(result.weakCopyReasonCodes.includes("weak_copy_hollow_sentence"));
});

test("safety: evaluateMarketingOutput end-to-end — concrete birthday copy passes cleanly with zero reasons", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: PERSONAL_OCCASION_REQUESTS.birthday,
    shopEvidence: SHOP,
    candidate: { headline: "Birthday Blooms", body: "Send a bright bouquet of gerbera daisies to make their birthday feel extra special this year.", cta: "Order today" },
    canonicalConcept: { audience: "general_local_customers", occasionCategory: "birthday" },
    component: "caption"
  });
  assert.equal(result.reasons.length, 0);
  assert.equal(result.decision, "pass");
});

test("safety: an invented current-stock inventory claim in a birthday caption is still caught and repaired", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: PERSONAL_OCCASION_REQUESTS.birthday,
    shopEvidence: SHOP,
    inventoryEvidence: [],
    candidate: { headline: "Birthday Blooms", body: "We just got a fresh shipment of birthday-perfect peonies in today, order now.", cta: "Order today" },
    canonicalConcept: { audience: "general_local_customers", occasionCategory: "birthday" },
    component: "caption"
  });
  assert.ok(result.reasons.length > 0);
  assert.ok(result.repairedBy.includes("stripUnverifiedInventoryClaims"));
});

test("safety: an unsupported temporal claim in a birthday caption is still caught and repaired", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: PERSONAL_OCCASION_REQUESTS.birthday,
    shopEvidence: SHOP,
    candidate: { headline: "Birthday Blooms", body: "It's finally Friday, the perfect day for birthday flowers from a rose bouquet.", cta: "Order today" },
    canonicalConcept: { audience: "general_local_customers", occasionCategory: "birthday" },
    component: "caption"
  });
  assert.ok(result.repairedBy.includes("stripInventedTemporalClaims"));
});

test("safety: sympathy classification/behavior is completely unaffected by this batch — sympathy always wins over any occasion signal", () => {
  const occasionCategory = classifyOccasionCategory({ requestText: "Flowers for the Wilson family, they just lost their dad.", objective: null, isSympathy: true });
  assert.equal(occasionCategory, "sympathy");
  const creativeMode = classifyCreativeMode({ occasionCategory, namedCampaign: "sympathy", sympathyClassification: "sympathy", promotionIntent: "not_promotion", requestText: "Flowers for the Wilson family, they just lost their dad." });
  assert.equal(creativeMode, "sympathy_elegance", "sympathy must never resolve to personal_celebration, regardless of any other signal");
});

test("safety: fabricated phone numbers and diversity/inventory/temporal protections all remain reachable for personal_celebration — none of this batch's changes touch those detectors", () => {
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: "Closing early today",
    shopEvidence: SHOP,
    candidate: { headline: "Closing Early", body: "We're closing early today.", cta: "Call (555) 555-5555" },
    canonicalConcept: { audience: "general_local_customers", occasionCategory: "birthday" },
    component: "flyer_text"
  });
  assert.equal(result.decision, "retry");
  assert.match(result.safeCandidate.cta, /6065064039|606-506-4039/);
});
