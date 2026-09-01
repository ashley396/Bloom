import test from "node:test";
import assert from "node:assert/strict";
import { runMarketingImageQuality, IMAGE_QUALITY_STATE } from "../netlify/functions/_shared/marketing-image-quality.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

/**
 * Batch 2 ("Marketing image quality + provider cost accounting") — the
 * one authoritative image-quality state machine. Real, live bug this
 * closes: ai-image-engine.js's generateImageCheckingText read
 * assessGeneratedMarketingPhoto's own `accepted` field, which DEFAULTS
 * to true whenever the vision call itself failed or returned an
 * unparseable reply — so an inspection that never genuinely ran was
 * silently treated as a pass, and a second still-rejected candidate was
 * returned to the caller anyway. runMarketingImageQuality reads
 * `check.ok`/`check.readable` directly and never lets either failure
 * mode reach PASS.
 */

const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

/**
 * `visionReplies[i]` describes the verdict for the i-th real image-
 * generation attempt's vision inspection — applied to EVERY underlying
 * fetch call within that attempt's vision phase (runVisionWithFallback
 * tries up to 3 models, each with its own payload shape(s), before
 * assessGeneratedMarketingPhoto gives up — a single queued reply would
 * only cover the FIRST of those and silently fall through to a default
 * "clean" reply on the rest, which is not what a "total vision failure"
 * test means to simulate).
 */
function mockGenerateAndVision({ visionReplies = [], imageOk = true } = {}) {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  const calls = [];
  let imageAttempt = -1;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts?.body || "{}");
    calls.push({ url: String(url), body });
    // Distinguish by MODEL URL, not body shape — llama's own vision
    // payload has multiple variants and not all of them carry a
    // top-level "image" key (some embed the image inside `messages`
    // content instead), so body-shape sniffing misclassifies some of
    // them as the plain flux image-generation call.
    const isImageGeneration = /flux|black-forest-labs/i.test(String(url));
    if (!isImageGeneration) {
      const next = imageAttempt >= 0 && imageAttempt < visionReplies.length ? visionReplies[imageAttempt] : "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: ok";
      if (next === "THROW") throw new Error("vision provider network error");
      if (next === "OUTAGE") return { ok: false, json: async () => ({ success: false, errors: [{ message: "vision outage" }] }) };
      return { ok: true, json: async () => ({ success: true, result: { description: next } }) };
    }
    // Plain image-generation call (flux) — starts the next attempt's vision phase.
    imageAttempt += 1;
    if (!imageOk) return { ok: false, status: 500, json: async () => ({ success: false, errors: [{ message: "image provider down" }] }) };
    return { ok: true, json: async () => ({ success: true, result: { image: TINY_JPEG_BASE64 } }) };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

