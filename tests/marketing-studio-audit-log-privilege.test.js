import test from "node:test";
import assert from "node:assert/strict";
import { writeAdminAudit, writeCommandAudit } from "../netlify/functions/_shared/platform-admin.js";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Real production-adjacent bug (found via Ashley's own authenticated
// "Ask Lily to create it" click on her real, verified marketing_studio_beta
// shop): generate_content — and every other florist-reachable action in
// marketing-studio.js — logs its own audit trail via writeCommandAudit(),
// which used to insert into platform_admin_audit using WHATEVER client the
// caller happened to be using. For the admin-console path that client is
// already a service-role client (platformAdmin()'s own buildServerClient),
// so this always worked. But the florist path (marketing-studio-shop.js's
// deps.florist.client) hands the exact same shared dispatch an ordinary
// session-scoped `authenticated` client instead — and `authenticated` has
// ZERO grants on platform_admin_audit (confirmed live against Florisyn
// Staging: information_schema.role_table_grants shows only REFERENCES/
// TRIGGER/TRUNCATE for `authenticated` on platform_admin_audit AND
// platform_admins — no SELECT/INSERT/UPDATE/DELETE at all; only
// service_role has real DML there), so the write throws a real Postgres
// permission error. platform_admin_audit is meant to stay exactly that
// locked down (see the greenfield baseline's own comment: "No
// browser-facing policies are created. Access is only through secured
// Netlify functions using the Supabase service role") — the fix is never
// to loosen that table's protection, only to stop routing a privileged
// write through an unprivileged client.

function permissionDeniedResult(table) {
  return { data: null, error: { code: "42501", message: `permission denied for table ${table}` } };
}

test("writeCommandAudit: never routes the platform_admin_audit write through the caller's own (potentially unprivileged) client — always through a dedicated audit client", async () => {
  // Stands in for Ashley's real authenticated florist session client: if
  // this were ever asked to insert into platform_admin_audit, a real
  // database would deny it exactly like this.
  const floristClient = createFakeSupabaseClient([permissionDeniedResult("platform_admin_audit")]);
  // Stands in for the dedicated service-role client the fix must use instead.
  const auditClient = createFakeSupabaseClient([{ data: { id: "audit-1" }, error: null }]);

  await writeCommandAudit(
    floristClient,
    "ashley-user-id",
    "marketing_content_generated",
    { shopId: "shop-ashley", targetType: "marketing_content_items", targetId: "item-1" },
    { createAuditClient: () => auditClient }
  );

  assert.ok(
    !floristClient.calls.some((c) => c.table === "platform_admin_audit"),
    "the caller's own (florist-session, RLS-scoped) client must never be asked to touch platform_admin_audit — that table stays service-role-only"
  );
  const auditInsert = auditClient.calls.find((c) => c.table === "platform_admin_audit" && c.ops.some((op) => op[0] === "insert"));
  assert.ok(auditInsert, "the audit row must still actually be written — just through the correct, privileged client");
  assert.equal(auditInsert.payload.admin_user_id, "ashley-user-id");
  assert.equal(auditInsert.payload.shop_id, "shop-ashley");
  assert.equal(auditInsert.payload.action, "marketing_content_generated");
});

test("writeAdminAudit: a real permission-denied response from the audit write is swallowed — it must never surface as a failure of the real action it's merely logging", async () => {
  const deniedAuditClient = createFakeSupabaseClient([permissionDeniedResult("platform_admin_audit")]);
  // Must resolve, not reject/throw — a caller that awaits this directly
  // (every call site in marketing-studio.js does) must never see its own
  // otherwise-successful action fail over a logging write.
  await assert.doesNotReject(() =>
    writeAdminAudit(null, "u1", "shop-1", "marketing_content_generated", {}, { createAuditClient: () => deniedAuditClient })
  );
});

test("writeAdminAudit: when the audit client itself can't even be constructed (e.g. no service key in this environment), the write is skipped silently, never thrown", async () => {
  await assert.doesNotReject(() =>
    writeAdminAudit(null, "u1", "shop-1", "marketing_content_generated", {}, {
      createAuditClient: () => {
        throw new Error("supabase server key missing");
      }
    })
  );
});

// ── End-to-end: the exact real path Ashley's "Ask Lily to create it" click
// takes — createMarketingStudioHandler reached via deps.florist (never
// deps.authenticate/platformAdmin — that would be the wrong, admin-console
// path), for a shop whose marketing_studio_beta is real (deps.florist is
// only ever set by marketing-studio-shop.js after independently verifying
// that). No SUPABASE_SERVICE_ROLE_KEY is configured in this test process,
// so the fix's internal audit-client construction will itself throw and be
// swallowed — proving generate_content still completes even with the
// audit-logging path fully unavailable, not just denied.

function floristDeps(client) {
  return {
    florist: { client, user: { id: "ashley-user-id" }, shopId: "shop-ashley", role: "owner" }
  };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
function mockCloudflareOnce(jsonResult) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(jsonResult) } }) });
  return {
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  // Global flag stays OFF — access here comes only from deps.florist,
  // exactly like Ashley's real admin-only, per-shop beta.
  delete process.env.FLORISYN_FLAG_MARKETING_STUDIO;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
});
test.after(() => {
  process.env = { ...savedEnv };
});

test("generate_content via deps.florist (Ashley's real button click path): succeeds end to end, and the florist's own session client is never asked to write platform_admin_audit", async () => {
  const mock = mockCloudflareOnce({
    platform: "facebook",
    headline: "h",
    body: "b",
    cta: "c",
    visual_brief: "v",
    hashtags: [],
    asset_requirements: [],
    brand_traits_used: [],
    visual_traits_used: []
  });
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "idea" }, error: null }, // currentItem
      { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
      { data: { marketing_monthly_budget_cents: null }, error: null }, // budget
      { data: null, error: null }, // content_items update -> generating
      { data: { name: "Test Florals" }, error: null }, // shopRow
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: [], error: null }, // loadGroundedInventory
      { data: [], error: null }, // audience: customers
      { data: [], error: null }, // audience: orders
      { data: [], error: null }, // recent-content shortlist (marketing_platform_variants)
      { data: null, error: null }, // recordUsage("copy")
      { data: { id: "copy-asset-1" }, error: null }, // persistGeneratedAsset
      { data: null, error: null }, // variant update
      { data: { id: "item-1", status: "draft" }, error: null } // final content_items update
      // No platform_admin_audit response queued at all — the fix must
      // never reach this florist client to ask for one.
    ]);
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `generate_content must succeed for Ashley's own verified shop even though audit logging is fully unavailable in this environment: ${res.body}`);

    assert.ok(
      !client.calls.some((c) => c.table === "platform_admin_audit"),
      "Ashley's own session-scoped client must never be asked to touch platform_admin_audit"
    );
  } finally {
    mock.restore();
  }
});
