import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSocialPost,
  generateVideoConcept,
  generateWebsiteSectionDraft,
  generateFlyerContent,
  persistGeneratedAsset
} from "../netlify/functions/_shared/ai-creative-engine.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

function mockCloudflareOnce(jsonResult) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(jsonResult) } }) };
  };
  return {
    getSentBody: () => sentBody,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

test("generateSocialPost: the task instruction explicitly forbids describing/restating the request — the direct fix for the paraphrase bug", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "Homecoming season is here!",
    body: "Order your Homecoming corsage or boutonniere by Wednesday for guaranteed pickup Friday.",
    cta: "Order by Wednesday",
    visual_brief: "A red spray rose corsage on a wrist, shot on a wooden counter with soft window light.",
    hashtags: ["#homecoming", "#localflorist"],
    asset_requirements: []
  });
  try {
    const result = await generateSocialPost({ channel: "facebook", occasion: "Homecoming", audience: "students and parents", requestText: "Create a Facebook post..." });
    assert.equal(result.ok, true);
    // Real, finished copy — not a restatement of the input request.
    assert.ok(!result.content.body.toLowerCase().includes("create a facebook post"));
    assert.match(result.content.body, /order/i);
    assert.equal(result.content.platform, "facebook");
    assert.ok(result.content.hashtags.length > 0);

    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /ACTUAL, FINISHED social media post/);
    assert.match(userMessage, /Do not describe the request/);
    assert.match(userMessage, /Do not restate the user's instruction/);
  } finally {
    mock.restore();
  }
});

// Priority F wiring: buildBrandSummary() (marketing-brand-brain.js) existed
// and was documented as "handed to Lily's content-generation prompts as
// extra grounding" but nothing ever actually passed it in — a florist
// could teach Lily "always say artisan, never cheap" via update_brand_brain
// and see zero effect on real captions. These prove the prompt the model
// actually receives changes when a brand voice summary is supplied, and
// stays clean (no stray "undefined"/empty section) when it is not.
test("generateSocialPost: a supplied brandVoiceSummary is actually included in the real prompt sent to the model, framed as a default the request can override", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "Homecoming season is here!",
    body: "Order your Homecoming corsage today.",
    cta: "Order now",
    visual_brief: "A corsage on a wooden counter.",
    hashtags: [],
    asset_requirements: []
  });
  try {
    await generateSocialPost({
      channel: "facebook",
      occasion: "Homecoming",
      requestText: "Create a Facebook post...",
      brandVoiceSummary: "voice tone: warm and conversational; preferred words: artisan, hand-tied; always avoid: cheap, discount"
    });
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /artisan, hand-tied/, "the shop's real learned brand voice must reach the actual model prompt, not just sit in a settings API response");
    assert.match(userMessage, /always avoid: cheap, discount/);
    assert.match(userMessage, /the request's own explicit instructions always win if they conflict/i, "explicit user instructions must be framed as overriding the learned default, never the other way around");
  } finally {
    mock.restore();
  }
});

// Lily Creative Style Learning: visualStyleSummary is the shop's separate
// VISUAL creative-style memory (ai-style-memory.js — backgrounds/lighting/
// colors/mood/etc.), deliberately a second, independent field from
// brandVoiceSummary above so a liked "bright and airy photography" trait
// can never leak into caption wording. Also proves the anti-fabrication
// contract: the model must report back which specific supplied traits it
// actually used (brand_traits_used/visual_traits_used), never a full echo
// of everything it was given.
test("generateSocialPost: a supplied visualStyleSummary reaches the real prompt, separately from brandVoiceSummary, and the model's real traits_used comes back on the result", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "Homecoming season is here!",
    body: "Order your Homecoming corsage today.",
    cta: "Order now",
    visual_brief: "A soft, airy backdrop with warm natural light.",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [{ category: "preferred_words", text: "artisan" }],
    visual_traits_used: [{ category: "background_style", text: "soft luxury" }, { category: "lighting", text: "warm natural light" }]
  });
  try {
    const result = await generateSocialPost({
      channel: "facebook",
      occasion: "Homecoming",
      requestText: "Create a Facebook post...",
      brandVoiceSummary: "preferred words: artisan",
      visualStyleSummary: "background style: soft luxury; lighting: warm natural light"
    });
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /background style: soft luxury; lighting: warm natural light/, "the shop's real learned VISUAL style must reach the actual model prompt");
    assert.match(userMessage, /VISUAL creative style/i, "the visual-style block must be framed distinctly from the writing/brand-voice block");
    assert.deepEqual(result.content.brand_traits_used, [{ category: "preferred_words", text: "artisan" }]);
    assert.deepEqual(result.content.visual_traits_used, [
      { category: "background_style", text: "soft luxury" },
      { category: "lighting", text: "warm natural light" }
    ]);
  } finally {
    mock.restore();
  }
});

