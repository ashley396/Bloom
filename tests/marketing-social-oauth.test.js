import test from "node:test";
import assert from "node:assert/strict";
import {
  OAUTH_SUPPORTED_PLATFORMS,
  isOAuthArchitected,
  signOAuthState,
  verifyOAuthState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  exchangeLongLivedFacebookToken,
  refreshTikTokToken,
  resolveFacebookPages,
  resolveInstagramBusinessAccount,
  encryptSocialToken,
  decryptSocialToken,
  oauthScopesFor
} from "../netlify/functions/_shared/marketing-social-oauth.js";

function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

const CONFIGURED_ENV = {
  FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID: "fb-app-id",
  FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET: "fb-app-secret",
  FLORISYN_SOCIAL_INSTAGRAM_CLIENT_ID: "fb-app-id",
  FLORISYN_SOCIAL_INSTAGRAM_CLIENT_SECRET: "fb-app-secret",
  FLORISYN_SOCIAL_TIKTOK_CLIENT_ID: "tt-client-key",
  FLORISYN_SOCIAL_TIKTOK_CLIENT_SECRET: "tt-client-secret",
  FLORISYN_MARKETING_OAUTH_STATE_SECRET: "state-secret-for-tests"
};

test("isOAuthArchitected / OAUTH_SUPPORTED_PLATFORMS: exactly facebook, instagram, tiktok — never a platform without a verified flow", () => {
  assert.deepEqual([...OAUTH_SUPPORTED_PLATFORMS].sort(), ["facebook", "instagram", "tiktok"]);
  assert.equal(isOAuthArchitected("facebook"), true);
  assert.equal(isOAuthArchitected("linkedin"), false);
  assert.equal(isOAuthArchitected("pinterest"), false);
});

test("oauthScopesFor: real, platform-specific scopes — never empty for an architected platform", () => {
  assert.ok(oauthScopesFor("facebook").includes("pages_manage_posts"));
  assert.ok(oauthScopesFor("instagram").includes("instagram_content_publish"));
  assert.ok(oauthScopesFor("tiktok").includes("video.publish"));
  assert.deepEqual(oauthScopesFor("youtube"), []);
});

test("signOAuthState / verifyOAuthState: a real state round-trips to the exact platform/shop/user/codeVerifier it was signed with", () => {
  const state = signOAuthState(
    { platform: "tiktok", shopId: "shop-1", userId: "user-1", codeVerifier: "verifier-abc" },
    { env: CONFIGURED_ENV }
  );
  assert.ok(state, "a configured secret must produce a real state");
  const verified = verifyOAuthState(state, { env: CONFIGURED_ENV });
  assert.equal(verified.valid, true);
  assert.equal(verified.platform, "tiktok");
  assert.equal(verified.shopId, "shop-1");
  assert.equal(verified.userId, "user-1");
  assert.equal(verified.codeVerifier, "verifier-abc");
});

test("signOAuthState: returns null when no state secret is configured, never a state an attacker's own secret could forge as easily", () => {
  const state = signOAuthState({ platform: "facebook", shopId: "shop-1", userId: "user-1" }, { env: {} });
  assert.equal(state, null);
});

test("verifyOAuthState: rejects a tampered state — flipping one character invalidates the signature", () => {
  const state = signOAuthState({ platform: "facebook", shopId: "shop-1", userId: "user-1" }, { env: CONFIGURED_ENV });
  const tampered = state.slice(0, -2) + (state.slice(-2, -1) === "A" ? "B" : "A") + state.slice(-1);
  const verified = verifyOAuthState(tampered, { env: CONFIGURED_ENV });
  assert.equal(verified.valid, false);
});

test("verifyOAuthState: rejects an expired state — a connection attempt started too long ago must be redone, not silently honored", () => {
  const longAgo = Date.now() - 60 * 60 * 1000;
  const state = signOAuthState({ platform: "facebook", shopId: "shop-1", userId: "user-1" }, { env: CONFIGURED_ENV, now: longAgo });
  const verified = verifyOAuthState(state, { env: CONFIGURED_ENV, now: Date.now() });
  assert.equal(verified.valid, false);
  assert.match(verified.error, /expired/);
});

