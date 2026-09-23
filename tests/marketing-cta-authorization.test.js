/**
 * Test G: CTA-authorization / casual-social fix.
 *
 * Live failure this closes: "Make me a cute Facebook post about
 * brightening someone's day with flowers." (canonical ctaIntent: "none",
 * no CTA asked for) came back with "Lilies in Bloom has flowers ready to
 * brighten someone's day. Call 606-506-4039 to place an order." — a real,
 * verified phone number laundered an invented commercial instruction the
 * request never authorized.
 *
 * Ashley's own architectural rule, verbatim: "Fact availability and CTA
 * authorization are separate concepts... factsAllowed must not mean
 * permission to introduce a CTA using this fact."
 *
 * This file proves: (1) determineCtaAuthorization's own signals in
 * isolation, (2) the unauthorized-CTA detector/strip pass in
 * evaluateMarketingOutput, (3) classifyBriefText never protects an
 * unauthorized CTA sentence as deterministic overlay text, (4) the
 * deterministic rescue path obeys the same authorization boundary,
 * (5) every category Ashley named (verified phone/URL/address/delivery
 * capability) is rejected when unauthorized and accepted when a real
 * signal justifies it, (6) legitimate CTAs (event, sympathy, promotion,
 * explicit request) are never regressed, (7) Test F's operational-notice
 * CTA-free contract is untouched, and (8) the exact live-failed prompt now
 * produces real, non-empty, non-sterile, CTA-free copy end to end through
 * the real handler.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  determineCtaAuthorization,
  classifyEventFacts,
  classifyPromotionFacts,
  classifyCtaIntent
} from "../netlify/functions/_shared/marketing-canonical-concept.js";
import {
  sentenceReadsAsCta,
  detectUnauthorizedCtaClaim,
  stripUnauthorizedCtaSentences,
  buildDeterministicCreativeRescueContent,
  evaluateMarketingOutput,
  buildDeterministicNoticeContent,
  classifyOperationalNoticeFacts
} from "../netlify/functions/_shared/marketing-content-revision.js";
import { classifyBriefText } from "../netlify/functions/_shared/marketing-openai-creative-brief.js";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

const SHOP = "Lilies in Bloom";
const PHONE = "606-506-4039";

function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
function floristDeps(client) {
  return { florist: { client, user: { id: "ashley-user-id" }, shopId: "shop-ashley", role: "owner" } };
}

// ---------------------------------------------------------------------------
// Part 2: sentenceReadsAsCta — every phrase Ashley listed as needing to be
// caught (shape only — authorization is a separate question).
// ---------------------------------------------------------------------------

test("Part 2: every listed unauthorized-CTA phrasing is recognized as CTA-shaped", () => {
  const phrases = [
    "Call 606-506-4039 to place an order.",
    "Order today.",
    "Shop now.",
    "Visit our website to order.",
    "Message us to order.",
    "Stop by and pick up flowers today."
  ];
  for (const p of phrases) assert.equal(sentenceReadsAsCta(p), true, p);
});

test("Part 5: every legitimate CTA example is ALSO recognized as CTA-shaped (shape detection is authorization-blind)", () => {
  const phrases = [
    "Call us to order flowers for Homecoming.",
    "Order your Homecoming corsage today.",
    "Call us about funeral flowers.",
    "Call us at 606-506-4039.",
    "Visit our website to order.",
    "Message us to place an order."
  ];
  for (const p of phrases) assert.equal(sentenceReadsAsCta(p), true, p);
});

test("ordinary, non-CTA prose is never flagged", () => {
  const phrases = [
    "A little bit of flowers can make an ordinary day feel extra special.",
    "Brighten someone's day with a little beauty from Lilies in Bloom.",
    "Our shop mascot is ready for the parade with a fresh bouquet in hand!",
    "In The Shop Now",
    "Fresh roses just arrived! Stop by today."
  ];
  for (const p of phrases) assert.equal(sentenceReadsAsCta(p), false, p);
});

// ---------------------------------------------------------------------------
// Part 1/2: determineCtaAuthorization's own signals, in isolation.
// ---------------------------------------------------------------------------

test("determineCtaAuthorization: false by default — a verified phone/fact alone never authorizes a CTA", () => {
  assert.equal(determineCtaAuthorization({ requestText: "Make me a cute Facebook post about brightening someone's day with flowers." }), false);
});

test("determineCtaAuthorization: an explicit, real ctaIntent authorizes", () => {
  assert.equal(determineCtaAuthorization({ requestText: "anything", ctaIntent: "call_shop" }), true);
  assert.equal(determineCtaAuthorization({ requestText: "anything", ctaIntent: "none" }), false);
});

test("determineCtaAuthorization: the request's own text signaling contact/order intent authorizes", () => {
  assert.equal(determineCtaAuthorization({ requestText: "Call us to order flowers for Homecoming." }), true);
  assert.equal(determineCtaAuthorization({ requestText: "Message us to place an order." }), true);
});

test("determineCtaAuthorization: a real promotion contract authorizes", () => {
  const promo = classifyPromotionFacts({ requestText: "Take 20% off all bouquets this weekend." });
  assert.ok(promo);
  assert.equal(determineCtaAuthorization({ requestText: "Take 20% off all bouquets this weekend.", promotionFacts: promo }), true);
});

test("determineCtaAuthorization: a real event contract with a stated action authorizes", () => {
  const ef = classifyEventFacts({ requestText: "Remind students to order homecoming corsages." });
  assert.equal(ef.action, "order");
  assert.equal(determineCtaAuthorization({ requestText: "Remind students to order homecoming corsages.", eventFacts: ef }), true);
});

test("determineCtaAuthorization: genuine sympathy context authorizes", () => {
  assert.equal(determineCtaAuthorization({ requestText: "We'd like to send flowers for their mother's funeral." }), true);
});

// ---------------------------------------------------------------------------
// Part 6: the exact live-found defect, reproduced against
// evaluateMarketingOutput directly (the AI-draft path).
// ---------------------------------------------------------------------------

const EXACT_TEST_G_PROMPT = "Make me a cute Facebook post about brightening someone's day with flowers.";

test("Part 6: the exact Test G defect — a real verified phone laundering an unauthorized call CTA is rejected and stripped", () => {
  const ctaAuthorized = determineCtaAuthorization({ requestText: EXACT_TEST_G_PROMPT });
  assert.equal(ctaAuthorized, false);
  const candidateText = "Lilies in Bloom has flowers ready to brighten someone's day. Call 606-506-4039 to place an order.";
  const flagged = detectUnauthorizedCtaClaim({ generatedText: candidateText, ctaAuthorized });
  assert.equal(flagged, "Call 606-506-4039 to place an order.");
  const stripped = stripUnauthorizedCtaSentences({ generatedText: candidateText, ctaAuthorized });
  assert.equal(stripped.text, "Lilies in Bloom has flowers ready to brighten someone's day.");
  assert.deepEqual(stripped.removed, ["Call 606-506-4039 to place an order."]);

  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: EXACT_TEST_G_PROMPT,
    shopEvidence: { name: SHOP, phone: PHONE },
    canonicalConcept: { audience: "general_local_customers", messageIntent: "brighten_day", ctaAuthorized },
    candidate: { headline: "", body: candidateText, cta: "" },
    component: "caption"
  });
  assert.ok(result.reasonCodes.includes("unauthorized_cta_claim"), JSON.stringify(result.reasonCodes));
  assert.equal(result.safeCandidate.body, "Lilies in Bloom has flowers ready to brighten someone's day.");
  assert.doesNotMatch(result.safeCandidate.body, /place an order|call \d/i);
});

test("Part 6: verified phone + unauthorized call CTA is rejected; the SAME phone with an authorized signal survives", () => {
  const unauthorized = { requestText: "Make a cute post about our flowers.", generatedText: "Fresh flowers make any day better. Call 606-506-4039 to place an order." };
  const ua = determineCtaAuthorization({ requestText: unauthorized.requestText });
  assert.equal(ua, false);
  assert.equal(detectUnauthorizedCtaClaim({ generatedText: unauthorized.generatedText, ctaAuthorized: ua }) !== null, true);

  const authorized = { requestText: "Make a post and tell people to call us at 606-506-4039.", generatedText: "Fresh flowers make any day better. Call 606-506-4039 to place an order." };
  const a = determineCtaAuthorization({ requestText: authorized.requestText });
  assert.equal(a, true);
  assert.equal(detectUnauthorizedCtaClaim({ generatedText: authorized.generatedText, ctaAuthorized: a }), null);
});

test("Part 6: verified URL + unauthorized order-online CTA is rejected; explicitly requested it survives", () => {
  const genText = "Fresh flowers make any day better. Visit our website to order.";
  const unauthorized = determineCtaAuthorization({ requestText: "Make a cute post about our flowers." });
  assert.equal(detectUnauthorizedCtaClaim({ generatedText: genText, ctaAuthorized: unauthorized }), "Visit our website to order.");

  const authorized = determineCtaAuthorization({ requestText: "Make a post and tell people to visit our website to order." });
  assert.equal(authorized, true);
  assert.equal(detectUnauthorizedCtaClaim({ generatedText: genText, ctaAuthorized: authorized }), null);
});

test("Part 6: verified address + unauthorized visit CTA is rejected; explicitly requested it survives", () => {
  const genText = "Fresh flowers make any day better. Visit our shop to pick up your order.";
  const unauthorized = determineCtaAuthorization({ requestText: "Make a cute post about our flowers." });
  assert.equal(detectUnauthorizedCtaClaim({ generatedText: genText, ctaAuthorized: unauthorized }), "Visit our shop to pick up your order.");

  const authorized = determineCtaAuthorization({ requestText: "Make a post and invite people to visit our shop to pick up an order." });
  assert.equal(authorized, true);
  assert.equal(detectUnauthorizedCtaClaim({ generatedText: genText, ctaAuthorized: authorized }), null);
});

test("Part 6: verified delivery capability + unauthorized sales claim is rejected; explicitly requested it survives", () => {
  const genText = "Fresh flowers make any day better. Order now for delivery today.";
  const unauthorized = determineCtaAuthorization({ requestText: "Make a cute post about our flowers." });
  assert.equal(detectUnauthorizedCtaClaim({ generatedText: genText, ctaAuthorized: unauthorized }), "Order now for delivery today.");

  const authorized = determineCtaAuthorization({ requestText: "Make a post telling people to order now for delivery today." });
  assert.equal(authorized, true);
  assert.equal(detectUnauthorizedCtaClaim({ generatedText: genText, ctaAuthorized: authorized }), null);
});

// ---------------------------------------------------------------------------
// Part 5: do not regress legitimate CTA cases (Homecoming/event, funeral/
// sympathy, promotion) — evaluated end to end through evaluateMarketingOutput.
// ---------------------------------------------------------------------------

test("Part 5: a Homecoming event reminder with a real order action keeps its call CTA", () => {
  const requestText = "Remind students to order homecoming corsages. Call 606-506-4039 to order.";
  const eventFacts = classifyEventFacts({ requestText });
  const ctaAuthorized = determineCtaAuthorization({ requestText, eventFacts });
  assert.equal(ctaAuthorized, true);
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: requestText,
    shopEvidence: { name: SHOP, phone: PHONE },
    canonicalConcept: { audience: "students", eventFacts, ctaAuthorized },
    candidate: { headline: "", body: "Homecoming is coming up! Students, order your corsages from Lilies in Bloom. Call 606-506-4039 to order.", cta: "" },
    component: "caption"
  });
  assert.ok(!result.reasonCodes.includes("unauthorized_cta_claim"), JSON.stringify(result.reasonCodes));
});

test("Part 5: a funeral/sympathy request keeps its contact CTA", () => {
  const requestText = "We'd like to send flowers for their mother's funeral. Call us about funeral flowers.";
  const ctaAuthorized = determineCtaAuthorization({ requestText });
  assert.equal(ctaAuthorized, true);
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: requestText,
    shopEvidence: { name: SHOP, phone: PHONE },
    canonicalConcept: { ctaAuthorized },
    candidate: { headline: "", body: "Our condolences are with your family. Call us about funeral flowers.", cta: "" },
    component: "caption"
  });
  assert.ok(!result.reasonCodes.includes("unauthorized_cta_claim"), JSON.stringify(result.reasonCodes));
});

test("Part 5: a real promotion keeps its call/order CTA", () => {
  const requestText = "Take 20% off all bouquets this weekend.";
  const promotionFacts = classifyPromotionFacts({ requestText });
  const ctaAuthorized = determineCtaAuthorization({ requestText, promotionFacts });
  assert.equal(ctaAuthorized, true);
  const result = evaluateMarketingOutput({
    route: "generate_content",
    request: requestText,
    shopEvidence: { name: SHOP, phone: PHONE },
    canonicalConcept: { promotionFacts, ctaAuthorized },
    candidate: { headline: "", body: "Take 20% off all bouquets this weekend at Lilies in Bloom. Call 606-506-4039 to order.", cta: "" },
    component: "caption"
  });
  assert.ok(!result.reasonCodes.includes("unauthorized_cta_claim"), JSON.stringify(result.reasonCodes));
});

// ---------------------------------------------------------------------------
// Part 3: classifyBriefText never protects an unauthorized CTA sentence.
// ---------------------------------------------------------------------------

test("Part 3: classifyBriefText drops an unauthorized CTA-shaped sentence entirely — never style text, never protected/drawn overlay text", () => {
  const unauthorized = classifyBriefText("Lilies in Bloom has flowers ready to brighten someone's day. Call 606-506-4039 to place an order.", { ctaAuthorized: false });
  // The first sentence carries no recognized fact token on its own (no
  // verifiedIdentifiers supplied here), so it correctly lands in styleText
  // — the point of this test is the SECOND sentence, which must appear
  // in NEITHER list once its CTA is unauthorized.
  assert.deepEqual(unauthorized.styleText, ["Lilies in Bloom has flowers ready to brighten someone's day."]);
  assert.equal(unauthorized.factCriticalText.length, 0, "the unauthorized CTA sentence must never be protected overlay text");
  const allUnauthorized = [...unauthorized.styleText, ...unauthorized.factCriticalText].join(" ");
  assert.doesNotMatch(allUnauthorized, /place an order/i, "the unauthorized CTA sentence must not reach the image prompt as style text either");
  // The fact TOKEN itself is still recognized (extractFactTokens is
  // unconditional) — only the CTA-shaped SENTENCE it lived in is dropped.
  assert.ok(unauthorized.factTokens.includes("606-506-4039"));

  // The exact same sentence, authorized, is still protected (a real fact
  // token inside an authorized CTA is exactly what this machinery exists
  // to protect).
  const authorized = classifyBriefText("Lilies in Bloom has flowers ready to brighten someone's day. Call 606-506-4039 to place an order.", { ctaAuthorized: true });
  assert.ok(authorized.factCriticalText.some((s) => /place an order/i.test(s)));
});

// ---------------------------------------------------------------------------
// Part 7: the rescue path never invents a CTA when unauthorized, and never
// produces an empty/fragment/sterile result — it still says something real.
// ---------------------------------------------------------------------------

test("Part 7: the rescue path obeys the same authorization boundary — no CTA, but a real, non-empty, non-generic-florist-CTA body", () => {
  const unauthorized = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: PHONE, ctaAuthorized: false, messageIntent: "brighten_day" });
  assert.equal(unauthorized.cta, "");
  assert.ok(unauthorized.body.length > 20, "the rescue body must be a real sentence, never empty or a fragment");
  assert.doesNotMatch(unauthorized.body, /call|order|shop now/i, "the rescue body itself must not invent a CTA either");
  assert.equal(unauthorized.caption, unauthorized.body, "with no authorized CTA, the caption is exactly the body — no invented sales line appended");

  const authorized = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: PHONE, ctaAuthorized: true, ctaIntent: "call_shop", messageIntent: "brighten_day" });
  assert.match(authorized.cta, /^Call 606-506-4039/);
});

test("Part 7: stripUnauthorizedCtaSentences never strips a field down to nothing — callers with no retry/rescue of their own (ai-orchestrator.js, compound-orchestrator.js) must never persist an empty caption", () => {
  // The whole candidate IS the unauthorized CTA sentence — stripping it
  // in the ordinary way would leave "". The backstop must leave the text
  // untouched instead (the unauthorized reason is still flagged
  // separately, for any caller that does have a retry/rescue to act on).
  const wholeCandidateIsCta = stripUnauthorizedCtaSentences({ generatedText: "Call 606-506-4039 to place an order.", ctaAuthorized: false });
  assert.equal(wholeCandidateIsCta.text, "Call 606-506-4039 to place an order.", "never strip a field down to empty — a real sentence, even an unauthorized one, is safer than nothing");
  assert.deepEqual(wholeCandidateIsCta.removed, []);

  // A candidate with real content alongside the unauthorized CTA still
  // strips normally — the backstop only refuses to empty the field
  // entirely.
  const partial = stripUnauthorizedCtaSentences({ generatedText: "Lilies in Bloom has flowers ready to brighten someone's day. Call 606-506-4039 to place an order.", ctaAuthorized: false });
  assert.equal(partial.text, "Lilies in Bloom has flowers ready to brighten someone's day.");
  assert.deepEqual(partial.removed, ["Call 606-506-4039 to place an order."]);
});

// ---------------------------------------------------------------------------
// Test F must remain CTA-free — this batch must never regress it.
// ---------------------------------------------------------------------------

test("Test F regression: the operational-notice CTA contract is unaffected by Test G", () => {
  const out = buildDeterministicNoticeContent({ requestText: "Let customers know we will be closing at 2 PM today.", shopName: SHOP, shopPhone: PHONE });
  assert.equal(out.headline, "Closing Early Today");
  assert.equal(out.body, "Lilies in Bloom is closing at 2 PM today.");
  assert.equal(out.cta, "");
  const facts = classifyOperationalNoticeFacts("Let customers know we will be closing at 2 PM today.");
  assert.equal(determineCtaAuthorization({ requestText: "Let customers know we will be closing at 2 PM today.", eventFacts: null }), false);
  assert.equal(facts.operation, "closing");
});

// ---------------------------------------------------------------------------
// End-to-end: the exact live-failed prompt through the real handler.
// ---------------------------------------------------------------------------

test("real dispatch: the exact live-failed Test G prompt produces real, non-empty, CTA-free copy end to end", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const fetchCalls = [];
  try {
    // The mock caption always contains the unauthorized CTA, so both the
    // first attempt AND its one bounded retry are rejected, falling to the
    // deterministic rescue — the real, full pipeline this defect actually
    // travels through live. That costs more DB calls than a single clean
    // attempt would (a second recordUsage, the rescue's own path), so —
    // matching this codebase's own established pattern for exercising a
    // real two-attempt-then-rescue dispatch (see
    // marketing-copy-diagnostics-observability.test.js) — a short fixed
    // prefix is followed by generous generic filler rather than hand-
    // counting every downstream call exactly.
    const fixedRows = [
      { data: { id: "item-1", content_type: "text_post", title: EXACT_TEST_G_PROMPT, brief: EXACT_TEST_G_PROMPT, status: "idea" }, error: null }, // currentItem
      { data: [{ id: "item-1", status: "generating" }], error: null }, // atomic claim
      { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
      { data: { marketing_monthly_budget_cents: null }, error: null }, // budget check
      { data: { name: SHOP, phone: PHONE }, error: null }, // shopRow
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: [], error: null }, // loadGroundedInventory
      { data: [], error: null }, // audience customers
      { data: [], error: null }, // audience orders
      { data: [], error: null } // recent-content shortlist
    ];
    const fillerRows = Array.from({ length: 24 }, (_, i) => ({ data: { id: `x${i}` }, error: null }));
    const client = createFakeSupabaseClient([...fixedRows, ...fillerRows], { storage: createFakeSupabaseStorage({}) });
    globalThis.fetch = async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      fetchCalls.push({ url: String(url), body });
      return {
        ok: true,
        json: async () => ({
          success: true,
          result: {
            response: JSON.stringify({
              platform: "facebook",
              headline: "",
              body: "Lilies in Bloom has flowers ready to brighten someone's day. Call 606-506-4039 to place an order.",
              cta: "",
              visual_brief: "a bright arrangement",
              hashtags: [],
              asset_requirements: [],
              brand_traits_used: [],
              visual_traits_used: []
            })
          }
        })
      };
    };
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.ok(body.copy.body.length > 0, "the caption must never end up empty");
    assert.doesNotMatch(body.copy.body, /place an order|call \d/i, "no unauthorized CTA may survive into the persisted caption");
    assert.match(body.copy.body, /brighten|flowers/i, "the real message must still be there, not stripped to nothing");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
