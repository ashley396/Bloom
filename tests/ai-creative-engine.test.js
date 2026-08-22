import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSocialPost,
  generateVideoConcept,
  generateWebsiteSectionDraft,
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
