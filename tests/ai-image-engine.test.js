import test from "node:test";
import assert from "node:assert/strict";
import {
  generateImage,
  generateImageCheckingText,
  imageGenerationConfigured,
  buildImagePrompt,
  generateFlyerBackgroundWithRetry,
  buildFlyerBackgroundPrompt,
  buildBackgroundPrompt,
  composePrompt
} from "../netlify/functions/_shared/ai-image-engine.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

/**
 * A fetch mock distinguishing generateImage's real image-generation call
 * ({prompt, steps}, no `image` field) from florist-ai-vision.js's own
 * vision-check call (llava/uform payload shape: {prompt, image,
 * max_tokens}) — the same distinction every marketing-studio test's own
 * mock now has to make for the same reason. `visionAnswers` is consumed in
 * order, one per vision call made; the last entry repeats once exhausted.
 * Each entry is just the TEXT verdict ("YES"/"NO") — assessGeneratedMarketingPhoto's
 * real reply format also carries SUBJECT_MATCH/REASON lines, so this wraps
 * each answer into that same three-line shape (SUBJECT_MATCH always PASS
 * here; the subject-match side of the gate has its own dedicated tests).
 */
function mockImageAndVision(visionAnswers = ["NO"]) {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  const queue = [...visionAnswers];
  const imageGenCalls = [];
  const visionCalls = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts?.body || "{}");
    if ("image" in body) {
      visionCalls.push(body);
      const answer = queue.length > 1 ? queue.shift() : queue[0];
      const reply = `TEXT: ${answer}\nSUBJECT_MATCH: PASS\nREASON: test`;
      return { ok: true, json: async () => ({ success: true, result: { description: reply } }) };
    }
    imageGenCalls.push(body);
    return { ok: true, json: async () => ({ result: { image: TINY_JPEG_BASE64 } }) };
  };
  return {
    imageGenCalls,
    visionCalls,
    restore: () => {
      globalThis.fetch = originalFetch;
    }
  };
}

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
// Structured creative_brief (Phase 2 rebuild, priority-1 gap): when present,
// it describes the SAME concept as visualBrief but already broken into the
// fields an image prompt actually needs — preferred over the raw prose for
// that reason. visualBrief alone must keep working for any caller (the flyer
// wording path, older persisted content) that has no structured brief yet.
// ---------------------------------------------------------------------------

test("buildImagePrompt: a structured creativeBrief is preferred over visualBrief prose, and its concrete fields all reach the real prompt", () => {
  const prompt = buildImagePrompt({
    visualBrief: "Some vaguer prose describing roses.",
    creativeBrief: {
      primary_subject: "A dozen garden roses in a low ceramic vase",
      mood: "romantic, soft",
      lighting: "warm golden-hour window light",
      composition: "close-up, shallow depth of field",
      floral_style: "garden-style, loose and organic"
    }
  });
  assert.match(prompt, /A dozen garden roses in a low ceramic vase/);
  assert.match(prompt, /romantic, soft/);
  assert.match(prompt, /warm golden-hour window light/);
  assert.match(prompt, /garden-style, loose and organic/);
});

test("buildImagePrompt: a creativeBrief with no primary_subject falls back to visualBrief prose, never an empty subject clause", () => {
  const prompt = buildImagePrompt({
    visualBrief: "A red spray rose corsage on a wrist.",
    creativeBrief: { mood: "romantic" }
  });
  assert.match(prompt, /wrist/);
});

test("buildImagePrompt: no creativeBrief at all (the ordinary case today) behaves exactly as before — visualBrief prose used verbatim", () => {
  const prompt = buildImagePrompt({ visualBrief: "A red spray rose corsage on a wrist." });
  assert.match(prompt, /wrist/);
});

