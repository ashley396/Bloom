import test from "node:test";
import assert from "node:assert/strict";
import {
  detectWeakMarketingCopy,
  detectWeakMarketingCopyReasonCodes,
  evaluateMarketingOutput,
  buildCopySpecificityProfile,
  buildConciseRewriteInstruction,
  buildDeterministicCreativeRescueContent,
  detectUnverifiedServiceAvailabilityClaim,
  detectUnverifiedInventoryStateClaim,
  detectInventedTemporalClaim,
  stripFabricatedContactNumbers,
  requestSignalsPlainOperationalNotice,
  isEverydaySocialMessageIntent,
  EVERYDAY_SOCIAL_MESSAGE_INTENTS,
  EVERYDAY_CAPTION_MAX_SUBSTANTIVE_SENTENCES,
  EVERYDAY_CAPTION_MAX_WORDS,
  RETRY_FEEDBACK_VERSION,
  BEREAVEMENT_CONTEXT_RE
} from "../netlify/functions/_shared/marketing-content-revision.js";
import { _internalsForTesting, COPY_GUIDANCE_VERSION } from "../netlify/functions/_shared/ai-creative-engine.js";
import { TASK_TEXT_MAX_CHARS } from "../netlify/functions/ai-assistant.js";
import { BRAND_CATEGORIES, buildBrandSummary, normalizePreferences as normalizeBrandPreferences } from "../netlify/functions/_shared/marketing-brand-brain.js";
import { STYLE_CATEGORIES, buildStyleSummary, normalizePreferences as normalizeStylePreferences } from "../netlify/functions/_shared/ai-style-memory.js";
import { classifyMessageIntent, classifyUserTemporalIntent, classifyAudience, classifyOccasionCategory } from "../netlify/functions/_shared/marketing-canonical-concept.js";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// ---------------------------------------------------------------------------
// Test C writer-quality fix (2026-09-11).
//
// Second live Test C run (a78e946, item 19f60709): the hook REQUIREMENT,
// the temporal line and the v2 retry feedback were all provably in the
// prompt (persisted promptContext), and both AI attempts STILL came back
// as five substantive sentences with one real human hook and four generic
// ones (persisted copyProfile: hollow 4/5, humanSituational 1, on each
// attempt). The evaluator rejected them correctly; the writer padded one
// good sentence into a paragraph, and the retry rewrote it long again.
//
// This file proves the three narrow responses: (1) the everyday-social
// SHAPE rule and two-or-three-sentence LENGTH line reach the prompt for
// send_flowers/brighten_day only; (2) the one existing retry receives a
// concise-rewrite instruction (cut, don't expand) for those intents only;
// (3) a narrow overlong guard fires on the FIRST caption attempt for those
// intents only, never on the retry, never for notices/flyers/promotions/
// sympathy/self-purchase — and the hollow threshold is untouched.
// ---------------------------------------------------------------------------

const SHOP = "Lilies in Bloom";
const PHONE = "606-506-4039";
const TEST_C_BRIEF = "Create a Facebook post encouraging people to send flowers today.";

// Realistic generated-copy fixtures, shaped like what the live model wrote.
// One genuine hook (sentence 2) padded into a five-sentence paragraph.
const ONE_HOOK_FOUR_GENERIC =
  "Sending flowers is one of the simplest ways to show someone you care. " +
  "Your neighbor just got home from a long hospital stay and hasn't heard from anyone yet. " +
  "A thoughtful bouquet brightens any day and brings a little joy. " +
  "Flowers have a way of saying what words cannot. " +
  "Let Lilies in Bloom help you make someone smile with fresh flowers today.";
// A natural two-or-three-sentence caption where the hook IS the caption.
const NATURAL_SHORT_CAPTION =
  "Your sister just finished her first week at a new job. " +
  "A bouquet showing up on her doorstep today says more than a text ever could. " +
  `Call ${PHONE} to send one.`;
// The same emotional idea restated four times with nothing concrete.
const REPEATED_EMOTIONAL_FILLER =
  "Flowers bring so much joy to everyone who receives them. " +
  "There is nothing like the happiness a fresh bouquet brings to someone's day. " +
  "A beautiful arrangement fills any room with warmth and love. " +
  "Brighten someone's day with flowers from Lilies in Bloom today.";

const EVERYDAY_OPTS = { shopName: SHOP, shopPhone: PHONE, audience: "general_local_customers", messageIntent: "send_flowers", component: "caption", isRetryAttempt: false };

// Independent review's fixture: a GOOD four-sentence caption (one hook,
// hollow 2/4 — under the threshold) that shipped clean before the guard
// existed. It must still ship, whatever the retry does.
const GOOD_FOUR_SENTENCES =
  "Your neighbor just got home from a long hospital stay and hasn't heard from anyone yet. " +
  "Flowers on the porch tell her somebody noticed she was gone. " +
  "It doesn't take an occasion, just a phone call to us. " +
  `Lilies in Bloom, ${PHONE} — tell us where they're going.`;
// A three-sentence hollow retry — one REAL (blocking) fault.
const HOLLOW_THREE =
  "Flowers bring so much joy to everyone who receives them today. " +
  "There is nothing like the happiness a fresh bouquet brings to someone's day. " +
  "A beautiful arrangement fills any room with warmth and love for everyone.";

