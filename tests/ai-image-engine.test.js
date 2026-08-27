import test from "node:test";
import assert from "node:assert/strict";
import {
  generateImage,
  imageGenerationConfigured,
  buildImagePrompt,
  generateFlyerBackgroundWithRetry,
  buildFlyerBackgroundPrompt
} from "../netlify/functions/_shared/ai-image-engine.js";
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

// ---------------------------------------------------------------------------
// Bounded flyer-background retry.
//
// A flyer with no photograph can never meet the "bright, happy, colourful
// floral image" standard, whatever the renderer does with it — so one
// transient provider failure used to be enough to hand a florist a
// photo-less flyer. One retry, never a loop: an unconfigured or wedged
// provider must not turn a single click into unbounded spend.
// ---------------------------------------------------------------------------

test("generateFlyerBackgroundWithRetry: a transient first failure is retried exactly once, with a DIFFERENT composition prompt, and the success is returned", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  const prompts = [];
  let call = 0;
  globalThis.fetch = async (_url, opts) => {
    prompts.push(JSON.parse(opts.body).prompt);
    call++;
    if (call === 1) return { ok: false, status: 500, json: async () => ({ success: false, errors: [{ message: "upstream hiccup" }] }) };
    return { ok: true, json: async () => ({ result: { image: TINY_JPEG_BASE64 } }) };
  };
  try {
    const client = createFakeSupabaseClient([{ data: { id: "m1" }, error: null }]);
    client.storage = createFakeSupabaseStorage();
    const res = await generateFlyerBackgroundWithRetry(client, "shop-1", {
      promptFor: (attempt) => `backdrop attempt ${attempt}`,
      filenameFor: (attempt) => `bg-${attempt}.jpg`
    });
    assert.equal(res.ok, true, `the retry must succeed: ${res.error || ""}`);
    assert.equal(res.attempts, 2);
    assert.equal(prompts.length, 2, "exactly two provider calls — one retry, never a loop");
    assert.notEqual(prompts[0], prompts[1], "the retry must ask for a different composition, not resend the identical prompt");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateFlyerBackgroundWithRetry: two real failures stop at two attempts — never an unbounded loop — and report the failure honestly", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 500, json: async () => ({ success: false, errors: [{ message: "still down" }] }) };
  };
  try {
    const client = createFakeSupabaseClient([]);
    const res = await generateFlyerBackgroundWithRetry(client, "shop-1", {
      promptFor: (attempt) => `backdrop ${attempt}`,
      filenameFor: () => "bg.jpg"
    });
    assert.equal(res.ok, false);
    assert.equal(res.attempts, 2);
    assert.equal(calls, 2, "bounded at two provider calls");
    assert.ok(res.error, "the real failure must be reported, never swallowed into a fake success");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateFlyerBackgroundWithRetry: an UNCONFIGURED provider is not retried at all — a second identical call cannot succeed and would only add latency", async () => {
  const originalAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const originalToken = process.env.CLOUDFLARE_AI_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_AI_API_TOKEN;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("must never be called when unconfigured");
  };
  try {
    const res = await generateFlyerBackgroundWithRetry(createFakeSupabaseClient([]), "shop-1", {
      promptFor: () => "backdrop",
      filenameFor: () => "bg.jpg"
    });
    assert.equal(res.ok, false);
    assert.equal(res.attempts, 1, "no retry when the provider isn't configured");
    assert.equal(calls, 0, "no network call at all");
    assert.match(res.error, /not configured/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAccount !== undefined) process.env.CLOUDFLARE_ACCOUNT_ID = originalAccount;
    if (originalToken !== undefined) process.env.CLOUDFLARE_AI_API_TOKEN = originalToken;
  }
});

// ---------------------------------------------------------------------------
// The background prompt must actively require the visual direction Ashley
// specified, and actively forbid what she rejected. These assert on the
// PROMPT only — a correct prompt is not proof of a correct image, and this
// suite makes no claim about what the model actually returns.
// ---------------------------------------------------------------------------

test("buildFlyerBackgroundPrompt: demands bright, happy, colourful floral photography and explicitly rules out dark/moody/dull", () => {
  const p = buildFlyerBackgroundPrompt({ occasion: "Closing early" });
  assert.match(p, /bright/i);
  assert.match(p, /colou?rful|vivid/i);
  assert.match(p, /natural daylight|natural light/i);
  assert.match(p, /never dark, moody, dull/i);
});

test("buildFlyerBackgroundPrompt: never asks the model to render words, numbers, logos or watermarks — a diffusion model can't spell", () => {
  const p = buildFlyerBackgroundPrompt({ occasion: "Closing early" });
  assert.match(p, /no legible text, words, letters, numbers/i);
  assert.match(p, /no logos, no watermarks/i);
});

test("buildFlyerBackgroundPrompt: asks for open space in the LOWER portion, where the templates actually place text — never a white panel or colour overlay", () => {
  const p = buildFlyerBackgroundPrompt({ occasion: "Closing early" });
  assert.match(p, /lower portion of the frame/i);
  assert.ok(!/white (panel|box)/i.test(p), "must never request a white panel");
  assert.ok(!/overlay|colou?r wash/i.test(p), "must never request an overlay or colour wash");
});

test("buildFlyerBackgroundPrompt: a different variationSeed genuinely asks for a different composition, so Regenerate isn't just a re-roll of one instruction", () => {
  const a = buildFlyerBackgroundPrompt({ occasion: "Closing early", variationSeed: 0 });
  const b = buildFlyerBackgroundPrompt({ occasion: "Closing early", variationSeed: 1 });
  assert.notEqual(a, b);
});

test("buildFlyerBackgroundPrompt: never hardcodes a shop, and only claims specific flowers when real inventory was supplied", () => {
  const generic = buildFlyerBackgroundPrompt({ occasion: "Closing early" });
  assert.ok(!/lilies in bloom/i.test(generic), "no specific shop may be baked into multi-tenant prompt behaviour");
  const grounded = buildFlyerBackgroundPrompt({ occasion: "Closing early", groundedFlowers: ["garden roses", "eucalyptus"] });
  assert.match(grounded, /garden roses/);
  assert.ok(!/garden roses/i.test(generic), "flowers must not be implied as available when no inventory was supplied");
});

test("generateFlyerBackgroundWithRetry: an UPLOAD failure is NOT retried — the image was already generated and billed, so a retry would pay twice to hit the same storage error", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    return { ok: true, json: async () => ({ result: { image: TINY_JPEG_BASE64 } }) };
  };
  try {
    // A client whose media insert fails => uploadWebsiteMedia fails.
    const client = createFakeSupabaseClient([{ data: null, error: { message: "storage rejected" } }]);
    client.storage = createFakeSupabaseStorage({
      uploadResponses: [{ data: null, error: { message: "storage rejected" } }]
    });
    const res = await generateFlyerBackgroundWithRetry(client, "shop-1", {
      promptFor: (attempt) => `backdrop ${attempt}`,
      filenameFor: () => "bg.jpg"
    });
    assert.equal(res.ok, false);
    assert.equal(res.stage, "upload", "the failure must be attributed to storage, not the provider");
    assert.equal(res.attempts, 1, "an upload failure must not trigger a second billed generation");
    assert.equal(providerCalls, 1, "exactly one image was generated");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