test("buildImagePrompt: a creativeBrief naming sympathy work still triggers the restrained sympathy palette even when visualBrief itself is silent about it", () => {
  const prompt = buildImagePrompt({
    visualBrief: "A tasteful arrangement.",
    creativeBrief: { primary_subject: "A dignified standing spray for a graveside service" }
  });
  assert.match(prompt, /sympathy work/i);
  assert.match(prompt, /white, ivory and cream/i);
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
  assert.match(p, /ABSOLUTELY NO TEXT/);
  assert.match(p, /no words, letters, numbers/i);
  assert.match(p, /watermarks or logos/i, "the logo/watermark ban must survive wherever it is expressed");
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

test("buildFlyerBackgroundPrompt: real inventory (groundedFlowers) still wins over a structured creativeBrief — never claim stock that isn't real just because a brief was supplied", () => {
  const p = buildFlyerBackgroundPrompt({
    occasion: "Closing early",
    groundedFlowers: ["garden roses"],
    creativeBrief: { primary_subject: "A wild armful of peonies" }
  });
  assert.match(p, /garden roses/);
  assert.ok(!/peonies/i.test(p), "an ungrounded creativeBrief subject must never override real inventory");
});

test("buildFlyerBackgroundPrompt: a structured creativeBrief is used as the visual fallback when no real inventory is grounded", () => {
  const p = buildFlyerBackgroundPrompt({
    occasion: "Closing early",
    creativeBrief: { primary_subject: "A wild armful of peonies and ranunculus", mood: "romantic" }
  });
  assert.match(p, /wild armful of peonies and ranunculus/);
});

test("buildFlyerBackgroundPrompt: a creativeBrief naming sympathy work triggers the restrained palette even when occasion/visualBrief are silent", () => {
  const p = buildFlyerBackgroundPrompt({
    creativeBrief: { primary_subject: "A dignified standing spray for a graveside service" }
  });
  assert.match(p, /sympathy and funeral work/i);
  assert.ok(!/happy, colorful/i.test(p));
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

// ---------------------------------------------------------------------------
// generateImageCheckingText — real, live-found failure: a florist's plain
// "make today's post" request came back with a photo carrying invented,
// garbled pseudo-branding painted into a corner, despite NO_TEXT_DIRECTIVE
// being unconditional on every prompt. A prompt instruction is a
// statistical nudge to a diffusion model, not a hard constraint, so this
// actually inspects the generated pixels with a real vision model
// (florist-ai-vision.js) and retries once if it finds text.
// ---------------------------------------------------------------------------

test("generateImageCheckingText: a clean photo (vision says no text) is returned after exactly one generation and one vision check", async () => {
  const mock = mockImageAndVision(["NO"]);
  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
  const client = createFakeSupabaseClient([], { storage });
  try {
    const result = await generateImageCheckingText(client, "shop-1", { promptFor: () => "a jaguar holding flowers", filenameFor: () => "marketing.jpg" });
    assert.equal(result.ok, true);
    assert.equal(mock.imageGenCalls.length, 1, "a clean first attempt must never trigger a second, billed generation");
    assert.equal(mock.visionCalls.length, 1);
  } finally {
    mock.restore();
  }
});

test("generateImageCheckingText: vision finds invented text on the first photo — retries ONCE with a fresh generation, and returns the second (clean) result", async () => {
  const mock = mockImageAndVision(["YES", "NO"]);
  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
  const client = createFakeSupabaseClient([], { storage });
  try {
    const filenames = [];
    const result = await generateImageCheckingText(client, "shop-1", {
      promptFor: () => "a jaguar holding flowers",
      filenameFor: (attempt) => {
        const name = attempt === 0 ? "marketing.jpg" : `marketing-retry${attempt}.jpg`;
        filenames.push(name);
        return name;
      }
    });
    assert.equal(result.ok, true);
    assert.equal(mock.imageGenCalls.length, 2, "text found on the first photo must trigger exactly one fresh regeneration");
    assert.equal(mock.visionCalls.length, 2, "the SECOND photo must also be checked, not assumed clean");
    assert.deepEqual(filenames, ["marketing.jpg", "marketing-retry1.jpg"], "the retry must use a distinct filename, not overwrite the first attempt");
  } finally {
    mock.restore();
  }
});

test("generateImageCheckingText: text found on BOTH attempts still returns the last real photo — never fails the whole request over an imperfect (but real, usable) image", async () => {
  const mock = mockImageAndVision(["YES", "YES"]);
  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
  const client = createFakeSupabaseClient([], { storage });
  try {
    const result = await generateImageCheckingText(client, "shop-1", { promptFor: () => "a jaguar holding flowers", filenameFor: (a) => `m${a}.jpg` });
    assert.equal(result.ok, true, "exhausting the bounded retry must still hand back a real, usable photo rather than a failure");
    assert.equal(mock.imageGenCalls.length, 2, "never more than the bounded maxAttempts — no unbounded loop");
  } finally {
    mock.restore();
  }
});

// Phase 2 rebuild, priority-3 gap: the quality gate's SUBJECT_MATCH check
// (not just invented text) must also trigger the same bounded retry — a
// wrong or broken photo is exactly the failure the jaguar-mascot regression
// (see buildImagePrompt's own history) had no detection for at all before.
function mockImageAndSubjectMatch(verdicts = ["PASS"]) {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  const queue = [...verdicts];
  const imageGenCalls = [];
  const visionCalls = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts?.body || "{}");
    if ("image" in body) {
      visionCalls.push(body);
      const verdict = queue.length > 1 ? queue.shift() : queue[0];
      const reply = `TEXT: NO\nSUBJECT_MATCH: ${verdict}\nREASON: test`;
      return { ok: true, json: async () => ({ success: true, result: { description: reply } }) };
    }
    imageGenCalls.push(body);
    return { ok: true, json: async () => ({ result: { image: TINY_JPEG_BASE64 } }) };
  };
  return {
    imageGenCalls,
    visionCalls,
    restore: () => {
      globalThis.fetch = originalFetch;
    }
  };
}

test("generateImageCheckingText: a SUBJECT_MATCH: FAIL verdict (no invented text at all) still triggers exactly one fresh retry", async () => {
  const mock = mockImageAndSubjectMatch(["FAIL", "PASS"]);
  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
  const client = createFakeSupabaseClient([], { storage });
  try {
    const result = await generateImageCheckingText(client, "shop-1", {
      promptFor: () => "a jaguar holding flowers",
      filenameFor: (a) => `m${a}.jpg`,
      creativeBrief: { primary_subject: "A jaguar mascot holding a bouquet of roses" }
    });
    assert.equal(result.ok, true);
    assert.equal(mock.imageGenCalls.length, 2, "a subject mismatch must trigger exactly one fresh regeneration, same as invented text");
  } finally {
    mock.restore();
  }
});

test("generateImageCheckingText: the passed-through creativeBrief/visualBrief/occasion actually reach the real vision prompt", async () => {
  const mock = mockImageAndSubjectMatch(["PASS"]);
  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
  const client = createFakeSupabaseClient([], { storage });
  try {
    await generateImageCheckingText(client, "shop-1", {
      promptFor: () => "a jaguar holding flowers",
      filenameFor: () => "m.jpg",
      creativeBrief: { primary_subject: "A jaguar mascot holding a bouquet of roses" }
    });
    const sentText = JSON.stringify(mock.visionCalls[0]);
    assert.match(sentText, /A jaguar mascot holding a bouquet of roses/);
  } finally {
    mock.restore();
  }
});

test("generateImageCheckingText: a failed generation is returned as a real failure, and never wastes a vision-check call on an image that doesn't exist", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return { ok: false, json: async () => ({ success: false, errors: [{ message: "provider unavailable" }] }) };
  };
  const client = createFakeSupabaseClient([]);
  try {
    const result = await generateImageCheckingText(client, "shop-1", { promptFor: () => "a jaguar holding flowers", filenameFor: () => "m.jpg" });
    assert.equal(result.ok, false);
    assert.equal(fetchCalls, 1, "a failed image generation must never be followed by a vision-check call — there is no photo to check");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateImageCheckingText: a vision-check that itself errors out never blocks or fails a perfectly real photo", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts?.body || "{}");
    if ("image" in body) return { ok: false, json: async () => ({ success: false, errors: [{ message: "vision model unavailable" }] }) };
    return { ok: true, json: async () => ({ result: { image: TINY_JPEG_BASE64 } }) };
  };
  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` });
  const client = createFakeSupabaseClient([], { storage });
  try {
    const result = await generateImageCheckingText(client, "shop-1", { promptFor: () => "a jaguar holding flowers", filenameFor: () => "m.jpg" });
    assert.equal(result.ok, true, "a QA-check outage must never hold up a real, otherwise-successful photo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildFlyerBackgroundPrompt: reserves a genuinely calm, un-busy area for the text block — not merely 'open space'", () => {
  const p = buildFlyerBackgroundPrompt({ occasion: "Closing early" });
  assert.match(p, /calm/i);
  assert.match(p, /no flowers, foliage, stems, petals, vase or busy detail/i);
  assert.match(p, /readable/i);
  assert.match(p, /upper portion/i, "the blooms must be steered away from the text area, not just out of it");
});

test("buildFlyerBackgroundPrompt: the no-text and no-logo guarantees SURVIVE the length cap, even with a long visual brief", () => {
  // A real regression: lengthening the composition guidance pushed the
  // mandatory tail past the 1200-char slice, silently truncating the one
  // directive that stops a diffusion model painting garbled words on a
  // customer's flyer. A huge brief must not be able to cut it off.
  const p = buildFlyerBackgroundPrompt({
    occasion: "Closing early",
    brandColor: "#8f3f68",
    groundedFlowers: ["garden roses", "ranunculus", "eucalyptus", "lisianthus", "spray roses"],
    visualBrief: "x".repeat(4000)
  });
  assert.ok(p.length <= 1200, `prompt must respect the provider cap, got ${p.length}`);
  assert.match(p, /ABSOLUTELY NO TEXT/);
  assert.match(p, /no words, letters, numbers/i);
  assert.match(p, /watermarks or logos/i, "the logo/watermark ban must survive wherever it is expressed");
  // The earlier version of this test asserted only the tail and passed
  // green while the calm-text-area instruction — the entire point of the
  // change beside it — had silently vanished. Every REQUIRED clause must
  // survive, not just the last one.
  assert.match(p, /Critically important/, "the calm-text-area instruction must never be the clause that gets dropped");
  assert.match(p, /Luxury editorial floral photography/, "the bright/colorful direction must survive too");
  assert.ok(!/\s\S*\.\.\.$/.test(p), "nothing may be left cut mid-sentence");
});

test("buildFlyerBackgroundPrompt: ordinary real inputs keep every required clause AND the optional detail", () => {
  // The exact shape marketing-studio.js passes: a real visual brief, the
  // shop's brand colour, and grounded inventory. A 101-character brief was
  // enough to start cutting directives under the old character slice.
  const p = buildFlyerBackgroundPrompt({
    occasion: "Closing early today",
    brandColor: "#8f3f68",
    visualBrief: "A".repeat(101),
    groundedFlowers: ["garden roses", "ranunculus"]
  });
  assert.ok(p.length <= 1200);
  assert.match(p, /Critically important/);
  assert.match(p, /ABSOLUTELY NO TEXT/);
  assert.match(p, /watermarks or logos/i, "the logo/watermark ban must survive wherever it is expressed");
  assert.match(p, /garden roses/, "real inventory should still make it in at this size");
  // The brand-colour clause is OPTIONAL by design and is the first thing
  // surrendered when the cap bites — that is the intended trade, and it is
  // asserted here so the priority order stays deliberate rather than
  // accidental: required clauses in, optional detail out, nothing sliced.
  assert.ok(p.length <= 1200);
});

// ---------------------------------------------------------------------------
// The no-text and realism guarantees must survive ANY caller input.
//
// Ashley, on a funeral post whose image had invented gibberish painted across
// it — "Revise the Flower, Fost", "He lay airth rerord sanding lite!" — and a
// flat, unconvincing arrangement: these posts "need to have ultra realistic
// flower arrangements that match the post and the wording on the pictures
// must make sense if it has wording on it."
//
// A diffusion model cannot spell, so the only wording that can make sense is
// no wording at all — Florisyn draws the real words itself. The prompt
// appended that guarantee and then sliced the joined string to 1200
// characters, so a visual brief of 1200 characters or more deleted it
// outright. The brief is model-written and unbounded.
// ---------------------------------------------------------------------------

test("buildImagePrompt: the no-text guarantee survives a visual brief of any length", () => {
  for (const length of [0, 100, 1079, 1080, 1200, 2000, 8000]) {
    const prompt = buildImagePrompt({ visualBrief: "x".repeat(length), occasion: "funeral tribute work" });
    assert.match(prompt, /ABSOLUTELY NO TEXT/,
      `a ${length}-character brief deleted the one instruction stopping the model painting nonsense on a shop's post`);
    assert.ok(prompt.length <= 1200, `prompt overflowed the provider cap at ${length}: ${prompt.length}`);
  }
});

