/**
 * Real OAuth 2.0 architecture for social publishing connections — Priority
 * 3 of the "finish everything that can safely be completed without Ashley"
 * pass. Builds the actual authorize-URL/token-exchange/refresh machinery
 * for the three platforms Priority 5 wires real adapters for (Facebook
 * Pages, Instagram, TikTok), using each provider's own current, documented
 * endpoints and scopes — verified via live web search against Meta's and
 * TikTok's developer documentation during this pass, not reconstructed
 * from training-data memory alone (getting this wrong would mean silently
 * claiming an integration works when it doesn't — exactly what the "don't
 * invent undocumented URLs/scopes" rule forbids).
 *
 * Verified this pass:
 *   - Meta Graph API (Facebook Login) — authorize dialog at
 *     facebook.com/{version}/dialog/oauth, token exchange at
 *     graph.facebook.com/{version}/oauth/access_token, long-lived token
 *     exchange via grant_type=fb_exchange_token. Facebook Pages scopes
 *     (pages_show_list, pages_read_engagement, pages_manage_posts,
 *     business_management) and Instagram publishing scopes
 *     (instagram_basic, instagram_content_publish, plus the same
 *     pages_show_list/pages_read_engagement needed to resolve the linked
 *     Instagram Business Account ID) both go through this same Facebook
 *     Login flow — Instagram has no separate OAuth endpoint for content
 *     publishing today.
 *   - TikTok for Developers OAuth v2 — authorize at
 *     www.tiktok.com/v2/auth/authorize/ (PKCE required, client_key not
 *     client_id), token exchange and refresh both at
 *     open.tiktokapis.com/v2/oauth/token/ (form-encoded POST), scopes
 *     user.info.basic/video.publish/video.upload for the Content Posting
 *     API's Direct Post flow.
 *
 * This module never has real credentials to use until Ashley registers
 * and gets each platform's OAuth app approved and sets the matching env
 * vars (see platformOAuthEnvVarNames in marketing-social-providers.js) —
 * every exported function here fails honestly (never fabricates a URL
 * with an empty client id, never fakes a token) until then. Building the
 * real, correct architecture now means connecting a platform later is
 * "set two env vars and click connect," not a code change.
 */

import crypto from "node:crypto";
import { encryptProviderToken, decryptProviderToken } from "./payment-hub-crypto.js";
import { platformOAuthEnvVarNames, isPlatformConfigured } from "./marketing-social-providers.js";

const GRAPH_API_VERSION = "v22.0"; // Meta Graph API — current at verification time; Meta versions roughly yearly, bump here (not scattered across call sites) if a future pass confirms a newer default.

const OAUTH_CONFIG = Object.freeze({
  facebook: {
    authorizeUrl: `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`,
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "business_management"],
    clientIdParam: "client_id",
    clientSecretParam: "client_secret",
    pkce: false,
    supportsLongLivedExchange: true
  },
  instagram: {
    // Same Meta Graph API / Facebook Login flow as facebook — an Instagram
    // professional (Business/Creator) account must be linked to a
    // Facebook Page for content publishing; there is no separate
    // Instagram-only OAuth endpoint for this today.
    authorizeUrl: `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`,
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"],
    clientIdParam: "client_id",
    clientSecretParam: "client_secret",
    pkce: false,
    supportsLongLivedExchange: true
  },
  tiktok: {
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "video.publish", "video.upload"],
    clientIdParam: "client_key",
    clientSecretParam: "client_secret",
    pkce: true,
    supportsLongLivedExchange: false
  }
});

/** The platforms this module has real, documentation-verified OAuth
 * architecture for today. Intentionally a subset of SUPPORTED_PLATFORMS —
 * linkedin/pinterest/google_business/youtube each need their own
 * documentation-verified pass before real OAuth is wired for them, never
 * guessed ahead of time by copying another platform's shape. */
export const OAUTH_SUPPORTED_PLATFORMS = Object.freeze(Object.keys(OAUTH_CONFIG));

export function isOAuthArchitected(platform) {
  return Object.prototype.hasOwnProperty.call(OAUTH_CONFIG, platform);
}

function stateSecret(env = process.env) {
  return env.FLORISYN_MARKETING_OAUTH_STATE_SECRET || env.PAYMENT_HUB_TOKEN_KEY || null;
}

