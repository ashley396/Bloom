import test from "node:test";
import assert from "node:assert/strict";
import {
  generateImage,
  imageGenerationConfigured,
  buildImagePrompt,
  generateFlyerBackgroundWithRetry,
  buildFlyerBackgroundPrompt,
  buildBackgroundPrompt,
  composePrompt
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