test("generateSocialPost: a model that reports no traits_used at all returns empty arrays, never a fabricated guess at what was used", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "h",
    body: "b",
    cta: "c",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: []
    // no brand_traits_used / visual_traits_used at all
  });
  try {
    const result = await generateSocialPost({
      channel: "facebook",
      requestText: "x",
      brandVoiceSummary: "preferred words: artisan",
      visualStyleSummary: "lighting: warm natural light"
    });
    assert.deepEqual(result.content.brand_traits_used, []);
    assert.deepEqual(result.content.visual_traits_used, []);
  } finally {
    mock.restore();
  }
});

// Real, live-found failure (2026-08-26, shop owner's own account): the
// interface displayed "your learned style (we appreciate your
// understanding, prepare for a special event, quiet storefront photo)" on
// a brand-new shop with no learned style yet — the model self-reported
// brand_traits_used/visual_traits_used that were never actually present
// in the summaries it was given, and those invented "traits" would have
// been written straight into real Brand Brain/My Style storage on the
// next Approve. A trait only survives now if its own text literally
// appears in the summary this call was actually given.
test("generateSocialPost: an EMPTY brandVoiceSummary/visualStyleSummary (a fresh shop, nothing learned yet) drops every self-reported trait — nothing could have legitimately been \"used\" from nothing", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "h",
    body: "b",
    cta: "c",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: [],
    // The model hallucinated these — no real summary was ever supplied.
    brand_traits_used: [{ category: "tone", text: "we appreciate your understanding" }],
    visual_traits_used: [{ category: "mood", text: "quiet storefront photo" }, { category: "event", text: "prepare for a special event" }]
  });
  try {
    const result = await generateSocialPost({ channel: "facebook", requestText: "x" }); // no brandVoiceSummary/visualStyleSummary at all
    assert.deepEqual(result.content.brand_traits_used, []);
    assert.deepEqual(result.content.visual_traits_used, []);
  } finally {
    mock.restore();
  }
});

test("generateSocialPost: a self-reported trait whose text is NOT actually present in the real summary is dropped, even when other traits from the same call ARE grounded", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "h",
    body: "b",
    cta: "c",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [
      { category: "preferred_words", text: "artisan" }, // real — present in the summary below
      { category: "tone", text: "we appreciate your understanding" } // invented — never in the summary
    ],
    visual_traits_used: []
  });
  try {
    const result = await generateSocialPost({
      channel: "facebook",
      requestText: "x",
      brandVoiceSummary: "preferred words: artisan"
    });
    assert.deepEqual(result.content.brand_traits_used, [{ category: "preferred_words", text: "artisan" }]);
  } finally {
    mock.restore();
  }
});

// Phase 5/9 wiring: "I have 40 roses I need to sell, make a Facebook post"
// could previously only ever invent flowers — buildSocialPostTask had zero
// inventory awareness. inventorySummary is a third, independent grounding
// field alongside brandVoiceSummary/visualStyleSummary, carrying the exact
// text marketing-inventory-grounding.js's buildInventoryGroundingBrief()
// already produces (real names/quantities/low-stock flags).
test("generateSocialPost: a supplied inventorySummary reaches the real prompt, and the model is told never to name stock that isn't on the list", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "h",
    body: "40 garden roses, fresh in today.",
    cta: "Order now",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: []
  });
  try {
    await generateSocialPost({
      channel: "facebook",
      requestText: "I have 40 roses I need to sell, make a Facebook post",
      inventorySummary: "Real current inventory to ground this in (do not mention flowers not on this list): Garden Rose (40 stems in stock)."
    });
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /Garden Rose \(40 stems in stock\)/, "the shop's real current inventory must reach the actual model prompt");
    assert.match(userMessage, /never name a flower, color, or variety that isn't on it/i, "the anti-fabrication instruction must accompany the real inventory list");
    assert.match(userMessage, /only mention specific flowers\/stems by name if the request above is actually about/i, "inventory must not be forced into every post regardless of what was asked");
  } finally {
    mock.restore();
  }
});

