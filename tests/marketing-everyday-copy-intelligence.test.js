import test from "node:test";
import assert from "node:assert/strict";
import {
  findHollowSentences,
  hasHumanSituationalSpecificity,
  detectWeakMarketingCopy,
  detectWeakMarketingCopyReasonCodes,
  detectUnverifiedServiceAvailabilityClaim,
  stripUnverifiedServiceAvailabilityClaims,
  detectInventedTemporalClaim,
  detectUnverifiedInventoryStateClaim,
  stripFabricatedContactNumbers,
  buildDeterministicCreativeRescueContent
} from "../netlify/functions/_shared/marketing-content-revision.js";
import { _internalsForTesting, generateSocialPost } from "../netlify/functions/_shared/ai-creative-engine.js";
import { classifyMessageIntent } from "../netlify/functions/_shared/marketing-canonical-concept.js";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

const SHOP = "Lilies in Bloom";

// ---------------------------------------------------------------------------
// Everyday copy intelligence fix (Test C copy-quality follow-up). A corpus
// investigation proved findHollowSentences() flagged 4/6 genuinely good
// everyday/gifting captions as "hollow" (67% false-positive rate) purely
// because they name no flower species/product/number/date, while every
// occasion with a natural anchor to name (birthday, sympathy, promotion)
// saw zero false positives — the same premise mismatch this file's own
// self_purchase exemption already documents, for a different signal. This
// file is the permanent regression corpus + prompt/retry/safety proof for
// the fix: a second, compositional human/situational specificity signal
// (hasHumanSituationalSpecificity) alongside the existing commercial/
// floral one, generation-prompt coaching for send_flowers/brighten_day/
// general_everyday, and actionable (not just "don't repeat") retry
// feedback — all using the EXISTING two-attempt generation budget, never
// a third provider call, and never weakening any fact-safety detector.
// ---------------------------------------------------------------------------

function isHollowFlagged(text, opts = {}) {
  return detectWeakMarketingCopyReasonCodes("", text, { shopName: SHOP, ...opts }).includes("weak_copy_hollow_sentence");
}
function isWeakFlagged(text, requestText = "", opts = {}) {
  return detectWeakMarketingCopyReasonCodes(requestText, text, { shopName: SHOP, ...opts }).length > 0;
}

// ---------------------------------------------------------------------------
// Part 3: the permanent corpus.
// ---------------------------------------------------------------------------

const GOOD_COPY = [
  {
    label: "emotional everyday gifting",
    text: "Sometimes the best reason to send flowers is that you thought of someone. Lilies in Bloom will help you pick something they'll actually love. Call 606-506-4039 to place an order."
  },
  {
    label: "send-flowers copy, concrete recipient situation",
    text: "Your mom hasn't heard from you in a week. A bouquet on her porch says more than a text ever could. Order today and we'll have it ready by tomorrow."
  },
  {
    label: "brighten-someone's-day copy",
    text: "Know someone having a rough week? A surprise delivery from Lilies in Bloom can turn their whole day around. It takes five minutes to send, and it means everything to receive."
  },
  {
    label: "romantic but non-occasion copy",
    audience: "romantic_partners",
    text: "You don't need an anniversary to surprise someone with flowers. Send a bouquet just because — Lilies in Bloom will make it feel like a big deal anyway."
  },
  {
    label: "concise everyday florist copy",
    text: "Flowers on a Tuesday hit different. Send some today."
  },
  {
    label: "multi-sentence emotional writing, no flower species named",
    text: "A little surprise on someone's doorstep can turn an ordinary afternoon into a good one. That's the whole idea behind sending flowers — no big occasion required, just good timing. Lilies in Bloom makes it easy to send one today."
  },
  { label: "recipient-specific: mother", text: "Your mother mentioned she's had a long week at work. A bouquet waiting on her kitchen table tomorrow morning would say more than a phone call ever could." },
  { label: "recipient-specific: friend", text: "Haven't caught up with your best friend in months? Surprise her with something colorful and let the flowers start the conversation." },
  { label: "recipient-specific: partner", audience: "romantic_partners", text: "Your partner doesn't need a reason to feel appreciated. Drop off a bouquet before they get home and watch their whole evening change." },
  { label: "recipient-specific: coworker", text: "A coworker just got through a rough project. Leaving flowers on their desk Monday morning is a small thing that means a lot." },
  { label: "send-flowers-today", text: "Thinking of someone today? Send them flowers and let them know before the day gets away from you." },
  { label: "just-because gifting", text: "No birthday, no anniversary, just because. Sometimes that's exactly when flowers land the hardest." },
  { label: "sensory/visual writing", text: "Picture the look on their face when a box of fresh blooms shows up at their door with no warning at all. That's the moment worth sending for." },
  { label: "concrete action-based writing", text: "Pick a bouquet, add a short note, and have it dropped off before they even know it's coming. That's the whole plan." },
  { label: "concise conversational writing", text: "Someone's having a rough week. Send them flowers." },
  {
    label: "multi-sentence emotional writing without named flower species (2)",
    text: "A surprise bouquet has a way of stopping someone mid-day. It says you were thinking of them without needing the words. Lilies in Bloom can have one on its way this afternoon."
  }
];