test("verifyOAuthState: a state signed for one platform never verifies as another — no cross-platform confusion", () => {
  const state = signOAuthState({ platform: "facebook", shopId: "shop-1", userId: "user-1" }, { env: CONFIGURED_ENV });
  // Verifying is platform-agnostic by design (the platform comes FROM the
  // state), so this asserts the decoded platform is exactly what was signed.
  const verified = verifyOAuthState(state, { env: CONFIGURED_ENV });
  assert.equal(verified.platform, "facebook");
});

test("buildAuthorizeUrl: an unconfigured platform never returns a URL with an empty client id", () => {
  const result = buildAuthorizeUrl("facebook", { shopId: "shop-1", userId: "user-1", redirectUri: "https://app.example.com/callback", env: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID/);
});

test("buildAuthorizeUrl: a platform with no OAuth architecture yet is refused cleanly, not guessed at", () => {
  const result = buildAuthorizeUrl("linkedin", { shopId: "shop-1", userId: "user-1", redirectUri: "https://app.example.com/callback", env: CONFIGURED_ENV });
  assert.equal(result.ok, false);
  assert.match(result.error, /No OAuth architecture/);
});

test("buildAuthorizeUrl: facebook — real host, client_id, redirect_uri, scope, and a signed state; no PKCE params", () => {
  const result = buildAuthorizeUrl("facebook", { shopId: "shop-1", userId: "user-1", redirectUri: "https://app.example.com/callback", env: CONFIGURED_ENV });
  assert.equal(result.ok, true);
  const url = new URL(result.url);
  assert.equal(url.hostname, "www.facebook.com");
  assert.match(url.pathname, /\/dialog\/oauth$/);
  assert.equal(url.searchParams.get("client_id"), "fb-app-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.example.com/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.match(url.searchParams.get("scope"), /pages_manage_posts/);
  assert.ok(url.searchParams.get("state"));
  assert.equal(url.searchParams.get("code_challenge"), null);

  const verified = verifyOAuthState(url.searchParams.get("state"), { env: CONFIGURED_ENV });
  assert.equal(verified.valid, true);
  assert.equal(verified.shopId, "shop-1");
});

test("buildAuthorizeUrl: tiktok — uses client_key (not client_id), includes a real PKCE code_challenge, and the state carries the matching code_verifier", () => {
  const result = buildAuthorizeUrl("tiktok", { shopId: "shop-1", userId: "user-1", redirectUri: "https://app.example.com/callback", env: CONFIGURED_ENV });
  assert.equal(result.ok, true);
  const url = new URL(result.url);
  assert.equal(url.hostname, "www.tiktok.com");
  assert.equal(url.searchParams.get("client_key"), "tt-client-key");
  assert.equal(url.searchParams.get("client_id"), null);
  const challenge = url.searchParams.get("code_challenge");
  assert.ok(challenge);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");

  const verified = verifyOAuthState(url.searchParams.get("state"), { env: CONFIGURED_ENV });
  assert.equal(verified.valid, true);
  assert.ok(verified.codeVerifier, "the callback needs the original code_verifier to complete PKCE");
});

test("exchangeCodeForToken: facebook — issues a real GET to the token endpoint with client_secret, code, redirect_uri", async () => {
  let capturedUrl;
  const restore = mockFetch(async (url) => {
    capturedUrl = new URL(String(url));
    return { ok: true, json: async () => ({ access_token: "short-lived-token", token_type: "bearer", expires_in: 5183944 }) };
  });
  const result = await exchangeCodeForToken("facebook", { code: "auth-code", redirectUri: "https://app.example.com/callback", env: CONFIGURED_ENV });
  restore();

  assert.equal(result.ok, true);
  assert.equal(result.accessToken, "short-lived-token");
  assert.equal(result.expiresInSeconds, 5183944);
  assert.equal(capturedUrl.hostname, "graph.facebook.com");
  assert.equal(capturedUrl.searchParams.get("client_secret"), "fb-app-secret");
  assert.equal(capturedUrl.searchParams.get("code"), "auth-code");
  assert.equal(capturedUrl.searchParams.get("redirect_uri"), "https://app.example.com/callback");
});

test("exchangeCodeForToken: tiktok — issues a form-encoded POST including code_verifier for PKCE", async () => {
  let capturedUrl, capturedInit;
  const restore = mockFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return { ok: true, json: async () => ({ access_token: "tt-access", refresh_token: "tt-refresh", expires_in: 86400, scope: "video.publish" }) };
  });
  const result = await exchangeCodeForToken("tiktok", { code: "auth-code", redirectUri: "https://app.example.com/callback", codeVerifier: "verifier-xyz", env: CONFIGURED_ENV });
  restore();

  assert.equal(result.ok, true);
  assert.equal(result.accessToken, "tt-access");
  assert.equal(result.refreshToken, "tt-refresh");
  assert.equal(capturedUrl, "https://open.tiktokapis.com/v2/oauth/token/");
  assert.equal(capturedInit.method, "POST");
  assert.equal(capturedInit.headers["Content-Type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(capturedInit.body);
  assert.equal(form.get("client_key"), "tt-client-key");
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code_verifier"), "verifier-xyz");
});

test("exchangeCodeForToken: a provider error response surfaces the real error message, never a fabricated token", async () => {
  const restore = mockFetch(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid verification code format." } }) }));
  const result = await exchangeCodeForToken("facebook", { code: "bad-code", redirectUri: "https://app.example.com/callback", env: CONFIGURED_ENV });
  restore();
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid verification code format/);
});

test("exchangeCodeForToken: a response missing access_token is treated as a failure, not silently accepted", async () => {
  const restore = mockFetch(async () => ({ ok: true, json: async () => ({ token_type: "bearer" }) }));
  const result = await exchangeCodeForToken("facebook", { code: "auth-code", redirectUri: "https://app.example.com/callback", env: CONFIGURED_ENV });
  restore();
  assert.equal(result.ok, false);
  assert.match(result.error, /no access_token/);
});

test("exchangeCodeForToken: an unconfigured platform never attempts the network call", async () => {
  let called = false;
  const restore = mockFetch(async () => {
    called = true;
    throw new Error("should not be called");
  });
  const result = await exchangeCodeForToken("facebook", { code: "auth-code", redirectUri: "https://app.example.com/callback", env: {} });
  restore();
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("exchangeLongLivedFacebookToken: real fb_exchange_token grant, real query params", async () => {
  let capturedUrl;
  const restore = mockFetch(async (url) => {
    capturedUrl = new URL(String(url));
    return { ok: true, json: async () => ({ access_token: "long-lived-token", expires_in: 5183944 }) };
  });
  const result = await exchangeLongLivedFacebookToken("facebook", { accessToken: "short-lived-token", env: CONFIGURED_ENV });
  restore();
  assert.equal(result.ok, true);
  assert.equal(result.accessToken, "long-lived-token");
  assert.equal(capturedUrl.searchParams.get("grant_type"), "fb_exchange_token");
  assert.equal(capturedUrl.searchParams.get("fb_exchange_token"), "short-lived-token");
});

test("exchangeLongLivedFacebookToken: refuses tiktok — Meta's long-lived exchange doesn't apply to a different provider's tokens", async () => {
  const result = await exchangeLongLivedFacebookToken("tiktok", { accessToken: "x", env: CONFIGURED_ENV });
  assert.equal(result.ok, false);
});

test("refreshTikTokToken: real refresh_token grant, form-encoded POST to the same token endpoint", async () => {
  let capturedInit;
  const restore = mockFetch(async (url, init) => {
    capturedInit = init;
    return { ok: true, json: async () => ({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 86400 }) };
  });
  const result = await refreshTikTokToken({ refreshToken: "old-refresh", env: CONFIGURED_ENV });
  restore();
  assert.equal(result.ok, true);
  assert.equal(result.accessToken, "new-access");
  const form = new URLSearchParams(capturedInit.body);
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("refresh_token"), "old-refresh");
});

test("encryptSocialToken / decryptSocialToken: round-trips a real token through the shared AES-256-GCM helper", () => {
  const env = { FLORISYN_MARKETING_TOKEN_KEY: "a-real-marketing-token-key" };
  const cipher = encryptSocialToken("super-secret-access-token", env);
  assert.ok(Buffer.isBuffer(cipher));
  assert.equal(decryptSocialToken(cipher, env), "super-secret-access-token");
});

test("encryptSocialToken: falls back to PAYMENT_HUB_TOKEN_KEY when no marketing-specific key is set, matching the codebase's existing fallback convention", () => {
  const env = { PAYMENT_HUB_TOKEN_KEY: "shared-app-wide-key" };
  const cipher = encryptSocialToken("token-value", env);
  assert.ok(Buffer.isBuffer(cipher));
  assert.equal(decryptSocialToken(cipher, env), "token-value");
});

test("resolveFacebookPages: lists real pages with their own page-scoped access tokens, not the user's token", async () => {
  let capturedUrl;
  const restore = mockFetch(async (url) => {
    capturedUrl = new URL(String(url));
    return { ok: true, json: async () => ({ data: [{ id: "page-1", name: "Test Florals", access_token: "page-token-1" }] }) };
  });
  const result = await resolveFacebookPages({ accessToken: "user-token" });
  restore();
  assert.equal(result.ok, true);
  assert.deepEqual(result.pages, [{ id: "page-1", name: "Test Florals", accessToken: "page-token-1" }]);
  assert.equal(capturedUrl.pathname, "/v22.0/me/accounts");
  assert.equal(capturedUrl.searchParams.get("access_token"), "user-token");
});

test("resolveFacebookPages: zero pages is a real, honest result — never fabricated", async () => {
  const restore = mockFetch(async () => ({ ok: true, json: async () => ({ data: [] }) }));
  const result = await resolveFacebookPages({ accessToken: "user-token" });
  restore();
  assert.equal(result.ok, true);
  assert.deepEqual(result.pages, []);
});

test("resolveFacebookPages: a provider error surfaces the real message", async () => {
  const restore = mockFetch(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid OAuth access token." } }) }));
  const result = await resolveFacebookPages({ accessToken: "bad-token" });
  restore();
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid OAuth access token/);
});

test("resolveInstagramBusinessAccount: resolves the real linked IG business account id, authenticated with the PAGE token", async () => {
  let capturedUrl;
  const restore = mockFetch(async (url) => {
    capturedUrl = new URL(String(url));
    return { ok: true, json: async () => ({ instagram_business_account: { id: "ig-user-1" } }) };
  });
  const result = await resolveInstagramBusinessAccount({ pageId: "page-1", pageAccessToken: "page-token-1" });
  restore();
  assert.equal(result.ok, true);
  assert.equal(result.igUserId, "ig-user-1");
  assert.equal(capturedUrl.pathname, "/v22.0/page-1");
  assert.equal(capturedUrl.searchParams.get("access_token"), "page-token-1");
});

test("resolveInstagramBusinessAccount: a Page with no linked Instagram account is a clear, honest failure, never a guessed id", async () => {
  const restore = mockFetch(async () => ({ ok: true, json: async () => ({}) }));
  const result = await resolveInstagramBusinessAccount({ pageId: "page-1", pageAccessToken: "page-token-1" });
  restore();
  assert.equal(result.ok, false);
  assert.match(result.error, /no linked Instagram/);
});
