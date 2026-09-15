import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyEventFacts,
  buildCanonicalConcept,
  EVENT_FACTS_VERSION,
  EVENT_CAMPAIGN_LABELS
} from "../netlify/functions/_shared/marketing-canonical-concept.js";
import {
  classifySentenceSpecificity,
  hasEventSpecificity,
  eventSpecificitySignals,
  findHollowSentences,
  buildCopySpecificityProfile,
  detectMissingEventFacts,
  detectUnsupportedEventClaims,
  stripUnsupportedEventClaims,
  buildDeterministicEventReminderRescueContent,
  buildDeterministicCreativeRescueContent,
  buildDeterministicPromotionRescueContent,
  evaluateMarketingOutput,
  buildCopyEvaluationDiagnostic,
  EVENT_FACT_CODES
} from "../netlify/functions/_shared/marketing-content-revision.js";
import { _internalsForTesting, COPY_GUIDANCE_VERSION } from "../netlify/functions/_shared/ai-creative-engine.js";
import { buildCreativeDirectorDirection } from "../netlify/functions/_shared/marketing-creative-director.js";
import { buildBackgroundPromptFromBrief } from "../netlify/functions/_shared/marketing-premium-creative-orchestrator.js";
import { buildDeterministicCreativeDirection } from "../netlify/functions/_shared/marketing-creative-direction.js";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

/**
 * Test E ("event-reminder fact preservation + copy intelligence fix",
 * 2026-09-15). The live run of the EXACT prompt below (item 8ff9a31d, asset
 * 026e7648) classified correctly but shipped the generic florist rescue:
 * both generated captions were judged hollow, and the rescue dropped
 * Homecoming, the audience, the order reminder and all three products. These
 * tests prove the structured event contract survives generation →
 * evaluation → rescue → flyer wording → image direction, that nothing
 * unsupplied can be invented, that generic copy is still rejected, and that
 * everyday/promotion/birthday/sympathy behavior is untouched.
 */

const TEST_E_BRIEF = "Remind parents and students to order homecoming bouquets, corsages and boutonnieres.";
const SHOP = "Lilies in Bloom";
const PHONE = "606-506-4039";
const SHOP_EVIDENCE = { name: SHOP, phone: PHONE };
const CONTRACT = classifyEventFacts({ requestText: TEST_E_BRIEF, occasionTitle: TEST_E_BRIEF.slice(0, 80) });
const CONCEPT = { audience: "students_and_parents", messageIntent: "general_everyday", eventFacts: CONTRACT, ctaIntent: "call_shop" };

function evalCaption(body, { concept = CONCEPT, request = TEST_E_BRIEF, isRetryAttempt = false, headline = "" } = {}) {
  return evaluateMarketingOutput({ route: "generate_content", request, shopEvidence: SHOP_EVIDENCE, inventoryEvidence: [], canonicalConcept: concept, candidate: { headline, body, cta: "" }, component: "caption", isRetryAttempt });
}
function evalFlyer(candidate, { concept = CONCEPT, request = TEST_E_BRIEF } = {}) {
  return evaluateMarketingOutput({ route: "generate_content", request, shopEvidence: SHOP_EVIDENCE, inventoryEvidence: [], canonicalConcept: concept, candidate, component: "flyer_text", isRetryAttempt: false, graphicTextLimits: { ctaMaxChars: 30 } });
}

// ---------------------------------------------------------------------------
// Part 1 — the contract.
// ---------------------------------------------------------------------------

test("Part 1: the exact Test E prompt resolves to the event contract — homecoming / parents and students / order / bouquets, corsages, boutonnieres — with every absent fact explicitly null", () => {
  assert.deepEqual(CONTRACT, {
    version: EVENT_FACTS_VERSION,
    event: "homecoming",
    eventLabel: "Homecoming",
    audience: "students_and_parents",
    audienceLabel: "parents and students",
    action: "order",
    products: ["bouquets", "corsages", "boutonnieres"],
    eventDate: null,
    orderDeadline: null,
    school: null,
    pricing: null,
    promotion: null,
    scarcity: null,
    fulfillmentTiming: null
  });
});

test("Part 1: event-general — Prom, graduation ordering, and a school-dance reminder each get their own contract from the same classifier; singular product forms and the florist's own product order are kept", () => {
  const prom = classifyEventFacts({ requestText: "Remind students to order prom corsages and boutonnieres." });
  assert.equal(prom.event, "prom");
  assert.equal(prom.eventLabel, "Prom");
  assert.deepEqual(prom.products, ["corsages", "boutonnieres"]);
  assert.equal(prom.audienceLabel, "students");
  const grad = classifyEventFacts({ requestText: "Remind families to order a graduation bouquet for their grad." });
  assert.equal(grad.event, "graduation");
  assert.deepEqual(grad.products, ["bouquets"], "singular 'bouquet' resolves to the canonical product");
  assert.equal(grad.audienceLabel, "families");
  const dance = classifyEventFacts({ requestText: "School dance reminder: students, reserve your boutonniere, corsage and bouquet with us." });
  assert.equal(dance.event, "school_dance");
  assert.equal(dance.eventLabel, EVENT_CAMPAIGN_LABELS.school_dance);
  assert.equal(dance.action, "reserve");
  assert.deepEqual(dance.products, ["boutonnieres", "corsages", "bouquets"], "the florist's own order, singular forms accepted");
  // A plain graduation celebration post (no ordering action) is NOT an
  // event reminder — it keeps its existing behavior untouched.
  assert.equal(classifyEventFacts({ requestText: "Create a graduation bouquet post." }), null);
  // Non-events carry no contract at all.
  assert.equal(classifyEventFacts({ requestText: "Create a cute Facebook post for 20% off bouquets this weekend." }), null);
  assert.equal(classifyEventFacts({ requestText: "Create a Facebook post encouraging people to send flowers today." }), null);
  assert.equal(classifyEventFacts({ requestText: "Create a birthday Facebook post for a friend turning 40." }), null);
  assert.equal(classifyEventFacts({ requestText: "Create a gentle Facebook post letting families know we can help with funeral flowers." }), null);
});