test("buildImagePrompt: the realism instruction is never dropped to make room", () => {
  for (const length of [0, 1200, 5000]) {
    const prompt = buildImagePrompt({ visualBrief: "x".repeat(length) });
    assert.match(prompt, /Ultra-realistic photograph of genuine fresh flowers/,
      `a ${length}-character brief dropped the realism instruction`);
    assert.match(prompt, /Not an illustration, painting, clip art, cartoon or 3D render/);
  }
});

test("buildImagePrompt: the occasion survives, so the arrangement matches the post it illustrates", () => {
  const prompt = buildImagePrompt({ visualBrief: "x".repeat(4000), occasion: "sympathy and funeral tribute work" });
  assert.match(prompt, /sympathy and funeral tribute work/,
    "a generic bouquet on a funeral post is the arrangement not matching the post");
});

test("buildImagePrompt: no clause is ever cut mid-sentence", () => {
  // A half-instruction is worse than none — the model still reads it.
  const prompt = buildImagePrompt({ visualBrief: "A serene chapel tribute. ".repeat(80) });
  assert.ok(!/\bABSOLUTELY NO TEX\b|\bUltra-realistic photograph of genuine fresh\.$/.test(prompt));
  assert.match(prompt, /render\.|scene with no writing of any kind\./);
});