export function marketingTokenKeyMaterial(env = process.env) {
  return env.FLORISYN_MARKETING_TOKEN_KEY || env.PAYMENT_HUB_TOKEN_KEY || null;
}

export function encryptSocialToken(plaintext, env = process.env) {
  return encryptProviderToken(plaintext, marketingTokenKeyMaterial(env));
}

export function decryptSocialToken(ciphertext, env = process.env) {
  return decryptProviderToken(ciphertext, marketingTokenKeyMaterial(env));
}

/** PKCE (RFC 7636) code_verifier/code_challenge pair — required for
 * TikTok's authorization code flow. S256 method. */
export function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

/** Signs a CSRF-resistant OAuth state carrying exactly what the callback
 * needs to complete the flow without a bearer token (the browser redirect
 * back from the provider carries no Authorization header) — same signed-
 * payload/HMAC/base64url convention as bloom-storefront-core.js's preview
 * token, not a new scheme. 10-minute expiry: long enough for a real
 * login/consent flow, short enough to bound a leaked/replayed state. */
export function signOAuthState({ platform, shopId, userId, codeVerifier = "" }, { env = process.env, now = Date.now(), nonce } = {}) {
  const secret = stateSecret(env);
  if (!secret) return null;
  const expiresAtMs = now + 10 * 60 * 1000;
  const n = nonce || crypto.randomBytes(9).toString("base64url");
  const payload = [platform, shopId, userId, expiresAtMs, n, codeVerifier].join(":");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

/** Verifies and decodes a state produced by signOAuthState. Returns
 * { valid: false, error } or { valid: true, platform, shopId, userId,
 * codeVerifier }. */
export function verifyOAuthState(state, { env = process.env, now = Date.now() } = {}) {
  const secret = stateSecret(env);
  if (!secret) return { valid: false, error: "OAuth state signing is not configured (FLORISYN_MARKETING_OAUTH_STATE_SECRET)." };
  if (!state) return { valid: false, error: "Missing state." };
  let raw;
  try {
    raw = Buffer.from(String(state), "base64url").toString("utf8");
  } catch {
    return { valid: false, error: "Malformed state." };
  }
  const parts = raw.split(":");
  if (parts.length !== 7) return { valid: false, error: "Malformed state." };
  const [platform, shopId, userId, expiresAtMsRaw, nonce, codeVerifier, sig] = parts;
  const payload = [platform, shopId, userId, expiresAtMsRaw, nonce, codeVerifier].join(":");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const actualBuffer = Buffer.from(sig || "", "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return { valid: false, error: "Invalid state signature." };
  }
  const expiresAtMs = Number(expiresAtMsRaw);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < now) {
    return { valid: false, error: "This connection attempt expired — please try connecting again." };
  }
  if (!isOAuthArchitected(platform)) return { valid: false, error: `Unrecognized platform in state: ${platform}.` };
  return { valid: true, platform, shopId, userId, codeVerifier: codeVerifier || null };
}

/** Builds the real, provider-hosted authorize URL to redirect the admin's
 * browser to. Never returns a URL with an empty client id — an
 * unconfigured platform is a clear { ok:false } instead, exactly like
 * every other not-live path in this codebase. */