function testCClassification() {
  const isSympathy = BEREAVEMENT_CONTEXT_RE.test(`${TEST_C_BRIEF} ${TEST_C_BRIEF}`);
  const occasionCategory = classifyOccasionCategory({ occasionTitle: TEST_C_BRIEF, requestText: TEST_C_BRIEF, objective: null, isSympathy });
  const audience = classifyAudience({ requestText: TEST_C_BRIEF, occasionTitle: TEST_C_BRIEF, isSympathy, occasionCategory });
  const messageIntent = classifyMessageIntent({ requestText: TEST_C_BRIEF, audience, isSympathy, occasionCategory });
  const userTemporalIntent = classifyUserTemporalIntent({ requestText: TEST_C_BRIEF });
  return { isSympathy, occasionCategory, audience, messageIntent, userTemporalIntent };
}

// ---------------------------------------------------------------------------
// Part 5 fixtures — evaluator behavior.
// ---------------------------------------------------------------------------

test("one good hook + four generic sentences still fails: hollow (unchanged threshold) AND the new everyday overlong guard on attempt 1", () => {
  const codes = detectWeakMarketingCopyReasonCodes(TEST_C_BRIEF, ONE_HOOK_FOUR_GENERIC, EVERYDAY_OPTS);
  assert.ok(codes.includes("weak_copy_hollow_sentence"), `hollow must still fire: ${codes}`);
  assert.ok(codes.includes("weak_copy_everyday_overlong"), `overlong guard must fire on attempt 1: ${codes}`);
  const profile = buildCopySpecificityProfile(ONE_HOOK_FOUR_GENERIC, { shopName: SHOP, messageIntent: "send_flowers" });
  assert.equal(profile.substantiveSentenceCount, 5);
  assert.equal(profile.hollowSentenceCount, 4);
  assert.equal(profile.humanSituationalSpecificityMatched, true, "the one real hook is recognised");
  assert.equal(profile.hollowThresholdMet, true);
  assert.deepEqual(profile.everydayShape, { applicable: true, substantiveSentenceLimit: EVERYDAY_CAPTION_MAX_SUBSTANTIVE_SENTENCES, wordLimit: EVERYDAY_CAPTION_MAX_WORDS, exceeded: true });
});

test("a natural 2–3 sentence caption with one concrete hook passes every check, including the shape guard", () => {
  const evalResult = evaluateMarketingOutput({
    route: "generate_content",
    request: TEST_C_BRIEF,
    shopEvidence: { name: SHOP, phone: PHONE },
    canonicalConcept: { audience: "general_local_customers", messageIntent: "send_flowers" },
    candidate: { headline: "", body: NATURAL_SHORT_CAPTION, cta: "" },
    component: "caption"
  });
  assert.equal(evalResult.decision, "pass", `expected a clean pass, got ${JSON.stringify(evalResult.reasons)}`);
  assert.deepEqual(evalResult.weakCopyReasonCodes, []);
  assert.equal(evalResult.copyProfile.everydayShape.exceeded, false);
  assert.equal(evalResult.copyProfile.humanSituationalSpecificityMatched, true);
  assert.ok(evalResult.copyProfile.wordCount >= 25 && evalResult.copyProfile.wordCount <= 55, `natural caption sits in the target band: ${evalResult.copyProfile.wordCount} words`);
});

test("repeated emotional filler fails (hollow) — and, at four substantive sentences, also trips the everyday shape guard", () => {
  const codes = detectWeakMarketingCopyReasonCodes(TEST_C_BRIEF, REPEATED_EMOTIONAL_FILLER, EVERYDAY_OPTS);
  assert.ok(codes.includes("weak_copy_hollow_sentence"), `expected hollow: ${codes}`);
  assert.ok(codes.includes("weak_copy_everyday_overlong"), `expected overlong: ${codes}`);
});

