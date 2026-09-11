import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCopySpecificityProfile,
  classifySentenceSpecificity,
  findHollowSentences,
  evaluateMarketingOutput,
  buildCopyEvaluationDiagnostic,
  detectWeakMarketingCopy,
  detectWeakMarketingCopyReasonCodes,
  detectUnverifiedServiceAvailabilityClaim,
  detectUnverifiedInventoryStateClaim,
  stripFabricatedContactNumbers,
  buildDeterministicCreativeRescueContent,
  BEREAVEMENT_CONTEXT_RE,
  RETRY_FEEDBACK_VERSION
} from "../netlify/functions/_shared/marketing-content-revision.js";
import { _internalsForTesting, generateSocialPost, COPY_GUIDANCE_VERSION } from "../netlify/functions/_shared/ai-creative-engine.js";
import {
  classifyMessageIntent,
  classifyUserTemporalIntent,
  classifyAudience,
  classifyOccasionCategory,
  buildCanonicalConcept
} from "../netlify/functions/_shared/marketing-canonical-concept.js";
import { buildDeterministicCreativeDirection, validateCreativeDirection } from "../netlify/functions/_shared/marketing-creative-direction.js";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// ---------------------------------------------------------------------------
// Test C copy-observability follow-up.
//
// The live Test C run on staging commit e239e8c (2026-09-10 17:56 UTC)
// rejected both AI caption attempts (weak_copy_filler_phrase, then
// weak_copy_hollow_sentence), fired the deterministic rescue, and shipped
// the rescue caption — an outcome identical to the run before that commit.
// The persisted diagnostics could not say whether the WRITER produced
// generic copy or the EVALUATOR wrongly rejected specific copy, because
// (correctly) the rejected text itself is never stored.
//
// This file proves the non-sensitive answer to that question now exists:
//   - a per-attempt specificity PROFILE (counts/ratios/booleans, computed by
//     the same primitives the hollow-sentence rule uses) is persisted;
//   - the prompt-construction FACTS for each attempt (which coaching was
//     actually included, which guidance/feedback version) are persisted;
//   - the raw rejected copy is still never persisted anywhere;
//   - the exact Test C input builds the intended prompt;
//   - the tightened send_flowers guidance and hollow-copy retry feedback
//     demand a concrete human hook and name what does not count;
//   - the two-attempt provider budget, every fact-safety detector, and the
//     Birthday/Sympathy/self-purchase paths are unchanged;
//   - the photo-forward branding exception is documented without loosening
//     the designed-flyer branding requirement.
// ---------------------------------------------------------------------------

const SHOP = "Lilies in Bloom";
const TEST_C_BRIEF = "Create a Facebook post encouraging people to send flowers today.";
const TEST_C_RESCUE_CAPTION = "Lilies in Bloom makes it easy to send someone flowers today. Call 606-506-4039 to place an order.";

// Three substantive sentences, every one hollow by the evaluator's own
// definition (no flower/product/number/date, no person+action pairing).
const HOLLOW_COPY =
  "Sending flowers is a wonderful way to show someone you care. It's a gesture that speaks volumes and brightens any day. There's no better time than now to let someone special know you're thinking of them.";
// Distinctive fragments of that copy (and of the rejected draft's headline
// used in the handler test) — none may ever reach a persisted row.
const HOLLOW_HEADLINE = "A Little Something Sent Your Way";
const HOLLOW_FRAGMENTS = ["wonderful way", "speaks volumes", "no better time than now", "someone special", "Little Something Sent"];

function testCClassification() {
  const isSympathy = BEREAVEMENT_CONTEXT_RE.test(`${TEST_C_BRIEF} ${TEST_C_BRIEF}`);
  const occasionCategory = classifyOccasionCategory({ occasionTitle: TEST_C_BRIEF, requestText: TEST_C_BRIEF, objective: null, isSympathy });
  const audience = classifyAudience({ requestText: TEST_C_BRIEF, occasionTitle: TEST_C_BRIEF, isSympathy, occasionCategory });
  const messageIntent = classifyMessageIntent({ requestText: TEST_C_BRIEF, audience, isSympathy, occasionCategory });
  const userTemporalIntent = classifyUserTemporalIntent({ requestText: TEST_C_BRIEF });
  return { isSympathy, occasionCategory, audience, messageIntent, userTemporalIntent };
}

function assertNoRawCopy(serialized, label) {
  for (const fragment of HOLLOW_FRAGMENTS) {
    assert.ok(!serialized.includes(fragment), `${label} must never contain the rejected copy's own wording ("${fragment}")`);
  }
}

// ---------------------------------------------------------------------------
// Part 1 — the non-sensitive specificity profile.
// ---------------------------------------------------------------------------