// Real, live-found failure (Ashley's own screenshots): a regenerated post
// image came back with the requested subject (a jaguar) missing entirely.
// visual_brief used to be the ONE optional clause here — a too-long one was
// dropped WHOLE rather than trimmed, silently erasing the actual subject of
// the photo. Now it is never dropped: it is fitted to whatever budget is
// left after every other required clause, truncated at a word boundary
// instead. This is the regression guard — a long, realistic, detailed
// brief (near generateSocialPost's own 600-char visual_brief cap) combined
// with a long occasion string must still leave the named subject in the
// final prompt, never lose it outright the way a dropped clause would.
test("buildImagePrompt: a long, realistic visual brief never loses its subject entirely — it is trimmed, not dropped", () => {
  const longRealisticBrief =
    "A jaguar mascot in a football jersey holding a large bouquet of red and white roses and carnations, " +
    "standing on a bright green football field under stadium lights, playful sports-fan theme, confetti in " +
    "the air, bright cheerful colors, homecoming game atmosphere, crowd blurred in the background, banners " +
    "visible but unreadable, festive game-day energy throughout the whole scene composition, with additional " +
    "descriptive detail about the stadium architecture, the marching band assembled on the field, streamers " +
    "in the school colors, and a wide-angle composition that captures the full scale of the celebration.";
  // A realistic detailed brief — this one alone stays under the 1200 cap
  // even with visual_brief still OPTIONAL, so it does not by itself
  // reproduce the drop; the next test below pushes further (a longer brief
  // plus a long occasion string) and DOES exceed it, verified by actually
  // reverting the fix and confirming that one — and only that one — fails.
  assert.ok(longRealisticBrief.length > 550, "keep this a genuinely long, realistic brief");
  const prompt = buildImagePrompt({
    visualBrief: longRealisticBrief,
    occasion: "Good luck post for the football team homecoming game this Friday night"
  });
  assert.match(prompt, /jaguar/i, "the real subject must survive even a long, realistic brief — never dropped wholesale");
  assert.match(prompt, /ABSOLUTELY NO TEXT/, "the no-text guarantee must still survive alongside it");
  assert.ok(prompt.length <= 1200, `prompt overflowed the provider cap: ${prompt.length}`);
});

