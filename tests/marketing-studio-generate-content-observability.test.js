import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Phase 2 rebuild, priorities 6+7 (unified fact-safety tagging +
// observability/tracing): one real trace ID threading generate_content's
// actual pipeline stages through structured console logs — GROUND -> WRITE
// -> FACT CHECK -> PERSIST. The fact-safety "tag" is delivered as part of
// this same tracing (which real detectors ran and what they decided),
// deliberately NOT as a second, duplicate detection engine — this repo's
// existing detectors (factsPreserved, detectPermanentClosureMismatch,
// detectInventedOperationalContent, etc.) are still the only place a
// fact-safety decision is actually made.

function floristDeps(client) {
  return { florist: { client, user: { id: "ashley-user-id" }, shopId: "shop-ashley", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}

/** Captures every console.log/warn/error call made during fn(), parses
 * each as JSON (structuredLog's own wire format), and returns only the
 * ones this feature actually emits (message starting with
 * "marketing_generate_content_") — ignoring any other logging elsewhere
 * in the handler. */
async function captureTraceLogs(fn) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  const capture = (line) => {
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.message === "string" && parsed.message.startsWith("marketing_generate_content_")) lines.push(parsed);
    } catch {
      // Not a structuredLog JSON line — ignore.
    }
  };
  console.log = (line) => capture(line);
  console.warn = (line) => capture(line);
  console.error = (line) => capture(line);
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

test("generate_content (real dispatch, deterministic path): emits a real trace — start, grounded, fact_safety(deterministic:true), complete — all sharing ONE traceId", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "item-1", content_type: "text_post", title: "t", brief: "Lilies in Bloom is closing at 2:30 today. Customers can call 606-506-4039 to place an order.", status: "idea" }, error: null },
    { data: [{ id: "variant-1", platform: "facebook" }], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: null, error: null }, // -> generating
    { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null }, // shopRow
    { data: null, error: null }, // loadBrandBrain
    { data: null, error: null }, // loadStyleMemory
    { data: [], error: null }, // loadGroundedInventory
    { data: [], error: null }, // audience: customers
    { data: [], error: null }, // audience: orders
    { data: [], error: null }, // recent-content shortlist
    { data: null, error: null }, // recordUsage("copy")
    { data: { id: "copy-asset-1" }, error: null }, // persistGeneratedAsset
    { data: null, error: null }, // variant update
    { data: { id: "item-1", status: "draft" }, error: null } // final content_items update
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));
  const { result: res, lines } = await captureTraceLogs(() => handler(event("generate_content", { content_item_id: "item-1" })));
  assert.equal(res.statusCode, 200, `expected the deterministic path to succeed: ${res.body}`);

  const byMessage = Object.fromEntries(lines.map((l) => [l.message, l]));
  assert.ok(byMessage.marketing_generate_content_start, "a start event must be logged");
  assert.ok(byMessage.marketing_generate_content_grounded, "a grounded event must be logged");
  assert.ok(byMessage.marketing_generate_content_fact_safety, "a fact_safety event must be logged");
  assert.ok(byMessage.marketing_generate_content_complete, "a complete event must be logged");

  // One real trace, not four disconnected log lines.
  const traceId = byMessage.marketing_generate_content_start.traceId;
  assert.ok(traceId, "the start event must carry a real traceId");
  for (const msg of ["marketing_generate_content_grounded", "marketing_generate_content_fact_safety", "marketing_generate_content_complete"]) {
    assert.equal(byMessage[msg].traceId, traceId, `${msg} must share the same traceId as the start event`);
  }

  // The unified fact-safety tag: the deterministic path ran, so there is
  // nothing for the reactive AI-output detectors to check — recorded
  // honestly as deterministic:true, not omitted.
  assert.equal(byMessage.marketing_generate_content_fact_safety.deterministic, true);

  // Never logs the shop's real content — only shape (ids, booleans,
  // enum-ish strings). The real caption/phone/shop name must never appear
  // in any traced line.
  const allLogText = JSON.stringify(lines);
  assert.doesNotMatch(allLogText, /606-506-4039/);
  assert.doesNotMatch(allLogText, /Lilies in Bloom/);
  assert.doesNotMatch(allLogText, /closing at 2:30/);
});

test("generate_content (real dispatch): the fact_safety tag on the AI-copy path honestly records deterministic:false and each detector's real outcome", async () => {
  const mock = (() => {
    const originalFetch = globalThis.fetch;
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
    process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
    globalThis.fetch = async (_url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if ("image" in body) return { ok: true, json: async () => ({ success: true, result: { description: "TEXT: NO\nSUBJECT_MATCH: PASS" } }) };
      return {
        ok: true,
        json: async () => ({
          success: true,
          result: {
            response: JSON.stringify({
              platform: "facebook",
              headline: "Fresh Roses Just Arrived!",
              body: "We've got fresh roses ready for their forever vase.",
              cta: "Shop now",
              visual_brief: "A bright bouquet on a marble counter.",
              hashtags: [],
              asset_requirements: [],
              brand_traits_used: [],
              visual_traits_used: []
            })
          }
        })
      };
    };
    return {
      restore: () => {
        globalThis.fetch = originalFetch;
      }
    };
  })();
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "I have 40 roses I need to sell — a bright, romantic bouquet post for Facebook", status: "idea" }, error: null },
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: null, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null }, // recent-content shortlist
      { data: null, error: null }, // recordUsage("copy")
      { data: { id: "copy-asset-1" }, error: null },
      { data: null, error: null },
      { data: { id: "item-1", status: "draft" }, error: null }
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const { result: res, lines } = await captureTraceLogs(() => handler(event("generate_content", { content_item_id: "item-1" })));
    assert.equal(res.statusCode, 200, `expected the ordinary creative post to succeed: ${res.body}`);
    const factSafety = lines.find((l) => l.message === "marketing_generate_content_fact_safety");
    assert.ok(factSafety, "a fact_safety event must be logged on the AI-copy path too");
    assert.equal(factSafety.deterministic, false);
    // Batch 1 rebuild: the log now names the shared evaluateMarketingOutput()
    // evaluator's own decision/checksRun/reasonCount rather than two
    // separately-recomputed booleans — an ordinary, clean creative post
    // must read as "pass" (or "repair" if only a harmless deterministic
    // fix applied), never rescued, with no reasons requiring a hard gate.
    assert.ok(["pass", "repair"].includes(factSafety.decision), `an ordinary creative post must never require a hard-gate rescue: got decision "${factSafety.decision}"`);
    assert.equal(factSafety.reasonCount, 0, "an ordinary creative post must have zero unrepairable reasons");
    assert.ok(Array.isArray(factSafety.checksRun) && factSafety.checksRun.length > 0, "the real checks that ran must be named for observability");
    assert.equal(factSafety.rescued, false, "a genuinely clean AI copy must never be reported as rescued");
  } finally {
    mock.restore();
  }
});
