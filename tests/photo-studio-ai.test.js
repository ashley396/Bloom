import test from "node:test";
import assert from "node:assert/strict";
import { handleEnhanceSuggest, handleGenerateImage, identifyFlowersForImagePrompt } from "../netlify/functions/photo-studio-ai.js";
import { assessPhotoQuality } from "../netlify/functions/_shared/florist-ai-vision.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
const TINY_IMAGE_DATA_URL = `data:image/jpeg;base64,${TINY_JPEG_BASE64}`;

function mockCloudflare({ visionText, generateResult } = {}) {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    calls.push({ url: String(url), body });
    if (String(url).includes("flux-1-schnell")) {
      return { ok: true, json: async () => ({ result: { image: TINY_JPEG_BASE64 } }) };
    }
    // Vision calls always carry image bytes somewhere in the payload — as a
    // top-level `image` field (llava/uform shape) or as array-typed message
    // content (the llama-vision "messages" shape); a plain-text generate
    // call never does. Route by that, not by any one specific shape, since
    // runVisionModel tries several shapes per model in fallback order.
    const isVision = Boolean(body.image) || (Array.isArray(body.messages) && body.messages.some((m) => Array.isArray(m.content)));
    if (isVision) {
      return { ok: true, json: async () => ({ success: true, result: { response: visionText || "The lighting is a little dark and the background is busy." } }) };
    }
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(generateResult || {}) } }) };
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

test("assessPhotoQuality: uses a different prompt/task from flower ID — asks about lighting/color/background/framing only", async () => {
  const mock = mockCloudflare({ visionText: "The photo is underexposed with a cluttered background." });
  try {
    const result = await assessPhotoQuality({ buffer: Buffer.from("fake-image-bytes") });
    assert.equal(result.text, "The photo is underexposed with a cluttered background.");
    const visionCall = mock.calls.find((c) => Boolean(c.body.image));
    // llava/uform's shape (tried first) carries the prompt directly.
    const promptText = visionCall.body.prompt;
    assert.match(promptText, /lighting/i);
    assert.match(promptText, /Do not invent details/i);
    // Never the flower-naming prompt.
    assert.doesNotMatch(promptText, /wholesale florist names/i);
  } finally {
    mock.restore();
  }
});

test("handleEnhanceSuggest: maps a real assessment onto one of Photo Studio's own existing presets — never invents a new one", async () => {
  const mock = mockCloudflare({
    visionText: "The photo is a bit dark and flat.",
    generateResult: { recommended_preset: "luxury", reason: "Deeper, richer tones will make the colors pop against the dark background." }
  });
  try {
    const res = await handleEnhanceSuggest({ image_base64: TINY_IMAGE_DATA_URL });
    const payload = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.recommendation.preset, "luxury");
    assert.ok(["clean", "luxury", "warm", "true"].includes(payload.recommendation.preset));
    assert.match(payload.recommendation.reason, /deeper|richer/i);
  } finally {
    mock.restore();
  }
});

test("handleEnhanceSuggest: an out-of-list preset from the model is rejected, falling back to assessment-only (never a fabricated preset)", async () => {
  const mock = mockCloudflare({
    visionText: "Nice photo overall.",
    generateResult: { recommended_preset: "cinematic_hdr", reason: "made up" }
  });
  try {
    const res = await handleEnhanceSuggest({ image_base64: TINY_IMAGE_DATA_URL });
    const payload = JSON.parse(res.body);
    assert.equal(payload.recommendation, null);
    assert.match(payload.message, /pick a preset yourself/i);
  } finally {
    mock.restore();
  }
});

test("handleEnhanceSuggest: rejects a request with no photo", async () => {
  const res = await handleEnhanceSuggest({});
  assert.equal(res.statusCode, 400);
});