test("Part 1: supplied facts are captured verbatim — a date, a deadline, a school, pricing, scarcity, pickup timing — and only then", () => {
  const c = classifyEventFacts({ requestText: "Remind students to order prom corsages by Friday, May 3 for pickup on Saturday morning at Lincoln High School. Corsages start at $25, limited quantities." });
  assert.equal(c.event, "prom");
  assert.equal(c.orderDeadline, "by Friday, May 3");
  assert.equal(c.eventDate, null, "a deadline's own weekday, or a pickup day, is never the EVENT date");
  assert.equal(c.school, "Lincoln High School");
  const dated = classifyEventFacts({ requestText: "Homecoming is September 19 — remind students to order corsages by Friday." });
  assert.equal(dated.eventDate, "September 19");
  assert.equal(dated.orderDeadline, "by Friday");
  // A sentence-initial imperative is never part of the school's name.
  assert.equal(classifyEventFacts({ requestText: "Remind Lincoln High School students to order homecoming corsages." }).school, "Lincoln High School");
  assert.match(c.pricing, /^\$25/);
  assert.equal(c.scarcity, "limited quantities");
  assert.match(c.fulfillmentTiming, /^pickup on Saturday/i);
});

test("Part 1: buildCanonicalConcept carries eventFacts (null for a non-event) without touching any identity field", () => {
  const concept = buildCanonicalConcept({ requestText: TEST_E_BRIEF, occasionTitle: TEST_E_BRIEF.slice(0, 80), objective: "seasonal_occasion", platform: "facebook", contentType: "image_post", assetType: "flyer" });
  assert.equal(concept.occasionCategory, "event_reminder");
  assert.equal(concept.namedCampaign, "homecoming");
  assert.equal(concept.audience, "students_and_parents");
  assert.equal(concept.creativeMode, "campaign_poster");
  assert.deepEqual(concept.eventFacts, CONTRACT);
  assert.equal(concept.promotionFacts, null);
  const everyday = buildCanonicalConcept({ requestText: "Create a Facebook post encouraging people to send flowers today.", objective: "awareness" });
  assert.equal(everyday.eventFacts, null);
});

// ---------------------------------------------------------------------------
// Part 2 — event specificity in the hollow-sentence evaluator.
// ---------------------------------------------------------------------------

test("Part 2: appropriate event-reminder sentences count as specific — but only with two distinct event signals together; generic event copy stays hollow; nothing changes without a contract", () => {
  const specific = [
    "Parents and students, don't forget to order your homecoming bouquets.",
    "Homecoming bouquets and boutonnieres can be ordered right now at the shop.",
    "Students, reserve your prom corsage this week.",
    "Order your homecoming flowers from Lilies in Bloom."
  ];
  // Never hollow — and the pure-event ones (no listed bloom, no number) classify as "event".
  for (const s of specific) assert.notEqual(classifySentenceSpecificity(s, SHOP, { eventFacts: CONTRACT }), "hollow", s);
  assert.equal(classifySentenceSpecificity(specific[0], SHOP, { eventFacts: CONTRACT }), "event");
  // (Sentences that also carry a listed bloom, a number or a shop-detail phrase
  // classify "commercial" first — the event route only ever ADDS specificity.)
  const stillHollow = [
    "Homecoming is a special time for everyone in town.",
    "Bouquets make every celebration feel a little brighter.",
    "Beautiful flowers for life's special moments.",
    "Brighten someone's day with flowers.",
    "Call us to place an order."
  ];
  for (const s of stillHollow) assert.notEqual(classifySentenceSpecificity(s, SHOP, { eventFacts: CONTRACT }), "event", s);
  assert.equal(classifySentenceSpecificity("Beautiful flowers for all of life's most special moments and memories.", SHOP, { eventFacts: CONTRACT }), "hollow");
  // Signals are reported individually.
  assert.deepEqual(eventSpecificitySignals("Parents and students, order your corsages now.", CONTRACT), { event: false, audience: true, product: true, action: true });
  assert.equal(hasEventSpecificity("Homecoming is here.", CONTRACT), false);
  // Without a contract the event route never runs — everyday behavior is byte-identical.
  assert.equal(classifySentenceSpecificity("Parents and students, don't forget to order your homecoming bouquets.", SHOP), "hollow");
  assert.equal(classifySentenceSpecificity("Your sister hasn't heard from you in a month.", SHOP), "human_situational");
  assert.equal(classifySentenceSpecificity("Twelve stems, hand-tied in the shop this morning for whoever needs them.", SHOP), "commercial");
});