test("profile: fully hollow copy reports 3/3 hollow substantive sentences, ratio 1, rule triggered, neither specificity signal matched", () => {
  const profile = buildCopySpecificityProfile(HOLLOW_COPY, { shopName: SHOP, audience: "general_local_customers" });
  assert.equal(profile.sentenceCount, 3);
  assert.equal(profile.substantiveSentenceCount, 3);
  assert.equal(profile.hollowSentenceCount, 3);
  assert.equal(profile.hollowRatio, 1);
  assert.equal(profile.hollowThresholdMet, true);
  assert.equal(profile.commercialSpecificityMatched, false);
  assert.equal(profile.humanSituationalSpecificityMatched, false);
  assert.deepEqual(profile.sentenceCategoryCounts, { short: 0, commercial: 0, human_situational: 0, both: 0, hollow: 3 });
  // The independent sub-signals: sentences 1 and 3 carry a bare person
  // reference ("someone"/"you"/"them"), sentence 2 carries none, and no
  // sentence has a relational action — this is what distinguishes generic
  // copy from a near-miss the evaluator might be wrongly rejecting.
  assert.deepEqual(profile.signalCounts, { personReference: 2, relationalAction: 0, commercialDetail: 0 });
  assert.equal(profile.fillerPhraseHitCount, 0);
  assert.equal(profile.selfPurchaseExempt, false);
  // The profile mirrors the real rule: the same copy IS flagged hollow.
  assert.ok(detectWeakMarketingCopyReasonCodes(TEST_C_BRIEF, HOLLOW_COPY, { shopName: SHOP }).includes("weak_copy_hollow_sentence"));
});

test("profile: genuinely specific copy reports the human/situational signal as matched and the hollow rule as NOT triggered", () => {
  const good = "Your mom hasn't heard from you in a week. A bouquet on her porch says more than a text ever could. Order today and we'll have it ready by tomorrow.";
  const profile = buildCopySpecificityProfile(good, { shopName: SHOP });
  assert.equal(profile.humanSituationalSpecificityMatched, true);
  assert.equal(profile.hollowThresholdMet, false);
  assert.ok(profile.sentenceCategoryCounts.human_situational >= 2);
  // Mirrors the real rule: this copy is NOT flagged hollow.
  assert.ok(!detectWeakMarketingCopyReasonCodes("", good, { shopName: SHOP }).includes("weak_copy_hollow_sentence"));
});

test("profile: commercial/floral specificity is reported separately from human/situational specificity", () => {
  const commercial = "Fresh peonies and garden roses are hand-tied here in the shop every single morning of the week.";
  const profile = buildCopySpecificityProfile(commercial, { shopName: SHOP });
  assert.equal(profile.commercialSpecificityMatched, true);
  assert.equal(profile.humanSituationalSpecificityMatched, false);
  assert.equal(profile.sentenceCategoryCounts.commercial, 1);
});

test("profile: per-sentence categories match findHollowSentences exactly — the filter is a thin wrapper over the classifier, so they cannot drift", () => {
  const mixed = `${HOLLOW_COPY} Your sister hasn't heard from you in a month. Roses. Twelve stems, hand-tied in the shop this morning for whoever needs them.`;
  const hollowViaFilter = findHollowSentences(mixed, SHOP);
  const hollowViaClassifier = mixed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => classifySentenceSpecificity(s, SHOP) === "hollow");
  assert.deepEqual(hollowViaFilter, hollowViaClassifier);
  assert.equal(classifySentenceSpecificity("Roses.", SHOP), "short");
  assert.equal(classifySentenceSpecificity("Your sister hasn't heard from you in a month.", SHOP), "human_situational");
  assert.equal(classifySentenceSpecificity("Twelve stems, hand-tied in the shop this morning for whoever needs them.", SHOP), "commercial");
});

test("profile: hollowThresholdMet means the threshold was met, not that the hollow check fired — filler takes precedence, so it must be read with weakCopyReasonCodes", () => {
  const fillerFirst = `We understand the importance of flowers in everyday life. ${HOLLOW_COPY}`;
  const codes = detectWeakMarketingCopyReasonCodes(TEST_C_BRIEF, fillerFirst, { shopName: SHOP });
  assert.deepEqual(codes, ["weak_copy_filler_phrase"], "the hollow check never runs once a filler phrase matched");
  const profile = buildCopySpecificityProfile(fillerFirst, { shopName: SHOP });
  assert.equal(profile.fillerPhraseHitCount, 1);
  assert.equal(profile.hollowThresholdMet, true, "the threshold was still met — the profile reports the copy's shape, the codes report which check fired");
});

