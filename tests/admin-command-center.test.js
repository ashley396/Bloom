import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeFeatureFlags,
  validateAnnouncementPayload,
  systemHealthSnapshot,
  summarizeClientErrors,
  buildMonthlySeries,
  auditRecordFromRow,
  sanitizeSubscriptionForAdmin,
  DEFAULT_FEATURE_FLAGS
} from "../netlify/functions/_shared/command-center.js";
import { createAdminCommandCenterHandler } from "../netlify/functions/admin-command-center.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";
import fs from "node:fs";

const adminHtml = () => fs.readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const adminJs = () => fs.readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");

test("mergeFeatureFlags applies defaults for unknown keys", () => {
  const flags = mergeFeatureFlags({ marketplace: false });
  assert.equal(flags.marketplace, false);
  assert.equal(flags.ai, DEFAULT_FEATURE_FLAGS.ai);
});

test("validateAnnouncementPayload requires title and body", () => {
  const invalid = validateAnnouncementPayload({ title: "", body: "" });
  assert.equal(invalid.valid, false);
  const valid = validateAnnouncementPayload({ title: "Maintenance", body: "Tonight 10pm CT", audience: "florists", kind: "maintenance" });
  assert.equal(valid.valid, true);
});

test("sanitizeSubscriptionForAdmin omits stripe secrets", () => {
  const sanitized = sanitizeSubscriptionForAdmin({
    shop_id: "s1",
    plan_code: "pro",
    status: "active",
    stripe_customer_id: "cus_123",
    stripe_secret_key: "sk_live_should_not_appear"
  });
  assert.equal(sanitized.stripe_customer_id, "cus_123");
  assert.equal(sanitized.stripe_secret_key, undefined);
});

test("systemHealthSnapshot flags missing env vars", () => {
  const health = systemHealthSnapshot({});
  assert.equal(health.environment_valid, false);
  assert.ok(health.missing_env.length > 0);
});

test("systemHealthSnapshot no longer claims health for a queue that doesn't exist", () => {
  const health = systemHealthSnapshot({});
  assert.equal("queue" in health, false);
});

test("summarizeClientErrors groups real client_error audit rows by type and page", () => {
  const summary = summarizeClientErrors([
    { created_at: "2026-08-16T12:00:00Z", shop_id: "shop-a", metadata: { type: "api", path: "/ordersPage", message: "Request failed (500)", status: 500 } },
    { created_at: "2026-08-16T11:59:00Z", shop_id: "shop-a", metadata: { type: "api", path: "/ordersPage", message: "Request failed (500)", status: 500 } },
    { created_at: "2026-08-16T11:00:00Z", shop_id: "shop-b", metadata: { type: "uncaught", path: "/inventoryPage", message: "x is not a function" } },
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.shops_affected, 2);
  assert.equal(summary.by_type.api, 2);
  assert.equal(summary.by_type.uncaught, 1);
  assert.deepEqual(summary.top_paths[0], { path: "/ordersPage", count: 2 });
  assert.equal(summary.most_recent_at, "2026-08-16T12:00:00Z");
  assert.equal(summary.recent.length, 3);
});

test("summarizeClientErrors is a clean empty state, not an error, when nothing went wrong", () => {
  const summary = summarizeClientErrors([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.shops_affected, 0);
  assert.equal(summary.most_recent_at, null);
  assert.deepEqual(summary.top_paths, []);
});

test("system-health action surfaces real client_error audit rows, not a hardcoded empty array", async () => {
  const client = createFakeSupabaseClient([
    { data: { user_id: "u1", role: "super_admin", active: true }, error: null }, // platform_admins lookup
    {
      data: [
        { created_at: "2026-08-16T12:00:00Z", shop_id: "shop-a", metadata: { type: "api", path: "/paymentsPage", message: "Payment Hub could not load.", status: 503 } },
      ],
      error: null,
    }, // audit_events select
  ]);
  const handler = createAdminCommandCenterHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client,
  });
  const res = await handler({ httpMethod: "GET", queryStringParameters: { action: "system-health" }, headers: {} });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.recent_errors.total, 1);
  assert.equal(body.recent_errors.recent[0].path, "/paymentsPage");
  assert.equal("queue" in body.health, false);

  const auditCall = client.calls.find((c) => c.table === "audit_events");
  assert.ok(auditCall, "expected a real audit_events query, not a hardcoded response");
  const eqOp = auditCall.ops.find(([name]) => name === "eq");
  assert.deepEqual(eqOp[1], ["event_type", "client_error"]);
});