test("shape guard scope: NOT on the retry attempt, NOT for flyer text, NOT for general_everyday/self_purchase/promotion/null intents — and never when the copy is within limits", () => {
  const long = ONE_HOOK_FOUR_GENERIC;
  const overlong = (opts) => detectWeakMarketingCopyReasonCodes(TEST_C_BRIEF, long, opts).includes("weak_copy_everyday_overlong");
  assert.equal(overlong({ ...EVERYDAY_OPTS, isRetryAttempt: true }), false, "an overlong-but-otherwise-kept retry ships rather than being thrown away for the rescue");
  assert.equal(overlong({ ...EVERYDAY_OPTS, component: "flyer_text" }), false, "designed flyer wording is never shape-guarded here");
  // Second-review fix: through evaluateMarketingOutput, flyer_text never
  // even sees the everyday intent — no everyday wording, no applicable flag.
  const flyerEval = evaluateMarketingOutput({
    route: "generate_content",
    request: TEST_C_BRIEF,
    shopEvidence: { name: SHOP, phone: PHONE },
    canonicalConcept: { audience: "general_local_customers", messageIntent: "send_flowers" },
    candidate: { headline: "Flowers, Sent With Thought", body: ONE_HOOK_FOUR_GENERIC, cta: "" },
    component: "flyer_text"
  });
  assert.equal(flyerEval.copyProfile.everydayShape.applicable, false);
  assert.equal(flyerEval.weakCopyReasonCodes.includes("weak_copy_everyday_overlong"), false);
  assert.equal(overlong({ ...EVERYDAY_OPTS, messageIntent: "general_everyday" }), false);
  assert.equal(overlong({ ...EVERYDAY_OPTS, messageIntent: "self_purchase", audience: "self_purchase" }), false);
  assert.equal(overlong({ ...EVERYDAY_OPTS, messageIntent: null }), false);
  assert.equal(overlong({ ...EVERYDAY_OPTS, component: undefined }), false, "callers that never say which component (the public string API) are unaffected");
  // Still hollow on the retry — the hollow threshold itself is untouched.
  assert.ok(detectWeakMarketingCopyReasonCodes(TEST_C_BRIEF, long, { ...EVERYDAY_OPTS, isRetryAttempt: true }).includes("weak_copy_hollow_sentence"));
  // brighten_day is the other everyday intent and IS guarded.
  assert.equal(overlong({ ...EVERYDAY_OPTS, messageIntent: "brighten_day" }), true);
  // A five-sentence promotion with real facts is neither hollow nor shape-guarded.
  const promo = "Take 20% off any bouquet this week only at Lilies in Bloom. The sale runs Monday through Saturday, while stems last. Every arrangement is hand-tied in the shop the same morning it goes out. Walk in, call 606-506-4039, or order online before Saturday at 4 PM. Treat someone, or yourself, while the discount lasts.";
  const promoCodes = detectWeakMarketingCopyReasonCodes("Create a Facebook post for 20% off bouquets this week.", promo, { ...EVERYDAY_OPTS, messageIntent: "general_everyday" });
  assert.equal(promoCodes.includes("weak_copy_everyday_overlong"), false);
  assert.equal(promoCodes.includes("weak_copy_hollow_sentence"), false);
  assert.deepEqual(EVERYDAY_SOCIAL_MESSAGE_INTENTS, ["send_flowers", "brighten_day"]);
  assert.equal(isEverydaySocialMessageIntent("general_everyday"), false);
});

test("the shape guard is ADVISORY: it is in reasons (earns the retry) but never in blockingReasons (never the rescue, never the keep-worse choice)", () => {
  const evalResult = evaluateMarketingOutput({
    route: "generate_content",
    request: TEST_C_BRIEF,
    shopEvidence: { name: SHOP, phone: PHONE },
    canonicalConcept: { audience: "general_local_customers", messageIntent: "send_flowers" },
    candidate: { headline: "", body: GOOD_FOUR_SENTENCES, cta: "" },
    component: "caption"
  });
  assert.equal(evalResult.decision, "retry", "the guard still earns the one bounded retry");
  assert.deepEqual(evalResult.weakCopyReasonCodes, ["weak_copy_everyday_overlong"], `overlong only — no hollow: ${evalResult.reasons}`);
  assert.equal(evalResult.reasons.length, 1);
  assert.deepEqual(evalResult.blockingReasons, [], "advisory: nothing here may drive the rescue");
  assert.equal(evalResult.copyProfile.humanSituationalSpecificityMatched, true);
  // A real fault IS blocking.
  const hollow = evaluateMarketingOutput({
    route: "generate_content",
    request: TEST_C_BRIEF,
    shopEvidence: { name: SHOP, phone: PHONE },
    canonicalConcept: { audience: "general_local_customers", messageIntent: "send_flowers" },
    candidate: { headline: "", body: HOLLOW_THREE, cta: "" },
    component: "caption",
    isRetryAttempt: true
  });
  assert.equal(hollow.blockingReasons.length, 1);
  assert.deepEqual(hollow.weakCopyReasonCodes, ["weak_copy_hollow_sentence"]);
});

test("the shape guard judges the body only: a three-sentence body plus a separate shop-name-and-phone cta field is exactly what the prompt asked for, never a paragraph", () => {
  const body = "Your neighbor just got home from a long hospital stay and hasn't heard from anyone yet. Flowers on the porch tell her somebody noticed she was gone. It doesn't take an occasion, just a phone call to us.";
  const cta = `Call Lilies in Bloom at ${PHONE} and tell us where they're going.`;
  const evalResult = evaluateMarketingOutput({
    route: "generate_content",
    request: TEST_C_BRIEF,
    shopEvidence: { name: SHOP, phone: PHONE },
    canonicalConcept: { audience: "general_local_customers", messageIntent: "send_flowers" },
    candidate: { headline: "", body, cta },
    component: "caption"
  });
  assert.equal(evalResult.weakCopyReasonCodes.includes("weak_copy_everyday_overlong"), false, `cta must not count: ${evalResult.reasons}`);
  assert.equal(evalResult.copyProfile.everydayShape.exceeded, false);
  // The same words as a single body field DO count.
  const codes = detectWeakMarketingCopyReasonCodes(TEST_C_BRIEF, `${body} ${cta}`, { ...EVERYDAY_OPTS, bodyText: `${body} ${cta}` });
  assert.ok(codes.includes("weak_copy_everyday_overlong"));
});

test("weak_copy_too_long wording agrees with the everyday target (two or three) and keeps the old wording elsewhere", () => {
  const six = Array.from({ length: 6 }, (_, i) => `Sentence number ${i + 1} is here to make this caption run on and on with plenty of extra words in every single line.`).join(" ");
  const everyday = detectWeakMarketingCopy(TEST_C_BRIEF, six, EVERYDAY_OPTS).find((r) => /Far too long/.test(r));
  const other = detectWeakMarketingCopy(TEST_C_BRIEF, six, { ...EVERYDAY_OPTS, messageIntent: "general_everyday" }).find((r) => /Far too long/.test(r));
  assert.match(everyday, /Two or three short sentences, and stop\./);
  assert.match(other, /Three or four short sentences, and stop\./);
});

