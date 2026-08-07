import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
import { checkDistributedRateLimit } from "./_shared/production.js";
import { fetchWithTimeout, requestIdOf } from "./_shared/upstream.js";
import { logAuthEvent, mapAuthProviderFailure, jsonAuthError } from "./_shared/auth-email.js";

export async function handler(event) {
  const requestId = requestIdOf(event);
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();
  const limit = await checkDistributedRateLimit(event, { key: "auth-reset", limit: 15, windowMs: 60_000 });
  if (!limit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((limit.retryAfterMs || 60_000) / 1000));
    const limited = json(429, { error: "Too many requests. Please wait and try again.", code: "auth_rate_limited", retryAfterSeconds }, process.env, event);
    limited.headers = { ...limited.headers, "Retry-After": String(retryAfterSeconds) };
    return limited;
  }

  try {
    const body = bodyOf(event);
    const password = String(body.password || "");
    const accessToken = String(body.access_token || "");
    if (!accessToken) return json(400, { error: "Reset session is missing. Open the link from your email again.", code: "reset_link_expired" });
    if (password.length < 8) return json(400, { error: "Password must be at least 8 characters.", code: "password_too_short" });

    const { url, anonKey } = publicSettings();
    const response = await fetchWithTimeout(`${url}/auth/v1/user`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ password })
    }, { timeoutMs: 5_000, service: "Password reset service" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const mapped = mapAuthProviderFailure(response, data, { flow: "reset" });
      logAuthEvent("warn", "auth_reset_failed", {
        provider_status: response.status,
        code: mapped.code,
        request_id: requestId
      }, event);
      return jsonAuthError({ ...mapped, code: "reset_link_expired", error: "This reset link is invalid or expired. Request a new password reset email." }, process.env, event);
    }
    logAuthEvent("info", "auth_reset_success", { request_id: requestId }, event);
    return json(200, { ok: true, code: "reset_success" });
  } catch (error) {
    return fail(error);
  }
}
