import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { publicSettings, fail } from "./_shared/supabase.js";
import { checkDistributedRateLimit } from "./_shared/production.js";
import { validateEmail } from "./_shared/validation.js";
import { authRedirectPath } from "./_shared/site-url.js";
import { fetchWithTimeout, requestIdOf } from "./_shared/upstream.js";
import { logAuthEvent, mapAuthProviderFailure, jsonAuthError } from "./_shared/auth-email.js";
import { sendPasswordRecoveryEmail } from "./_shared/auth-recovery-email.js";

export async function handler(event) {
  const requestId = requestIdOf(event);
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();
  const limit = await checkDistributedRateLimit(event, { key: "auth-forgot", limit: 10, windowMs: 60_000 });
  if (!limit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((limit.retryAfterMs || 60_000) / 1000));
    const limited = json(429, { error: "Too many requests. Please wait and try again.", code: "auth_rate_limited", retryAfterSeconds }, process.env, event);
    limited.headers = { ...limited.headers, "Retry-After": String(retryAfterSeconds) };
    return limited;
  }

  try {
    const body = bodyOf(event);
    const emailCheck = validateEmail(body.email, { required: true });
    if (!emailCheck.ok) return json(400, { error: emailCheck.error, code: emailCheck.code || "invalid_email" });

    const origin = event.headers?.origin || event.headers?.Origin || "";
    const redirectTo = authRedirectPath(process.env, origin, "/reset-password");

    // Prefer Florisyn-branded Resend email with an explicit production redirect (never localhost).
    const branded = await sendPasswordRecoveryEmail({
      email: emailCheck.value,
      origin,
      env: process.env
    });
    if (branded.sent) {
      logAuthEvent(
        "info",
        "auth_recover_branded_sent",
        {
          email_domain: emailCheck.value.split("@")[1],
          provider: branded.provider,
          redirect_host: (() => {
            try {
              return new URL(branded.redirectTo || redirectTo).host;
            } catch {
              return "unknown";
            }
          })(),
          request_id: requestId
        },
        event
      );
      return json(200, {
        ok: true,
        code: "recover_accepted",
        message: "If an account exists for this email, you will receive password reset instructions shortly."
      });
    }

    if (branded.reason && branded.reason !== "provider_not_configured") {
      logAuthEvent(
        "warn",
        "auth_recover_branded_fallback",
        {
          email_domain: emailCheck.value.split("@")[1],
          reason: branded.reason,
          request_id: requestId
        },
        event
      );
    }

    const { url, anonKey } = publicSettings();
    const response = await fetchWithTimeout(`${url}/auth/v1/recover`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      body: JSON.stringify({ email: emailCheck.value, redirect_to: redirectTo })
    }, { timeoutMs: 5_000, service: "Password recovery service" });
    const data = await response.json().catch(() => ({}));
    const mapped = mapAuthProviderFailure(response, data, { flow: "recover" });
    if (mapped.statusCode >= 500 || mapped.code === "auth_rate_limited") {
      logAuthEvent("error", mapped.code === "auth_rate_limited" ? "auth_recover_rate_limited" : "auth_recover_provider_unavailable", {
        email_domain: emailCheck.value.split("@")[1],
        provider_status: response.status,
        code: mapped.code,
        request_id: requestId
      }, event);
      return jsonAuthError(mapped);
    }
    logAuthEvent("info", "auth_recover_accepted", {
      email_domain: emailCheck.value.split("@")[1],
      provider_status: response.status,
      redirect_host: (() => {
        try {
          return new URL(redirectTo).host;
        } catch {
          return "unknown";
        }
      })(),
      request_id: requestId
    }, event);
    return json(200, {
      ok: true,
      code: "recover_accepted",
      message: "If an account exists for this email, you will receive password reset instructions shortly. If the link opens localhost, update Supabase Authentication → URL Configuration Site URL to https://www.florisyn.com and add that domain under Redirect URLs."
    });
  } catch (error) {
    return fail(error);
  }
}