test("the shape guard's threshold is a real margin above the prompt's target: three substantive sentences up to 80 words never trip it", () => {
  // Three substantive, all-hollow sentences: hollow fires, overlong does not.
  const three = "Flowers bring so much joy to everyone who receives them today. There is nothing like the happiness a fresh bouquet brings to someone's day. A beautiful arrangement fills any room with warmth and love for everyone.";
  const codes = detectWeakMarketingCopyReasonCodes(TEST_C_BRIEF, three, EVERYDAY_OPTS);
  assert.equal(codes.includes("weak_copy_everyday_overlong"), false, `3 substantive sentences under 80 words is not overlong: ${codes}`);
  assert.ok(codes.includes("weak_copy_hollow_sentence"), "hollow still judges it on content, not length");
});

// ---------------------------------------------------------------------------
// Part 2 — retry feedback instructs deletion/compression.
// ---------------------------------------------------------------------------

test("concise-rewrite instruction: cut not expand, keep the strongest hook, delete generic sentences, 2–3 sentences, no new intro/conclusion — and only for everyday intents after filler/hollow/overlong", () => {
  const text = buildConciseRewriteInstruction({ messageIntent: "send_flowers", weakCopyReasonCodes: ["weak_copy_hollow_sentence"] });
  assert.match(text, /REWRITE BY CUTTING, NOT EXPANDING/);
  assert.match(text, /keep the single strongest human hook sentence/);
  assert.match(text, /delete every generic sentence/);
  assert.match(text, /only two or three short sentences/);
  assert.match(text, /Do not add a new introduction sentence/);
  assert.match(text, /do not add a closing summary/);
  assert.match(text, /do not restate the same emotional idea/);
  assert.equal(buildConciseRewriteInstruction({ messageIntent: "brighten_day", weakCopyReasonCodes: ["weak_copy_filler_phrase"] }).length > 0, true);
  // Review fix: with no hook to keep, the instruction says to WRITE one first
  // rather than contradicting the hollow feedback beside it.
  const noHook = buildConciseRewriteInstruction({ messageIntent: "send_flowers", weakCopyReasonCodes: ["weak_copy_hollow_sentence"], hadHumanHook: false });
  assert.match(noHook, /write ONE concrete human hook sentence first/);
  assert.doesNotMatch(noHook, /keep the single strongest human hook sentence you already had/);
  assert.match(noHook, /REWRITE BY CUTTING, NOT EXPANDING/);
  assert.equal(buildConciseRewriteInstruction({ messageIntent: "send_flowers", weakCopyReasonCodes: ["weak_copy_everyday_overlong"] }).length > 0, true);
  // Never for other intents, and never for unrelated reasons.
  assert.equal(buildConciseRewriteInstruction({ messageIntent: "general_everyday", weakCopyReasonCodes: ["weak_copy_hollow_sentence"] }), "");
  assert.equal(buildConciseRewriteInstruction({ messageIntent: "self_purchase", weakCopyReasonCodes: ["weak_copy_hollow_sentence"] }), "");
  assert.equal(buildConciseRewriteInstruction({ messageIntent: null, weakCopyReasonCodes: ["weak_copy_hollow_sentence"] }), "");
  assert.equal(buildConciseRewriteInstruction({ messageIntent: "send_flowers", weakCopyReasonCodes: ["weak_copy_shop_name_fixation"] }), "");
  assert.equal(buildConciseRewriteInstruction({ messageIntent: "send_flowers", weakCopyReasonCodes: [] }), "");
  assert.equal(buildConciseRewriteInstruction(), "");
  // The per-reason feedback the model already gets stays concrete too.
  const reasons = detectWeakMarketingCopy(TEST_C_BRIEF, ONE_HOOK_FOUR_GENERIC, EVERYDAY_OPTS);
  const overlongFeedback = reasons.find((r) => /This is a paragraph, not a caption/.test(r));
  assert.ok(overlongFeedback, "overlong feedback names the fault in the model's own terms");
  assert.match(overlongFeedback, /Keep the one sentence that carries the real human hook, delete the rest, and return two or three short sentences/);
  assert.equal(RETRY_FEEDBACK_VERSION, "2026-09-11.v3");
});

// ---------------------------------------------------------------------------
// Part 1 — the prompt shape rule reaches the right prompts and no others.
// ---------------------------------------------------------------------------