test("Part 2: the hollow-sentence rule no longer rejects a real homecoming reminder, and still rejects a mostly-generic one", () => {
  const good = "Homecoming is almost here! Parents and students, now is the time to order your homecoming bouquets, corsages and boutonnieres from Lilies in Bloom. Stop in or give us a call.";
  const r = evalCaption(good);
  assert.equal(r.decision, "pass", JSON.stringify(r.reasons));
  assert.deepEqual(r.weakCopyReasonCodes, []);
  assert.deepEqual(r.eventFactCodes, []);
  const profile = buildCopySpecificityProfile("Parents and students, don't forget to order your homecoming bouquets. Corsages and boutonnieres too. Call us today.", { shopName: SHOP, eventFacts: CONTRACT });
  assert.equal(profile.eventSpecificityMatched, true);
  assert.ok(profile.sentenceCategoryCounts.event >= 1);
  assert.deepEqual(findHollowSentences("Parents and students, order your homecoming corsages now. Flowers make every single day feel a little better.", SHOP, { eventFacts: CONTRACT }), ["Flowers make every single day feel a little better."]);
  // Mostly generic event copy is still weak copy (never an exemption).
  const generic = "Homecoming is a magical night to remember forever. Flowers make every memory sweeter and every smile brighter. Let us be part of your special moments this season.";
  const g = evalCaption(generic);
  assert.equal(g.decision, "retry");
  assert.ok(g.weakCopyReasonCodes.includes("weak_copy_hollow_sentence"), JSON.stringify(g.weakCopyReasonCodes));
});

// ---------------------------------------------------------------------------
// Part 3 — fact preservation and unsupported inventions.
// ---------------------------------------------------------------------------

test("Part 3: dropping the core facts is a rejection — the exact live rescue text, and the required generic fixtures, fail preservation with precise codes", () => {
  const liveShipped = "Lilies in Bloom designs flowers for the moments that matter — a little something to brighten someone's day. Call 606-506-4039 to place an order.";
  const r = evalCaption(liveShipped);
  assert.equal(r.decision, "retry");
  assert.deepEqual(r.eventFactCodes, ["event_name_missing", "event_product_missing:bouquets", "event_product_missing:corsages", "event_product_missing:boutonnieres", "event_audience_missing"]);
  assert.ok(r.reasonCodes.includes("event_fact_missing"));
  for (const fixture of ["Beautiful flowers for life's special moments.", "Brighten someone's day with flowers.", "Call us to place an order."]) {
    const codes = detectMissingEventFacts({ generatedText: fixture, eventFacts: CONTRACT }).map((m) => m.code);
    assert.ok(codes.includes("event_name_missing"), fixture);
    assert.ok(codes.includes("event_product_missing"), fixture);
    assert.ok(codes.includes("event_audience_missing"), fixture);
  }
  // One dropped product is enough.
  const dropped = evalCaption("Homecoming is almost here! Parents and students, order your homecoming bouquets and corsages from Lilies in Bloom today.");
  assert.deepEqual(dropped.eventFactCodes, ["event_product_missing:boutonnieres"]);
  // The audience may be expressed naturally — either noun counts.
  assert.deepEqual(detectMissingEventFacts({ generatedText: "Students: homecoming bouquets, corsages and boutonnieres are ready to order.", eventFacts: CONTRACT }), []);
  assert.deepEqual(detectMissingEventFacts({ generatedText: "Parents, order the homecoming bouquet, corsage and boutonniere now.", eventFacts: CONTRACT }), [], "singular forms preserve the product");
  // Flyer wording must carry the event and the ordering purpose; its short slots need not list every product.
  assert.deepEqual(detectMissingEventFacts({ generatedText: "Order Your Homecoming Flowers Call 606-506-4039", eventFacts: CONTRACT, component: "flyer_text" }), []);
  assert.deepEqual(detectMissingEventFacts({ generatedText: "Beautiful Blooms, Thoughtfully Arranged Lilies in Bloom designs flowers for the moments that matter.", eventFacts: CONTRACT, component: "flyer_text" }).map((m) => m.code), ["event_name_missing", "event_action_missing"]);
});

test("Part 3: unsupported inventions are rejected — a deadline, a date, scarcity, online ordering, free delivery, an invented school, pricing, a discount — and allowed only when the florist supplied them", () => {
  const cases = [
    ["Parents and students, order your homecoming bouquets, corsages and boutonnieres by Friday.", "event_deadline_invented"],
    ["Homecoming is September 19 — order your bouquets, corsages and boutonnieres now.", "event_date_invented"],
    ["Order your homecoming corsages and boutonnieres soon, limited quantities!", "event_scarcity_invented"],
    ["Parents and students can order homecoming bouquets, corsages and boutonnieres online.", "event_online_ordering_invented"],
    ["Free delivery on all homecoming corsages and boutonnieres for students and parents.", "event_fulfillment_invented"],
    ["Lincoln High School students, order your homecoming corsages and boutonnieres today.", "event_school_invented"],
    ["Homecoming corsages start at $25 for students and parents.", "event_pricing_invented"],
    ["Take 15% off homecoming bouquets, corsages and boutonnieres, parents and students!", "event_discount_invented"],
    ["Order your homecoming flowers before they sell out, students!", "event_scarcity_invented"]
  ];
  for (const [text, code] of cases) {
    const codes = detectUnsupportedEventClaims({ generatedText: text, requestText: TEST_E_BRIEF, eventFacts: CONTRACT }).map((v) => v.code);
    assert.ok(codes.includes(code), `expected ${code} for "${text}", got ${JSON.stringify(codes)}`);
  }
  // General urgency the florist asked for is fine.
  assert.deepEqual(detectUnsupportedEventClaims({ generatedText: "Order your homecoming flowers now — parents and students, don't forget your bouquets, corsages and boutonnieres.", requestText: TEST_E_BRIEF, eventFacts: CONTRACT }), []);
  // Supplied facts are allowed through.
  const suppliedReq = "Remind students to order prom corsages and boutonnieres by Friday, May 3 at Lincoln High School.";
  const supplied = classifyEventFacts({ requestText: suppliedReq });
  assert.deepEqual(detectUnsupportedEventClaims({ generatedText: "Lincoln High School students: order your prom corsages and boutonnieres by Friday, May 3.", requestText: suppliedReq, eventFacts: supplied }), []);
  // The strip removes only the offending sentence.
  const stripped = stripUnsupportedEventClaims({ generatedText: "Parents and students, order your homecoming bouquets, corsages and boutonnieres. Order by Friday or miss out!", requestText: TEST_E_BRIEF, eventFacts: CONTRACT });
  assert.equal(stripped.text, "Parents and students, order your homecoming bouquets, corsages and boutonnieres.");
  assert.equal(stripped.removed.length, 1);
  assert.ok(EVENT_FACT_CODES.includes("event_deadline_invented"));
});