test("profile: self_purchase stays exempt — zero hollow sentences reported, flag set, exactly as findHollowSentences already behaves", () => {
  const profile = buildCopySpecificityProfile(HOLLOW_COPY, { shopName: SHOP, audience: "self_purchase" });
  assert.equal(profile.selfPurchaseExempt, true);
  assert.equal(profile.hollowSentenceCount, 0);
  assert.equal(profile.hollowThresholdMet, false);
  assert.deepEqual(findHollowSentences(HOLLOW_COPY, SHOP, { audience: "self_purchase" }), []);
});

test("profile: contains only numbers, booleans, null and a numeric count map — never a sentence, phrase, or word of the copy", () => {
  const profile = buildCopySpecificityProfile(HOLLOW_COPY, { shopName: SHOP });
  assertNoRawCopy(JSON.stringify(profile), "copy profile");
  for (const [key, value] of Object.entries(profile)) {
    if (key === "sentenceCategoryCounts" || key === "signalCounts") {
      for (const n of Object.values(value)) assert.equal(typeof n, "number");
      continue;
    }
    if (key === "everydayShape") {
      for (const v of Object.values(value)) assert.ok(["number", "boolean"].includes(typeof v), "everydayShape holds only numbers and booleans");
      continue;
    }
    assert.ok(["number", "boolean"].includes(typeof value) || value === null, `${key} must be a number, boolean, or null`);
  }
});

test("evaluateMarketingOutput: returns the profile of the SAME joined candidate it judged, on both reject and pass paths", () => {
  const rejected = evaluateMarketingOutput({
    route: "generate_content",
    request: TEST_C_BRIEF,
    shopEvidence: { name: SHOP, phone: "6065064039" },
    canonicalConcept: { audience: "general_local_customers" },
    candidate: { headline: "h", body: HOLLOW_COPY, cta: "" },
    component: "caption"
  });
  assert.equal(rejected.decision, "retry");
  assert.ok(rejected.weakCopyReasonCodes.includes("weak_copy_hollow_sentence"));
  assert.equal(rejected.copyProfile.hollowSentenceCount, 3);
  assert.equal(rejected.copyProfile.hollowThresholdMet, true);

  const passed = evaluateMarketingOutput({
    route: "generate_content",
    request: TEST_C_BRIEF,
    shopEvidence: { name: SHOP, phone: "6065064039" },
    canonicalConcept: { audience: "general_local_customers" },
    candidate: { headline: null, body: "Your friend hasn't heard from you in a while. Sending flowers today is a simple way to remind them you're thinking of them.", cta: "" },
    component: "caption"
  });
  assert.equal(passed.decision, "pass");
  assert.equal(passed.copyProfile.humanSituationalSpecificityMatched, true);
  assert.equal(passed.copyProfile.hollowThresholdMet, false);
});

// ---------------------------------------------------------------------------
// Part 1 — the extended diagnostic shape and its privacy guarantees.
// ---------------------------------------------------------------------------

test("buildCopyEvaluationDiagnostic: carries the profile, an allow-listed prompt context, and the retry-feedback version — and nothing else from the prompt context", () => {
  const evalResult = evaluateMarketingOutput({
    route: "generate_content",
    request: TEST_C_BRIEF,
    shopEvidence: { name: SHOP },
    canonicalConcept: { audience: "general_local_customers" },
    candidate: { headline: "h", body: HOLLOW_COPY, cta: "" },
    component: "caption",
    isRetryAttempt: true
  });
  const diagnostic = buildCopyEvaluationDiagnostic({
    attempt: 2,
    evalResult,
    diversityEval: { decision: "pass", repeatedSignals: [] },
    selected: true,
    rescueFired: true,
    promptContext: {
      copyGuidanceVersion: COPY_GUIDANCE_VERSION,
      messageIntent: "send_flowers",
      userTemporalIntent: "today",
      audience: "general_local_customers",
      occasionCategory: "general",
      messageIntentGuidanceIncluded: true,
      userTemporalIntentLineIncluded: 1,
      audienceGuidanceIncluded: false,
      // Must all be dropped: not on the allow-list, or not a short enum.
      requestText: TEST_C_BRIEF,
      taskPrompt: "You are writing the ACTUAL, FINISHED social media post ...",
      candidateBody: HOLLOW_COPY,
      messageIntentGuidanceText: _internalsForTesting.MESSAGE_INTENT_COPY_GUIDANCE.send_flowers
    },
    retryFeedbackVersion: RETRY_FEEDBACK_VERSION
  });
  assert.equal(diagnostic.diagnosticVersion, 2);
  assert.equal(diagnostic.attempt, 2);
  assert.ok(diagnostic.weakCopyReasonCodes.includes("weak_copy_hollow_sentence"));
  assert.equal(diagnostic.copyProfile.hollowSentenceCount, 3);
  assert.deepEqual(diagnostic.prompt, {
    messageIntent: "send_flowers",
    userTemporalIntent: "today",
    audience: "general_local_customers",
    occasionCategory: "general",
    copyGuidanceVersion: COPY_GUIDANCE_VERSION,
    messageIntentGuidanceIncluded: true,
    userTemporalIntentLineIncluded: true,
    audienceGuidanceIncluded: false,
    // Not supplied in this promptContext → coerced to false, never dropped.
    everydayShapeRuleIncluded: false
  });
  assert.equal(diagnostic.retryFeedbackVersion, RETRY_FEEDBACK_VERSION);
  const serialized = JSON.stringify(diagnostic);
  assertNoRawCopy(serialized, "diagnostic");
  assert.ok(!serialized.includes("encouraging people"), "request text must never be persisted");
  assert.ok(!serialized.includes("ACTUAL, FINISHED"), "prompt text must never be persisted");
  assert.ok(!serialized.includes("REQUIRED: the body"), "guidance text must never be persisted");
});

