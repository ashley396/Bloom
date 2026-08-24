import test from "node:test";
import assert from "node:assert/strict";
import { handleMarketingSocialOAuthCallback } from "../netlify/functions/marketing-social-oauth-callback.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
});
test.afterEach(() => {
  process.env = { ...savedEnv };
});

function makeEvent(qs = {}, { method = "GET" } = {}) {
  return { httpMethod: method, queryStringParameters: qs, headers: {} };
}

const validState = () => ({ valid: true, platform: "facebook", shopId: "shop-1", userId: "user-1", codeVerifier: null });

test("rejects non-GET methods", async () => {
  const res = await handleMarketingSocialOAuthCallback(makeEvent({}, { method: "POST" }));
  assert.equal(res.statusCode, 405);
});

test("the provider's own denial (e.g. admin clicked cancel) redirects with an honest message, touches no database", async () => {
  const client = createFakeSupabaseClient([]);
  const res = await handleMarketingSocialOAuthCallback(makeEvent({ error: "access_denied", error_description: "User denied consent." }), {
    admin: () => client
  });
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.Location, /oauth=error/);
  assert.match(new URL(res.headers.Location).searchParams.get("message"), /User denied consent/);
  assert.equal(client.calls.length, 0);
});

test("an invalid/expired state is rejected before any token exchange or database write is attempted", async () => {
  const client = createFakeSupabaseClient([]);
  let exchangeCalled = false;
  const res = await handleMarketingSocialOAuthCallback(makeEvent({ code: "auth-code", state: "garbage" }), {
    admin: () => client,
    verifyOAuthState: () => ({ valid: false, error: "Invalid state signature." }),
    exchangeCodeForToken: async () => {
      exchangeCalled = true;
      return { ok: false };
    }
  });
  assert.equal(res.statusCode, 302);
  assert.match(new URL(res.headers.Location).searchParams.get("message"), /Invalid state signature/);
  assert.equal(exchangeCalled, false);
  assert.equal(client.calls.length, 0);
});

test("missing code param (valid state, but no code) redirects with a clear message", async () => {
  const client = createFakeSupabaseClient([]);
  const res = await handleMarketingSocialOAuthCallback(makeEvent({ state: "signed-state" }), {
    admin: () => client,
    verifyOAuthState: validState
  });
  assert.equal(res.statusCode, 302);
  assert.match(new URL(res.headers.Location).searchParams.get("message"), /did not return an authorization code/);
});

test("a token exchange failure surfaces the real provider error, never a fabricated connection", async () => {
  const client = createFakeSupabaseClient([]);
  const res = await handleMarketingSocialOAuthCallback(makeEvent({ code: "bad-code", state: "signed-state" }), {
    admin: () => client,
    verifyOAuthState: validState,
    exchangeCodeForToken: async () => ({ ok: false, error: "Invalid verification code format." })
  });
  assert.equal(res.statusCode, 302);
  assert.match(new URL(res.headers.Location).searchParams.get("message"), /Invalid verification code format/);
  assert.equal(client.calls.length, 0, "no partial connection row on a failed exchange");
});