test("Part 3: through the evaluator an invented deadline is BLOCKING (retry, then rescue) and the diagnostic carries the codes only", () => {
  const r = evalCaption("Homecoming is coming! Parents and students, order your homecoming bouquets, corsages and boutonnieres by Friday from Lilies in Bloom.");
  assert.equal(r.decision, "retry");
  assert.ok(r.blockingReasons.length >= 1);
  // "by Friday" is both a weekday the florist never gave and a deadline.
  assert.deepEqual(r.eventFactCodes, ["event_date_invented", "event_deadline_invented"]);
  const d = buildCopyEvaluationDiagnostic({ evalResult: r, attempt: 1, selected: false, rescueFired: false });
  assert.deepEqual(d.eventFactCodes, ["event_date_invented", "event_deadline_invented"]);
  assert.doesNotMatch(JSON.stringify(d), /Friday/, "never the text");
  const retry = evalCaption("Homecoming is coming! Parents and students, order your homecoming bouquets, corsages and boutonnieres by Friday from Lilies in Bloom.", { isRetryAttempt: true });
  assert.equal(retry.decision, "reject");
});

// ---------------------------------------------------------------------------
// Part 4 — the deterministic event-reminder rescue.
// ---------------------------------------------------------------------------

test("Part 4: the event rescue composes safe copy from the contract only — event, audience, action, all three products, verified shop name and phone — and invents nothing", () => {
  const rescue = buildDeterministicEventReminderRescueContent({ shopName: SHOP, shopPhone: "6065064039", eventFacts: CONTRACT });
  assert.deepEqual(rescue, {
    headline: "Order Your Homecoming Flowers",
    body: "Order homecoming bouquets, corsages and boutonnieres.",
    cta: "Call 606-506-4039",
    caption: "Homecoming is coming up! Parents and students, don't forget to order your bouquets, corsages and boutonnieres from Lilies in Bloom. Call 606-506-4039 to order.",
    kind: "creative_rescue",
    eventReminder: true
  });
  assert.ok(rescue.headline.length <= 42 && rescue.body.length <= 60 && rescue.cta.length <= 30);
  // The rescue itself passes its own contract checks in both surfaces.
  assert.deepEqual(detectMissingEventFacts({ generatedText: rescue.caption, eventFacts: CONTRACT }), []);
  assert.deepEqual(detectUnsupportedEventClaims({ generatedText: rescue.caption, requestText: TEST_E_BRIEF, eventFacts: CONTRACT }), []);
  assert.deepEqual(detectMissingEventFacts({ generatedText: `${rescue.headline} ${rescue.body} ${rescue.cta}`, eventFacts: CONTRACT, component: "flyer_text" }), []);
  assert.equal(evalCaption(rescue.caption).decision, "pass");
  assert.equal(evalFlyer({ headline: rescue.headline, body: rescue.body, cta: rescue.cta }).decision, "pass");
  // No CTA when the concept's intent forbids a call.
  assert.equal(buildDeterministicEventReminderRescueContent({ shopName: SHOP, shopPhone: "6065064039", ctaIntent: "visit_shop", eventFacts: CONTRACT }).cta, "");
});

test("Part 4: event-general rescue — Prom, the school dance and Graduation compose from their own contracts; the generic creative rescue defers to it and is byte-for-byte unchanged otherwise", () => {
  const prom = buildDeterministicEventReminderRescueContent({ shopName: SHOP, shopPhone: "6065064039", eventFacts: classifyEventFacts({ requestText: "Remind students to order prom corsages and boutonnieres." }) });
  assert.equal(prom.headline, "Order Your Prom Flowers");
  assert.equal(prom.body, "Order prom corsages and boutonnieres.");
  assert.equal(prom.caption, "Prom is coming up! Students, don't forget to order your corsages and boutonnieres from Lilies in Bloom. Call 606-506-4039 to order.");
  const dance = buildDeterministicEventReminderRescueContent({ shopName: SHOP, shopPhone: null, eventFacts: classifyEventFacts({ requestText: "Remind students to reserve school dance corsages." }) });
  assert.equal(dance.headline, "Reserve Your School Dance Flowers");
  assert.equal(dance.caption, "The school dance is coming up! Students, don't forget to reserve your corsages from Lilies in Bloom.");
  assert.equal(dance.cta, "");
  const grad = buildDeterministicEventReminderRescueContent({ shopName: SHOP, shopPhone: "6065064039", eventFacts: classifyEventFacts({ requestText: "Remind families to order graduation bouquets." }) });
  assert.equal(grad.headline, "Order Your Graduation Flowers");
  assert.equal(grad.caption, "Graduation is coming up! Families, don't forget to order your bouquets from Lilies in Bloom. Call 606-506-4039 to order.");
  for (const r of [prom, dance, grad]) assert.doesNotMatch(JSON.stringify(r), /\b(?:by|before)\s+\w+day|\d{1,2}\/\d{1,2}|limited|online|deliver|\$\d|% off|High School/i);
  // Deferral.
  const viaGeneric = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: "6065064039", audience: "students_and_parents", occasionCategory: "event_reminder", namedCampaign: "homecoming", messageIntent: "general_everyday", eventFacts: CONTRACT });
  assert.equal(viaGeneric.eventReminder, true);
  assert.equal(viaGeneric.caption, "Homecoming is coming up! Parents and students, don't forget to order your bouquets, corsages and boutonnieres from Lilies in Bloom. Call 606-506-4039 to order.");
  // Unchanged elsewhere.
  const birthday = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: "6065064039", occasionCategory: "birthday", namedCampaign: "birthday" });
  assert.equal(birthday.headline, "Birthday Blooms, Ready to Celebrate");
  const sympathy = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: "6065064039", occasionCategory: "sympathy", namedCampaign: "sympathy" });
  assert.equal(sympathy.headline, "Funeral & Sympathy Flowers");
  const everyday = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: "6065064039", occasionCategory: "general", namedCampaign: "none", messageIntent: "send_flowers", userTemporalIntent: "today" });
  assert.equal(everyday.headline, "Flowers, Sent With Thought");
  const promo = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: "6065064039", promotionFacts: { discount: { type: "percent", value: "20", text: "20% off" }, product: "bouquets", timing: "this weekend", promoCode: null, redemptionChannel: null, restrictions: [] } });
  assert.equal(promo.promotion, true);
  assert.equal(promo.headline, buildDeterministicPromotionRescueContent({ shopName: SHOP, shopPhone: "6065064039", promotionFacts: { discount: { type: "percent", value: "20", text: "20% off" }, product: "bouquets", timing: "this weekend", promoCode: null, redemptionChannel: null, restrictions: [] } }).headline);
});

