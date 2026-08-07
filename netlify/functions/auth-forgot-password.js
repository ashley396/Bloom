import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { fail } from "./_shared/supabase.js";
import { checkDistributedRateLimit } from "./_shared/production.js";
import { validateEmail } from "./_shared/validation.js";
import { requestIdOf } from "./_shared/upstream.js";
import { logAuthEvent } from "./_shared/auth-email.js";
import { sendPasswordResetEmail } from "./_shared/auth-confirmation-email.js";
import { emailProviderConfigured } from "./_shared/notification-email.js";

export async function handler(event) {
  const requestId = requestIdOf(event);
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();
  const limit = await checkDistributedRateLimit(event, { key: "auth-forgot", limit: 10, windowMs: 60_000 });
  if (!limit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((limit.retryAfterMs || 60_000) / 1000));
    const limited = json(
      429,
      { error: "Too many requests. Please wait and try again.", code: "auth_rate_limited", retryAfterSeconds },
      process.env,
      event
    );
    limited.headers = { ...limited.headers, "Retry-After": String(retryAfterSeconds) };
    return limited;
  }

  try {
    const body = bodyOf(event);
    const emailCheck = validateEmail(body.email, { required: true });
    if (!emailCheck.ok) {
      return json(400, { error: emailCheck.error, code: emailCheck.code || "invalid_email" }, process.env, event);
    }

    const origin = event.headers?.origin || event.headers?.Origin || "";
    const direct = await sendPasswordResetEmail({
      email: emailCheck.value,
      fullName: body.fullName || "",
      origin,
      env: process.env
    });

    // Always return the same privacy-preserving success copy when the account is missing.
    if (direct.sent || direct.reason === "user_not_found") {
      logAuthEvent(
        "info",
        direct.sent ? "auth_recover_email_sent" : "auth_recover_accepted",
        {
          email_domain: emailCheck.value.split("@")[1],
          provider: direct.provider || null,
          mailer_configured: emailProviderConfigured(process.env).configured,
          request_id: requestId
        },
        event
      );
      return json(
        200,
        {
          ok: true,
          code: "recover_accepted",
          resetEmailSent: Boolean(direct.sent),
          message: "If an account exists for this email, you will receive password reset instructions shortly."
        },
        process.env,
        event
      );
    }

    logAuthEvent(
      "error",
      "auth_recover_provider_unavailable",
      {
        email_domain: emailCheck.value.split("@")[1],
        reason: direct.reason || null,
        detail: direct.detail ? String(direct.detail).slice(0, 160) : null,
        mailer_configured: emailProviderConfigured(process.env).configured,
        request_id: requestId
      },
      event
    );

    return json(
      503,
      {
        error: "Password reset email could not be sent right now. Please try again shortly.",
        code: direct.reason === "provider_error" ? "auth_email_provider_unavailable" : direct.reason || "auth_email_provider_unavailable",
        resetEmailSent: false
      },
      process.env,
      event
    );
  } catch (error) {
    return fail(error, process.env, event);
  }
}
