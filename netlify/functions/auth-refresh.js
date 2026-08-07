import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
import { fetchWithTimeout, requestIdOf } from "./_shared/upstream.js";
import { checkRateLimit } from "./_shared/production.js";
import { assertFloristAccessOrAdmin } from "./_shared/florist-access.js";

export async function handler(event) {
  const requestId = requestIdOf(event);
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();
  const limit = checkRateLimit(event,{key:"auth-refresh",limit:120,windowMs:60_000});
  if (!limit.allowed) {
    return json(429, { error: "Too many session refresh attempts. Please sign in again.", code: "auth_rate_limited" }, process.env, event);
  }
  try {
    const body = bodyOf(event);
    const { url, anonKey } = publicSettings();
    if (!String(body.refreshToken || "").trim()) {
      return json(400, { error: "Refresh token is required." }, process.env, event);
    }
    const response = await fetchWithTimeout(
      `${url}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`
        },
        body: JSON.stringify({ refresh_token: body.refreshToken })
      },
      { timeoutMs: 5_000, service: "Session refresh service" }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(response.status >= 400 && response.status < 600 ? response.status : 401, {
        error: "Session expired",
        code: "session_expired"
      }, process.env, event);
    }

    const access = await assertFloristAccessOrAdmin(data.user?.id, event, requestId, { flow: "refresh" });
    if (!access.ok) {
      return json(access.status || 403, { error: access.error, code: access.code }, process.env, event);
    }

    return json(200, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      user: data.user
    }, process.env, event);
  } catch (error) {
    return fail(error, process.env, event);
  }
}