// ---------------------------------------------------------------------------
// Parts 2/5/6 — prompt line and image direction.
// ---------------------------------------------------------------------------

test("Part 2/5: both wording prompts carry the EVENT CONTRACT with every absent fact spelled out as NONE; promptContext records it; guidance version bumped", () => {
  const line = _internalsForTesting.eventFactsLine(CONTRACT);
  assert.match(line, /EVENT CONTRACT — this is a Homecoming reminder post/);
  assert.match(line, /Audience: "parents and students"/);
  assert.match(line, /Products: bouquets, corsages, boutonnieres — name ALL of them/);
  assert.match(line, /Event date: NONE supplied/);
  assert.match(line, /Order deadline: NONE/);
  assert.match(line, /School: NONE/);
  assert.match(line, /Pricing\/discount: NONE/);
  assert.match(line, /Inventory\/scarcity: NONE/);
  assert.match(line, /Pickup\/delivery timing: NONE/);
  assert.match(line, /Online ordering: NONE/);
  assert.equal(_internalsForTesting.eventFactsLine(null), "");
  const social = _internalsForTesting.buildSocialPostTask({ channel: "facebook", occasion: TEST_E_BRIEF, shop: { name: SHOP }, requestText: TEST_E_BRIEF, concept: { isSympathy: false, audience: "students_and_parents", eventFacts: CONTRACT } });
  assert.match(social, /EVENT CONTRACT — this is a Homecoming reminder post/);
  const flyer = _internalsForTesting.buildFlyerContentTask({ occasion: TEST_E_BRIEF, visualStyleSignal: true, shop: { name: SHOP }, requestText: TEST_E_BRIEF, concept: { isSympathy: false, objective: "seasonal_occasion", eventFacts: CONTRACT, ctaMaxChars: 30 } });
  assert.match(flyer, /EVENT CONTRACT — this is a Homecoming reminder post/);
  assert.equal(_internalsForTesting.buildSocialPostPromptContext({ eventFacts: CONTRACT }).eventContractIncluded, true);
  assert.equal(_internalsForTesting.buildSocialPostPromptContext({}).eventContractIncluded, false);
  assert.equal(COPY_GUIDANCE_VERSION, "2026-09-15.v5");
});

test("Part 6: the image direction reads the structured contract — school-dance flowers with corsage/boutonniere/bouquet cues, balloons and every school detail forbidden — and only when a contract exists", () => {
  const concept = buildCanonicalConcept({ requestText: TEST_E_BRIEF, occasionTitle: TEST_E_BRIEF.slice(0, 80), objective: "seasonal_occasion", platform: "facebook", contentType: "image_post", assetType: "flyer", ctaText: "Call 606-506-4039", photoStrategy: "subject_forward", styleTier: "generated" });
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept, shopBrand: {} });
  const director = buildCreativeDirectorDirection({ canonicalConcept: concept, creativeDirection: direction });
  assert.equal(director.ok, true);
  assert.match(director.directionText, /campaign for a school homecoming dance/);
  assert.match(director.directionText, /a hand-tied bouquet, a wrist corsage on satin ribbon, a matching boutonniere/);
  assert.match(director.directionText, /never balloons, streamers, confetti, cake, birthday or wedding cues/);
  assert.match(director.directionText, /Never depict a school name, mascot, logo, jersey, pennant, banner, scoreboard, specific school colors, a date, or any lettering/);
  assert.match(director.avoidanceText, /balloons, streamers, confetti or cake/);
  assert.doesNotMatch(director.directionText, /Lincoln|September|order homecoming bouquets/i, "no request text, no invented school or date");
  const prompt = buildBackgroundPromptFromBrief({ styleText: [], occasion: "event_reminder" }, { canonicalConcept: concept, creativeDirection: direction });
  assert.match(prompt, /school homecoming dance/);
  assert.match(prompt, /wrist corsage/);
  // A non-event direction is byte-identical to before.
  const everyday = buildCanonicalConcept({ requestText: "Create a Facebook post encouraging people to send flowers today.", objective: "awareness", photoStrategy: "subject_forward", styleTier: "generated" });
  const everydayDirection = buildDeterministicCreativeDirection({ canonicalConcept: everyday, shopBrand: {} });
  const everydayDirector = buildCreativeDirectorDirection({ canonicalConcept: everyday, creativeDirection: everydayDirection });
  assert.doesNotMatch(everydayDirector.directionText, /campaign for a|corsage|balloons/);
  assert.doesNotMatch(everydayDirector.avoidanceText, /balloons/);
  // Prom uses its own setting.
  const promConcept = buildCanonicalConcept({ requestText: "Remind students to order prom corsages and boutonnieres.", objective: "seasonal_occasion", photoStrategy: "subject_forward", styleTier: "generated" });
  const promDirector = buildCreativeDirectorDirection({ canonicalConcept: promConcept, creativeDirection: buildDeterministicCreativeDirection({ canonicalConcept: promConcept, shopBrand: {} }) });
  assert.match(promDirector.directionText, /campaign for a prom night/);
  assert.doesNotMatch(promDirector.directionText, /hand-tied bouquet/, "only the supplied products are cued");
});

