import test from "node:test";
import assert from "node:assert/strict";
import { generateImage, imageGenerationConfigured, buildImagePrompt } from "../netlify/functions/_shared/ai-image-engine.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

test("imageGenerationConfigured: false when Cloudflare credentials are missing", () => {
  assert.equal(imageGenerationConfigured({}), false);
  assert.equal(imageGenerationConfigured({ CLOUDFLARE_ACCOUNT_ID: "a" }), false);
  assert.equal(imageGenerationConfigured({ CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_AI_API_TOKEN: "b" }), true);
});

test("generateImage: calls the exact proven flux-1-schnell model shape, uploads through the existing website-media pipeline, returns a public URL", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  delete process.env.CLOUDFLARE_IMAGE_MODEL;
  const originalFetch = globalThis.fetch;
  let calledUrl = null;
  let calledBody = null;
  globalThis.fetch = async (url, opts) => {
    calledUrl = url;
    calledBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ result: { image: TINY_JPEG_BASE64 } }) };
  };

  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
  const client = createFakeSupabaseClient([], { storage });

  try {
    const result = await generateImage(client, "shop-1", { prompt: "A professional florist photo of a Homecoming corsage." });
    assert.equal(result.ok, true);
    assert.match(result.url, /^https:\/\/fake\.storage\/website-media\//);
    assert.equal(result.model, "@cf/black-forest-labs/flux-1-schnell");
    assert.match(calledUrl, /\/ai\/run\/@cf\/black-forest-labs\/flux-1-schnell$/);
    assert.equal(calledBody.steps, 8);
    // Credentials never appear in what a caller gets back.
    assert.ok(!JSON.stringify(result).includes("token-test"));
    // Path convention matches the existing website-media bucket: {shopId}/{uuid}.{ext}
    assert.match(storage.calls.find((c) => c.op === "upload").path, /^shop-1\/[0-9a-f-]+\.jpg$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateImage: not configured — returns ok:false without ever calling fetch", async () => {
  const originalAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const originalToken = process.env.CLOUDFLARE_AI_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_AI_API_TOKEN;
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not be called");
  };
  try {
    const result = await generateImage(createFakeSupabaseClient([]), "shop-1", { prompt: "x" });
    assert.equal(result.ok, false);
    assert.match(result.error, /not configured/i);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAccount !== undefined) process.env.CLOUDFLARE_ACCOUNT_ID = originalAccount;
    if (originalToken !== undefined) process.env.CLOUDFLARE_AI_API_TOKEN = originalToken;
  }
});

test("generateImage: a provider error surfaces as ok:false rather than throwing", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ errors: [{ message: "model overloaded" }] }) });
  try {
    const result = await generateImage(createFakeSupabaseClient([]), "shop-1", { prompt: "x" });
    assert.equal(result.ok, false);
    assert.match(result.error, /overloaded/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateImage: rejects an empty prompt without a network call", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not be called");
  };
  try {
    const result = await generateImage(createFakeSupabaseClient([]), "shop-1", { prompt: "" });
    assert.equal(result.ok, false);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildImagePrompt: never falls back to a vague placeholder when real context exists", () => {
  const prompt = buildImagePrompt({ occasion: "Homecoming", products: ["Freedom rose", "spray rose"], shopName: "Test Blooms" });
  assert.match(prompt, /Homecoming/);
  assert.match(prompt, /Freedom rose/);
  assert.match(prompt, /Test Blooms/);
  assert.doesNotMatch(prompt, /seasonal focal flower|accent bloom/i);
});

test("buildImagePrompt: uses an explicit visual brief verbatim when one is provided", () => {
  const prompt = buildImagePrompt({ visualBrief: "A red spray rose corsage on a wrist, shot on a wooden counter." });
  assert.match(prompt, /wrist/);
});