// Phase 9 ("connect intelligence to marketing"): audienceSummary is a
// fourth, independent grounding field carrying the exact text
// customer-audience-grounding.js's buildAudienceGroundingBrief() already
// produces (real subscriber/segment counts).
test("generateSocialPost: a supplied audienceSummary reaches the real prompt, and the model is told never to state an unlisted audience number", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "h",
    body: "Happy birthday from all of us!",
    cta: "Order now",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: []
  });
  try {
    await generateSocialPost({
      channel: "facebook",
      requestText: "make a birthday post for my subscribers with birthdays this month",
      audienceSummary: "Real audience data for this shop (never invent a different number or segment): 42 marketing subscribers; 6 birthdays this month."
    });
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /42 marketing subscribers; 6 birthdays this month/, "the shop's real audience data must reach the actual model prompt");
    assert.match(userMessage, /never state an audience size, subscriber count, or customer-segment number that isn't in the real audience data/i);
  } finally {
    mock.restore();
  }
});

test("generateSocialPost: omitting audienceSummary (nothing real to ground on) never injects an empty/undefined audience section", async () => {
  const mock = mockCloudflareOnce({ platform: "facebook", headline: "h", body: "b", cta: "c", visual_brief: "v", hashtags: [], asset_requirements: [] });
  try {
    await generateSocialPost({ channel: "facebook", requestText: "x" });
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.ok(!userMessage.includes("undefined"), "no audience data must never leak a stray 'undefined' into the real prompt");
    // The anti-fabrication RULE bullet is always present (it also covers a
    // request that never supplied any audience data at all) — what must
    // never appear unconditionally is the SUMMARY sentence itself.
    assert.ok(!/audience data for this shop/i.test(userMessage), "no audience summary section at all when there's genuinely nothing to ground on — never a fabricated one");
  } finally {
    mock.restore();
  }
});

test("generateSocialPost: omitting inventorySummary (nothing real to ground on) never injects an empty/undefined inventory section", async () => {
  const mock = mockCloudflareOnce({ platform: "facebook", headline: "h", body: "b", cta: "c", visual_brief: "v", hashtags: [], asset_requirements: [] });
  try {
    await generateSocialPost({ channel: "facebook", requestText: "x" });
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.ok(!userMessage.includes("undefined"), "no inventory data must never leak a stray 'undefined' into the real prompt");
    assert.ok(!/real current inventory/i.test(userMessage), "no inventory section at all when there's genuinely nothing to ground on — never a fabricated one");
  } finally {
    mock.restore();
  }
});

test("generateSocialPost: omitting brandVoiceSummary (a brand-new shop with nothing learned yet) never injects an empty/undefined brand-voice section", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "h",
    body: "b",
    cta: "c",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: []
  });
  try {
    await generateSocialPost({ channel: "facebook", requestText: "x" });
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.ok(!userMessage.includes("undefined"), "a shop with no learned Brand Brain yet must never leak a stray 'undefined' into the real prompt");
    assert.ok(!/learned brand voice/i.test(userMessage), "no brand-voice section at all when there's genuinely nothing learned yet");
  } finally {
    mock.restore();
  }
});

test("generateSocialPost: returns ok:false (never throws) when the model returns no usable body", async () => {
  const mock = mockCloudflareOnce({ platform: "facebook" });
  try {
    const result = await generateSocialPost({ channel: "facebook", requestText: "x" });
    assert.equal(result.ok, false);
    assert.match(result.error, /didn't return usable post copy/i);
  } finally {
    mock.restore();
  }
});

test("generateSocialPost: returns ok:false on a provider failure without throwing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const result = await generateSocialPost({ channel: "facebook", requestText: "x" });
    assert.equal(result.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateVideoConcept: marks renderingAvailable:false and never claims a finished video", async () => {
  const mock = mockCloudflareOnce({
    concept: "A 15-second behind-the-counter look at building a Homecoming corsage.",
    script: "",
    scenes: ["0-3s: hands selecting a spray rose from the cooler — on-screen text: Homecoming season is here"],
    captions: ["Order by Wednesday for Friday pickup"],
    hashtags: ["#homecoming"],
    suggested_length_seconds: 15
  });
  try {
    const result = await generateVideoConcept({ channel: "instagram", occasion: "Homecoming", requestText: "Make me a Reel for Homecoming" });
    assert.equal(result.ok, true);
    assert.equal(result.content.renderingAvailable, false);
    assert.match(result.content.renderingNote, /not connected yet/i);
    assert.ok(result.content.scenes.length > 0);
    // Real, concrete shot description, not a generic placeholder.
    assert.match(result.content.scenes[0], /spray rose/i);
  } finally {
    mock.restore();
  }
});

test("generateVideoConcept: a supplied brandVoiceSummary reaches the real video-concept prompt too, not just the caption path", async () => {
  const mock = mockCloudflareOnce({
    concept: "x",
    script: "",
    scenes: ["0-3s: hands trimming stems"],
    captions: [],
    hashtags: [],
    suggested_length_seconds: 15
  });
  try {
    await generateVideoConcept({
      channel: "instagram",
      requestText: "Make me a Reel",
      brandVoiceSummary: "posting personality: playful; hashtag style: minimal (2-3)"
    });
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /posting personality: playful/);
  } finally {
    mock.restore();
  }
});