// ---------------------------------------------------------------------------
// Part 7 — the exact failed run, through the real handler.
// ---------------------------------------------------------------------------

function floristDeps(client) {
  return { florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
function responsesFor(brief) {
  const fixed = [
    { data: { id: "item-1", content_type: "image_post", title: brief.slice(0, 80), brief, status: "idea" }, error: null },
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
const LIVE_GENERIC_SHAPE = "Homecoming season is a magical time to celebrate the moments that matter with the people you love. Flowers have a way of making every memory feel a little more special. Our team is here to help you find the perfect touch for the big night. Let us make this homecoming one to remember. Reach out today and we will take care of the rest.";

async function runTestE({ captionBodies, flyerCopies = null, captionCta = "" }) {
  const originalFetch = globalThis.fetch;
  const originalOpenAi = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const calls = { social: 0, flyer: 0, image: 0, other: 0 };
  const socialPrompts = [];
  const flyerPrompts = [];
  globalThis.fetch = async (url, options) => {
    const body = String(options?.body || "");
    if (String(url).includes("flux")) {
      calls.image++;
      return { ok: true, json: async () => ({ success: true, result: { image: Buffer.from("fake-jpeg-bytes").toString("base64") } }) };
    }
    if (body.includes(SOCIAL_MARKER)) {
      socialPrompts.push(body);
      const text = captionBodies[Math.min(calls.social, captionBodies.length - 1)];
      calls.social++;
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify({ platform: "facebook", headline: "Homecoming", body: text, cta: captionCta, visual_brief: "a lush arrangement of mixed fresh flowers on a marble counter", hashtags: [], asset_requirements: [], brand_traits_used: [], visual_traits_used: [] }) } }) };
    }
    if (body.includes(FLYER_MARKER)) {
      flyerPrompts.push(body);
      const copy = flyerCopies ? flyerCopies[Math.min(calls.flyer, flyerCopies.length - 1)] : { headline: "Beautiful Blooms", body: "Flowers for life's special moments.", cta: "" };
      calls.flyer++;
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(copy) } }) };
    }
    calls.other++;
    return { ok: true, json: async () => ({ success: true, result: { response: "{}" } }) };
  };
  try {
    const storage = createFakeSupabaseStorage({});
    const client = createFakeSupabaseClient(responsesFor(TEST_E_BRIEF), { storage });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    // The per-attempt diagnostic is written by a follow-up UPDATE on the
    // usage row (never in the insert) — read those payloads.
    const usageDiagnostics = client.calls
      .filter((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "update") && c.payload?.metadata?.diagnosticVersion)
      .map((c) => c.payload.metadata);
    const variantUpdate = client.calls.filter((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update")).pop();
    return { res, body: JSON.parse(res.body), calls, socialPrompts, flyerPrompts, content: assetInsert?.payload?.content || null, usageDiagnostics, variantCaption: variantUpdate?.payload?.caption ?? null };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenAi !== undefined) process.env.OPENAI_API_KEY = originalOpenAi;
  }
}