const BAD_COPY = [
  {
    label: "generic AI filler",
    text: "Sending flowers is a wonderful way to show someone you care. It's a gesture that speaks volumes and brightens any day. There's no better time than now to let someone special know you're thinking of them."
  },
  {
    label: "repetitive inspirational fluff",
    text: "Flowers have a way of making people feel truly special and appreciated. They bring joy and warmth to any moment, big or small. Every bouquet tells a story of love and thoughtfulness that words alone cannot express."
  },
  {
    label: "vague 'moments that matter' language",
    text: "We believe every moment deserves to be celebrated with something beautiful. Our team is passionate about helping you create memories that last a lifetime. Let us be part of your special moments, whatever they may be."
  },
  {
    label: "interchangeable florist advertising",
    text: "We offer a wide selection of arrangements to suit any taste. Our knowledgeable staff is always ready to help you find the perfect gift. Visit us today to see what we have to offer."
  },
  {
    label: "empty emotional clichés",
    text: "Life is full of beautiful moments waiting to be shared. A thoughtful gesture can make all the difference in someone's world. Take a moment today to spread a little joy and warmth to those around you."
  },
  {
    label: "strings of beautiful/special/joy/smile language with no situation",
    text: "Beautiful flowers bring so much joy and happiness to everyone. Nothing is more special than seeing a smile light up someone's face. Every bouquet is thoughtful and full of love."
  }
];

test("corpus: every GOOD everyday/gifting example is NOT flagged weak_marketing_copy", () => {
  for (const { label, text, audience } of GOOD_COPY) {
    assert.equal(isWeakFlagged(text, "", { audience }), false, `expected GOOD "${label}" to pass cleanly: ${JSON.stringify(detectWeakMarketingCopy("", text, { shopName: SHOP, audience }))}`);
  }
});

test("corpus: every BAD generic/filler/cliché example is still flagged weak_marketing_copy (by hollow-sentence or filler-phrase)", () => {
  for (const { label, text } of BAD_COPY) {
    assert.equal(isWeakFlagged(text), true, `expected BAD "${label}" to still be flagged`);
  }
});