test("happy path (facebook): exchanges the code, extends to a long-lived token, stores the connection + encrypted secrets, audits, and redirects to oauth=success", async () => {
  process.env.FLORISYN_MARKETING_TOKEN_KEY = "a-real-key";
  const client = createFakeSupabaseClient([
    { data: { id: "conn-1" }, error: null }, // marketing_social_connections upsert().select().single()
    { data: null, error: null }, // marketing_social_connection_secrets upsert()
    { data: null, error: null } // platform_admin_audit insert()
  ]);
  const res = await handleMarketingSocialOAuthCallback(makeEvent({ code: "auth-code", state: "signed-state" }), {
    admin: () => client,
    verifyOAuthState: validState,
    exchangeCodeForToken: async () => ({ ok: true, accessToken: "short-lived", refreshToken: null, expiresInSeconds: 5000, scope: "pages_manage_posts" }),
    exchangeLongLivedFacebookToken: async () => ({ ok: true, accessToken: "long-lived-token", expiresInSeconds: 5183944 })
  });

  assert.equal(res.statusCode, 302);
  assert.equal(new URL(res.headers.Location).searchParams.get("oauth"), "success");
  assert.equal(new URL(res.headers.Location).searchParams.get("platform"), "facebook");

  const connCall = client.calls.find((c) => c.table === "marketing_social_connections");
  assert.equal(connCall.payload.shop_id, "shop-1");
  assert.equal(connCall.payload.platform, "facebook");
  assert.equal(connCall.payload.status, "connected");

  const secretsCall = client.calls.find((c) => c.table === "marketing_social_connection_secrets");
  assert.equal(secretsCall.payload.connection_id, "conn-1");
  assert.ok(Buffer.isBuffer(secretsCall.payload.access_token_ciphertext) || secretsCall.payload.access_token_ciphertext);
  assert.notEqual(String(secretsCall.payload.access_token_ciphertext), "long-lived-token", "the raw token must never be stored in plaintext");

  const auditCall = client.calls.find((c) => c.table === "platform_admin_audit");
  assert.ok(auditCall, "a real connection must leave a real audit trail");
  assert.equal(auditCall.payload.action, "marketing_platform_connected");
  assert.equal(auditCall.payload.admin_user_id, "user-1");
});

test("happy path (tiktok): no long-lived exchange attempted — that mechanism is Meta-only", async () => {
  process.env.FLORISYN_MARKETING_TOKEN_KEY = "a-real-key";
  let longLivedCalled = false;
  const client = createFakeSupabaseClient([
    { data: { id: "conn-1" }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const res = await handleMarketingSocialOAuthCallback(makeEvent({ code: "auth-code", state: "signed-state" }), {
    admin: () => client,
    verifyOAuthState: () => ({ valid: true, platform: "tiktok", shopId: "shop-1", userId: "user-1", codeVerifier: "verifier" }),
    exchangeCodeForToken: async () => ({ ok: true, accessToken: "tt-access", refreshToken: "tt-refresh", expiresInSeconds: 86400, scope: "video.publish" }),
    exchangeLongLivedFacebookToken: async () => {
      longLivedCalled = true;
      return { ok: false };
    }
  });
  assert.equal(res.statusCode, 302);
  assert.equal(new URL(res.headers.Location).searchParams.get("oauth"), "success");
  assert.equal(longLivedCalled, false);

  const secretsCall = client.calls.find((c) => c.table === "marketing_social_connection_secrets");
  assert.ok(secretsCall.payload.refresh_token_ciphertext, "tiktok's real refresh token must be stored (encrypted), unlike Meta's flow");
});

test("no token encryption key configured: the exchange succeeded but nothing is saved — a clear error, never a plaintext-stored token", async () => {
  delete process.env.FLORISYN_MARKETING_TOKEN_KEY;
  delete process.env.PAYMENT_HUB_TOKEN_KEY;
  const client = createFakeSupabaseClient([{ data: { id: "conn-1" }, error: null }]);
  const res = await handleMarketingSocialOAuthCallback(makeEvent({ code: "auth-code", state: "signed-state" }), {
    admin: () => client,
    verifyOAuthState: validState,
    exchangeCodeForToken: async () => ({ ok: true, accessToken: "short-lived", refreshToken: null, expiresInSeconds: 5000 }),
    exchangeLongLivedFacebookToken: async () => ({ ok: true, accessToken: "long-lived-token", expiresInSeconds: 5183944 })
  });
  assert.equal(res.statusCode, 302);
  assert.equal(new URL(res.headers.Location).searchParams.get("oauth"), "error");
  assert.match(new URL(res.headers.Location).searchParams.get("message"), /token encryption key is not configured/);
  assert.equal(client.calls.filter((c) => c.table === "marketing_social_connection_secrets").length, 0);
});