test("Part 7 (real handler, exact failed run): both captions come back generic → the EVENT rescue ships; Homecoming, parents/students, the order reminder and all three products survive in the caption AND the on-image wording; nothing invented; call budgets unchanged", async () => {
  const { res, body, calls, content, socialPrompts, usageDiagnostics, variantCaption } = await runTestE({ captionBodies: [LIVE_GENERIC_SHAPE] });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(calls.social, 2, "caption: attempt + exactly one bounded retry");
  assert.equal(calls.flyer, 0, "the on-image wording reuses the rescue — no extra provider call");
  assert.ok(calls.image >= 1 && calls.image <= 2, `image: attempt + at most the existing quality-check retry (${calls.image})`);
  assert.ok(socialPrompts.every((p) => /EVENT CONTRACT — this is a Homecoming reminder post/.test(p)), "the contract reached every caption prompt");
  const caption = body.copy.body;
  assert.equal(caption, "Homecoming is coming up! Parents and students, don't forget to order your bouquets, corsages and boutonnieres from Lilies in Bloom. Call 606-506-4039 to order.");
  assert.equal(variantCaption, caption, "the persisted variant caption is the event rescue");
  assert.equal(body.copy.creative_rescue_used, true);
  // On-image wording: event-specific, never "Beautiful Blooms, Thoughtfully Arranged".
  assert.equal(content.headline, "Order Your Homecoming Flowers");
  assert.equal(content.body, "Order homecoming bouquets, corsages and boutonnieres.");
  assert.equal(content.cta, "Call 606-506-4039");
  assert.equal(content.creative_rescue_used, true);
  assert.deepEqual(content.canonical_concept.eventFacts, CONTRACT);
  assert.equal(content.canonical_concept.namedCampaign, "homecoming");
  // Preservation, explicitly.
  const joined = `${caption} ${content.headline} ${content.body}`;
  for (const fact of [/homecoming/i, /parents/i, /students/i, /\border\b/i, /bouquets/, /corsages/, /boutonnieres/]) assert.match(joined, fact);
  assert.doesNotMatch(joined, /\b(?:by|before)\s+\w+day|September|\d{1,2}\/\d{1,2}|limited|sell out|online|deliver|\$\d|% off|High School|moments that matter|brighten someone/i);
  // Diagnostics carry the event codes for the rejected attempts.
  assert.equal(usageDiagnostics.length, 2);
  assert.ok(usageDiagnostics[0].eventFactCodes.includes("event_product_missing:corsages"), JSON.stringify(usageDiagnostics[0].eventFactCodes));
  assert.ok(usageDiagnostics[0].eventFactCodes.includes("event_audience_missing"));
  assert.ok(usageDiagnostics[0].reasonCodes.includes("event_fact_missing"));
  assert.equal(usageDiagnostics[1].rescueFired, true);
  assert.doesNotMatch(JSON.stringify(usageDiagnostics), /magical|moments that matter/, "diagnostics never carry the text");
});

test("Part 7 (real handler): a GOOD homecoming caption is accepted on the first attempt — no false hollow rejection — and the AI flyer wording is checked against the contract too", async () => {
  const good = "Homecoming is almost here! Parents and students, now is the time to order your homecoming bouquets, corsages and boutonnieres from Lilies in Bloom. Stop in or give us a call and we will get them ready.";
  const { res, body, calls, content, flyerPrompts } = await runTestE({ captionBodies: [good], captionCta: "Call 606-506-4039", flyerCopies: [{ headline: "Beautiful Blooms, Thoughtfully Arranged", body: "Flowers for life's special moments.", cta: "Call 606-506-4039" }, { headline: "Order Homecoming Flowers Now", body: "Bouquets, corsages and boutonnieres for the big night.", cta: "Call 606-506-4039" }] });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(calls.social, 1, "accepted first time");
  assert.equal(body.copy.body, good);
  assert.equal(body.copy.creative_rescue_used, undefined);
  assert.equal(calls.flyer, 2, "generic on-image wording earned exactly one bounded retry");
  assert.ok(flyerPrompts.every((p) => /EVENT CONTRACT/.test(p)));
  assert.equal(content.headline, "Order Homecoming Flowers Now", "the event-specific retry was kept");
  assert.equal(content.creative_rescue_used, undefined);
});

test("Part 7 (real handler): a caption that invents a deadline on both attempts is rejected and the event rescue ships without it", async () => {
  const invented = "Homecoming is coming! Parents and students, order your homecoming bouquets, corsages and boutonnieres by Friday from Lilies in Bloom. Don't miss out!";
  const { res, body, calls } = await runTestE({ captionBodies: [invented] });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(calls.social, 2);
  assert.equal(body.copy.creative_rescue_used, true);
  assert.doesNotMatch(body.copy.body, /Friday|miss out/i);
  assert.match(body.copy.body, /Homecoming is coming up! Parents and students/);
});

// ---------------------------------------------------------------------------
// Independent-review additions (2026-09-15).
// ---------------------------------------------------------------------------

test("review 1: the caption is judged on its BODY — facts that live only in the caption's headline field never reach the customer and no longer pass", () => {
  const r = evaluateMarketingOutput({ route: "generate_content", request: TEST_E_BRIEF, shopEvidence: SHOP_EVIDENCE, inventoryEvidence: [], canonicalConcept: CONCEPT, candidate: { headline: "Homecoming Bouquets, Corsages and Boutonnieres", body: "Parents and students, this season is all about the moments that matter. Let us make your night unforgettable with flowers you will love. Order today.", cta: "" }, component: "caption" });
  assert.equal(r.decision, "retry");
  assert.ok(r.eventFactCodes.includes("event_name_missing"), JSON.stringify(r.eventFactCodes));
  assert.ok(r.eventFactCodes.includes("event_product_missing:corsages"));
});

test("review 2: a SUPPLIED deadline survives — the rescue states it, and a caption that drops it is rejected", () => {
  const req = "Remind students to order homecoming corsages by Friday, Sept 19.";
  const ef = classifyEventFacts({ requestText: req });
  assert.equal(ef.orderDeadline, "by Friday, Sept 19");
  const rescue = buildDeterministicEventReminderRescueContent({ shopName: SHOP, shopPhone: "6065064039", eventFacts: ef });
  assert.match(rescue.caption, /Order by Friday, Sept 19\./);
  assert.match(rescue.body, /Order by Friday, Sept 19\./);
  const concept = { audience: "students", messageIntent: "general_everyday", eventFacts: ef };
  assert.deepEqual(detectMissingEventFacts({ generatedText: "Students, don't forget to order your homecoming corsages from Lilies in Bloom.", eventFacts: ef }).map((m) => m.code), ["event_deadline_missing"]);
  const kept = evaluateMarketingOutput({ route: "generate_content", request: req, shopEvidence: SHOP_EVIDENCE, inventoryEvidence: [], canonicalConcept: concept, candidate: { headline: "", body: rescue.caption, cta: "" }, component: "caption" });
  assert.equal(kept.decision, "pass", JSON.stringify(kept.reasons));
});