test("prompt shape: send_flowers and brighten_day get the SHAPE rule + the two-or-three-sentence LENGTH line; sympathy, self_purchase and general_everyday keep the three-or-four line and no SHAPE rule", () => {
  const { buildSocialPostTask, buildSocialPostPromptContext, EVERYDAY_SOCIAL_SHAPE_RULE, MESSAGE_INTENT_COPY_GUIDANCE, lengthRuleLine } = _internalsForTesting;
  const task = (concept, requestText = TEST_C_BRIEF) => buildSocialPostTask({ channel: "facebook", occasion: requestText, shop: { name: SHOP }, requestText, concept });

  assert.match(EVERYDAY_SOCIAL_SHAPE_RULE, /the hook IS the caption/);
  assert.match(EVERYDAY_SOCIAL_SHAPE_RULE, /TWO or THREE short sentences, about 25–55 words in total/);
  assert.match(EVERYDAY_SOCIAL_SHAPE_RULE, /Every substantive sentence must add something new/);
  assert.match(EVERYDAY_SOCIAL_SHAPE_RULE, /Do NOT write an introduction sentence before the hook/);
  assert.match(EVERYDAY_SOCIAL_SHAPE_RULE, /Do NOT add a summary or wrap-up sentence after it/);
  assert.match(EVERYDAY_SOCIAL_SHAPE_RULE, /Do NOT add generic florist-brand filler/);
  assert.match(EVERYDAY_SOCIAL_SHAPE_RULE, /Do NOT restate the same emotional idea in different words/);
  // Abstract only — no paste-able caption sentence, no example recipient.
  assert.doesNotMatch(EVERYDAY_SOCIAL_SHAPE_RULE, /your (mom|sister|friend|neighbor|coworker)|rough week|doorstep/i);
  assert.ok(MESSAGE_INTENT_COPY_GUIDANCE.send_flowers.endsWith(EVERYDAY_SOCIAL_SHAPE_RULE));
  assert.ok(MESSAGE_INTENT_COPY_GUIDANCE.brighten_day.endsWith(EVERYDAY_SOCIAL_SHAPE_RULE));
  assert.ok(!MESSAGE_INTENT_COPY_GUIDANCE.general_everyday.includes(EVERYDAY_SOCIAL_SHAPE_RULE));

  const c = testCClassification();
  assert.equal(c.messageIntent, "send_flowers");
  const sendTask = task({ isSympathy: false, audience: c.audience, messageIntent: c.messageIntent, userTemporalIntent: c.userTemporalIntent });
  assert.match(sendTask, /SHAPE — the hook IS the caption/);
  assert.match(sendTask, /- LENGTH: two or three short sentences for the body \(about 25–55 words in total\), then stop\./);
  assert.doesNotMatch(sendTask, /LENGTH: three or four short sentences/);
  // The general rule can no longer contradict the shape rule in the same prompt.
  assert.equal((sendTask.match(/- LENGTH:/g) || []).length, 1);
  assert.equal(buildSocialPostPromptContext({ messageIntent: "send_flowers" }).everydayShapeRuleIncluded, true);
  assert.equal(buildSocialPostPromptContext({ messageIntent: "brighten_day" }).everydayShapeRuleIncluded, true);

  const sympathyTask = task({ isSympathy: true, audience: "funeral_families", messageIntent: "general_everyday" }, "funeral flowers for the service");
  assert.doesNotMatch(sympathyTask, /SHAPE — the hook IS the caption/);
  assert.match(sympathyTask, /- LENGTH: three or four short sentences for the body, then stop\./);
  const selfTask = task({ isSympathy: false, audience: "self_purchase", messageIntent: "self_purchase" }, "cute post about buying myself flowers");
  assert.doesNotMatch(selfTask, /SHAPE — the hook IS the caption/);
  assert.match(selfTask, /- LENGTH: three or four short sentences for the body, then stop\./);
  const generalTask = task({ isSympathy: false, audience: "general_local_customers", messageIntent: "general_everyday" }, "Create a Facebook post for 20% off bouquets this week.");
  assert.doesNotMatch(generalTask, /SHAPE — the hook IS the caption/);
  assert.match(generalTask, /- LENGTH: three or four short sentences for the body, then stop\./);
  assert.equal(buildSocialPostPromptContext({ messageIntent: "general_everyday" }).everydayShapeRuleIncluded, false);
  assert.equal(lengthRuleLine(undefined), lengthRuleLine("general_everyday"));
  assert.equal(COPY_GUIDANCE_VERSION, "2026-09-11.v3");
});

// ---------------------------------------------------------------------------
// Part 5 — real handler: overlong+hollow attempt 1 → the ONE retry carries the
// concise instruction → a short, hook-only retry is accepted and ships as
// real AI copy (no rescue), with exactly two social-copy provider calls.
// ---------------------------------------------------------------------------