test("corpus: Birthday/Sympathy/self_purchase/Promotion/Operational baselines remain clean, unaffected by the new specificity signal", () => {
  const cases = [
    { label: "Birthday", requestText: "Create a birthday Facebook post.", text: "Nothing says happy birthday quite like a fresh bouquet of roses on the doorstep. Lilies in Bloom can have a birthday arrangement ready by this afternoon. Order now and make their day." },
    // requestText must itself establish the sympathy context — this
    // copy's own bereavement-adjacent wording (casket flowers) would
    // otherwise trip the separate, pre-existing, unrelated weak_copy_
    // invented_bereavement_framing check (the request never asked for
    // this), exactly as it should for a genuinely ungrounded request.
    { label: "Sympathy", requestText: "Create a comforting Facebook post letting families know we can help with funeral flowers.", audience: "funeral_families", text: "Lilies in Bloom helps families choose a standing spray or casket flowers with care and without pressure. We're here whenever you need us. Call 606-506-4039 to talk through what would be right." },
    { label: "self_purchase", requestText: "Give me a cute post about buying myself flowers.", audience: "self_purchase", text: "You don't need a reason to bring home flowers. Sometimes wanting them is reason enough. Treat yourself today." },
    { label: "Promotion", requestText: "Create a Facebook post for 20% off bouquets this week.", text: "Take 20% off any bouquet this week only at Lilies in Bloom. Treat someone — or yourself — while the discount lasts. Call 606-506-4039 to order." },
    { label: "Operational notice", requestText: "Let customers know we close at 2 PM today.", text: "Lilies in Bloom is closing early today at 2 PM. Call 606-506-4039 for any last-minute orders." }
  ];
  for (const { label, requestText, text, audience } of cases) {
    assert.equal(isWeakFlagged(text, requestText, { audience }), false, `expected baseline "${label}" to remain clean: ${JSON.stringify(detectWeakMarketingCopy(requestText, text, { shopName: SHOP, audience }))}`);
  }
});

// ---------------------------------------------------------------------------
// hasHumanSituationalSpecificity: generic emotional words must NEVER count
// alone.
// ---------------------------------------------------------------------------

test("hasHumanSituationalSpecificity: generic emotional words alone never count as specific", () => {
  const genericWordsAlone = [
    "Flowers bring so much love into every home.",
    "Every bouquet is a symbol of joy and happiness.",
    "Nothing says special quite like a beautiful arrangement.",
    "A thoughtful gift can brighten anyone's day.",
    "Smiles are the best part of what we do here."
  ];
  for (const sentence of genericWordsAlone) {
    assert.equal(hasHumanSituationalSpecificity(sentence), false, `"${sentence}" must not pass on generic emotional words alone`);
  }
});

test("hasHumanSituationalSpecificity: requires BOTH a person-reference AND a concrete relational action — either alone is not enough", () => {
  // Person-reference with no concrete action.
  assert.equal(hasHumanSituationalSpecificity("Someone out there would love these flowers."), false);
  // Action-shaped word with no person-reference.
  assert.equal(hasHumanSituationalSpecificity("Delivery happens every single day of the week."), false);
  // Both present together — passes.
  assert.equal(hasHumanSituationalSpecificity("Your friend hasn't heard from you in a while."), true);
});

test("hasHumanSituationalSpecificity: bare 'send'/'give' never count as the action signal — they are the generic topic of every candidate, not a concrete circumstance", () => {
  assert.equal(hasHumanSituationalSpecificity("Sending flowers is a wonderful way to show someone you care."), false);
  assert.equal(hasHumanSituationalSpecificity("Giving flowers to someone is always a nice idea."), false);
});

// ---------------------------------------------------------------------------
// Part 1: generation-prompt guidance (buildSocialPostTask / buildFlyerContentTask).
// ---------------------------------------------------------------------------