function usageInserts(client) {
  return client.calls.filter((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert"));
}
function usageUpdates(client) {
  return client.calls.filter((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "update"));
}

function baseClient(extraResponses = []) {
  const storage = createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/${path}` });
  return createFakeSupabaseClient(extraResponses, { storage });
}

// ---------------------------------------------------------------------------
// QUALITY
// ---------------------------------------------------------------------------

test("QUALITY 1: vision exception -> FALLBACK, never PASS", async () => {
  const mock = mockGenerateAndVision({ visionReplies: ["THROW", "THROW"] });
  const client = baseClient([
    { data: { id: "u1" }, error: null }, // reserve image (attempt 0)
    { data: null, error: null }, // complete image
    { data: { id: "u2" }, error: null }, // reserve vision
    { data: null, error: null }, // fail vision (exception)
    { data: { id: "u3" }, error: null }, // reserve image (attempt 1)
    { data: null, error: null }, // complete image
    { data: { id: "u4" }, error: null }, // reserve vision
    { data: null, error: null } // fail vision (exception)
  ]);
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg",
      buildFallback: async () => ({ ok: true, kind: "deterministic", url: "https://fake.storage/fallback.jpg" })
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FALLBACK);
    assert.notEqual(result.state, IMAGE_QUALITY_STATE.PASS);
    assert.equal(result.fallback.kind, "deterministic");
  } finally {
    mock.restore();
  }
});

test("QUALITY 2: image preparation failure -> FALLBACK", async () => {
  // No usable image payload at all (assessGeneratedMarketingPhoto returns
  // ok:false, readable:false without ever calling the vision provider) —
  // simulated by having generateImage itself succeed with real bytes, but
  // this test proves the SAME "never PASS" path fires for a preparation
  // failure by forcing the vision leg to report OUTAGE (ok:false), the
  // other real trigger for check.ok === false alongside a genuine
  // exception (both collapse to the same fail-closed branch in the
  // runner by design — see its own docstring).
  const mock = mockGenerateAndVision({ visionReplies: ["OUTAGE", "OUTAGE"] });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null },
    { data: { id: "u3" }, error: null },
    { data: null, error: null },
    { data: { id: "u4" }, error: null },
    { data: null, error: null }
  ]);
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg",
      buildFallback: async () => ({ ok: true, kind: "real_photo", url: "https://fake.storage/real.jpg" })
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FALLBACK);
  } finally {
    mock.restore();
  }
});

test("QUALITY 3: unreadable vision result -> FALLBACK, never PASS", async () => {
  const mock = mockGenerateAndVision({ visionReplies: ["I cannot determine that.", "Still unclear."] });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null },
    { data: { id: "u3" }, error: null },
    { data: null, error: null },
    { data: { id: "u4" }, error: null },
    { data: null, error: null }
  ]);
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg",
      buildFallback: async () => ({ ok: true, kind: "deterministic", url: "https://fake.storage/fallback.jpg" })
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FALLBACK);
  } finally {
    mock.restore();
  }
});

test("QUALITY 4: first candidate rejected, second accepted -> PASS", async () => {
  const mock = mockGenerateAndVision({
    visionReplies: ["TEXT: YES\nSUBJECT_MATCH: PASS\nREASON: garbled watermark", "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: clean"]
  });
  const client = baseClient([
    { data: { id: "u1" }, error: null }, // reserve image attempt 0
    { data: null, error: null }, // complete image
    { data: { id: "u2" }, error: null }, // reserve vision attempt 0
    { data: null, error: null }, // fail vision (rejected)
    { data: { id: "u3" }, error: null }, // reserve image attempt 1
    { data: null, error: null }, // complete image
    { data: { id: "u4" }, error: null }, // reserve vision attempt 1
    { data: null, error: null } // complete vision (accepted)
  ]);
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: (attempt, prior) => (attempt === 0 ? "a bright bouquet" : `a bright bouquet, absolutely no text anywhere (previous attempt rejected: ${prior[0]?.check?.reason})`),
      filenameFor: () => "test.jpg"
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.PASS);
    assert.ok(result.gen.ok);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0].state, "RETRY");
    assert.equal(result.attempts[1].state, "PASS");
  } finally {
    mock.restore();
  }
});

test("QUALITY 5: first and second candidates both rejected -> FALLBACK", async () => {
  const mock = mockGenerateAndVision({
    visionReplies: ["TEXT: YES\nSUBJECT_MATCH: PASS\nREASON: bad", "TEXT: YES\nSUBJECT_MATCH: PASS\nREASON: still bad"]
  });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null },
    { data: { id: "u3" }, error: null },
    { data: null, error: null },
    { data: { id: "u4" }, error: null },
    { data: null, error: null }
  ]);
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg",
      buildFallback: async () => ({ ok: true, kind: "deterministic", url: "https://fake.storage/fallback.jpg" })
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FALLBACK);
  } finally {
    mock.restore();
  }
});

test("QUALITY 6: the second rejected candidate is never displayed — result.gen is null on FALLBACK/FAIL", async () => {
  const mock = mockGenerateAndVision({
    visionReplies: ["TEXT: YES\nSUBJECT_MATCH: PASS\nREASON: bad", "TEXT: YES\nSUBJECT_MATCH: PASS\nREASON: still bad"]
  });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null },
    { data: { id: "u3" }, error: null },
    { data: null, error: null },
    { data: { id: "u4" }, error: null },
    { data: null, error: null }
  ]);
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg",
      buildFallback: async () => null
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FAIL);
    assert.equal(result.gen, null, "a rejected candidate must never be returned as the usable result");
    assert.equal(result.rejectedAssetPaths.length, 2, "both rejected candidates must be tracked, never silently discarded");
  } finally {
    mock.restore();
  }
});

test("QUALITY 9: no fallback available -> explicit FAIL", async () => {
  const mock = mockGenerateAndVision({ visionReplies: ["THROW", "THROW"] });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null },
    { data: { id: "u3" }, error: null },
    { data: null, error: null },
    { data: { id: "u4" }, error: null },
    { data: null, error: null }
  ]);
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg"
      // no buildFallback at all
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FAIL);
  } finally {
    mock.restore();
  }
});

test("QUALITY 10: a rejected candidate's asset path is tracked (quarantined by omission) — never referenced by the returned usable result", async () => {
  const mock = mockGenerateAndVision({
    visionReplies: ["TEXT: YES\nSUBJECT_MATCH: PASS\nREASON: bad", "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: clean"]
  });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null },
    { data: { id: "u3" }, error: null },
    { data: null, error: null },
    { data: { id: "u4" }, error: null },
    { data: null, error: null }
  ]);
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg"
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.PASS);
    assert.equal(result.rejectedAssetPaths.length, 1, "the first, rejected candidate's path must be tracked");
    assert.notEqual(result.rejectedAssetPaths[0], result.gen.path, "the rejected path must never be the same as the accepted, usable one");
  } finally {
    mock.restore();
  }
});

test("QUALITY 7: a genuine, non-retryable infrastructure failure (a storage/config error, e.g. an RLS denial) skips buildFallback and resolves to FAIL with the real error — never silently absorbed into a template", async () => {
  // Simulates generateImage's own "upload" stage failure (the image WAS
  // generated and billed, then storage itself rejected it) — the exact
  // real production incident this fail-closed default protects against
  // (see marketing-studio-storage-admin-policy-privilege.test.js for the
  // full end-to-end regression test through the real handler).
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async (url) => {
    if (/flux|black-forest-labs/i.test(String(url))) return { ok: true, json: async () => ({ success: true, result: { image: TINY_JPEG_BASE64 } }) };
    return { ok: true, json: async () => ({ success: true, result: { description: "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: ok" } }) };
  };
  const storage = createFakeSupabaseStorage({
    uploadResponses: [{ data: null, error: { message: "permission denied for table platform_admins", code: "42501" } }]
  });
  const client = createFakeSupabaseClient(
    [
      { data: { id: "u1" }, error: null }, // reserve image (attempt 0)
      { data: null, error: null } // fail image (upload denied)
    ],
    { storage }
  );
  let fallbackCalled = false;
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg",
      buildFallback: async () => {
        fallbackCalled = true;
        return { ok: true, kind: "deterministic", url: "https://fake.storage/fallback.jpg" };
      }
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FAIL);
    assert.match(result.error, /permission denied for table platform_admins/);
    assert.equal(fallbackCalled, false, "buildFallback must never even be called for a genuine infra failure — this is fail-closed, not a quiet degrade");
    assert.equal(result.attempts.length, 1, "an upload/config failure is never worth a second attempt at the same hard failure — stops immediately");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("QUALITY 7b: the SAME hard infrastructure failure, for a caller with its own deliberate always-fallback design (failClosedOnInfraError: false), still reaches its template fallback — preserves a pre-existing Tier A/Tier B contract", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async (url) => {
    if (/flux|black-forest-labs/i.test(String(url))) return { ok: true, json: async () => ({ success: true, result: { image: TINY_JPEG_BASE64 } }) };
    return { ok: true, json: async () => ({ success: true, result: { description: "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: ok" } }) };
  };
  const storage = createFakeSupabaseStorage({
    uploadResponses: [
      { data: null, error: { message: "permission denied for table platform_admins", code: "42501" } },
      { data: null, error: { message: "permission denied for table platform_admins", code: "42501" } }
    ]
  });
  const client = createFakeSupabaseClient(
    [
      { data: { id: "u1" }, error: null },
      { data: null, error: null },
      { data: { id: "u2" }, error: null },
      { data: null, error: null }
    ],
    { storage }
  );
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg",
      buildFallback: async () => ({ ok: true, kind: "template", url: null }),
      failClosedOnInfraError: false
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FALLBACK, "a caller that opted out of fail-closed infra handling keeps its own pre-existing 'always degrade gracefully' behavior");
    assert.equal(result.fallback.kind, "template");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Batch 6, Part E/F/G — Part P #12: no eligible Marketing image provider
// (an unconfigured environment, or a request no registered provider's
// capabilities/cost can satisfy) is treated exactly like generateImage's
// own pre-existing "config" stage failure — never a second failure mode
// a caller has to special-case, and it still reaches buildFallback (or
// FAILs honestly with none) the same way any other config-stage failure
// already does.
test("QUALITY 12 (PROVIDER): no eligible image provider configured is treated as the SAME genuine config-stage failure as generateImage's own — fails closed, never silently absorbed into a fallback", async () => {
  const savedAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const savedToken = process.env.CLOUDFLARE_AI_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_AI_API_TOKEN;
  try {
    const client = baseClient([
      { data: { id: "u1" }, error: null }, // reserve image (attempt 0)
      { data: null, error: null } // fail image (no eligible provider)
    ]);
    let fallbackCalled = false;
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg",
      buildFallback: async () => {
        fallbackCalled = true;
        return { ok: true, kind: "template", url: null };
      }
    });
    // Matches QUALITY 7's own "config"/"upload" stage contract exactly:
    // a genuine configuration problem (here, no eligible provider) must
    // never be silently absorbed into a fallback by default — it fails
    // closed so the real incident (missing credentials) stays visible.
    assert.equal(result.state, IMAGE_QUALITY_STATE.FAIL);
    assert.match(result.error, /not configured|no eligible/i);
    assert.equal(fallbackCalled, false, "buildFallback must never even be called for a genuine config failure — this is fail-closed, not a quiet degrade");
    assert.equal(result.attempts.length, 1, "a config-stage failure is never worth a second attempt");
    assert.equal(result.attempts[0].stage, "config");
  } finally {
    if (savedAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = savedAccountId;
    if (savedToken === undefined) delete process.env.CLOUDFLARE_AI_API_TOKEN;
    else process.env.CLOUDFLARE_AI_API_TOKEN = savedToken;
  }
});

test("QUALITY 12b (PROVIDER): a caller with its own deliberate always-fallback design (failClosedOnInfraError: false) still reaches its template fallback when no provider is eligible", async () => {
  const savedAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const savedToken = process.env.CLOUDFLARE_AI_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_AI_API_TOKEN;
  try {
    const client = baseClient([
      { data: { id: "u1" }, error: null },
      { data: null, error: null }
    ]);
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg",
      buildFallback: async () => ({ ok: true, kind: "template", url: null }),
      failClosedOnInfraError: false
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FALLBACK, "a caller that opted out of fail-closed infra handling keeps its own pre-existing 'always degrade gracefully' behavior even when no provider is eligible");
    assert.equal(result.fallback.kind, "template");
  } finally {
    if (savedAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = savedAccountId;
    if (savedToken === undefined) delete process.env.CLOUDFLARE_AI_API_TOKEN;
    else process.env.CLOUDFLARE_AI_API_TOKEN = savedToken;
  }
});

test("QUALITY 8: an ineligible fallback (ok:false, or nothing at all) is never treated as usable — resolves FAIL, never invents a substitute photo", async () => {
  const mock = mockGenerateAndVision({ visionReplies: ["THROW", "THROW"] });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null },
    { data: { id: "u3" }, error: null },
    { data: null, error: null },
    { data: { id: "u4" }, error: null },
    { data: null, error: null }
  ]);
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg",
      // An ineligible/unavailable fallback (no real photo/template exists
      // for this request) — explicitly ok:false, not a usable candidate.
      buildFallback: async () => ({ ok: false })
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FAIL);
    assert.equal(result.fallback, null, "an ineligible fallback must never be surfaced as if it were usable");
    assert.equal(result.gen, null, "no rejected/unsafe image may ever stand in for a missing fallback");
  } finally {
    mock.restore();
  }
});

test("QUALITY 8b: a buildFallback that throws degrades to FAIL exactly like one that returns nothing — never crashes the caller", async () => {
  const mock = mockGenerateAndVision({ visionReplies: ["THROW", "THROW"] });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null },
    { data: { id: "u3" }, error: null },
    { data: null, error: null },
    { data: { id: "u4" }, error: null },
    { data: null, error: null }
  ]);
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "a bright bouquet",
      filenameFor: () => "test.jpg",
      buildFallback: async () => {
        throw new Error("fallback lookup exploded");
      }
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FAIL);
  } finally {
    mock.restore();
  }
});

// QUALITY 11: route coverage — every scoped Marketing image-generation
// caller (Pure Photo Studio explicitly excluded per the Batch 2 spec)
// routes through this one authoritative gate, never generateImage()
// directly. A direct grep across the real, shipped source is the only
// way this claim is actually verifiable — a passing runner test proves
// nothing about a DIFFERENT file that bypassed it entirely.
test("QUALITY 11 (ROUTE COVERAGE): no scoped Marketing image caller calls generateImage() directly — only through runMarketingImageQuality", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const functionsDir = fileURLToPath(new URL("../netlify/functions/", import.meta.url));

  // Pure Photo Studio is explicitly OUT OF SCOPE for this batch (per the
  // approved spec) — it's one legitimate direct caller. Batch 6, Part E:
  // marketing-image-provider-cloudflare.js is the new, single legitimate
  // Marketing-scoped adapter that wraps generateImage() — every OTHER
  // Marketing caller (marketing-image-quality.js included, which now
  // routes through the provider registry instead) must still never call
  // it directly.
  const ALLOWED_DIRECT_CALLERS = new Set(["photo-studio-ai.js", "ai-image-engine.js", "marketing-image-quality.js", "marketing-image-provider-cloudflare.js"]);

  function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) out.push(...walk(full));
      else if (entry.endsWith(".js")) out.push(full);
    }
    return out;
  }

  const offenders = [];
  for (const file of walk(functionsDir)) {
    const base = path.basename(file);
    if (ALLOWED_DIRECT_CALLERS.has(base)) continue;
    const src = readFileSync(file, "utf8");
    // A real call site, not a comment/docstring mention — requires the
    // actual call syntax "generateImage(" preceded by an import of it
    // from ai-image-engine.js (never flag an unrelated same-named export).
    const importsIt = /import\s*\{[^}]*\bgenerateImage\b[^}]*\}\s*from\s*["'][^"']*ai-image-engine\.js["']/.test(src);
    if (importsIt && /[^a-zA-Z0-9_.]generateImage\s*\(/.test(src)) offenders.push(base);
  }
  assert.deepEqual(offenders, [], `scoped Marketing file(s) still call generateImage() directly instead of routing through runMarketingImageQuality: ${offenders.join(", ")}`);
});

// ---------------------------------------------------------------------------
// COST
// ---------------------------------------------------------------------------

test("COST 12: one image call + one vision call creates two separate usage rows", async () => {
  const mock = mockGenerateAndVision({ visionReplies: ["TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: ok"] });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null }
  ]);
  try {
    const result = await runMarketingImageQuality({ client, shopId: "shop-1", promptFor: () => "x", filenameFor: () => "f.jpg" });
    assert.equal(result.state, IMAGE_QUALITY_STATE.PASS);
    const inserts = usageInserts(client);
    assert.equal(inserts.length, 2, "one row for the image call, one for the vision call");
    assert.equal(inserts[0].payload.purpose, "image");
    assert.equal(inserts[1].payload.purpose, "vision");
  } finally {
    mock.restore();
  }
});

test("COST 13: a corrective retry creates its own separate attempt rows, distinguished by attempt_index", async () => {
  const mock = mockGenerateAndVision({
    visionReplies: ["TEXT: YES\nSUBJECT_MATCH: PASS\nREASON: bad", "TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: clean"]
  });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null },
    { data: { id: "u3" }, error: null },
    { data: null, error: null },
    { data: { id: "u4" }, error: null },
    { data: null, error: null }
  ]);
  try {
    await runMarketingImageQuality({ client, shopId: "shop-1", promptFor: () => "x", filenameFor: () => "f.jpg" });
    const inserts = usageInserts(client);
    assert.equal(inserts.length, 4, "2 attempts x (image + vision) = 4 rows");
    assert.equal(inserts[0].payload.attempt_index, 0);
    assert.equal(inserts[1].payload.attempt_index, 0);
    assert.equal(inserts[2].payload.attempt_index, 1);
    assert.equal(inserts[3].payload.attempt_index, 1);
  } finally {
    mock.restore();
  }
});

test("COST 15: a provider failure marks its own usage row failed, not silently estimated forever", async () => {
  const mock = mockGenerateAndVision({ imageOk: false });
  const client = baseClient([
    { data: { id: "u1" }, error: null }, // reserve image attempt 0
    { data: null, error: null }, // FAIL image (provider down)
    { data: { id: "u2" }, error: null }, // reserve image attempt 1
    { data: null, error: null } // FAIL image (still down)
  ]);
  try {
    const result = await runMarketingImageQuality({ client, shopId: "shop-1", promptFor: () => "x", filenameFor: () => "f.jpg" });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FAIL);
    const updates = usageUpdates(client);
    assert.ok(updates.length >= 2);
    for (const u of updates) assert.equal(u.payload.status, "failed");
  } finally {
    mock.restore();
  }
});

test("COST 16: a ledger reservation failure prevents the provider call from ever happening", async () => {
  const client = baseClient([{ data: null, error: { message: "insert failed" } }, { data: null, error: { message: "insert failed" } }]);
  let providerCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    providerCalled = true;
    return { ok: true, json: async () => ({ success: true, result: { image: TINY_JPEG_BASE64 } }) };
  };
  try {
    const result = await runMarketingImageQuality({ client, shopId: "shop-1", promptFor: () => "x", filenameFor: () => "f.jpg" });
    assert.equal(providerCalled, false, "the provider must never be called when the usage reservation itself failed");
    assert.equal(result.state, IMAGE_QUALITY_STATE.FAIL);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("COST 17: a fallback that makes no provider call creates no fake charge", async () => {
  const mock = mockGenerateAndVision({ imageOk: false });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null }
  ]);
  let fallbackCalled = false;
  try {
    const result = await runMarketingImageQuality({
      client,
      shopId: "shop-1",
      promptFor: () => "x",
      filenameFor: () => "f.jpg",
      buildFallback: async () => {
        fallbackCalled = true;
        return { ok: true, kind: "deterministic", url: "https://fake.storage/fallback.jpg" };
      }
    });
    assert.equal(result.state, IMAGE_QUALITY_STATE.FALLBACK);
    assert.equal(fallbackCalled, true);
    // No THIRD usage insert exists for the fallback itself — only the two
    // real, failed provider attempts (both image-generation calls, no
    // vision call ever reached since generation itself failed both times).
    const inserts = usageInserts(client);
    assert.equal(inserts.length, 2);
    assert.ok(inserts.every((i) => i.payload.purpose === "image"));
  } finally {
    mock.restore();
  }
});

test("COST 18: provider and model are recorded correctly on the usage row", async () => {
  const mock = mockGenerateAndVision({ visionReplies: ["TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: ok"] });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null }
  ]);
  try {
    await runMarketingImageQuality({ client, shopId: "shop-1", promptFor: () => "x", filenameFor: () => "f.jpg" });
    const inserts = usageInserts(client);
    assert.equal(inserts[0].payload.provider, "cloudflare");
  } finally {
    mock.restore();
  }
});

test("COST 20: estimated reconciliation is distinguishable from provider-confirmed cost", async () => {
  const mock = mockGenerateAndVision({ visionReplies: ["TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: ok"] });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null }
  ]);
  try {
    await runMarketingImageQuality({ client, shopId: "shop-1", promptFor: () => "x", filenameFor: () => "f.jpg" });
    const inserts = usageInserts(client);
    assert.equal(inserts[0].payload.cost_source, "estimated", "no actual provider cost is exposed by this provider — must stay clearly estimated, never silently upgraded");
  } finally {
    mock.restore();
  }
});

test("COST 21: shop A usage never affects shop B — reservations are scoped by shop_id", async () => {
  const mock = mockGenerateAndVision({ visionReplies: ["TEXT: NO\nSUBJECT_MATCH: PASS\nREASON: ok"] });
  const client = baseClient([
    { data: { id: "u1" }, error: null },
    { data: null, error: null },
    { data: { id: "u2" }, error: null },
    { data: null, error: null }
  ]);
  try {
    await runMarketingImageQuality({ client, shopId: "shop-A", promptFor: () => "x", filenameFor: () => "f.jpg" });
    const inserts = usageInserts(client);
    assert.ok(inserts.every((i) => i.payload.shop_id === "shop-A"));
  } finally {
    mock.restore();
  }
});