function floristDeps(client) {
  return { florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
function generateResponses(brief) {
  const fixed = [
    { data: { id: "item-1", content_type: "social_post", title: brief, brief, status: "idea" }, error: null },
    { data: [{ id: "item-1", status: "generating" }], error: null },
    { data: [{ id: "variant-1", platform: "facebook" }], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: { name: SHOP, phone: "6065064039" }, error: null },
    { data: null, error: null },
    { data: null, error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null }
  ];
  const filler = Array.from({ length: 30 }, (_, i) => ({ data: { id: `x${i}` }, error: null }));
  return [...fixed, ...filler];
}

test("handler: paragraph attempt 1 → retry told to CUT → short hook-only retry ships as real AI copy, no rescue, exactly two social-copy calls, both diagnostics v2 with shape recorded", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const socialCalls = [];
  const SOCIAL_MARKER = "You are writing the ACTUAL, FINISHED social media post";
  globalThis.fetch = async (url, options) => {
    const body = String(options?.body || "");
    if (String(url).includes("flux")) {
      return { ok: true, json: async () => ({ success: true, result: { image: Buffer.from("fake-jpeg-bytes").toString("base64") } }) };
    }
    const isSocial = body.includes(SOCIAL_MARKER);
    if (isSocial) socialCalls.push(body);
    // Attempt 1 is the live paragraph shape; the retry is the short caption.
    const copyBody = isSocial && socialCalls.length === 1 ? ONE_HOOK_FOUR_GENERIC : NATURAL_SHORT_CAPTION;
    return {
      ok: true,
      json: async () => ({
        success: true,
        result: {
          response: JSON.stringify({
            platform: "facebook",
            headline: "Sent With Thought",
            body: copyBody,
            cta: "",
            visual_brief: "a lush arrangement of mixed fresh flowers on a marble counter",
            hashtags: [],
            asset_requirements: [],
            brand_traits_used: [],
            visual_traits_used: []
          })
        }
      })
    };
  };
  try {
    const storage = createFakeSupabaseStorage({});
    const client = createFakeSupabaseClient(generateResponses(TEST_C_BRIEF), { storage });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);

    // Real AI copy shipped — the short retry — not the deterministic rescue.
    assert.equal(body.copy.creative_rescue_used, undefined, "no rescue when the retry genuinely passes");
    assert.equal(body.copy.body, NATURAL_SHORT_CAPTION);

    // Exactly two social-copy provider calls; the second carries the cut instruction.
    assert.equal(socialCalls.length, 2, "one attempt plus one bounded retry, never a third social-copy call");
    assert.ok(!socialCalls[0].includes("REWRITE BY CUTTING"), "attempt 1 gets no retry feedback");
    assert.ok(socialCalls[1].includes("REWRITE BY CUTTING, NOT EXPANDING"), "the retry request carries the concise-rewrite instruction");
    assert.ok(socialCalls[1].includes("This is a paragraph, not a caption"), "the retry request carries the overlong reason itself");
    assert.ok(socialCalls[1].includes("A previous attempt was rejected for these reasons"), "the existing retry preamble is unchanged");
    assert.ok(socialCalls[1].includes("SHAPE — the hook IS the caption"), "the SHAPE rule is in the retry prompt too");

    const diagnosticUpdates = client.calls.filter(
      (c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "update" && op[1][0]?.metadata?.attempt !== undefined)
    );
    assert.equal(diagnosticUpdates.length, 2);
    const [d1, d2] = diagnosticUpdates.map((c) => c.payload.metadata);
    assert.equal(d1.attempt, 1);
    assert.ok(d1.weakCopyReasonCodes.includes("weak_copy_hollow_sentence"));
    assert.ok(d1.weakCopyReasonCodes.includes("weak_copy_everyday_overlong"));
    assert.equal(d1.copyProfile.everydayShape.exceeded, true);
    assert.equal(d1.copyProfile.substantiveSentenceCount, 5);
    assert.equal(d1.selected, false);
    assert.equal(d1.rescueFired, false);
    assert.equal(d1.prompt.everydayShapeRuleIncluded, true);
    assert.equal(d1.prompt.copyGuidanceVersion, COPY_GUIDANCE_VERSION);
    assert.equal(d2.attempt, 2);
    assert.deepEqual(d2.weakCopyReasonCodes, []);
    assert.equal(d2.copyProfile.everydayShape.exceeded, false);
    assert.ok(d2.copyProfile.substantiveSentenceCount <= 3);
    assert.equal(d2.selected, true);
    assert.equal(d2.rescueFired, false);
    assert.equal(d2.retryFeedbackVersion, RETRY_FEEDBACK_VERSION);

    // Privacy unchanged: the rejected paragraph never reaches a persisted row.
    const persisted = JSON.stringify(client.calls.map((call) => call.payload ?? null));
    assert.ok(!persisted.includes("long hospital stay"), "rejected attempt-1 wording is persisted nowhere");
    assert.ok(!persisted.includes("simplest ways to show someone you care"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Independent review's exact regression scenarios: a GOOD four-sentence
// attempt 1 (overlong-only) must still ship whether the retry has a real
// fault (tie on blocking count), is worse, or fails outright.
// ---------------------------------------------------------------------------

async function runHandlerWith({ attempt1, attempt2, retryFails = false }) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const socialCalls = [];
  globalThis.fetch = async (url, options) => {
    const body = String(options?.body || "");
    if (String(url).includes("flux")) {
      return { ok: true, json: async () => ({ success: true, result: { image: Buffer.from("fake-jpeg-bytes").toString("base64") } }) };
    }
    const isSocial = body.includes("You are writing the ACTUAL, FINISHED social media post");
    if (isSocial) socialCalls.push(body);
    const isRetry = isSocial && socialCalls.length === 2;
    const copyBody = isSocial ? (socialCalls.length === 1 ? attempt1 : attempt2) : attempt2;
    if (isRetry && retryFails) {
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify({ platform: "facebook", headline: "", body: "", cta: "" }) } }) };
    }
    return {
      ok: true,
      json: async () => ({
        success: true,
        result: {
          response: JSON.stringify({
            platform: "facebook",
            headline: "Sent With Thought",
            body: copyBody,
            cta: "",
            visual_brief: "a lush arrangement of mixed fresh flowers on a marble counter",
            hashtags: [],
            asset_requirements: [],
            brand_traits_used: [],
            visual_traits_used: []
          })
        }
      })
    };
  };
  try {
    const storage = createFakeSupabaseStorage({});
    const client = createFakeSupabaseClient(generateResponses(TEST_C_BRIEF), { storage });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    return { res, body: JSON.parse(res.body), socialCalls, client };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("handler: overlong-only attempt 1 + hollow retry (tie on total, attempt 1 wins on BLOCKING count) → attempt 1 ships as real AI copy, no rescue", async () => {
  const { res, body, socialCalls, client } = await runHandlerWith({ attempt1: GOOD_FOUR_SENTENCES, attempt2: HOLLOW_THREE });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(socialCalls.length, 2, "the advisory guard still spent the one retry");
  assert.ok(socialCalls[1].includes("REWRITE BY CUTTING"));
  assert.equal(body.copy.creative_rescue_used, undefined, "no rescue: attempt 1 had no blocking reason");
  assert.equal(body.copy.body, GOOD_FOUR_SENTENCES, "the good four-sentence caption ships, exactly as it did before the guard existed");
  const diagnostics = client.calls
    .filter((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "update" && op[1][0]?.metadata?.attempt !== undefined))
    .map((c) => c.payload.metadata);
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0].weakCopyReasonCodes, ["weak_copy_everyday_overlong"]);
  assert.equal(diagnostics[0].blockingReasonCount, 0);
  assert.equal(diagnostics[0].selected, true);
  assert.equal(diagnostics[0].rescueFired, false);
  assert.equal(diagnostics[1].blockingReasonCount, 1);
  assert.equal(diagnostics[1].selected, false);
});