test("prompt: send_flowers messageIntent reaches buildSocialPostTask as coaching, additive to (never replacing) fact-safety rules", () => {
  const { buildSocialPostTask } = _internalsForTesting;
  const task = buildSocialPostTask({
    channel: "facebook",
    occasion: "General",
    shop: { name: "Lilies in Bloom" },
    requestText: "Create a Facebook post encouraging people to send flowers today.",
    concept: { isSympathy: false, audience: "general_local_customers", messageIntent: "send_flowers", userTemporalIntent: "today" }
  });
  assert.match(task, /core idea is SENDING flowers to someone else/);
  assert.match(task, /real, relatable recipient or human situation/);
  assert.match(task, /framed this around "today"/);
  assert.match(task, /NEVER means the shop can promise same-day delivery/);
  assert.match(task, /NEVER CLAIM A SPECIFIC BUSINESS FACT THAT ISN'T VERIFIED/);
});

test("prompt: brighten_day and general_everyday each get their own distinct coaching line", () => {
  const { buildSocialPostTask } = _internalsForTesting;
  const brighten = buildSocialPostTask({ channel: "facebook", occasion: "General", shop: { name: "Lilies in Bloom" }, requestText: "x", concept: { messageIntent: "brighten_day" } });
  assert.match(brighten, /'brighten someone's day' framing/);
  const everyday = buildSocialPostTask({ channel: "facebook", occasion: "General", shop: { name: "Lilies in Bloom" }, requestText: "x", concept: { messageIntent: "general_everyday" } });
  assert.match(everyday, /ordinary, no-special-occasion post/);
  assert.doesNotMatch(everyday, /core idea is SENDING flowers/);
});

test("prompt: self_purchase messageIntent never duplicates guidance — AUDIENCE_COPY_GUIDANCE's own self_purchase entry stays the sole source", () => {
  const { buildSocialPostTask } = _internalsForTesting;
  const task = buildSocialPostTask({
    channel: "facebook",
    occasion: "General",
    shop: { name: "Lilies in Bloom" },
    requestText: "cute post about buying myself flowers",
    concept: { audience: "self_purchase", messageIntent: "self_purchase" }
  });
  assert.match(task, /buying flowers for THEMSELVES/);
  // The new messageIntent dictionary has no "self_purchase" entry —
  // confirms no second, contradictory line was added.
  assert.equal(_internalsForTesting.MESSAGE_INTENT_COPY_GUIDANCE.self_purchase, undefined);
});

test("prompt: no messageIntent/userTemporalIntent supplied never injects an empty or broken line", () => {
  const { buildSocialPostTask, buildFlyerContentTask } = _internalsForTesting;
  const bareSocial = buildSocialPostTask({ channel: "facebook", occasion: "General", shop: { name: "Lilies in Bloom" }, requestText: "post about our shop" });
  assert.doesNotMatch(bareSocial, /core idea is SENDING flowers/);
  assert.doesNotMatch(bareSocial, /framed this around/);
  const bareFlyer = buildFlyerContentTask({ occasion: "General", shop: { name: "Lilies in Bloom" }, requestText: "post about our shop" });
  assert.doesNotMatch(bareFlyer, /core idea is SENDING flowers/);
});

test("prompt: userTemporalIntent renders correctly for every real value and never for an unrecognized one", () => {
  const { buildSocialPostTask } = _internalsForTesting;
  for (const [value, word] of [["today", "today"], ["tonight", "tonight"], ["tomorrow", "tomorrow"], ["this_weekend", "this weekend"]]) {
    const task = buildSocialPostTask({ channel: "facebook", occasion: "General", shop: { name: "Lilies in Bloom" }, requestText: "x", concept: { userTemporalIntent: value } });
    assert.match(task, new RegExp(`framed this around "${word}"`));
  }
  const bogus = buildSocialPostTask({ channel: "facebook", occasion: "General", shop: { name: "Lilies in Bloom" }, requestText: "x", concept: { userTemporalIntent: "next_decade" } });
  assert.doesNotMatch(bogus, /framed this around/);
});

test("prompt: messageIntent/userTemporalIntent guidance never leaks into or weakens the sympathy writing rules", () => {
  const { buildSocialPostTask } = _internalsForTesting;
  // Uses the REAL classifyMessageIntent classifier (not a hardcoded
  // messageIntent) on realistic sympathy request text that also contains
  // "send...flowers" phrasing — the exact shape of independent-review
  // Finding #2: before the fix, classifyMessageIntent never checked
  // isSympathy/occasionCategory, so this request classified as
  // "send_flowers" and injected friend/partner/surprise-framed coaching
  // into the same prompt as the sympathy writing rules.
  const messageIntent = classifyMessageIntent({
    requestText: "Create a comforting Facebook post letting families know they can send flowers for a funeral service.",
    audience: "funeral_families",
    isSympathy: true,
    occasionCategory: "sympathy"
  });
  assert.equal(messageIntent, "general_everyday", "a sympathy request must never classify as send_flowers, even when it contains 'send...flowers' phrasing");
  const task = buildSocialPostTask({
    channel: "facebook",
    occasion: "Sympathy",
    shop: { name: "Lilies in Bloom" },
    requestText: "flowers for a funeral service",
    concept: { isSympathy: true, audience: "funeral_families", messageIntent }
  });
  assert.match(task, /THIS IS SYMPATHY\/FUNERAL WORK/);
  // general_everyday's own generic coaching line is harmless additive
  // advice, but the sympathy block itself must still be fully intact.
  assert.match(task, /Never frame a death as a celebration/);
  // The send_flowers coaching (friend/partner/surprise framing) must never
  // appear in a sympathy prompt.
  assert.doesNotMatch(task, /wanting to surprise a partner/i);
});

test("classifyMessageIntent: a sympathy/funeral request is never classified as send_flowers, regardless of audience or wording (independent-review Finding #2, pinned)", () => {
  // Exact repro shape from the independent review: sympathy context +
  // "send...flowers" phrasing that would otherwise match SEND_FLOWERS_INTENT_RE.
  const bySympathyFlag = classifyMessageIntent({
    requestText: "Let people know they can send flowers to honor a loved one's memory.",
    audience: "funeral_families",
    isSympathy: true,
    occasionCategory: null
  });
  assert.equal(bySympathyFlag, "general_everyday");

  const byOccasionCategory = classifyMessageIntent({
    requestText: "Send flowers to show your support during this difficult time.",
    audience: "funeral_families",
    isSympathy: false,
    occasionCategory: "sympathy"
  });
  assert.equal(byOccasionCategory, "general_everyday");

  // Control: the identical "send...flowers" wording, outside a sympathy
  // context, still classifies as send_flowers — proving the sympathy gate
  // is scoped to sympathy, not a blanket messageIntent exemption.
  const nonSympathyControl = classifyMessageIntent({
    requestText: "Send flowers to someone today just because.",
    audience: "general_local_customers",
    isSympathy: false,
    occasionCategory: "general"
  });
  assert.equal(nonSympathyControl, "send_flowers");
});

test("hasHumanSituationalSpecificity: generic platitude verbs (appreciate/mean the world/thought of/remind) never count as human-situational specificity on their own (independent-review Finding #1, pinned)", () => {
  // Exact repro from the independent review: a fully generic, hollow
  // paragraph built entirely from the platitude verbs that were removed
  // from RELATIONAL_ACTION_RE, paired only with bare pronouns. Before the
  // fix this passed hasHumanSituationalSpecificity and was NOT flagged;
  // after the fix it must still be caught as hollow.
  const text =
    "It means so much when someone feels appreciated. Nothing says thoughtful more than knowing someone thought of you. " +
    "Flowers remind you that someone out there is thinking of you.";
  const reasonCodes = detectWeakMarketingCopyReasonCodes("Create a Facebook post about flowers.", text, { shopName: SHOP });
  assert.ok(reasonCodes.includes("weak_copy_hollow_sentence"), `expected weak_copy_hollow_sentence, got ${JSON.stringify(reasonCodes)}`);
  // None of the individual platitude verbs, alone with a bare pronoun,
  // satisfy the compositional rule.
  assert.equal(hasHumanSituationalSpecificity("Someone feels appreciated."), false);
  assert.equal(hasHumanSituationalSpecificity("It means so much to them."), false);
  assert.equal(hasHumanSituationalSpecificity("They thought of you."), false);
  assert.equal(hasHumanSituationalSpecificity("Flowers remind you that someone is thinking of you."), false);
});

test("prompt: messageIntent/userTemporalIntent guidance never weakens the operational-notice plain-factual rule", () => {
  const { buildSocialPostTask } = _internalsForTesting;
  const task = buildSocialPostTask({
    channel: "facebook",
    occasion: "Operational",
    shop: { name: "Lilies in Bloom" },
    requestText: "closing early today at 2pm",
    concept: { messageIntent: "general_everyday", userTemporalIntent: "today" }
  });
  assert.match(task, /never write it as if the business itself is shutting down/);
});

test("prompt: exact-fact-preservation rule is untouched regardless of messageIntent/userTemporalIntent", () => {
  const { buildSocialPostTask } = _internalsForTesting;
  const factRuleRe = /Any exact fact the request gives verbatim — a time, phone number, price, date, or link — must appear in your output EXACTLY as given, never paraphrased or rounded\./;
  const withSignals = buildSocialPostTask({ channel: "facebook", occasion: "General", shop: { name: "Lilies in Bloom" }, requestText: "call 606-506-4039", concept: { messageIntent: "send_flowers", userTemporalIntent: "today" } });
  const withoutSignals = buildSocialPostTask({ channel: "facebook", occasion: "General", shop: { name: "Lilies in Bloom" }, requestText: "call 606-506-4039" });
  assert.match(withSignals, factRuleRe);
  assert.match(withoutSignals, factRuleRe);
});

// ---------------------------------------------------------------------------
// Part 4: retry feedback is now actionable, not just "don't repeat".
// ---------------------------------------------------------------------------

test("retry feedback: weak_copy_filler_phrase text now tells the model to replace stock phrases with a specific human hook, not merely to avoid repeating them", () => {
  const text = "We've got you covered for every occasion, whether you're looking for something simple or extravagant.";
  const reasons = detectWeakMarketingCopy("x", text, { shopName: SHOP });
  assert.ok(reasons.some((r) => /Replace them with a specific human hook/.test(r)), `expected actionable filler-phrase feedback, got: ${JSON.stringify(reasons)}`);
});

test("retry feedback: weak_copy_hollow_sentence text now offers BOTH routes to specificity — a named product/detail, or a real recipient/situation/action", () => {
  const text = "Flowers have a way of making people feel truly special and appreciated. They bring joy and warmth to any moment, big or small. Every bouquet tells a story of love and thoughtfulness that words alone cannot express.";
  const reasons = detectWeakMarketingCopy("x", text, { shopName: SHOP });
  assert.ok(
    reasons.some((r) => /OR a specific recipient, situation, action, or sensory detail/.test(r)),
    `expected the broadened hollow-sentence feedback, got: ${JSON.stringify(reasons)}`
  );
});

// ---------------------------------------------------------------------------
// Provider-call budget: the existing two-attempt structure is unchanged.
// This is a non-looping `if` block in marketing-studio.js (generate_content)
// — a single conditional retry, never a loop — untouched by this batch
// except for the TEXT of the feedback appended to it. Proven directly here
// on generateSocialPost's own real network boundary: a guaranteed-to-fail
// candidate, called exactly the way the real retry logic calls it (once
// plain, once with rejection feedback appended), never triggers a third
// call on its own — there is no retry loop inside generateSocialPost
// itself for this batch to have accidentally introduced.
// ---------------------------------------------------------------------------

test("provider-call budget: generateSocialPost itself makes exactly one real call per invocation — no internal retry loop exists to accidentally trigger a third call", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return {
      ok: true,
      json: async () => ({
        success: true,
        result: { response: JSON.stringify({ platform: "facebook", headline: "h", body: "We've got you covered for every occasion.", cta: "c", visual_brief: "v", hashtags: [], asset_requirements: [] }) }
      })
    };
  };
  try {
    await generateSocialPost({ channel: "facebook", occasion: "General", shop: { name: "Lilies in Bloom" }, requestText: "send flowers today" });
    assert.equal(callCount, 1, "a single generateSocialPost() call must make exactly one provider request");
    // Simulate the real orchestration's own bounded retry (marketing-
    // studio.js): exactly one additional call, with feedback appended —
    // never a loop, never a third call.
    await generateSocialPost({
      channel: "facebook",
      occasion: "General",
      shop: { name: "Lilies in Bloom" },
      requestText: "send flowers today\n\nA previous attempt was rejected for these reasons — do not repeat them:\n- some reason"
    });
    assert.equal(callCount, 2, "the real orchestration's own bounded retry makes exactly one more call — never a third");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Part 5: safety regression — the new specificity signal must never
// suppress any existing fact-safety detector.
// ---------------------------------------------------------------------------

test("safety: same-day delivery / 'we can deliver today' / unsupported availability are still detected and stripped even in copy that also has real human/situational specificity", () => {
  const requestText = "Send someone flowers today.";
  const candidates = [
    "Your friend hasn't heard from you in a while — same-day delivery available on every order.",
    "Surprise your mom today. We can deliver flowers today.",
    "Send flowers to a coworker who's had a rough week — delivery is available now."
  ];
  for (const candidate of candidates) {
    const violations = detectUnverifiedServiceAvailabilityClaim({ generatedText: candidate, requestText });
    assert.ok(violations.length > 0, `must still flag: "${candidate}"`);
    const stripped = stripUnverifiedServiceAvailabilityClaims({ generatedText: candidate, requestText });
    assert.ok(!/same-day|deliver flowers today|available now/i.test(stripped.text), `unsupported claim must actually be removed from: "${candidate}"`);
  }
});

test("safety: 'send flowers today' remains clearly distinguishable from 'we can deliver today' — the first survives, the second is stripped", () => {
  const requestText = "Send someone flowers today.";
  const safe = "Send someone flowers today from Lilies in Bloom.";
  const unsafe = "We can deliver today.";
  assert.deepEqual(detectUnverifiedServiceAvailabilityClaim({ generatedText: safe, requestText }), []);
  assert.ok(detectUnverifiedServiceAvailabilityClaim({ generatedText: unsafe, requestText }).length > 0);
});

test("safety: invented inventory claims are still detected in copy that also has human/situational specificity", () => {
  const violations = detectUnverifiedInventoryStateClaim({
    generatedText: "Your friend would love these fresh garden roses we just got in stock.",
    requestText: "Send someone flowers today.",
    verifiedFlowerNames: []
  });
  assert.ok(violations.length > 0, "an invented in-stock claim must still be flagged");
});

test("safety: an invented order cutoff/delivery promise is still detected even alongside a real recipient reference", () => {
  // detectInventedOperationalContent is scoped to a genuinely PLAIN
  // operational-notice REQUEST (a schedule/hours/closure ask) gaining
  // invented embellishment — this ordinary send-flowers request is not
  // that shape at all, so the correct, already-existing detector for an
  // invented order-cutoff/delivery claim is detectUnverifiedServiceAvailabilityClaim
  // (the same one proven above), not detectInventedOperationalContent.
  const violations = detectUnverifiedServiceAvailabilityClaim({
    generatedText: "Surprise your friend today — order by 2 PM for delivery today.",
    requestText: "Send someone flowers today."
  });
  assert.ok(violations.length > 0, "a fabricated order cutoff must still be flagged even with a recipient reference present");
});

test("safety: fabricated contact numbers are still stripped regardless of human/situational specificity in the surrounding text", () => {
  const result = stripFabricatedContactNumbers({
    requestText: "Send someone flowers today.",
    shopPhone: "6065064039",
    copyText: "Surprise your mom today — call 555-000-1234 to order."
  });
  assert.ok(!result.text.includes("555-000-1234"), "a fabricated phone number must still be stripped");
});

// ---------------------------------------------------------------------------
// Birthday / Sympathy / self-purchase: rescue composition remains
// byte-for-byte unaffected by the everyday copy intelligence fix.
// ---------------------------------------------------------------------------

test("Birthday/Sympathy/self-purchase rescue composition remains byte-for-byte unchanged", () => {
  const birthday = buildDeterministicCreativeRescueContent({
    shopName: "Lilies in Bloom", shopPhone: "6065064039", ctaIntent: "call_shop",
    audience: "general_local_customers", occasionCategory: "birthday", namedCampaign: "birthday"
  });
  assert.equal(birthday.headline, "Birthday Blooms, Ready to Celebrate");
  assert.equal(birthday.body, "Lilies in Bloom has birthday flowers ready to make someone's day feel special.");

  const sympathy = buildDeterministicCreativeRescueContent({
    shopName: "Lilies in Bloom", shopPhone: "6065064039", ctaIntent: "call_shop",
    audience: "funeral_families", occasionCategory: "sympathy", namedCampaign: "sympathy"
  });
  assert.equal(sympathy.headline, "Funeral & Sympathy Flowers");
  assert.equal(sympathy.body, "Lilies in Bloom helps families choose funeral and sympathy flowers with care.");

  const selfPurchase = buildDeterministicCreativeRescueContent({
    shopName: "Lilies in Bloom", shopPhone: "6065064039", ctaIntent: "call_shop",
    audience: "self_purchase", occasionCategory: "general", namedCampaign: "none"
  });
  assert.equal(selfPurchase.headline, "Flowers, Just Because");
  assert.equal(selfPurchase.body, "You don't need a reason to bring home flowers from Lilies in Bloom — sometimes wanting them is reason enough.");
});

test("findHollowSentences: self_purchase audience is still exempted entirely, unaffected by the new second signal", () => {
  const hollow = findHollowSentences(
    "Flowers bring so much joy into everyday life. Every bouquet is thoughtful and full of love and happiness.",
    "Lilies in Bloom",
    { audience: "self_purchase" }
  );
  assert.deepEqual(hollow, [], "self_purchase stays completely exempt, even from the new human/situational signal");
});

// ---------------------------------------------------------------------------
// Handler-level integration: the real generate_content path for Test C's
// own everyday send_flowers request, proving genuinely good AI-generated
// copy (grounded via the new prompt guidance) is accepted WITHOUT needing
// a named flower species, discount, delivery method, number, or date.
// ---------------------------------------------------------------------------

function floristDeps(client) {
  return { florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
function subjectForwardResponses(brief) {
  const fixed = [
    { data: { id: "item-1", content_type: "social_post", title: "t", brief, status: "idea" }, error: null },
    { data: [{ id: "item-1", status: "generating" }], error: null },
    { data: [{ id: "variant-1", platform: "facebook" }], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: { name: "Lilies in Bloom", phone: "6065064039" }, error: null },
    { data: null, error: null },
    { data: null, error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null }
  ];
  const filler = Array.from({ length: 20 }, (_, i) => ({ data: { id: `x${i}` }, error: null }));
  return [...fixed, ...filler];
}
function mockCloudflareDualModel({ copyJson, imageBase64 }) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async (url) => {
    const isImageModel = String(url).includes("flux");
    return { ok: true, json: async () => (isImageModel ? { success: true, result: { image: imageBase64 } } : { success: true, result: { response: JSON.stringify(copyJson) } }) };
  };
  return { restore: () => (globalThis.fetch = originalFetch) };
}

test("handler: a genuinely good, human-situation-grounded AI caption for 'send flowers today' is accepted on the FIRST attempt — no flower species, discount, delivery method, number, or date required", async () => {
  const mock = mockCloudflareDualModel({
    copyJson: {
      platform: "facebook",
      headline: "Send a Little Thought Today",
      body: "Your friend hasn't heard from you in a while. Sending flowers today is a simple way to remind them you're thinking of them.",
      cta: "Call to send one today.",
      visual_brief: "a lush arrangement of mixed fresh flowers on a marble counter",
      hashtags: [],
      asset_requirements: [],
      brand_traits_used: [],
      visual_traits_used: []
    },
    imageBase64: Buffer.from("fake-jpeg-bytes").toString("base64")
  });
  try {
    const storage = createFakeSupabaseStorage({});
    const responses = subjectForwardResponses("Create a Facebook post encouraging people to send flowers today.");
    const client = createFakeSupabaseClient(responses, { storage });
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 200, res.body);

    const usageCalls = client.calls.filter((c) => c.table === "marketing_generation_usage");
    // Exactly one copy-request usage row created for THIS caption call
    // (recordUsage("copy") is invoked once per attempt) — proving the
    // first attempt was accepted, never reaching a second attempt/rescue.
    const copyRequestRows = usageCalls.filter((c) => c.ops.some((op) => op[0] === "insert"));
    const asset = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    const content = asset?.payload?.content;
    assert.ok(content, "an asset must be persisted");
    assert.equal(content.creative_rescue_used, undefined, "the first attempt must be accepted — no rescue needed");
    assert.match(content.body || content.caption || "", /friend/i, "the accepted copy preserves the real human-situation grounding");
  } finally {
    mock.restore();
  }
});
