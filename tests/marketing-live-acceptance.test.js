import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Batch 6, Part K: this harness has never been run against a real preview
// or a real provider (see the script's own docstring) — these tests prove
// its pure logic (report shape, bounded-run/no-auto-regenerate behavior,
// fail-closed target verification) entirely against a stubbed
// globalThis.fetch, never a real network call.

let savedFetch;
let savedEnv;
let tmpDir;

test.before(() => {
  savedFetch = globalThis.fetch;
  savedEnv = { ...process.env };
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketing-acceptance-test-"));
  process.env.MARKETING_ACCEPTANCE_OUTPUT_DIR = tmpDir;
  process.env.FLORISYN_ENV = "preview";
  process.env.SITE_URL = "https://deploy-preview-1--florisyn-marketing-staging.netlify.app";
  process.env.SOCIAL_PUBLISHING_ENABLED = "false";
  process.env.SCHEDULED_PUBLISHING_ENABLED = "false";
  delete process.env.SUPABASE_URL;
  delete process.env.PRODUCTION_SUPABASE_HOST;
});
test.after(() => {
  globalThis.fetch = savedFetch;
  process.env = { ...savedEnv };
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const { buildReport, rowIdentity, resultPath, verifyTargetIsSafe, runOnePrompt } = await import("../scripts/marketing-live-acceptance.mjs");

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("verifyTargetIsSafe: refuses when the target's own status endpoint reports unsafe", async () => {
  globalThis.fetch = async () => jsonResponse(412, { safeForMarketingPreview: false, violations: ["FLORISYN_ENV must be preview or staging"] });
  await assert.rejects(() => verifyTargetIsSafe("https://example.test"), /safe Marketing preview environment|violations/i);
});

test("verifyTargetIsSafe: refuses when the status endpoint is unreachable/errors", async () => {
  globalThis.fetch = async () => jsonResponse(500, {});
  await assert.rejects(() => verifyTargetIsSafe("https://example.test"), /Refusing to run/);
});

test("verifyTargetIsSafe: returns the real build stamp when the target genuinely reports safe", async () => {
  globalThis.fetch = async () => jsonResponse(200, { safeForMarketingPreview: true, violations: [], build: { commitSha: "abc123def456", commitShaShort: "abc123def456", environment: "preview" } });
  const build = await verifyTargetIsSafe("https://example.test");
  assert.equal(build.commitSha, "abc123def456");
});

test("buildReport: records exactly Part M's field list, with unexposed fields honestly null/noted rather than guessed", () => {
  const report = buildReport({
    promptId: "prompt-1",
    promptText: "Create today's Facebook post for Lilies in Bloom.",
    shopId: "shop-1",
    build: { commitSha: "abc123def456", commitShaShort: "abc123def456", environment: "preview" },
    verdict: "recorded",
    failureReason: null,
    contentItemId: "item-1",
    generateResponseRaw: { item: { id: "item-1", status: "draft" }, asset: { id: "asset-1", type: "image_post", url: "https://example.test/img.png" }, copy: { caption: "Fresh blooms today!" } },
    newUsageRows: [{ provider: "cloudflare", purpose: "image", estimated_cost_cents: 4, actual_cost_cents: 4, status: "actual", created_at: "2026-09-01T00:00:00.000Z", model: "flux-1-schnell", cost_source: "provider_reported" }]
  });
  assert.equal(report.commit_sha, "abc123def456");
  assert.equal(report.provider, "cloudflare");
  assert.equal(report.model, "flux-1-schnell");
  assert.equal(report.image_attempt_count, 1);
  assert.equal(report.estimated_cost_cents, 4);
  assert.equal(report.actual_cost_cents, 4);
  assert.equal(report.first_untouched_caption, "Fresh blooms today!");
  assert.equal(report.first_untouched_image_reference, "https://example.test/img.png");
  assert.equal(report.fallback_used, false);
  // Fields the real API surface genuinely does not expose must never be
  // fabricated as a specific value.
  assert.equal(report.vision_call_count, null);
  assert.match(report.quality_gate_verdict, /not exposed/);
});

test("buildReport: fallback_used reads true only when a real usage row's cost_source says so", () => {
  const report = buildReport({
    promptId: "prompt-1",
    promptText: "x",
    shopId: "shop-1",
    build: { commitSha: "abc", commitShaShort: "abc" },
    verdict: "recorded",
    newUsageRows: [{ provider: "cloudflare", purpose: "image", cost_source: "fallback", created_at: "t" }]
  });
  assert.equal(report.fallback_used, true);
});

test("buildReport: no usage rows at all is recorded as null (unknown), never false by default guess", () => {
  const report = buildReport({ promptId: "p", promptText: "x", shopId: "s", build: { commitSha: "a", commitShaShort: "a" }, verdict: "fail", failureReason: "boom", newUsageRows: [] });
  assert.equal(report.fallback_used, null);
  assert.equal(report.pass_fail, "fail");
  assert.equal(report.failure_reason, "boom");
});

test("rowIdentity: two rows with the same created_at/provider/purpose/cost/status are treated as the same row for a before/after diff", () => {
  const a = { created_at: "t1", provider: "cloudflare", purpose: "image", estimated_cost_cents: 4, actual_cost_cents: 4, status: "actual" };
  const b = { ...a };
  const c = { ...a, actual_cost_cents: 5 };
  assert.equal(rowIdentity(a), rowIdentity(b));
  assert.notEqual(rowIdentity(a), rowIdentity(c));
});

test("runOnePrompt: exactly one bounded run per prompt — a second call for the same prompt+commit returns the FIRST recorded result untouched, never re-runs", async () => {
  let createCalls = 0;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("marketing-preview-status")) {
      return jsonResponse(200, { safeForMarketingPreview: true, violations: [], build: { commitSha: "sha-bound-test", commitShaShort: "sha-bound", environment: "preview" } });
    }
    if (u.includes("action=usage_summary")) return jsonResponse(200, { items: [] });
    if (u.includes("action=create_content_item")) {
      createCalls += 1;
      return jsonResponse(200, { item: { id: `item-${createCalls}` } });
    }
    if (u.includes("action=generate_content")) {
      return jsonResponse(200, { item: { id: "item-1", status: "draft" }, asset: { id: "asset-1", type: "social_copy" }, copy: { caption: `run number ${createCalls}` } });
    }
    throw new Error(`unexpected fetch: ${u}`);
  };

  const args = { baseUrl: "https://example.test", authToken: "tok", promptId: "bound-test-prompt", promptText: "Create a test post.", shopId: "shop-1" };
  const first = await runOnePrompt(args);
  assert.equal(createCalls, 1);
  assert.equal(first.generate_response_raw.copy.caption, "run number 1");

  const second = await runOnePrompt(args);
  // The real network call must never have been made a second time for
  // create_content_item — the on-disk first result is returned instead.
  assert.equal(createCalls, 1, "a second run for the same prompt+commit must not call create_content_item again");
  assert.deepEqual(second, first);

  const filePath = resultPath("bound-test-prompt", "sha-bound");
  assert.ok(fs.existsSync(filePath), "the first result must be persisted to disk");
});

test("runOnePrompt: refuses to run at all when the target does not report itself as safe", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes("marketing-preview-status")) {
      return jsonResponse(412, { safeForMarketingPreview: false, violations: ["public site URL resolves to www.florisyn.com"] });
    }
    throw new Error("must never reach create_content_item when the target is unsafe");
  };
  await assert.rejects(
    () => runOnePrompt({ baseUrl: "https://example.test", authToken: "tok", promptId: "unsafe-test", promptText: "x", shopId: "shop-1" }),
    /florisyn\.com|unsafe/i
  );
});
