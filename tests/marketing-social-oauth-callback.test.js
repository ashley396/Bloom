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
const onePage = async () => ({ ok: true, pages: [{ id: "page-1", name: "Test Florals", accessToken: "page-token-1" }] });

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

test("happy path (facebook): exchanges the code, extends to a long-lived token, resolves the real Page and stores its PAGE token (not the user token), audits, and redirects to oauth=success", async () => {
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
    exchangeLongLivedFacebookToken: async () => ({ ok: true, accessToken: "long-lived-user-token", expiresInSeconds: 5183944 }),
    resolveFacebookPages: onePage
  });

  assert.equal(res.statusCode, 302);
  assert.equal(new URL(res.headers.Location).searchParams.get("oauth"), "success");
  assert.equal(new URL(res.headers.Location).searchParams.get("platform"), "facebook");

  const connCall = client.calls.find((c) => c.table === "marketing_social_connections");
  assert.equal(connCall.payload.shop_id, "shop-1");
  assert.equal(connCall.payload.platform, "facebook");
  assert.equal(connCall.payload.status, "connected");
  assert.equal(connCall.payload.external_account_id, "page-1", "must store the real Page id, not the connecting user's id");
  assert.equal(connCall.payload.account_label, "Test Florals");
  assert.equal(connCall.payload.expires_at, null, "a Page token from /me/accounts carries no real expires_in — never a guessed expiry");

  const secretsCall = client.calls.find((c) => c.table === "marketing_social_connection_secrets");
  assert.equal(secretsCall.payload.connection_id, "conn-1");
  assert.notEqual(String(secretsCall.payload.access_token_ciphertext), "page-token-1", "the raw token must never be stored in plaintext");
  // Decrypt to prove it's the PAGE token that got stored, not the
  // long-lived USER token — the exact bug this pass fixes.
  const { decryptSocialToken } = await import("../netlify/functions/_shared/marketing-social-oauth.js");
  assert.equal(decryptSocialToken(secretsCall.payload.access_token_ciphertext, process.env), "page-token-1");

  const auditCall = client.calls.find((c) => c.table === "platform_admin_audit");
  assert.ok(auditCall, "a real connection must leave a real audit trail");
  assert.equal(auditCall.payload.action, "marketing_platform_connected");
  assert.equal(auditCall.payload.admin_user_id, "user-1");
});

test("happy path (instagram): resolves the linked IG business account through the Page's own token, stores THAT as the target id", async () => {
  process.env.FLORISYN_MARKETING_TOKEN_KEY = "a-real-key";
  const client = createFakeSupabaseClient([{ data: { id: "conn-1" }, error: null }, { data: null, error: null }, { data: null, error: null }]);
  const res = await handleMarketingSocialOAuthCallback(makeEvent({ code: "auth-code", state: "signed-state" }), {
    admin: () => client,
    verifyOAuthState: () => ({ valid: true, platform: "instagram", shopId: "shop-1", userId: "user-1", codeVerifier: null }),
    exchangeCodeForToken: async () => ({ ok: true, accessToken: "short-lived", refreshToken: null, expiresInSeconds: 5000 }),
    exchangeLongLivedFacebookToken: async () => ({ ok: true, accessToken: "long-lived-user-token", expiresInSeconds: 5183944 }),
    resolveFacebookPages: onePage,
    resolveInstagramBusinessAccount: async ({ pageId }) => ({ ok: true, igUserId: `ig-${pageId}` })
  });
  assert.equal(res.statusCode, 302);
  assert.equal(new URL(res.headers.Location).searchParams.get("oauth"), "success");
  const connCall = client.calls.find((c) => c.table === "marketing_social_connections");
  assert.equal(connCall.payload.external_account_id, "ig-page-1");
  assert.equal(connCall.payload.account_label, "Test Florals (Instagram)");
});

