import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// Revoked-media hardening pass — Section 9 (security): direct-ID bypass
// denial, publishing denial, and revoke_clone_consent's Case D cascade
// (an already-completed asset demoted to quarantined in place). These are
// the marketing-studio.js-level gates layered on top of
// digital-twin-finalization.js's in-flight quarantine path (covered by
// tests/digital-twin-quarantine.test.js).

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}

function baseDeps(client) {
  return {
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client
  };
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
});
test.after(() => {
  process.env = { ...savedEnv };
});

function event(action, body, { method = "POST", qs = {} } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { action, ...qs },
    headers: {},
    body: JSON.stringify({ action, ...body })
  };
}

// ── revoke_clone_consent: Case D cascade ────────────────────────────────

test("revoke_clone_consent: quarantines completed assets tied to this consent and cancels their not-yet-published variants", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "consent-1", revoked_at: "2026-08-24T00:00:00.000Z" }, error: null }, // consent revoke update
    { data: null, error: null }, // avatar profile suspend
    { data: null, error: null }, // voice profile suspend
    { data: [{ id: "asset-1" }], error: null }, // ai_generated_assets quarantine cascade
    { data: null, error: null }, // platform_variants cancel cascade
    { data: null, error: null } // writeCommandAudit insert
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("revoke_clone_consent", { shop_id: "shop-1", consent_id: "consent-1" }));
  assert.equal(res.statusCode, 200);

  const assetUpdate = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "update"));
  assert.ok(assetUpdate, "must attempt to quarantine matching completed assets");
  assert.equal(assetUpdate.payload.status, "quarantined");
  assert.ok(assetUpdate.payload.quarantine_reason);
  assert.ok(assetUpdate.payload.quarantined_at);
  assert.ok(assetUpdate.ops.some((op) => op[0] === "eq" && op[1][0] === "status" && op[1][1] === "completed"), "only demotes rows that were actually completed");

  const variantUpdate = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
  assert.ok(variantUpdate, "must cancel any not-yet-published variant built from the quarantined asset");
  assert.equal(variantUpdate.payload.status, "canceled");
  assert.ok(variantUpdate.ops.some((op) => op[0] === "neq" && op[1][0] === "status" && op[1][1] === "published"), "never cancels an already-published variant");
});

test("revoke_clone_consent: no completed assets tied to this consent — cascade is a clean no-op, revocation itself still succeeds", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "consent-1", revoked_at: "2026-08-24T00:00:00.000Z" }, error: null },
    { data: null, error: null },
    { data: null, error: null },
    { data: [], error: null }, // nothing to quarantine
    { data: null, error: null } // writeCommandAudit insert
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("revoke_clone_consent", { shop_id: "shop-1", consent_id: "consent-1" }));
  assert.equal(res.statusCode, 200);
  const variantUpdate = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
  assert.equal(variantUpdate, undefined, "never touches variants when nothing was quarantined");
});

test("revoke_clone_consent: a quarantine-cascade failure never unwinds the consent revocation that already happened", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "consent-1", revoked_at: "2026-08-24T00:00:00.000Z" }, error: null },
    { data: null, error: null },
    { data: null, error: null },
    { data: null, error: { message: "db hiccup" } }, // cascade query itself fails
    { data: null, error: null } // writeCommandAudit insert still runs
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("revoke_clone_consent", { shop_id: "shop-1", consent_id: "consent-1" }));
  assert.equal(res.statusCode, 200, "revocation is real and already committed — a best-effort cascade failure must not turn it into an error response");
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
});

// ── run_publishing_queue: quarantined-asset publish gate ───────────────

test("run_publishing_queue: a variant whose source asset was quarantined is rejected BEFORE the social provider is ever called", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: [{ id: "job-1", platform_variant_id: "variant-1", status: "queued", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }], error: null }, // due jobs
    { data: { id: "variant-1", platform: "tiktok", caption: "hi", scheduled_at: null, ai_disclosure_required: false, disclosure_applied: false, asset_id: "asset-1" }, error: null }, // variant lookup
    { data: { id: "asset-1", status: "quarantined" }, error: null }, // asset status check
    { data: null, error: null } // publishing_jobs update (failure path)
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("run_publishing_queue", { shop_id: "shop-1" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.results[0].outcome, "failed");
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.last_error_code, "fatal", "a quarantined source asset is never worth retrying");
  assert.match(jobUpdate.payload.last_error, /quarantined/i);
});

test("run_publishing_queue: a variant whose source asset is a normal completed asset proceeds exactly as before this pass", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: [{ id: "job-1", platform_variant_id: "variant-1", status: "queued", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }], error: null },
    { data: { id: "variant-1", platform: "tiktok", caption: "hi", scheduled_at: null, ai_disclosure_required: false, disclosure_applied: false, asset_id: "asset-1" }, error: null },
    { data: { id: "asset-1", status: "completed" }, error: null }, // asset status check — not quarantined
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("run_publishing_queue", { shop_id: "shop-1" }));
  const body = JSON.parse(res.body);
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.last_error_code, "not_live", "must reach the pre-existing not-live path, not the quarantine gate");
  assert.equal(body.results[0].outcome, "failed");
});

test("run_publishing_queue: a variant with no linked asset_id at all is unaffected — the gate never fires on nothing to check", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: [{ id: "job-1", platform_variant_id: "variant-1", status: "queued", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }], error: null },
    { data: { id: "variant-1", platform: "facebook", caption: "hi", scheduled_at: null, asset_id: null }, error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("run_publishing_queue", { shop_id: "shop-1" }));
  const body = JSON.parse(res.body);
  const jobUpdate = client.calls.find((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update"));
  assert.equal(jobUpdate.payload.last_error_code, "not_live");
  assert.equal(body.results[0].outcome, "failed");
  assert.equal(client.calls.filter((c) => c.table === "ai_generated_assets").length, 0, "never queries ai_generated_assets when the variant has no asset_id");
});

// ── clone_job_status: quarantined output never carries a resultUrl ─────

test("clone_job_status: a webhook-cached quarantined job reports quarantined:true and suppresses resultUrl", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    {
      data: {
        id: "job-1",
        shop_id: "shop-1",
        status: "completed",
        result_url: "https://cdn.heygen.com/x.mp4",
        error_message: null,
        disposition: "quarantined"
      },
      error: null
    } // getCloneVideoJob
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler({
    httpMethod: "GET",
    queryStringParameters: { action: "clone_job_status", shop_id: "shop-1", job_id: "vid-1" },
    headers: {}
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.quarantined, true);
  assert.equal(body.resultUrl, null, "a quarantined job never hands back a usable media URL through this poll response");
  assert.equal(body.source, "webhook");
});

test("clone_job_status: a webhook-cached NORMAL completed job is unaffected — resultUrl still comes through", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    {
      data: {
        id: "job-1",
        shop_id: "shop-1",
        status: "completed",
        result_url: "https://cdn.heygen.com/x.mp4",
        error_message: null,
        disposition: "normal"
      },
      error: null
    }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler({
    httpMethod: "GET",
    queryStringParameters: { action: "clone_job_status", shop_id: "shop-1", job_id: "vid-1" },
    headers: {}
  });
  const body = JSON.parse(res.body);
  assert.equal(body.quarantined, false);
  assert.equal(body.resultUrl, "https://cdn.heygen.com/x.mp4");
});
