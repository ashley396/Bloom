/**
 * OAuth callback receiver for social publishing connections (Priority 3).
 *
 * This is a public, unauthenticated endpoint by necessity — the platform
 * (Facebook/Instagram/TikTok) redirects the admin's browser here directly
 * after consent, carrying no Authorization header at all. Trust comes
 * entirely from the signed `state` param (see marketing-social-oauth.js's
 * signOAuthState/verifyOAuthState — same HMAC/base64url convention as
 * bloom-storefront-core.js's preview token), never from a bearer token.
 * Same dependency-injectable-core / thin-handler-wrapper shape as
 * heygen-webhook.js, for the same handler-level-testability reason.
 *
 * Every branch below either completes a real token exchange and stores a
 * real (encrypted) connection, or redirects back with a clear, honest
 * failure reason — never a fabricated "connected" state.
 */

import { admin as adminClient } from "./_shared/supabase.js";
import { verifyOAuthState, exchangeCodeForToken, exchangeLongLivedFacebookToken, encryptSocialToken } from "./_shared/marketing-social-oauth.js";
import { resolvePublicSiteUrl } from "./_shared/site-url.js";
import { writeAdminAudit } from "./_shared/platform-admin.js";

function log(message, extra = {}) {
  console.warn(JSON.stringify({ level: "warn", fn: "marketing-social-oauth-callback", message, ...extra }));
}

function redirectTo(url) {
  return { statusCode: 302, headers: { Location: url }, body: "" };
}

/** Core logic, dependency-injectable for handler-level tests. */
export async function handleMarketingSocialOAuthCallback(event, dependencies = {}) {
  const getClient = dependencies.admin || adminClient;
  const verify = dependencies.verifyOAuthState || verifyOAuthState;
  const exchange = dependencies.exchangeCodeForToken || exchangeCodeForToken;
  const exchangeLongLived = dependencies.exchangeLongLivedFacebookToken || exchangeLongLivedFacebookToken;
  const encrypt = dependencies.encryptSocialToken || encryptSocialToken;

  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };

  const qs = event.queryStringParameters || {};
  const baseUrl = resolvePublicSiteUrl(process.env, event.headers?.origin);
  const adminUrl = (params) => `${baseUrl}/admin?${new URLSearchParams(params).toString()}`;

  if (qs.error) {
    // The provider's own denial/error path (e.g. the admin clicked
    // "cancel" on the consent screen) — nothing to store, just report it.
    log("provider_denied", { error: qs.error, description: qs.error_description });
    return redirectTo(adminUrl({ oauth: "error", message: `Connection was not completed: ${qs.error_description || qs.error}` }));
  }

  const verified = verify(qs.state, { env: process.env });
  if (!verified.valid) {
    log("state_invalid", { reason: verified.error });
    return redirectTo(adminUrl({ oauth: "error", message: verified.error || "Could not verify this connection attempt." }));
  }
  const { platform, shopId, userId, codeVerifier } = verified;

  if (!qs.code) {
    return redirectTo(adminUrl({ oauth: "error", platform, message: `${platform} did not return an authorization code.` }));
  }

  const redirectUri = `${baseUrl}/.netlify/functions/marketing-social-oauth-callback`;
  const tokenResult = await exchange(platform, { code: qs.code, redirectUri, codeVerifier, env: process.env });
  if (!tokenResult.ok) {
    log("token_exchange_failed", { platform, shopId, reason: tokenResult.error });
    return redirectTo(adminUrl({ oauth: "error", platform, message: `Could not complete the connection: ${tokenResult.error}` }));
  }

  let accessToken = tokenResult.accessToken;
  let expiresInSeconds = tokenResult.expiresInSeconds;
  if ((platform === "facebook" || platform === "instagram") && !tokenResult.refreshToken) {
    // Meta issues a short-lived (~1-2hr) user token from the code exchange
    // — extend it to the real long-lived (~60 day) token before storing,
    // per Meta's own documented mechanism (fb_exchange_token). A failure
    // here still leaves a usable (if short-lived) connection rather than
    // discarding a token the admin just approved.
    const longLived = await exchangeLongLived(platform, { accessToken, env: process.env });
    if (longLived.ok) {
      accessToken = longLived.accessToken;
      expiresInSeconds = longLived.expiresInSeconds;
    } else {
      log("long_lived_exchange_failed", { platform, shopId, reason: longLived.error });
    }
  }

  const client = getClient();
  const expiresAt = expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null;

  const upserted = await client
    .from("marketing_social_connections")
    .upsert(
      {
        shop_id: shopId,
        platform,
        status: "connected",
        connected_at: new Date().toISOString(),
        expires_at: expiresAt,
        last_error: null,
        last_checked_at: new Date().toISOString()
      },
      { onConflict: "shop_id,platform" }
    )
    .select("id")
    .single();

  if (upserted.error || !upserted.data?.id) {
    log("connection_upsert_failed", { platform, shopId, reason: upserted.error?.message });
    return redirectTo(adminUrl({ oauth: "error", platform, message: "Token exchange succeeded but the connection could not be saved. Try again." }));
  }

  const accessCipher = encrypt(accessToken, process.env);
  const refreshCipher = tokenResult.refreshToken ? encrypt(tokenResult.refreshToken, process.env) : null;
  if (!accessCipher) {
    log("token_encryption_unconfigured", { platform, shopId });
    return redirectTo(adminUrl({ oauth: "error", platform, message: "Token exchange succeeded but Florisyn's token encryption key is not configured — the connection was not saved. Set FLORISYN_MARKETING_TOKEN_KEY." }));
  }

  await client.from("marketing_social_connection_secrets").upsert(
    {
      connection_id: upserted.data.id,
      shop_id: shopId,
      access_token_ciphertext: accessCipher,
      refresh_token_ciphertext: refreshCipher,
      scope: tokenResult.scope || null,
      provider_metadata: {},
      updated_at: new Date().toISOString()
    },
    { onConflict: "connection_id" }
  );

  try {
    await writeAdminAudit(client, userId, shopId, "marketing_platform_connected", {
      target_type: "marketing_social_connections",
      target_id: platform,
      result: "success"
    });
  } catch (error) {
    log("audit_write_failed", { platform, shopId, reason: String(error?.message || error) });
  }

  return redirectTo(adminUrl({ oauth: "success", platform }));
}

export async function handler(event) {
  return handleMarketingSocialOAuthCallback(event);
}