test("buildImagePrompt: the subject survives even at the extreme — a full-length brief, a long instruction-shaped brief, and a long occasion string all at once", () => {
  const visualBrief = "SUBJECT-MARKER-JAGUAR " + "x".repeat(590);
  const prompt = buildImagePrompt({
    visualBrief,
    occasion: "funeral tribute work for a long occasion string padding out required clauses further than usual"
  });
  assert.match(prompt, /SUBJECT-MARKER-JAGUAR/, "the subject marker at the front of an over-length brief must survive");
  assert.ok(prompt.length <= 1200, `prompt overflowed the provider cap: ${prompt.length}`);
});

// A gap an independent review found in this fix's first version: `occasion`
// (currentItem.data.title) is caller-controlled with no length ceiling
// enforced anywhere upstream. No shipped UI sends a long one today, but
// nothing here should depend on that staying true — a long enough
// occasion string, combined with the sympathy clause it can trigger, could
// otherwise force the WHOLE prompt over cap, and composePrompt's own
// last-resort fallback (trim from the very front) doesn't respect clause
// boundaries — it would eat into REALISM_DIRECTIVE and the truncated
// visual_brief alike, losing the subject the same way as before. Occasion
// is now bounded the same way visual_brief is (truncated at a word
// boundary, never dropped), so this can't happen regardless of what a
// future caller ever passes as occasion.
test("buildImagePrompt: an unbounded occasion string (combined with a sympathy trigger) can never squeeze the subject out via the front-trim fallback", () => {
  const visualBrief = "SUBJECT-MARKER-JAGUAR " + "a".repeat(600);
  const occasion = "funeral tribute work, " + "b".repeat(680);
  const prompt = buildImagePrompt({ visualBrief: visualBrief.slice(0, 620), occasion });
  assert.match(prompt, /SUBJECT-MARKER-JAGUAR/, "the subject must survive even an adversarially long occasion string");
  assert.match(prompt, /ABSOLUTELY NO TEXT/, "the no-text guarantee must still survive alongside it");
  assert.match(prompt, /Ultra-realistic photograph/, "the realism instruction must still survive alongside it");
  assert.ok(prompt.length <= 1200, `prompt overflowed the provider cap: ${prompt.length}`);
});