test("review 5/6/7/8/9: no false fulfillment flags on plain florist phrasing; event+product alone is still hollow; mascots, scarcity idioms, bundle deals and acronym schools are caught; irregular audience plurals and 'the dance' count", () => {
  for (const ok of ["Pick up at the shop, students!", "Corsages and boutonnieres are available now, so stop in or give us a call.", "We deliver smiles to parents and students every homecoming."]) {
    assert.deepEqual(detectUnsupportedEventClaims({ generatedText: ok, requestText: TEST_E_BRIEF, eventFacts: CONTRACT }).map((v) => v.code), [], ok);
  }
  assert.equal(classifySentenceSpecificity("Homecoming bouquets are the perfect way to celebrate the moments that matter.", SHOP, { eventFacts: CONTRACT }), "hollow");
  const caught = [
    ["Go Eagles! Order your homecoming corsages and boutonnieres today.", "event_school_invented"],
    ["Order your homecoming corsages at LHS today, students.", "event_school_invented"],
    ["Quantities are limited, so order your homecoming boutonnieres now.", "event_scarcity_invented"],
    ["Spots are filling up fast for homecoming bouquets!", "event_scarcity_invented"],
    ["Two for one on homecoming boutonnieres this week!", "event_discount_invented"],
    ["Delivered fresh the morning of the dance.", "event_fulfillment_invented"],
    ["Order by the end of the week, parents and students.", "event_deadline_invented"],
    ["Next week is the dance — order your corsages now.", "event_date_invented"]
  ];
  for (const [text, code] of caught) {
    const codes = detectUnsupportedEventClaims({ generatedText: text, requestText: TEST_E_BRIEF, eventFacts: CONTRACT }).map((v) => v.code);
    assert.ok(codes.includes(code), `expected ${code} for "${text}", got ${JSON.stringify(codes)}`);
  }
  const famContract = classifyEventFacts({ requestText: "Remind families to order graduation bouquets." });
  assert.deepEqual(detectMissingEventFacts({ generatedText: "Every family can order graduation bouquets now.", eventFacts: famContract }), []);
  const danceContract = classifyEventFacts({ requestText: "Remind students to reserve school dance corsages." });
  assert.deepEqual(detectMissingEventFacts({ generatedText: "Students, reserve your corsages for the big dance now.", eventFacts: danceContract }), []);
});

test("review 10: with no supplied action the rescue never invents 'order'; a pick-up reminder never says 'call to pick up'", () => {
  const noAction = buildDeterministicEventReminderRescueContent({ shopName: SHOP, shopPhone: "6065064039", eventFacts: classifyEventFacts({ requestText: "Homecoming corsages and boutonnieres for students.", occasionCategory: "event_reminder", namedCampaign: "homecoming" }) });
  assert.doesNotMatch(JSON.stringify(noAction), /\border\b/i);
  assert.equal(noAction.headline, "Homecoming Flowers");
  assert.equal(noAction.body, "Homecoming corsages and boutonnieres from Lilies in Bloom.");
  assert.equal(noAction.caption, "Homecoming is coming up! Students, Lilies in Bloom can help with your corsages and boutonnieres. Call 606-506-4039.");
  const pickUp = buildDeterministicEventReminderRescueContent({ shopName: SHOP, shopPhone: "6065064039", eventFacts: classifyEventFacts({ requestText: "Remind students to pick up their homecoming boutonnieres.", occasionCategory: "event_reminder", namedCampaign: "homecoming" }) });
  assert.equal(pickUp.headline, "Pick Up Your Homecoming Flowers");
  assert.match(pickUp.caption, /Call 606-506-4039\.$/);
  assert.doesNotMatch(pickUp.caption, /Call 606-506-4039 to pick up/);
});

test("review 12: a revision concept carrying only the contracts (no stored concept) still skips the coherence checks", () => {
  const r = evaluateMarketingOutput({ route: "revise_content", request: "Make it warmer", shopEvidence: SHOP_EVIDENCE, inventoryEvidence: [], canonicalConcept: { promotionFacts: null, eventFacts: null, promotionRequestText: "x", eventRequestText: "x" }, candidate: { headline: "Fresh Tulips", body: "Fresh tulips have arrived at Lilies in Bloom.", cta: "Don't miss out" }, component: "flyer_text", isRetryAttempt: true });
  assert.ok(!r.checksRun.includes("detectConceptCoherenceMismatch"));
});

// ---------------------------------------------------------------------------
// Part 8 — untouched paths.
// ---------------------------------------------------------------------------

test("Part 8: Test C / Test D / Birthday / Sympathy concepts carry no event contract and run no event checks", () => {
  for (const brief of [
    "Create a Facebook post encouraging people to send flowers today.",
    "Create a cute Facebook post for 20% off bouquets this weekend.",
    "Create a birthday Facebook post for a friend turning 40.",
    "Create a gentle Facebook post letting families know we can help with funeral flowers.",
    "We are closing early at 3 PM today."
  ]) {
    assert.equal(classifyEventFacts({ requestText: brief }), null, brief);
    const r = evaluateMarketingOutput({ route: "generate_content", request: brief, shopEvidence: SHOP_EVIDENCE, inventoryEvidence: [], canonicalConcept: { audience: "general_local_customers", eventFacts: null }, candidate: { headline: "", body: "Twelve stems, hand-tied in the shop this morning for whoever needs them.", cta: "" }, component: "caption" });
    assert.ok(!r.checksRun.includes("detectMissingEventFacts"), brief);
    assert.deepEqual(r.eventFactCodes, []);
  }
});
