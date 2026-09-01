import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Priority 2 ("finish everything that can safely be completed without
// Ashley" pass): persisted per-shop Marketing Studio budget controls —
// admin action + usage_summary surfacing.

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

test("set_marketing_budget_cap: requires super_admin", async () => {
  const client = createFakeSupabaseClient([{ data: { user_id: "u1", role: "support", active: true }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("set_marketing_budget_cap", { shop_id: "shop-1", monthly_budget_cents: 5000 }));
  assert.equal(res.statusCode, 403);
});

test("set_marketing_budget_cap: persists a real cap, scoped to the requesting shop, with an audit trail", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { id: "shop-1", marketing_monthly_budget_cents: 5000 }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("set_marketing_budget_cap", { shop_id: "shop-1", monthly_budget_cents: 5000 }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.monthly_budget_cap_cents, 5000);

  const updateCall = client.calls.find((c) => c.table === "shops" && c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall.payload.marketing_monthly_budget_cents, 5000);
  const shopEq = updateCall.ops.find((op) => op[0] === "eq" && op[1][0] === "id");
  assert.equal(shopEq[1][1], "shop-1");

  const auditCall = client.calls.find((c) => c.table === "platform_admin_audit");
  assert.ok(auditCall, "must leave a real audit trail, same as every other admin mutation");
});

test("set_marketing_budget_cap: null clears the cap back to unlimited", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { id: "shop-1", marketing_monthly_budget_cents: null }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("set_marketing_budget_cap", { shop_id: "shop-1", monthly_budget_cents: null }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.monthly_budget_cap_cents, null);
});

test("set_marketing_budget_cap: rejects a negative or non-numeric cap", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("set_marketing_budget_cap", { shop_id: "shop-1", monthly_budget_cents: -100 }));
  assert.equal(res.statusCode, 400);
});

test("set_marketing_budget_cap: before the migration is applied, reports a clear 'apply this migration first' message, not a raw DB error", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: null, error: { code: "42703", message: 'column "marketing_monthly_budget_cents" of relation "shops" does not exist' } }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("set_marketing_budget_cap", { shop_id: "shop-1", monthly_budget_cents: 5000 }));
  assert.equal(res.statusCode, 503);
  assert.match(JSON.parse(res.body).error, /marketing budget column isn't set up yet/i);
});

test("usage_summary: surfaces the shop's monthly cap, committed spend, and remaining budget when a cap is configured", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: [], error: null }, // usage rows
    { data: { marketing_monthly_budget_cents: 1000 }, error: null }, // shop cap
    { data: [{ estimated_cost_cents: 400 }], error: null } // this month's committed spend
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("usage_summary", { shop_id: "shop-1" }, { method: "GET" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.monthly_budget_cap_cents, 1000);
  assert.equal(body.monthly_committed_spend_cents, 400);
  assert.equal(body.monthly_remaining_cents, 600);
});

test("usage_summary: an unconfigured shop reports null budget fields, never a fabricated zero or guessed cap", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: [], error: null }, { data: { marketing_monthly_budget_cents: null }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("usage_summary", { shop_id: "shop-1" }, { method: "GET" }));
  const body = JSON.parse(res.body);
  assert.equal(body.monthly_budget_cap_cents, null);
  assert.equal(body.monthly_committed_spend_cents, null);
  assert.equal(body.monthly_remaining_cents, null);
});

// Batch 6, Part K/G: the acceptance harness reads real provider metadata
// (model/trace_id/operation_id/provider_request_id/cost_source) back out
// of usage_summary — this is the one place that ever happens through the
// API. Proves the row actually reaches the response body unmodified.
test("usage_summary: Batch 2's real provider metadata columns (model, trace_id, operation_id, provider_request_id, cost_source) pass through to each row", async () => {
  const usageRow = {
    provider: "cloudflare",
    purpose: "image",
    estimated_cost_cents: 4,
    actual_cost_cents: 4,
    status: "actual",
    created_at: "2026-09-01T00:00:00.000Z",
    model: "flux-1-schnell",
    operation: "image_generation",
    trace_id: "trace-abc",
    operation_id: "op-123",
    attempt_index: 1,
    provider_request_id: "req-xyz",
    cost_source: "provider_reported"
  };
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: [usageRow], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("usage_summary", { shop_id: "shop-1" }, { method: "GET" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].model, "flux-1-schnell");
  assert.equal(body.items[0].trace_id, "trace-abc");
  assert.equal(body.items[0].operation_id, "op-123");
  assert.equal(body.items[0].provider_request_id, "req-xyz");
  assert.equal(body.items[0].cost_source, "provider_reported");
});

// The fail-open half of the same change: an environment where the Batch 2
// ledger-extension migration hasn't applied yet must not break
// usage_summary at all — same missingRelation() fallback convention used
// everywhere else in this file.
test("usage_summary: falls back to the original narrower column set (never breaks) when the wide provider-metadata columns aren't migrated yet", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: null, error: { code: "42703", message: 'column marketing_generation_usage.model does not exist' } }, // wide select fails
    { data: [{ provider: "cloudflare", purpose: "image", estimated_cost_cents: 4, actual_cost_cents: 4, status: "actual", created_at: "2026-09-01T00:00:00.000Z" }], error: null }, // narrow retry succeeds
    { data: { marketing_monthly_budget_cents: null }, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("usage_summary", { shop_id: "shop-1" }, { method: "GET" }));
  assert.equal(res.statusCode, 200, "a missing-column error on the wide select must never surface as a failure");
  const body = JSON.parse(res.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].provider, "cloudflare");
});
