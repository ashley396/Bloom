import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Priority 3 of the "finish everything that can safely be completed
// without Ashley" pass: connect_platform now builds a real, provider-
// hosted authorize URL (marketing-social-oauth.js) once real OAuth
// credentials are configured for an OAuth-architected platform, instead
// of the old "not implemented yet" placeholder message.

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
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
  savedEnv = { ...process.env };
});
test.after(() => {
  process.env = { ...savedEnv };
});
test.afterEach(() => {
  process.env = { ...savedEnv };
});

function event(action, body, { method = "POST" } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { action },
    headers: { origin: "https://app.example.com" },
    body: JSON.stringify({ action, ...body })
  };
}

test("connect_platform: requires super_admin", async () => {
  const client = createFakeSupabaseClient([{ data: { user_id: "u1", role: "support", active: true }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("connect_platform", { shop_id: "shop-1", platform: "facebook" }));
  assert.equal(res.statusCode, 403);
});

test("connect_platform: rejects an unrecognized platform", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("connect_platform", { shop_id: "shop-1", platform: "myspace" }));
  assert.equal(res.statusCode, 400);
});

test("connect_platform: unconfigured credentials — configured:false, no authorize_url, never fabricates a client id", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: null, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("connect_platform", { shop_id: "shop-1", platform: "facebook" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.configured, false);
  assert.equal(body.authorize_url, undefined);
  assert.match(body.message, /FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID/);
});

test("connect_platform: credentials configured but platform has no OAuth architecture yet (e.g. linkedin) — honest, not a fabricated connect", async () => {
  process.env.FLORISYN_SOCIAL_LINKEDIN_CLIENT_ID = "id";
  process.env.FLORISYN_SOCIAL_LINKEDIN_CLIENT_SECRET = "secret";
  const client = createFakeSupabaseClient([superAdminRow(), { data: null, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("connect_platform", { shop_id: "shop-1", platform: "linkedin" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.configured, true);
  assert.equal(body.authorize_url, undefined);
  assert.match(body.message, /not built for this platform yet/);
});

test("connect_platform: real credentials + real OAuth architecture (facebook) — returns a real authorize_url pointing at Meta", async () => {
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID = "fb-app-id";
  process.env.FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET = "fb-app-secret";
  process.env.FLORISYN_MARKETING_OAUTH_STATE_SECRET = "state-secret";
  const client = createFakeSupabaseClient([superAdminRow(), { data: null, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("connect_platform", { shop_id: "shop-1", platform: "facebook" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.configured, true);
  assert.ok(body.authorize_url);
  const url = new URL(body.authorize_url);
  assert.equal(url.hostname, "www.facebook.com");
  assert.equal(url.searchParams.get("client_id"), "fb-app-id");
  assert.ok(url.searchParams.get("state"));
});

test("disconnect_platform: clears status and deletes stored secrets, with an audit trail", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { id: "conn-1" }, error: null }, { data: null, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("disconnect_platform", { shop_id: "shop-1", platform: "facebook" }));
  assert.equal(res.statusCode, 200);
  const secretsDelete = client.calls.find((c) => c.table === "marketing_social_connection_secrets");
  assert.ok(secretsDelete, "disconnecting must remove the stored tokens, not just flip a status flag");
  const auditCall = client.calls.find((c) => c.table === "platform_admin_audit");
  assert.ok(auditCall);
});
