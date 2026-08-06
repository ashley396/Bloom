import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
import { checkRateLimit } from "./_shared/production.js";
import { validateEmail } from "./_shared/validation.js";
import { authRedirectPath } from "./_shared/site-url.js";
import { fetchWithTimeout, requestIdOf } from "./_shared/upstream.js";
import { logAuthEvent, mapAuthProviderFailure, jsonAuthError } from "./_shared/auth-email.js";

export async function handler(event) {
  const requestId = requestIdOf(event);
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  const limit = checkRateLimit(event, { key: "auth-resend-confirmation", limit: 5, windowMs: 60_000 });
  if (!limit.allowed) return json(429, { error: "Too many confirmation email requests. Please wait and try again.", code: "auth_rate_limited" });

  try {
    const body = bodyOf(event);
    const emailCheck = validateEmail(body.email, { required: true });
    if (!emailCheck.ok) return json(400, { error: emailCheck.error, code: emailCheck.code || "invalid_email" });

    const { url, anonKey } = publicSettings();
    const origin = event.headers?.origin || event.headers?.Origin || "";
    const redirectTo = authRedirectPath(process.env, origin, "/verify-email?confirmed=1");
    const response = await fetchWithTimeout(`${url}/auth/v1/resend`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      body: JSON.stringify({
        type: "signup",
        email: emailCheck.value,
        options: { email_redirect_to: redirectTo, emailRedirectTo: redirectTo }
      })
    }, { timeoutMs: 5_000, service: "Email confirmation service" });
    const data = await response.json().catch(() => ({}));
    const mapped = mapAuthProviderFailure(response, data, { flow: "resend" });
    if (mapped.statusCode >= 500) {
      logAuthEvent("error", "auth_resend_provider_unavailable", {
        email_domain: emailCheck.value.split("@")[1],
        provider_status: response.status,
        code: mapped.code,
        request_id: requestId
      }, event);
      return jsonAuthError(mapped);
    }
    logAuthEvent("info", "auth_resend_accepted", {
      email_domain: emailCheck.value.split("@")[1],
      provider_status: response.status,
      request_id: requestId
    }, event);
    return json(200, {
      ok: true,
      code: "resend_accepted",
      message: "If this email has an unconfirmed Florisyn account, a new confirmation link will arrive shortly. Already confirmed? Use Forgot Password instead."
    });
  } catch (error) {
    return fail(error);
  }
}