test("buildCopyEvaluationDiagnostic: only token-shaped strings survive — a short prose fragment, an over-long token, or a non-string degrades to null", () => {
  const diagnostic = buildCopyEvaluationDiagnostic({
    attempt: 1,
    evalResult: null,
    diversityEval: null,
    selected: false,
    rescueFired: false,
    promptContext: {
      messageIntent: "x".repeat(41),
      audience: 42,
      occasionCategory: HOLLOW_COPY,
      // 40 characters of prose: under any length cap, still must be dropped.
      userTemporalIntent: HOLLOW_COPY.slice(0, 40),
      copyGuidanceVersion: "Sending flowers"
    },
    retryFeedbackVersion: HOLLOW_COPY.slice(0, 40)
  });
  assert.equal(HOLLOW_COPY.slice(0, 40).length, 40);
  assert.equal(diagnostic.prompt.messageIntent, null);
  assert.equal(diagnostic.prompt.audience, null);
  assert.equal(diagnostic.prompt.occasionCategory, null);
  assert.equal(diagnostic.prompt.userTemporalIntent, null);
  assert.equal(diagnostic.prompt.copyGuidanceVersion, null);
  assert.equal(diagnostic.retryFeedbackVersion, null);
  assertNoRawCopy(JSON.stringify(diagnostic), "diagnostic with hostile prompt context");
  // Real enum/version tokens still pass.
  const ok = buildCopyEvaluationDiagnostic({ attempt: 1, evalResult: null, diversityEval: null, selected: false, rescueFired: false, promptContext: { messageIntent: "send_flowers", occasionCategory: "general", copyGuidanceVersion: COPY_GUIDANCE_VERSION }, retryFeedbackVersion: RETRY_FEEDBACK_VERSION });
  assert.equal(ok.prompt.messageIntent, "send_flowers");
  assert.equal(ok.prompt.copyGuidanceVersion, COPY_GUIDANCE_VERSION);
  assert.equal(ok.retryFeedbackVersion, RETRY_FEEDBACK_VERSION);
});

// ---------------------------------------------------------------------------
// Part 2 — the exact Test C input builds the intended prompt.
// ---------------------------------------------------------------------------