function withEnv(vars, fn) {
  const prior = {};
  for (const [key, value] of Object.entries(vars)) {
    prior[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("support-request-fix: with no webhook configured, the request is recorded but nothing is actually sent", () =>
  withEnv({ CLAUDE_CODE_FIX_WEBHOOK_URL: undefined, CLAUDE_CODE_FIX_WEBHOOK_TOKEN: undefined }, async () => {
    const ticket = {
      id: "ticket-1",
      item_type: "bug_report",
      subject: "Payment Center is blank",
      body: "Nothing loads when I click Payment Center.",
      shop_id: null,
      status: "open",
      notes: [{ type: "note", text: "existing note", at: "2026-08-15T00:00:00Z" }],
    };
    const client = createFakeSupabaseClient([
      { data: { user_id: "u1", role: "super_admin", active: true }, error: null }, // platform_admins
      { data: ticket, error: null }, // ticket load
      { data: { ...ticket, status: "assigned" }, error: null }, // update
    ]);
    const handler = createAdminCommandCenterHandler({
      authenticate: async () => ({ user: { id: "u1" } }),
      createServerClient: () => client,
    });
    const res = await handler({
      httpMethod: "POST",
      queryStringParameters: {},
      headers: {},
      body: JSON.stringify({ action: "support-request-fix", id: "ticket-1" }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.delivery, "not_configured");
    assert.match(body.message, /No CLAUDE_CODE_FIX_WEBHOOK_URL/);

    const updateCall = client.calls.find((c) => c.table === "platform_support_items" && c.ops.some(([op]) => op === "update"));
    assert.ok(updateCall, "expected the ticket to be updated with a fix_request note");
    // Existing note history must be preserved, not clobbered.
    assert.equal(updateCall.payload.notes.length, 2);
    assert.equal(updateCall.payload.notes[0].text, "existing note");
    assert.equal(updateCall.payload.notes[1].type, "fix_request");
    assert.equal(updateCall.payload.notes[1].delivery, "not_configured");
    assert.equal(updateCall.payload.status, "assigned", "an open ticket moves to assigned once a fix is requested");
  }));

test("support-request-fix: with a webhook configured, posts the ticket + recent shop errors to it", () =>
  withEnv({ CLAUDE_CODE_FIX_WEBHOOK_URL: "https://example.invalid/fix-hook", CLAUDE_CODE_FIX_WEBHOOK_TOKEN: "secret-token" }, async () => {
    const ticket = {
      id: "ticket-2",
      item_type: "bug_report",
      subject: "Orders board is broken",
      body: "Orders never load.",
      shop_id: "shop-a",
      status: "open",
      notes: [],
    };
    const client = createFakeSupabaseClient([
      { data: { user_id: "u1", role: "super_admin", active: true }, error: null }, // platform_admins
      { data: ticket, error: null }, // ticket load
      {
        data: [{ created_at: "2026-08-16T00:00:00Z", shop_id: "shop-a", metadata: { type: "api", path: "/ordersPage", message: "Request failed", status: 500 } }],
        error: null,
      }, // recent shop errors
      { data: { ...ticket, status: "assigned" }, error: null }, // update
    ]);

    let fetchCall = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      fetchCall = { url, opts };
      return { ok: true };
    };

    try {
      const handler = createAdminCommandCenterHandler({
        authenticate: async () => ({ user: { id: "u1" } }),
        createServerClient: () => client,
      });
      const res = await handler({
        httpMethod: "POST",
        queryStringParameters: {},
        headers: {},
        body: JSON.stringify({ action: "support-request-fix", id: "ticket-2" }),
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.delivery, "delivered");

      assert.ok(fetchCall, "expected the webhook to be called");
      assert.equal(fetchCall.url, "https://example.invalid/fix-hook");
      assert.equal(fetchCall.opts.headers.Authorization, "Bearer secret-token");
      const sent = JSON.parse(fetchCall.opts.body);
      assert.equal(sent.ticket_id, "ticket-2");
      assert.equal(sent.recent_shop_errors.total, 1);
      assert.match(sent.policy_doc, /FLORISYN_AI_AGENT_AUTONOMY_POLICY\.md/);
      assert.match(sent.policy_summary, /Tier 1 only/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }));

test("support-request-fix: an unknown ticket id returns 404, not a crash", async () => {
  const client = createFakeSupabaseClient([
    { data: { user_id: "u1", role: "super_admin", active: true }, error: null },
    { data: null, error: null },
  ]);
  const handler = createAdminCommandCenterHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client,
  });
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: {},
    headers: {},
    body: JSON.stringify({ action: "support-request-fix", id: "missing-ticket" }),
  });
  assert.equal(res.statusCode, 404);
});

test("bud-queue-list: surfaces queued fix requests so 'delivered' isn't just a trust-me status", async () => {
  const client = createFakeSupabaseClient([
    { data: { user_id: "u1", role: "super_admin", active: true }, error: null }, // platform_admins
    { data: [{ id: "fix_1", subject: "Delete button broken", status: "queued" }], error: null }, // list
  ]);
  const handler = createAdminCommandCenterHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client,
  });
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: {},
    headers: {},
    body: JSON.stringify({ action: "bud-queue-list" }),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].id, "fix_1");
});

test("bud-queue-update: rejects a status outside the known set", async () => {
  const client = createFakeSupabaseClient([
    { data: { user_id: "u1", role: "super_admin", active: true }, error: null },
  ]);
  const handler = createAdminCommandCenterHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client,
  });
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: {},
    headers: {},
    body: JSON.stringify({ action: "bud-queue-update", id: "fix_1", status: "not_a_real_status" }),
  });
  assert.equal(res.statusCode, 400);
});