test("handler: overlong-only attempt 1 + retry that FAILS outright → attempt 1 ships, no rescue", async () => {
  const { res, body, socialCalls } = await runHandlerWith({ attempt1: GOOD_FOUR_SENTENCES, attempt2: "", retryFails: true });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(socialCalls.length, 2);
  assert.equal(body.copy.creative_rescue_used, undefined);
  assert.equal(body.copy.body, GOOD_FOUR_SENTENCES);
});

test("handler: overlong-only attempt 1 + a retry that is ALSO overlong-only → the retry ships (guard is off on the retry), no rescue", async () => {
  const longer = `${GOOD_FOUR_SENTENCES} Your best friend just moved into her first apartment and hasn't heard from anyone since.`;
  const { res, body } = await runHandlerWith({ attempt1: GOOD_FOUR_SENTENCES, attempt2: longer });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(body.copy.creative_rescue_used, undefined);
  assert.equal(body.copy.body, longer, "tie at zero blocking reasons keeps the retry, as the pre-existing tie rule always did");
});

test("handler: a genuinely hollow attempt 1 (no hook) tells the retry to WRITE a hook first, and a still-hollow retry still lands in the rescue — real faults still block", async () => {
  const { res, body, socialCalls } = await runHandlerWith({ attempt1: REPEATED_EMOTIONAL_FILLER, attempt2: HOLLOW_THREE });
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(socialCalls[1].includes("write ONE concrete human hook sentence first"));
  assert.equal(body.copy.creative_rescue_used, true, "two hollow attempts → rescue, unchanged");
});

// ---------------------------------------------------------------------------
// Prompt-size regression (independent-review finding): the assembled
// social-post task must fit under the generate task cap with every summary
// at its builder's cap, or the TAIL rules get silently trimmed.
// ---------------------------------------------------------------------------

test("a realistic fully-populated send_flowers prompt (all summaries, every Brand Brain / style category with 3 short traits) stays under TASK_TEXT_MAX_CHARS — and did NOT fit under the old 12,000 cap", () => {
  const { buildSocialPostTask } = _internalsForTesting;
  const concept = { isSympathy: false, audience: "general_local_customers", messageIntent: "send_flowers", userTemporalIntent: "today", copyVoice: ["professional", "warm"] };
  // Built with the REAL builders and the REAL category lists so this
  // fixture cannot quietly under-count categories (second independent
  // review caught a hand-written 4-category version doing exactly that).
  // Trait text is realistic (~35–40 chars); neither builder caps the
  // NUMBER of traits, so this is a realistic bound, not a hard one — see
  // the KNOWN OPEN END note beside TASK_TEXT_MAX_CHARS in ai-assistant.js.
  const traits = (n, words) => Array.from({ length: n }, (_, i) => ({ text: `${words} ${i + 1} for this shop`, polarity: "positive", source: "explicit", active: true }));
  const brandPrefs = Object.fromEntries(BRAND_CATEGORIES.map((c) => [c, { traits: traits(3, "warm neighbourly wording style") }]));
  const stylePrefs = Object.fromEntries(STYLE_CATEGORIES.map((c) => [c, { traits: traits(3, "soft natural window light") }]));
  const brandVoiceSummary = buildBrandSummary(normalizeBrandPreferences(brandPrefs));
  const visualStyleSummary = buildStyleSummary(normalizeStylePreferences(stylePrefs));
  assert.ok(brandVoiceSummary.length > 1000 && visualStyleSummary.length > 1000, `summaries are genuinely populated: ${brandVoiceSummary.length}/${visualStyleSummary.length}`);
  // marketing-inventory-grounding.js: 8 lines.
  const inventorySummary = `Real current inventory to ground this in (do not mention flowers not on this list): ${Array.from({ length: 8 }, (_, i) => `Garden Rose Variety Number ${i + 1} (qty 24 stems)`).join("; ")}.`;
  const audienceSummary = "Real audience data for this shop (never invent a different number or segment): 412 customers on file; 118 ordered in the last 90 days; top segments: sympathy families (71), weddings (34), birthdays (28); 57 email subscribers. Only mention an audience size or segment if the request is actually about targeting, reach, or a specific customer group — never force a mention into copy that isn't about that.";
  // marketing-recent-content-grounding.js: 6 snippets x 140 chars.
  const recentContentSummary = `This shop's own recent real posts, most recent first (never repeat their exact opening line, phrasing, or angle — write something genuinely different this time, even if the underlying occasion/topic is similar): ${Array.from({ length: 6 }, (_, i) => `${i + 1}) "${"Lorem ipsum caption text that runs right up to the snippet cap of one hundred and forty chars total ok ".slice(0, 140)}…"`).join(" ")}`;
  const args = { channel: "facebook", occasion: TEST_C_BRIEF, shop: { name: SHOP }, requestText: TEST_C_BRIEF, concept };
  const bare = buildSocialPostTask(args);
  const full = buildSocialPostTask({ ...args, brandVoiceSummary, visualStyleSummary, inventorySummary, audienceSummary, recentContentSummary });
  assert.ok(full.length < TASK_TEXT_MAX_CHARS, `worst-case prompt ${full.length} chars must fit under the ${TASK_TEXT_MAX_CHARS} cap with margin`);
  assert.ok(full.length > 12000, `(${full.length}) documents why the old 12,000 cap had to be raised`);
  assert.ok(TASK_TEXT_MAX_CHARS - full.length >= 2500, "keep real margin, not just enough to clear it");
  // The rules that a trim would have removed are the ones at the very end.
  assert.match(full.slice(-1200), /- objective: name the ONE real marketing objective/);
  assert.match(bare, /SHAPE — the hook IS the caption/);
});

