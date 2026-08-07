import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
import { checkRateLimit, checkDistributedRateLimit } from "./_shared/production.js";
import { validateEmail } from "./_shared/validation.js";
import { authRedirectPath } from "./_shared/site-url.js";
import { fetchWithTimeout, requestIdOf } from "./_shared/upstream.js";
import { logAuthEvent, mapAuthProviderFailure, jsonAuthError } from "./_shared/auth-email.js";
import { sendSignupConfirmationEmail } from "./_shared/auth-confirmation-email.js";
import { emailProviderConfigured } from "./_shared/notification-email.js";

export async function handler(event) {
  const requestId = requestIdOf(event);
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  const localLimit = checkRateLimit(event, { key: "auth-resend-confirmation", limit: 5, windowMs: 60_000 });
  const distributed = await checkDistributedRateLimit(event, { key: "auth-resend-confirmation", limit: 8, windowMs: 60_000 });
  const limit = !localLimit.allowed ? localLimit : distributed;
  if (!limit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((limit.retryAfterMs || 60_000) / 1000));
    const limited = json(429, {
      error: "Too many confirmation email requests. Please wait and try again.",
      code: "auth_rate_limited",
      retryAfterSeconds
    }, process.env, event);
    limited.headers = { ...limited.headers, "Retry-After": String(retryAfterSeconds) };
    return limited;
  }

  try {
    const body = bodyOf(event);
    const emailCheck = validateEmail(body.email, { required: true });
    if (!emailCheck.ok) return json(400, { error: emailCheck.error, code: emailCheck.code || "invalid_email" });

    const origin = event.headers?.origin || event.headers?.Origin || "";
    const redirectTo = authRedirectPath(process.env, origin, "/verify-email?confirmed=1");

    // Preferred path: generate confirmation link + send via Resend/SendGrid (reliable delivery).
    const direct = await sendSignupConfirmationEmail({
      email: emailCheck.value,
      fullName: body.fullName || "",
      shopName: body.shopName || "",
      origin,
      env: process.env
    });
    if (direct.sent) {
      logAuthEvent("info", "auth_resend_email_sent", {
        email_domain: emailCheck.value.split("@")[1],
        provider: direct.provider,
        request_id: requestId
      }, event);
      return json(200, {
        ok: true,
        code: "resend_accepted",
        confirmationEmailSent: true,
        message: "If this email has an unconfirmed Florisyn account, a new confirmation link will arrive shortly. Already confirmed? Use Forgot Password instead."
      });
    }

    // Fallback: Supabase Auth resend with redirect_to as query (GoTrue-compatible).
    const { url, anonKey } = publicSettings();
    const response = await fetchWithTimeout(`${url}/auth/v1/resend?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      body: JSON.stringify({
        type: "signup",
        email: emailCheck.value
      })
    }, { timeoutMs: 5_000, service: "Email confirmation service" });
    const data = await response.json().catch(() => ({}));
    const mapped = mapAuthProviderFailure(response, data, { flow: "resend" });
    if (mapped.statusCode >= 500 || mapped.code === "auth_rate_limited") {
      logAuthEvent("error", mapped.code === "auth_rate_limited" ? "auth_resend_rate_limited" : "auth_resend_provider_unavailable", {
        email_domain: emailCheck.value.split("@")[1],
        provider_status: response.status,
        code: mapped.code,
        direct_reason: direct.reason || null,
        mailer_configured: emailProviderConfigured(process.env).configured,
        request_id: requestId
      }, event);
      return jsonAuthError(mapped, process.env, event);
    }
    logAuthEvent("info", "auth_resend_accepted", {
      email_domain: emailCheck.value.split("@")[1],
      provider_status: response.status,
      direct_reason: direct.reason || null,
      mailer_configured: emailProviderConfigured(process.env).configured,
      request_id: requestId
    }, event);
    return json(200, {
      ok: true,
      code: "resend_accepted",
      confirmationEmailSent: false,
      message: "If this email has an unconfirmed Florisyn account, a new confirmation link will arrive shortly. Already confirmed? Use Forgot Password instead."
    });
  } catch (error) {
    return fail(error);
  }
}