test("buildBackgroundPrompt: its own guarantees survive an unbounded brief too", () => {
  const prompt = buildBackgroundPrompt({ visualBrief: "y".repeat(3000) });
  assert.match(prompt, /ABSOLUTELY NO TEXT/);
  assert.match(prompt, /Empty background only/);
  assert.ok(prompt.length <= 1200);
});

test("composePrompt: drops optional clauses from the end and never a required one", () => {
  const out = composePrompt([
    { text: "REQ-FIRST", optional: false },
    { text: "z".repeat(1100), optional: true },
    { text: "OPT-TAIL", optional: true },
    { text: "REQ-LAST", optional: false }
  ]);
  assert.match(out, /REQ-FIRST/);
  assert.match(out, /REQ-LAST/);
  assert.ok(out.length <= 1200);
});

// ---------------------------------------------------------------------------
// The palette has to suit what the flyer is for.
//
// Ashley's funeral post came back with coral and sunny-yellow spring flowers
// on it. The bright palette was REQUIRED on every background prompt regardless
// of occasion — it exists because every flyer once trended dark and gloomy,
// and her own spec is "happy, colorful and floral", so it must stay the
// default. It just cannot be the only option.
// ---------------------------------------------------------------------------

test("sympathy work is never asked for in a bright, festive palette", () => {
  for (const occasion of ["funeral work", "sympathy arrangements", "a memorial service", "casket flowers", "a celebration of life"]) {
    const prompt = buildFlyerBackgroundPrompt({ occasion });
    assert.doesNotMatch(prompt, /sunny yellow|coral/,
      `"${occasion}" asked the model for a festive palette`);
    assert.match(prompt, /white, ivory and cream/, `"${occasion}" lost the sympathy palette`);
    assert.match(prompt, /never bright, festive, vivid or celebratory/i);
  }
});

test("everything else keeps the bright, happy default it was given for a reason", () => {
  for (const occasion of ["valentines day", "mothers day", "a spring sale", "a new subscription", ""]) {
    const prompt = buildFlyerBackgroundPrompt({ occasion });
    assert.match(prompt, /happy, colorful, rich and vivid/,
      `"${occasion}" lost the bright default — this is the gloomy-flyer regression`);
    assert.doesNotMatch(prompt, /white, ivory and cream/);
  }
});

test("the sympathy palette is picked up from the visual brief as well as the occasion", () => {
  const prompt = buildFlyerBackgroundPrompt({ visualBrief: "a dignified standing spray for a graveside service" });
  assert.match(prompt, /white, ivory and cream/);
});

test("the plain photo prompt carries the same palette for sympathy work", () => {
  const prompt = buildImagePrompt({ occasion: "funeral tribute work", visualBrief: "a standing spray" });
  assert.match(prompt, /restrained and dignified/);
  assert.match(prompt, /Never bright, festive, vivid or celebratory/i);
  // And still keeps its own guarantees.
  assert.match(prompt, /ABSOLUTELY NO TEXT/);
  assert.match(prompt, /Ultra-realistic photograph/);
  assert.ok(prompt.length <= 1200);
});

test("the sympathy palette never squeezes out the no-text guarantee", () => {
  const prompt = buildImagePrompt({ occasion: "funeral work", visualBrief: "x".repeat(3000) });
  assert.match(prompt, /ABSOLUTELY NO TEXT/);
  assert.ok(prompt.length <= 1200);
});

test("the sympathy prompt never contradicts itself about colour", () => {
  // The calm-area clause used to end "keep every BRIGHT, COLORFUL bloom in the
  // upper portion" — which, on a prompt that has just asked for restrained
  // white and ivory, tells the model two opposite things in one breath. Found
  // by reading the prompt the preview tool actually sends, not by a test.
  const prompt = buildFlyerBackgroundPrompt({ occasion: "funeral work" });
  assert.doesNotMatch(prompt, /bright, colorful/, "the sympathy prompt asks for bright colour and for restraint at once");
  assert.match(prompt, /white, ivory and cream/);
});