test("facebook: an account with zero Facebook Pages is a clear, honest failure — nothing is saved", async () => {
  const client = createFakeSupabaseClient([]);
  const res = await handleMarketingSocialOAuthCallback(makeEvent({ code: "auth-code", state: "signed-state" }), {
    admin: () => client,
    verifyOAuthState: validState,
    exchangeCodeForToken: async () => ({ ok: true, accessToken: "short-lived", refreshInSeconds: null }),
    exchangeLongLivedFacebookToken: async () => ({ ok: true, accessToken: "long-lived-user-token", expiresInSeconds: 5183944 }),
    resolveFacebookPages: async () => ({ ok: true, pages: [] })
  });
  assert.equal(res.statusCode, 302);
  assert.match(new URL(res.headers.Location).searchParams.get("message"), /No Facebook Page was found/);
  assert.equal(client.calls.length, 0);
});

test("facebook: an account managing multiple Pages is refused rather than guessing which one to use", async () => {
  const client = createFakeSupabaseClient([]);
  const res = await handleMarketingSocialOAuthCallback(makeEvent({ code: "auth-code", state: "signed-state" }), {
    admin: () => client,
    verifyOAuthState: validState,
    exchangeCodeForToken: async () => ({ ok: true, accessToken: "short-lived" }),
    exchangeLongLivedFacebookToken: async () => ({ ok: true, accessToken: "long-lived-user-token", expiresInSeconds: 5183944 }),
    resolveFacebookPages: async () => ({
      ok: true,
      pages: [
        { id: "page-1", name: "Test Florals Downtown", accessToken: "tok-1" },
        { id: "page-2", name: "Test Florals Uptown", accessToken: "tok-2" }
      ]
    })
  });
  assert.equal(res.statusCode, 302);
  const message = new URL(res.headers.Location).searchParams.get("message");
  assert.match(message, /Found 2 Facebook Pages/);
  assert.match(message, /Test Florals Downtown/);
  assert.equal(client.calls.length, 0);
});

test("instagram: a Page with no linked Instagram account is a clear, honest failure — nothing is saved", async () => {
  const client = createFakeSupabaseClient([]);
  const res = await handleMarketingSocialOAuthCallback(makeEvent({ code: "auth-code", state: "signed-state" }), {
    admin: () => client,
    verifyOAuthState: () => ({ valid: true, platform: "instagram", shopId: "shop-1", userId: "user-1", codeVerifier: null }),
    exchangeCodeForToken: async () => ({ ok: true, accessToken: "short-lived" }),
    exchangeLongLivedFacebookToken: async () => ({ ok: true, accessToken: "long-lived-user-token", expiresInSeconds: 5183944 }),
    resolveFacebookPages: onePage,
    resolveInstagramBusinessAccount: async () => ({ ok: false, error: "This Facebook Page has no linked Instagram professional (Business/Creator) account." })
  });
  assert.equal(res.statusCode, 302);
  assert.match(new URL(res.headers.Location).searchParams.get("message"), /no linked Instagram/);
  assert.equal(client.calls.length, 0);
});

test("happy path (tiktok): no Page resolution attempted at all — that mechanism is Meta-only, and TikTok's user token is stored directly", async () => {
  process.env.FLORISYN_MARKETING_TOKEN_KEY = "a-real-key";
  let pagesCalled = false;
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
    },
    resolveFacebookPages: async () => {
      pagesCalled = true;
      return { ok: true, pages: [] };
    }
  });
  assert.equal(res.statusCode, 302);
  assert.equal(new URL(res.headers.Location).searchParams.get("oauth"), "success");
  assert.equal(longLivedCalled, false);
  assert.equal(pagesCalled, false);

  const connCall = client.calls.find((c) => c.table === "marketing_social_connections");
  assert.equal(connCall.payload.external_account_id, null, "tiktok has no separate target account id — Direct Post targets the connected creator directly");

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
    exchangeLongLivedFacebookToken: async () => ({ ok: true, accessToken: "long-lived-user-token", expiresInSeconds: 5183944 }),
    resolveFacebookPages: onePage
  });
  assert.equal(res.statusCode, 302);
  assert.equal(new URL(res.headers.Location).searchParams.get("oauth"), "error");
  assert.match(new URL(res.headers.Location).searchParams.get("message"), /token encryption key is not configured/);
  assert.equal(client.calls.filter((c) => c.table === "marketing_social_connection_secrets").length, 0);
});