export function buildAuthorizeUrl(platform, { shopId, userId, redirectUri, env = process.env } = {}) {
  if (!isOAuthArchitected(platform)) {
    return { ok: false, error: `No OAuth architecture is built for "${platform}" yet.` };
  }
  if (!isPlatformConfigured(platform, env)) {
    const { clientIdVar, clientSecretVar } = platformOAuthEnvVarNames(platform);
    return { ok: false, error: `${clientIdVar} and ${clientSecretVar} are not both set — connect is not available for ${platform} yet.` };
  }
  if (!shopId || !userId) return { ok: false, error: "shopId and userId are required." };
  if (!redirectUri) return { ok: false, error: "redirectUri is required." };

  const cfg = OAUTH_CONFIG[platform];
  const { clientIdVar } = platformOAuthEnvVarNames(platform);
  const clientId = String(env[clientIdVar] || "").trim();

  let codeVerifier = "";
  let codeChallenge = null;
  if (cfg.pkce) {
    const pair = generatePkcePair();
    codeVerifier = pair.codeVerifier;
    codeChallenge = pair.codeChallenge;
  }

  const state = signOAuthState({ platform, shopId, userId, codeVerifier }, { env });
  if (!state) return { ok: false, error: "OAuth state signing is not configured (FLORISYN_MARKETING_OAUTH_STATE_SECRET)." };

  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set(cfg.clientIdParam, clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scopes.join(","));
  url.searchParams.set("state", state);
  if (codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }

  return { ok: true, url: url.toString(), state, scopes: cfg.scopes };
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Exchanges an authorization code for an access token, using each
 * provider's real token endpoint and request shape. Same { ok, ... }
 * contract as marketing-heygen-client.js — never throws for an expected
 * failure. */
export async function exchangeCodeForToken(platform, { code, redirectUri, codeVerifier, env = process.env } = {}) {
  if (!isOAuthArchitected(platform)) return { ok: false, error: `No OAuth architecture is built for "${platform}" yet.` };
  if (!isPlatformConfigured(platform, env)) return { ok: false, error: `${platform} OAuth credentials are not configured.` };
  if (!code) return { ok: false, error: "code is required." };
  if (!redirectUri) return { ok: false, error: "redirectUri is required." };

  const cfg = OAUTH_CONFIG[platform];
  const { clientIdVar, clientSecretVar } = platformOAuthEnvVarNames(platform);
  const clientId = String(env[clientIdVar] || "").trim();
  const clientSecret = String(env[clientSecretVar] || "").trim();

  let response;
  try {
    if (platform === "facebook" || platform === "instagram") {
      // Meta's token endpoint accepts a GET with query parameters.
      const url = new URL(cfg.tokenUrl);
      url.searchParams.set(cfg.clientIdParam, clientId);
      url.searchParams.set(cfg.clientSecretParam, clientSecret);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("code", code);
      response = await fetch(url.toString());
    } else {
      // TikTok's token endpoint is a form-encoded POST.
      const form = new URLSearchParams({
        client_key: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      });
      if (codeVerifier) form.set("code_verifier", codeVerifier);
      response = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
        body: form.toString()
      });
    }
  } catch (error) {
    return { ok: false, error: `${platform} token request failed: ${String(error?.message || error).slice(0, 200)}` };
  }

  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.error_description || payload?.message || `${platform} returned ${response.status}`;
    return { ok: false, error: detail };
  }

  // Normalize the two real response shapes (Meta's flat body vs TikTok's
  // { access_token, refresh_token, expires_in, ... } — TikTok is already
  // flat too, but Meta omits refresh_token/expires_in for a short-lived
  // token) into one contract callers can rely on.
  const accessToken = payload?.access_token || null;
  if (!accessToken) return { ok: false, error: `${platform} token response carried no access_token.` };
  return {
    ok: true,
    accessToken,
    refreshToken: payload?.refresh_token || null,
    expiresInSeconds: Number(payload?.expires_in) || null,
    scope: payload?.scope || null,
    raw: payload
  };
}

/** Meta-only: exchanges a short-lived user token for a long-lived one
 * (~60 days) via grant_type=fb_exchange_token — Meta's documented
 * mechanism for extending a token's life; Meta does not support a
 * standard OAuth refresh_token grant. */
export async function exchangeLongLivedFacebookToken(platform, { accessToken, env = process.env } = {}) {
  if (platform !== "facebook" && platform !== "instagram") return { ok: false, error: "Long-lived exchange is only defined for facebook/instagram." };
  if (!isPlatformConfigured(platform, env)) return { ok: false, error: `${platform} OAuth credentials are not configured.` };
  if (!accessToken) return { ok: false, error: "accessToken is required." };

  const cfg = OAUTH_CONFIG[platform];
  const { clientIdVar, clientSecretVar } = platformOAuthEnvVarNames(platform);
  const url = new URL(cfg.tokenUrl);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", String(env[clientIdVar] || "").trim());
  url.searchParams.set("client_secret", String(env[clientSecretVar] || "").trim());
  url.searchParams.set("fb_exchange_token", accessToken);

  let response;
  try {
    response = await fetch(url.toString());
  } catch (error) {
    return { ok: false, error: `${platform} long-lived token exchange failed: ${String(error?.message || error).slice(0, 200)}` };
  }
  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    return { ok: false, error: payload?.error?.message || `${platform} returned ${response.status}` };
  }
  if (!payload?.access_token) return { ok: false, error: `${platform} long-lived exchange carried no access_token.` };
  return { ok: true, accessToken: payload.access_token, expiresInSeconds: Number(payload.expires_in) || null };
}