// ---------------------------------------------------------------------------
// Part 4 — safety unchanged.
// ---------------------------------------------------------------------------

test("safety: 'send flowers today' allowed; same-day delivery, availability, inventory, invented offers/cutoffs, fabricated numbers still blocked", () => {
  const requestText = TEST_C_BRIEF;
  assert.deepEqual(detectUnverifiedServiceAvailabilityClaim({ generatedText: "Send someone flowers today from Lilies in Bloom.", requestText }), []);
  assert.deepEqual(detectInventedTemporalClaim({ generatedText: "Send someone flowers today.", requestText }), []);
  assert.ok(detectUnverifiedServiceAvailabilityClaim({ generatedText: "We can deliver today.", requestText }).length > 0);
  assert.ok(detectUnverifiedServiceAvailabilityClaim({ generatedText: "Same-day delivery available on every order.", requestText }).length > 0);
  assert.ok(detectUnverifiedServiceAvailabilityClaim({ generatedText: "Order by 2 PM for delivery today.", requestText }).length > 0);
  assert.ok(detectUnverifiedInventoryStateClaim({ generatedText: "Fresh garden roses just came in stock.", requestText, verifiedFlowerNames: [] }).length > 0);
  const stripped = stripFabricatedContactNumbers({ requestText, shopPhone: "6065064039", copyText: "Call 555-000-1234 to order." });
  assert.ok(!stripped.text.includes("555-000-1234"));
  // The natural caption fixture itself invents nothing the evaluator objects to.
  const evalResult = evaluateMarketingOutput({
    route: "generate_content",
    request: requestText,
    shopEvidence: { name: SHOP, phone: PHONE },
    canonicalConcept: { audience: "general_local_customers", messageIntent: "send_flowers" },
    candidate: { headline: "", body: NATURAL_SHORT_CAPTION, cta: "" },
    component: "caption"
  });
  assert.deepEqual(evalResult.reasonCodes, []);
});

// ---------------------------------------------------------------------------
// Part 5 — Birthday / Sympathy / self-purchase / Promotion / Operational unchanged.
// ---------------------------------------------------------------------------

test("Birthday, Sympathy, self-purchase rescue wording byte-for-byte unchanged; promotion and operational-notice paths untouched by the shape work", () => {
  const birthday = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: "6065064039", ctaIntent: "call_shop", audience: "general_local_customers", occasionCategory: "birthday", namedCampaign: "birthday" });
  assert.equal(birthday.body, "Lilies in Bloom has birthday flowers ready to make someone's day feel special.");
  const sympathy = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: "6065064039", ctaIntent: "call_shop", audience: "funeral_families", occasionCategory: "sympathy", namedCampaign: "sympathy" });
  assert.equal(sympathy.body, "Lilies in Bloom helps families choose funeral and sympathy flowers with care.");
  const selfPurchase = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: "6065064039", ctaIntent: "call_shop", audience: "self_purchase", occasionCategory: "general", namedCampaign: "none" });
  assert.equal(selfPurchase.body, "You don't need a reason to bring home flowers from Lilies in Bloom — sometimes wanting them is reason enough.");

  // Promotion copy: the everyday guard never applies (intent is not send_flowers/brighten_day).
  assert.equal(classifyMessageIntent({ requestText: "Create a Facebook post for 20% off bouquets this week.", audience: "general_local_customers", isSympathy: false, occasionCategory: "general" }), "general_everyday");
  // Operational notices never reach the AI caption evaluator at all — unchanged.
  assert.equal(requestSignalsPlainOperationalNotice("We are closing early today at 3 PM."), true);
  // Sympathy requests never classify as an everyday gifting intent, so no shape rule, no guard, no cut instruction.
  assert.equal(classifyMessageIntent({ requestText: "send flowers to the Johnson family for their mother's funeral", audience: "funeral_families", isSympathy: true, occasionCategory: "sympathy" }), "general_everyday");
});