test("generateVideoConcept: a supplied visualStyleSummary reaches the real video-concept prompt, separately from brandVoiceSummary", async () => {
  const mock = mockCloudflareOnce({
    concept: "x",
    script: "",
    scenes: ["0-3s: hands trimming stems"],
    captions: [],
    hashtags: [],
    suggested_length_seconds: 15,
    visual_traits_used: [{ category: "mood", text: "elegant" }]
  });
  try {
    const result = await generateVideoConcept({
      channel: "instagram",
      requestText: "Make me a Reel",
      visualStyleSummary: "mood: elegant"
    });
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /mood: elegant/);
    assert.deepEqual(result.content.visual_traits_used, [{ category: "mood", text: "elegant" }]);
  } finally {
    mock.restore();
  }
});

test("generateVideoConcept: a supplied inventorySummary reaches the real video-concept prompt too, not just the caption path", async () => {
  const mock = mockCloudflareOnce({
    concept: "x",
    script: "",
    scenes: ["0-3s: hands trimming stems"],
    captions: [],
    hashtags: [],
    suggested_length_seconds: 15
  });
  try {
    await generateVideoConcept({
      channel: "instagram",
      requestText: "Make me a Reel about our roses",
      inventorySummary: "Real current inventory to ground this in (do not mention flowers not on this list): Garden Rose (40 stems in stock)."
    });
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /Garden Rose \(40 stems in stock\)/);
    assert.match(userMessage, /never name a flower, color, or variety that isn't on it/i);
  } finally {
    mock.restore();
  }
});

test("generateVideoConcept: a supplied audienceSummary reaches the real video-concept prompt too, not just the caption path", async () => {
  const mock = mockCloudflareOnce({
    concept: "x",
    script: "",
    scenes: ["0-3s: hands trimming stems"],
    captions: [],
    hashtags: [],
    suggested_length_seconds: 15
  });
  try {
    await generateVideoConcept({
      channel: "instagram",
      requestText: "Make me a Reel for our repeat customers",
      audienceSummary: "Real audience data for this shop (never invent a different number or segment): 42 marketing subscribers; 9 repeat customers (2+ orders)."
    });
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /9 repeat customers \(2\+ orders\)/);
    assert.match(userMessage, /never state an audience size, subscriber count, or customer-segment number that isn't in the real audience data/i);
  } finally {
    mock.restore();
  }
});

// Phase 17 ("test as a florist"): a realistic, established shop with real
// learned brand voice, real learned visual style, a genuinely full
// inventory list, AND real audience data all present together at once —
// exactly the shape a busy, long-running shop's real request would carry,
// not the one-summary-at-a-time isolation the tests above check. This is
// the exact scenario that caught a real bug in Phase 9 (the task text
// silently truncated past 1200 chars, cutting off the newest anti-
// fabrication rule) — a regression guard against that class of bug
// recurring as more real grounding is added in the future.
test("generateSocialPost: a realistic shop with brand + style + inventory + audience ALL populated together never truncates past the model call's own cap", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "Our Spring Collection is here!",
    body: "Fresh garden roses, ranunculus, and peonies — order your spring arrangement today.",
    cta: "Shop the collection",
    visual_brief: "v",
    hashtags: ["#spring"],
    asset_requirements: []
  });
  try {
    await generateSocialPost({
      channel: "facebook",
      occasion: "Spring collection launch",
      audience: "loyal repeat customers",
      requestText: "Announce our spring collection to our regulars",
      brandVoiceSummary:
        "This shop's own learned brand voice (from what they've explicitly told Lily and repeatedly approved) — follow it as the DEFAULT: consistently uses warm, artisan language, mentions handcrafted quality, and favors phrases like 'farm-fresh' and 'locally sourced'.",
      visualStyleSummary:
        "This shop's own learned VISUAL creative style: soft, natural lighting with warm tones, rustic wooden surfaces, and garden-style loose arrangements photographed close-up.",
      inventorySummary:
        "Real current inventory to ground this in (do not mention flowers not on this list): Garden Rose (40 stems in stock); White Hydrangea (18 stems in stock, running low); Eucalyptus (60 stems in stock); Ranunculus (25 stems in stock); Peony (12 stems in stock, running low).",
      audienceSummary:
        "Real audience data for this shop (never invent a different number or segment): 128 marketing subscribers; 14 vip customers; 32 repeat customers (2+ orders); 9 birthdays this month."
    });
    const sent = mock.getSentBody();
    const userMessage = sent.messages.find((m) => m.role === "user").content;
    // Every real fact from every one of the four summaries must still
    // reach the model — none silently dropped by a length cap.
    assert.match(userMessage, /farm-fresh/);
    assert.match(userMessage, /garden-style loose arrangements/);
    assert.match(userMessage, /Garden Rose \(40 stems in stock\)/);
    assert.match(userMessage, /Peony \(12 stems in stock, running low\)/);
    assert.match(userMessage, /128 marketing subscribers/);
    assert.match(userMessage, /9 birthdays this month/);
    // The safety-critical anti-fabrication rules (added last in the task,
    // so first to be cut by any length cap) must both survive intact.
    assert.match(userMessage, /never name a flower, color, or variety that isn't on it/i);
    assert.match(userMessage, /never state an audience size, subscriber count, or customer-segment number/i);
  } finally {
    mock.restore();
  }
});