test("bud-queue-update: moves a request's status and records an audit event", async () => {
  const client = createFakeSupabaseClient([
    { data: { user_id: "u1", role: "super_admin", active: true }, error: null },
    { data: { id: "fix_1", status: "investigating" }, error: null }, // update
  ]);
  const handler = createAdminCommandCenterHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client,
  });
  const res = await handler({
    httpMethod: "POST",
    queryStringParameters: {},
    headers: {},
    body: JSON.stringify({ action: "bud-queue-update", id: "fix_1", status: "investigating" }),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.item.status, "investigating");
  const updateCall = client.calls.find((c) => c.table === "platform_agent_fix_requests" && c.ops.some(([op]) => op === "update"));
  assert.ok(updateCall, "expected an update against platform_agent_fix_requests");
  assert.equal(updateCall.payload.status, "investigating");
});

test("buildMonthlySeries aggregates rows by month", () => {
  const series = buildMonthlySeries([{ created_at: new Date().toISOString() }], { months: 3 });
  assert.equal(series.length, 3);
  assert.equal(series[2].value, 1);
});

test("auditRecordFromRow exposes command center audit fields", () => {
  const row = auditRecordFromRow({
    id: 1,
    created_at: "2026-07-28T12:00:00.000Z",
    admin_user_id: "admin-1",
    shop_id: "shop-1",
    action: "suspend_user",
    details: { target_type: "shop", target_id: "shop-1", result: "success", ip_placeholder: "127.0.0.1" }
  });
  assert.equal(row.action, "suspend_user");
  assert.equal(row.target_type, "shop");
  assert.equal(row.ip_placeholder, "127.0.0.1");
});

test("announcement audience validation accepts florist targeting", () => {
  const valid = validateAnnouncementPayload({
    title: "Holiday hours",
    body: "Support is limited on July 4.",
    audience: "florists",
    kind: "holiday"
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.audience, "florists");
});

test("admin dashboard degrades to 200 (never 500s) when backend queries fail", async () => {
  const activeAdmin = { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
  function adminQuery() {
    const q = {
      select() { return q; },
      eq() { return q; },
      maybeSingle() { return Promise.resolve(activeAdmin); },
      then(res, rej) { return Promise.resolve(activeAdmin).then(res, rej); }
    };
    return q;
  }
  function failingQuery() {
    const fail = () => Promise.reject(new Error("simulated db outage"));
    const q = {
      select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; },
      limit() { return q; }, gte() { return q; }, ilike() { return q; },
      maybeSingle() { return fail(); },
      then(res, rej) { return fail().then(res, rej); }
    };
    return q;
  }
  const client = { from(table) { return table === "platform_admins" ? adminQuery() : failingQuery(); } };
  const handler = createAdminCommandCenterHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client
  });
  const res = await handler({ httpMethod: "GET", queryStringParameters: { action: "dashboard" }, headers: {} });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.kpis, "dashboard still returns a kpis object when queries fail");
  assert.ok(body.charts, "dashboard still returns charts when queries fail");
});

test("admin remote editor keeps account, appearance, navigation, features, and subscription edits wired", () => {
  const html = adminHtml();
  const js = adminJs();
  for (const name of [
    "name",
    "email",
    "phone",
    "website",
    "primary",
    "accent",
    "background",
    "sidebar",
    "nav_order",
    "nav_hidden",
    "app_background_image",
    "dashboard_image",
    "logo_image",
    "layout_mode",
    "button_labels",
    "tab_labels",
    "plan_code",
    "subscription_status",
    "account_status"
  ]) {
    assert.match(html, new RegExp(`name="${name}"`));
  }
  assert.match(html, /data-tab="content"/);
  assert.match(html, /Edit florist pages \(Design Mode\)/);
  assert.match(js, /const FEATURES=\[[^\]]*'website'/);
  assert.match(js, /const FEATURES=\[[^\]]*'lily'/);
  assert.match(js, /const FEATURES=\[[^\]]*'rose'/);
  assert.match(js, /action:'update-shop'/);
  assert.match(js, /action:'save-config'/);
  assert.match(js, /parseJsonField\('button_labels'\)/);
  assert.match(js, /parseJsonField\('tab_labels'\)/);
  assert.match(js, /florisynDesign=1/);
  assert.match(js, /florisynImageEdit=1/);
  assert.match(js, /action:'update-subscription'/);
  assert.match(js, /#saveShop/);
  assert.match(js, /#saveSubscription/);
});


test("admin command center soft-fails permission-denied HQ reads", () => {
  const src = fs.readFileSync(new URL("../netlify/functions/admin-command-center.js", import.meta.url), "utf8");
  assert.match(src, /function isSoftReadError/);
  assert.match(src, /42501/);
  assert.match(src, /permission denied/);
  assert.match(src, /safeSelect\(client, "shop_subscriptions"/);
  assert.match(src, /safeSelect\(client, "platform_announcements"/);
});

test("payment operations treats Resend as configured email", () => {
  const src = fs.readFileSync(new URL("../netlify/functions/_shared/payment-operations-admin.js", import.meta.url), "utf8");
  assert.match(src, /RESEND_API_KEY/);
});