test("Test C input: classifies as send_flowers + today, and the prompt actually includes the send_flowers guidance and the temporal line", () => {
  const c = testCClassification();
  assert.equal(c.messageIntent, "send_flowers");
  assert.equal(c.userTemporalIntent, "today");
  assert.equal(c.isSympathy, false);

  const task = _internalsForTesting.buildSocialPostTask({
    channel: "facebook",
    occasion: TEST_C_BRIEF,
    shop: { name: SHOP },
    requestText: TEST_C_BRIEF,
    concept: { isSympathy: c.isSympathy, audience: c.audience, messageIntent: c.messageIntent, userTemporalIntent: c.userTemporalIntent }
  });
  assert.match(task, /core idea is SENDING flowers to someone else/);
  assert.match(task, /REQUIRED: the body must contain at least ONE concrete human hook/);
  assert.match(task, /framed this around "today"/);
  assert.match(task, /NEVER means the shop can promise same-day delivery/);
  // The hard fact-safety rules are still in the same prompt, untouched.
  assert.match(task, /NEVER CLAIM A SPECIFIC BUSINESS FACT THAT ISN'T VERIFIED/);
  assert.match(task, /Never invent a day-of-week/);
  assert.match(task, /This is NOT sympathy\/funeral work/);

  const promptContext = _internalsForTesting.buildSocialPostPromptContext({ isSympathy: false, audience: c.audience, messageIntent: c.messageIntent, userTemporalIntent: c.userTemporalIntent });
  assert.equal(promptContext.messageIntent, "send_flowers");
  assert.equal(promptContext.userTemporalIntent, "today");
  assert.equal(promptContext.messageIntentGuidanceIncluded, true);
  assert.equal(promptContext.userTemporalIntentLineIncluded, true);
  assert.equal(promptContext.copyGuidanceVersion, COPY_GUIDANCE_VERSION);
});

test("promptContext booleans are derived from the same helpers the task builder uses — they turn false exactly when the line is absent from the prompt", () => {
  const { buildSocialPostTask, buildSocialPostPromptContext } = _internalsForTesting;
  const bare = { isSympathy: false, audience: "unknown_general", messageIntent: null, userTemporalIntent: null };
  const task = buildSocialPostTask({ channel: "facebook", occasion: "General", shop: { name: SHOP }, requestText: "post about our shop", concept: bare });
  const ctx = buildSocialPostPromptContext(bare);
  assert.equal(ctx.messageIntentGuidanceIncluded, false);
  assert.equal(ctx.userTemporalIntentLineIncluded, false);
  assert.equal(ctx.audienceGuidanceIncluded, false);
  assert.doesNotMatch(task, /core idea is SENDING flowers/);
  assert.doesNotMatch(task, /framed this around/);
});

test("generateSocialPost: returns promptContext alongside the copy, computed from the concept it was actually called with", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ success: true, result: { response: JSON.stringify({ platform: "facebook", headline: "h", body: HOLLOW_COPY, cta: "c", visual_brief: "v", hashtags: [], asset_requirements: [] }) } })
  });
  try {
    const c = testCClassification();
    const result = await generateSocialPost({
      channel: "facebook",
      occasion: TEST_C_BRIEF,
      shop: { name: SHOP },
      requestText: TEST_C_BRIEF,
      concept: { isSympathy: false, audience: c.audience, messageIntent: c.messageIntent, userTemporalIntent: c.userTemporalIntent }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.promptContext, {
      copyGuidanceVersion: COPY_GUIDANCE_VERSION,
      messageIntent: "send_flowers",
      userTemporalIntent: "today",
      audience: c.audience,
      messageIntentGuidanceIncluded: true,
      userTemporalIntentLineIncluded: true,
      audienceGuidanceIncluded: Boolean(_internalsForTesting.AUDIENCE_COPY_GUIDANCE[c.audience]),
      // Test C writer-quality fix: send_flowers is an everyday gifting intent.
      everydayShapeRuleIncluded: true
    });
    assertNoRawCopy(JSON.stringify(result.promptContext), "promptContext");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Part 3 — the guidance is actually stronger, without example-copying bait.
// ---------------------------------------------------------------------------

test("send_flowers guidance: REQUIRES one concrete human hook from four named types, forbids reusing the instructions' wording, and names the generic constructions that never count", () => {
  const g = _internalsForTesting.MESSAGE_INTENT_COPY_GUIDANCE.send_flowers;
  assert.match(g, /REQUIRED: the body must contain at least ONE concrete human hook/);
  assert.match(g, /\(1\) a specific recipient relationship/);
  assert.match(g, /\(2\) a specific everyday situation/);
  assert.match(g, /\(3\) a specific action/);
  assert.match(g, /\(4\) the specific consequence/);
  assert.match(g, /do not reuse any wording from these instructions/);
  for (const phrase of ["makes it easy", "moments that matter", "brighten someone's day", "show you care"]) {
    assert.ok(g.includes(`'${phrase}'`), `send_flowers guidance must explicitly discourage '${phrase}'`);
  }
  assert.match(g, /never count as the hook on their own/);
  // No worked example sentences a model could paste back.
  assert.doesNotMatch(g, /rough week|haven't talked to in a while|surprise a partner/i);
  // Fact-safety inside the guidance is preserved and broadened, never loosened.
  assert.match(g, /Do NOT invent or imply a specific flower species, product, price, discount, delivery method, availability, or timing/);
});

test("general_everyday carries the shared generic-construction rule; brighten_day carries it WITHOUT listing the framing the florist explicitly asked for; self_purchase still has no messageIntent entry", () => {
  const { MESSAGE_INTENT_COPY_GUIDANCE, GENERIC_CONSTRUCTION_RULE, GENERIC_CONSTRUCTION_RULE_BRIGHTEN_DAY } = _internalsForTesting;
  assert.ok(MESSAGE_INTENT_COPY_GUIDANCE.general_everyday.endsWith(GENERIC_CONSTRUCTION_RULE));
  // Test C writer-quality fix: the two everyday gifting intents now END with
  // the SHAPE rule (see marketing-everyday-caption-shape.test.js); the
  // generic-construction rule still sits immediately before it.
  assert.ok(MESSAGE_INTENT_COPY_GUIDANCE.send_flowers.includes(GENERIC_CONSTRUCTION_RULE + " " + _internalsForTesting.EVERYDAY_SOCIAL_SHAPE_RULE));
  assert.ok(MESSAGE_INTENT_COPY_GUIDANCE.brighten_day.includes(GENERIC_CONSTRUCTION_RULE_BRIGHTEN_DAY + " " + _internalsForTesting.EVERYDAY_SOCIAL_SHAPE_RULE));
  // The brighten_day request asked for that framing — the rule must not
  // then tell the model the same phrase can never be the point.
  assert.match(GENERIC_CONSTRUCTION_RULE_BRIGHTEN_DAY, /Generic constructions never count as the hook on their own/);
  assert.doesNotMatch(GENERIC_CONSTRUCTION_RULE_BRIGHTEN_DAY, /'brighten someone's day'/);
  assert.match(GENERIC_CONSTRUCTION_RULE, /'brighten someone's day'/);
  assert.equal(MESSAGE_INTENT_COPY_GUIDANCE.self_purchase, undefined);
  assert.match(MESSAGE_INTENT_COPY_GUIDANCE.brighten_day, /REQUIRED: ground it in exactly one concrete human hook/);
});

// ---------------------------------------------------------------------------
// Part 2/5 — retry feedback is concrete.
// ---------------------------------------------------------------------------

test("retry feedback for hollow copy names ONE hook to pick, the four hook types, and the constructions that do not count — concrete rewrite instructions, not just 'be specific'", () => {
  const reasons = detectWeakMarketingCopy(TEST_C_BRIEF, HOLLOW_COPY, { shopName: SHOP });
  const hollowFeedback = reasons.find((r) => /would read the same for any business/.test(r));
  assert.ok(hollowFeedback, `expected the hollow-sentence feedback, got ${JSON.stringify(reasons)}`);
  assert.match(hollowFeedback, /pick ONE real hook/);
  assert.match(hollowFeedback, /a specific recipient relationship, a specific everyday situation, a specific action, or the specific consequence for that person/);
  assert.match(hollowFeedback, /"Makes it easy", "moments that matter", "brighten someone's day", "show you care"/);
  // The pre-existing broadened route wording is still there for the existing tests.
  assert.match(hollowFeedback, /OR a specific recipient, situation, action, or sensory detail/);
  assert.equal(typeof RETRY_FEEDBACK_VERSION, "string");
});

// ---------------------------------------------------------------------------
// Part 5 — real handler: both rejected attempts persist diagnostics, the raw
// copy is persisted nowhere, and no third provider call happens.
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
  const filler = Array.from({ length: 24 }, (_, i) => ({ data: { id: `x${i}` }, error: null }));
  return [...fixed, ...filler];
}

test("handler: two hollow caption attempts → a structured, profile-carrying diagnostic on BOTH usage rows, the rescue caption ships, the raw copy is persisted nowhere, and exactly two text-model calls are made", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  // Every Cloudflare call the real handler makes is recorded by what it
  // asked for (the social-post task is identified by its own opening
  // sentence in the request body) — the generate path also makes other,
  // legitimate non-copy calls (image, vision QA), which must not be
  // mistaken for a third copy attempt or hide one.
  let socialCopyCalls = 0;
  const providerCalls = [];
  globalThis.fetch = async (url, options) => {
    const body = String(options?.body || "");
    const isSocialCopyTask = body.includes("You are writing the ACTUAL, FINISHED social media post");
    const body_has_flyer_task = body.includes("FINISHED text content for a flyer/graphic");
    providerCalls.push({ url: String(url).replace(/^.*\/ai\/run\//, ""), isSocialCopyTask, body_has_flyer_task });
    if (String(url).includes("flux")) {
      return { ok: true, json: async () => ({ success: true, result: { image: Buffer.from("fake-jpeg-bytes").toString("base64") } }) };
    }
    if (isSocialCopyTask) socialCopyCalls++;
    return {
      ok: true,
      json: async () => ({
        success: true,
        result: {
          response: JSON.stringify({
            platform: "facebook",
            headline: HOLLOW_HEADLINE,
            body: HOLLOW_COPY,
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

    // The live Test C outcome, reproduced: both attempts rejected → rescue.
    assert.equal(body.copy.creative_rescue_used, true);
    assert.equal(body.copy.body, TEST_C_RESCUE_CAPTION);

    // Provider budget: exactly two text-model calls (attempt + one bounded
    // retry). The flyer wording reuses the rescue, so it costs nothing.
    assert.equal(socialCopyCalls, 2, `exactly one AI attempt plus one bounded retry — never a third social-copy call. Calls seen: ${JSON.stringify(providerCalls)}`);
    // And the flyer's on-image wording never spent its own AI call — the
    // caption rescue was reused, so no flyer-content task reached the provider.
    assert.ok(
      !providerCalls.some((c) => c.body_has_flyer_task),
      "no flyer-content task may reach the provider when the caption rescue is reused"
    );

    const diagnosticUpdates = client.calls.filter(
      (c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "update" && op[1][0]?.metadata?.attempt !== undefined)
    );
    assert.equal(diagnosticUpdates.length, 2, "both attempts' usage rows must receive a diagnostic write");
    const [d1, d2] = diagnosticUpdates.map((c) => c.payload.metadata);
    const c = testCClassification();

    for (const [label, d] of [["attempt 1", d1], ["attempt 2", d2]]) {
      assert.equal(d.diagnosticVersion, 2, label);
      assert.ok(d.weakCopyReasonCodes.includes("weak_copy_hollow_sentence"), `${label}: real sub-reason recorded`);
      assert.equal(d.rescueFired, true, label);
      assert.equal(d.copyProfile.substantiveSentenceCount, 3, label);
      assert.equal(d.copyProfile.hollowSentenceCount, 3, label);
      assert.equal(d.copyProfile.hollowRatio, 1, label);
      assert.equal(d.copyProfile.hollowThresholdMet, true, label);
      assert.equal(d.copyProfile.commercialSpecificityMatched, false, label);
      assert.equal(d.copyProfile.humanSituationalSpecificityMatched, false, label);
      assert.equal(d.prompt.messageIntent, "send_flowers", label);
      assert.equal(d.prompt.userTemporalIntent, "today", label);
      assert.equal(d.prompt.audience, c.audience, label);
      assert.equal(d.prompt.occasionCategory, c.occasionCategory, label);
      assert.equal(d.prompt.messageIntentGuidanceIncluded, true, label);
      assert.equal(d.prompt.userTemporalIntentLineIncluded, true, label);
      assert.equal(d.prompt.copyGuidanceVersion, COPY_GUIDANCE_VERSION, label);
    }
    assert.equal(d1.attempt, 1);
    assert.equal(d1.retryFeedbackVersion, null, "attempt 1 saw no rejection feedback");
    assert.equal(d1.selected, false);
    assert.equal(d2.attempt, 2);
    assert.equal(d2.retryFeedbackVersion, RETRY_FEEDBACK_VERSION, "attempt 2 records WHICH feedback wording it saw");
    assert.equal(d2.selected, true, "the retry tied on problem count and was the kept draft — then rescued");

    // Privacy: the rejected caption copy (body and headline) must not appear
    // in ANY persisted payload (usage rows, assets, variants, content items)
    // or in storage. Scope note: the rejected attempt's visual_brief is a
    // separate, pre-existing field this change does not touch.
    const persisted = JSON.stringify(client.calls.map((call) => call.payload ?? null));
    assertNoRawCopy(persisted, "every persisted payload");
    assertNoRawCopy(JSON.stringify(storage.calls.map((call) => (typeof call.body === "string" ? call.body : ""))), "storage uploads");
    // ...while the diagnostics themselves DID land on the usage rows.
    assert.ok(persisted.includes('"hollowThresholdMet":true'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Part 4 — safety is untouched.
// ---------------------------------------------------------------------------

test("safety: 'send flowers today' stays allowed; 'we can deliver today', invented inventory, invented cutoff, fabricated contact data stay blocked", () => {
  const requestText = "Send someone flowers today.";
  assert.deepEqual(detectUnverifiedServiceAvailabilityClaim({ generatedText: "Send someone flowers today from Lilies in Bloom.", requestText }), []);
  assert.ok(detectUnverifiedServiceAvailabilityClaim({ generatedText: "We can deliver today.", requestText }).length > 0);
  assert.ok(detectUnverifiedServiceAvailabilityClaim({ generatedText: "Same-day delivery available on every order.", requestText }).length > 0);
  assert.ok(detectUnverifiedServiceAvailabilityClaim({ generatedText: "Order by 2 PM for delivery today.", requestText }).length > 0);
  assert.ok(detectUnverifiedInventoryStateClaim({ generatedText: "Fresh garden roses just came in stock.", requestText, verifiedFlowerNames: [] }).length > 0);
  const stripped = stripFabricatedContactNumbers({ requestText, shopPhone: "6065064039", copyText: "Call 555-000-1234 to order." });
  assert.ok(!stripped.text.includes("555-000-1234"));
});

// ---------------------------------------------------------------------------
// Part 5 — Birthday / Sympathy / self-purchase unchanged.
// ---------------------------------------------------------------------------

test("Birthday/Sympathy/self-purchase: rescue wording byte-for-byte unchanged; sympathy and self_purchase prompts never receive the send_flowers requirement", () => {
  const birthday = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: "6065064039", ctaIntent: "call_shop", audience: "general_local_customers", occasionCategory: "birthday", namedCampaign: "birthday" });
  assert.equal(birthday.body, "Lilies in Bloom has birthday flowers ready to make someone's day feel special.");
  const sympathy = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: "6065064039", ctaIntent: "call_shop", audience: "funeral_families", occasionCategory: "sympathy", namedCampaign: "sympathy" });
  assert.equal(sympathy.body, "Lilies in Bloom helps families choose funeral and sympathy flowers with care.");
  const selfPurchase = buildDeterministicCreativeRescueContent({ shopName: SHOP, shopPhone: "6065064039", ctaIntent: "call_shop", audience: "self_purchase", occasionCategory: "general", namedCampaign: "none" });
  assert.equal(selfPurchase.body, "You don't need a reason to bring home flowers from Lilies in Bloom — sometimes wanting them is reason enough.");

  const { buildSocialPostTask, AUDIENCE_COPY_GUIDANCE } = _internalsForTesting;
  const sympathyIntent = classifyMessageIntent({ requestText: "Let families know they can send flowers for the funeral service.", audience: "funeral_families", isSympathy: true, occasionCategory: "sympathy" });
  assert.equal(sympathyIntent, "general_everyday");
  const sympathyTask = buildSocialPostTask({ channel: "facebook", occasion: "Sympathy", shop: { name: SHOP }, requestText: "funeral flowers", concept: { isSympathy: true, audience: "funeral_families", messageIntent: sympathyIntent } });
  assert.match(sympathyTask, /THIS IS SYMPATHY\/FUNERAL WORK/);
  assert.doesNotMatch(sympathyTask, /REQUIRED: the body must contain at least ONE concrete human hook/);

  const selfTask = buildSocialPostTask({ channel: "facebook", occasion: "General", shop: { name: SHOP }, requestText: "cute post about buying myself flowers", concept: { audience: "self_purchase", messageIntent: "self_purchase" } });
  assert.match(selfTask, /buying flowers for THEMSELVES/);
  assert.doesNotMatch(selfTask, /core idea is SENDING flowers/);
  assert.match(AUDIENCE_COPY_GUIDANCE.self_purchase, /never fall back on generic all-purpose florist language/);
});

// ---------------------------------------------------------------------------
// Decision 1 — the photo-forward branding exception is documented, and the
// designed-flyer branding requirement is unchanged in code.
// ---------------------------------------------------------------------------

test("branding rule doc: states the designed-flyer on-image shop-name requirement AND the photo-forward exception, as two separate rules", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const doc = fs.readFileSync(path.join(here, "..", ".claude", "rules", "marketing-studio.md"), "utf8");
  assert.match(doc, /Designed flyers \/ graphic layouts[\s\S]*shop's own real name is mandatory[\s\S]*visibly identifiable on-image/);
  assert.match(doc, /Photo-forward social posts[\s\S]*on-image branding is optional and should normally be[\s\S]*omitted unless the florist explicitly asks for it or it is creatively[\s\S]*appropriate/);
  assert.match(doc, /does not loosen that rule for any designed flyer/);
});

test("branding in code: a subject-forward everyday post resolves to photo_forward_social with the brand slot off, while a designed-flyer direction can never disable its brand slot", () => {
  const concept = buildCanonicalConcept({
    requestText: TEST_C_BRIEF,
    occasionTitle: TEST_C_BRIEF,
    platform: "facebook",
    contentType: "image_post",
    assetType: "flyer",
    objective: "awareness",
    primarySubject: null,
    ctaText: null,
    bodyText: "",
    isSympathy: false,
    photoStrategy: "subject_forward",
    styleTier: "generated"
  });
  const direction = buildDeterministicCreativeDirection({ canonicalConcept: concept, shopBrand: {} });
  assert.equal(direction.occasionTreatment, "photo_forward_social");
  assert.equal(direction.graphicTextSlots.brand, false);
  assert.equal(direction.graphicTextSlots.headline, false);

  // Designed-flyer path (the validator's default, non-photo-forward case):
  // the brand slot is forced back on and reported as an error.
  const { direction: designed, errors } = validateCreativeDirection({ graphicTextSlots: { brand: false } });
  assert.equal(designed.graphicTextSlots.brand, true);
  assert.ok(errors.some((e) => /brand.*disabled/i.test(e)));
});