// Real, live-found failure (Ashley's own real test): a plain "closing at
// 2:30, call to order" flyer request came back with invented wording —
// "Place your final orders now," "Prepare for a special event," "We look
// forward to serving you again soon" — none of it asked for. The prompt
// itself is the first line of defense (the deterministic
// detectInventedOperationalContent guard in marketing-studio.js is the
// backstop) — this proves the actual instruction text sent to the model
// carries the real rule, not just that the code intends to.
test("generateFlyerContent: the real prompt sent to the model explicitly forbids inventing a reason, urgency, future plan, or farewell", async () => {
  const mock = mockCloudflareOnce({ headline: "Closing at 2:30 today", body: "Call 606-506-4039 to place an order.", cta: "Call now" });
  try {
    await generateFlyerContent({ message: "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order." });
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /never add a reason, an urgency phrase, a future plan, or a farewell/i);
    assert.match(userMessage, /no "final orders,"/i);
    assert.match(userMessage, /never imply a future event or reopening/i);
  } finally {
    mock.restore();
  }
});

test("generateVideoConcept: returns ok:false when the model returns no scenes", async () => {
  const mock = mockCloudflareOnce({ concept: "x", scenes: [] });
  try {
    const result = await generateVideoConcept({ requestText: "x" });
    assert.equal(result.ok, false);
  } finally {
    mock.restore();
  }
});

test("generateWebsiteSectionDraft: produces real headline/CTA copy and marks appliedToLivePage:false", async () => {
  const mock = mockCloudflareOnce({
    headline: "Homecoming Flowers, Ready When You Are",
    subheadline: "Corsages and boutonnieres for this year's dance.",
    body: "Order online or by phone — pickup available every day this week.",
    cta_label: "Order Homecoming Flowers",
    visual_brief: "A row of wrist corsages on a display stand."
  });
  try {
    const result = await generateWebsiteSectionDraft({ occasion: "Homecoming", requestText: "campaign for my website" });
    assert.equal(result.ok, true);
    assert.equal(result.content.appliedToLivePage, false);
    assert.match(result.content.headline, /homecoming/i);
  } finally {
    mock.restore();
  }
});

test("persistGeneratedAsset: inserts into ai_generated_assets with the right shop scoping", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "asset-1", shop_id: "shop-1", asset_type: "social_post" }, error: null }]);
  const result = await persistGeneratedAsset(client, {
    shopId: "shop-1",
    userId: "user-1",
    persona: "Lily",
    assetType: "social_post",
    model: "@cf/meta/llama-3.1-8b-instruct-fast",
    content: { body: "hello" },
    status: "completed"
  });
  assert.equal(result.ok, true);
  assert.equal(result.asset.id, "asset-1");
  const insertCall = client.calls.find((c) => c.table === "ai_generated_assets");
  assert.ok(insertCall);
  assert.equal(insertCall.payload.shop_id, "shop-1");
  assert.equal(insertCall.payload.asset_type, "social_post");
});

test("persistGeneratedAsset: surfaces a db error instead of throwing", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "insert failed" } }]);
  const result = await persistGeneratedAsset(client, { shopId: "shop-1", assetType: "image", model: "x" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "insert failed");
});