test("handleGenerateImage: rejects an unsupported style before calling any provider", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("should not be called"); };
  try {
    const res = await handleGenerateImage(createFakeSupabaseClient([]), { shopId: "shop-1", userId: "user-1" }, { style: "cinematic_widescreen" });
    assert.equal(res.statusCode, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleGenerateImage: a generated image is explicitly marked generated:true and persisted separately from the original photo (media row + asset row, never overwriting)", async () => {
  const mock = mockCloudflare({ generateResult: {} });
  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
  const client = createFakeSupabaseClient(
    [
      { data: { id: "media-1" }, error: null }, // website_media insert
      { data: { id: "asset-1" }, error: null } // ai_generated_assets insert
    ],
    { storage }
  );
  try {
    const res = await handleGenerateImage(client, { shopId: "shop-1", userId: "user-1" }, {
      style: "website_hero",
      flowers: ["Freedom rose", "eucalyptus"],
      occasion: "Wedding",
      shop_name: "Test Blooms"
    });
    const payload = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.generated, true);
    assert.match(payload.url, /^https:\/\/fake\.storage\//);
    assert.equal(payload.asset_id, "asset-1");

    const mediaInsert = client.calls.find((c) => c.table === "website_media");
    assert.equal(mediaInsert.payload.source, "generated");
    assert.equal(mediaInsert.payload.shop_id, "shop-1");

    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets");
    assert.equal(assetInsert.payload.asset_type, "image");
    assert.equal(assetInsert.payload.content.style, "website_hero");
  } finally {
    mock.restore();
  }
});

test("handleGenerateImage: the prompt is grounded in real identified flowers, never a vague placeholder", async () => {
  const mock = mockCloudflare({});
  const storage = createFakeSupabaseStorage({ publicUrl: (p) => `https://fake.storage/${p}` });
  const client = createFakeSupabaseClient([{ data: { id: "m1" }, error: null }, { data: { id: "a1" }, error: null }], { storage });
  try {
    await handleGenerateImage(client, { shopId: "shop-1", userId: "user-1" }, {
      style: "social_square",
      flowers: ["Freedom rose", "spray rose"],
      occasion: "Homecoming"
    });
    const imageCall = mock.calls.find((c) => c.url.includes("flux-1-schnell"));
    assert.match(imageCall.body.prompt, /Freedom rose/);
    assert.doesNotMatch(imageCall.body.prompt, /seasonal focal flower|accent bloom/i);
  } finally {
    mock.restore();
  }
});

test("handleGenerateImage: without a flowers list but with a photo, auto-identifies flowers server-side instead of guessing", async () => {
  const mock = mockCloudflare({ visionText: "hydrangea, garden rose, eucalyptus" });
  const storage = createFakeSupabaseStorage({ publicUrl: (p) => `https://fake.storage/${p}` });
  const client = createFakeSupabaseClient([{ data: { id: "m1" }, error: null }, { data: { id: "a1" }, error: null }], { storage });
  try {
    await handleGenerateImage(client, { shopId: "shop-1", userId: "user-1" }, {
      style: "pinterest",
      flowers: [],
      image_base64: TINY_IMAGE_DATA_URL
    });
    const imageCall = mock.calls.find((c) => c.url.includes("flux-1-schnell"));
    assert.match(imageCall.body.prompt, /hydrangea/i);
  } finally {
    mock.restore();
  }
});

test("handleGenerateImage: a failed generation is persisted as a failed asset, never silently dropped", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ errors: [{ message: "model overloaded" }] }) });
  const client = createFakeSupabaseClient([{ data: { id: "failed-asset-1" }, error: null }]);
  try {
    const res = await handleGenerateImage(client, { shopId: "shop-1", userId: "user-1" }, { style: "website_hero", flowers: ["rose"] });
    const payload = JSON.parse(res.body);
    assert.equal(res.statusCode, 502);
    assert.equal(payload.ok, false);
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets");
    assert.equal(assetInsert.payload.status, "failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("identifyFlowersForImagePrompt: returns a clean array of real names, capped at 6, never fabricated beyond what vision saw", async () => {
  const mock = mockCloudflare({ visionText: "possibly hydrangea, garden rose, eucalyptus, ranunculus, tulip, peony, extra one" });
  try {
    const flowers = await identifyFlowersForImagePrompt(Buffer.from("fake"));
    assert.ok(flowers.length <= 6);
    assert.ok(flowers.some((f) => /hydrangea/i.test(f)));
    assert.ok(!flowers.some((f) => /^possibly /i.test(f)));
  } finally {
    mock.restore();
  }
});