/**
 * Facebook Pages / Instagram publishing both authenticate with a
 * page-scoped access token, never the connecting user's own token — a
 * gap the original OAuth pass left unresolved (a not-fully-wired
 * integration, not a working one). Real, documented resolution chain
 * (verified via live search during this pass):
 *   GET /me/accounts?fields=id,name,access_token (using the long-lived
 *   USER token) lists every Page the user manages, each with its own
 *   access token — long-lived when derived from a long-lived user token,
 *   per Meta's documented behavior, which is why this must run AFTER
 *   exchangeLongLivedFacebookToken(), never before.
 */
export async function resolveFacebookPages({ accessToken, env = process.env } = {}) {
  if (!accessToken) return { ok: false, error: "accessToken is required." };
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", "id,name,access_token");
  let response;
  try {
    response = await fetch(url.toString());
  } catch (error) {
    return { ok: false, error: `Could not list Facebook Pages: ${String(error?.message || error).slice(0, 200)}` };
  }
  const payload = await parseJsonSafely(response);
  if (!response.ok) return { ok: false, error: payload?.error?.message || `Meta returned ${response.status}` };
  const pages = (payload?.data || []).map((p) => ({ id: p.id, name: p.name, accessToken: p.access_token }));
  return { ok: true, pages };
}

/** Resolves the Instagram professional account linked to a given
 * Facebook Page — GET /{page-id}?fields=instagram_business_account,
 * authenticated with that Page's own access token (not the user token).
 * A Page with no linked Instagram account returns ok:false, never a
 * fabricated id. */
export async function resolveInstagramBusinessAccount({ pageId, pageAccessToken, env = process.env } = {}) {
  if (!pageId || !pageAccessToken) return { ok: false, error: "pageId and pageAccessToken are required." };
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}`);
  url.searchParams.set("access_token", pageAccessToken);
  url.searchParams.set("fields", "instagram_business_account");
  let response;
  try {
    response = await fetch(url.toString());
  } catch (error) {
    return { ok: false, error: `Could not resolve the linked Instagram account: ${String(error?.message || error).slice(0, 200)}` };
  }
  const payload = await parseJsonSafely(response);
  if (!response.ok) return { ok: false, error: payload?.error?.message || `Meta returned ${response.status}` };
  const igUserId = payload?.instagram_business_account?.id;
  if (!igUserId) return { ok: false, error: "This Facebook Page has no linked Instagram professional (Business/Creator) account." };
  return { ok: true, igUserId };
}

/** TikTok-only: refreshes an access token via the standard refresh_token
 * grant. Meta tokens are refreshed by re-running exchangeLongLivedFacebookToken
 * instead — Meta has no refresh_token grant on this flow. */
export async function refreshTikTokToken({ refreshToken, env = process.env } = {}) {
  if (!isPlatformConfigured("tiktok", env)) return { ok: false, error: "tiktok OAuth credentials are not configured." };
  if (!refreshToken) return { ok: false, error: "refreshToken is required." };
  const cfg = OAUTH_CONFIG.tiktok;
  const { clientIdVar, clientSecretVar } = platformOAuthEnvVarNames("tiktok");
  const form = new URLSearchParams({
    client_key: String(env[clientIdVar] || "").trim(),
    client_secret: String(env[clientSecretVar] || "").trim(),
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  let response;
  try {
    response = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: form.toString()
    });
  } catch (error) {
    return { ok: false, error: `tiktok token refresh failed: ${String(error?.message || error).slice(0, 200)}` };
  }
  const payload = await parseJsonSafely(response);
  if (!response.ok) return { ok: false, error: payload?.error?.message || payload?.error_description || `tiktok returned ${response.status}` };
  if (!payload?.access_token) return { ok: false, error: "tiktok refresh response carried no access_token." };
  return {
    ok: true,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || refreshToken,
    expiresInSeconds: Number(payload.expires_in) || null
  };
}

export function oauthScopesFor(platform) {
  return isOAuthArchitected(platform) ? OAUTH_CONFIG[platform].scopes.slice() : [];
}
