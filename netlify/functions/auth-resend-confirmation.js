import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { fail } from "./_shared/supabase.js";
import { checkRateLimit, checkDistributedRateLimit } from "./_shared/production.js";
import { validateEmail } from "./_shared/validation.js";
import { requestIdOf } from "./_shared/upstream.js";
import { logAuthEvent } from "./_shared/auth-email.js";
import { sendSignupConfirmationEmail } from "./_shared/auth-confirmation-email.js";
import { emailProviderConfigured } from "./_shared/notification-email.js";

export async function handler(event) {
  const requestId = requestIdOf(event);
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  const localLimit = checkRateLimit(event, { key: "auth-resend-confirmation", limit: 5, windowMs: 60_000 });
  const distributed = await checkDistributedRateLimit(event, {
    key: "auth-resend-confirmation",
    limit: 8,
    windowMs: 60_000
  });
  const limit = !localLimit.allowed ? localLimit : distributed;
  if (!limit.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((limit.retryAfterMs || 60_000) / 1000));
    const limited = json(
      429,
      {
        error: "Too many confirmation email requests. Please wait and try again.",
        code: "auth_rate_limited",
        retryAfterSeconds
      },
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

    // Single reliable path: Supabase admin link (or already-confirmed notice) + Resend.
    // Do not fall back to Supabase's own mailer — it is not configured for Florisyn.
    const direct = await sendSignupConfirmationEmail({
      email: emailCheck.value,
      fullName: body.fullName || "",
      shopName: body.shopName || "",
      origin,
      env: process.env
    });

    if (direct.sent) {
      logAuthEvent(
        "info",
        direct.alreadyConfirmed ? "auth_resend_already_confirmed_email_sent" : "auth_resend_email_sent",
        {
          email_domain: emailCheck.value.split("@")[1],
          provider: direct.provider,
          already_confirmed: Boolean(direct.alreadyConfirmed),
          link_type: direct.linkType || null,
          request_id: requestId
        },
        event
      );
      return json(
        200,
        {
          ok: true,
          code: direct.alreadyConfirmed ? "already_confirmed" : "resend_accepted",
          confirmationEmailSent: true,
          message: direct.alreadyConfirmed
            ? "This email is already confirmed. We sent a sign-in reminder — open Sign in to continue."
            : "If this email has an unconfirmed Florisyn account, a new confirmation link will arrive shortly."
        },
        process.env,
        event
      );
    }

    logAuthEvent(
      "warn",
      "auth_resend_direct_failed",
      {
        email_domain: emailCheck.value.split("@")[1],
        reason: direct.reason || null,
        detail: direct.detail ? String(direct.detail).slice(0, 160) : null,
        mailer_configured: emailProviderConfigured(process.env).configured,
        request_id: requestId
      },
      event
    );

    if (direct.reason === "user_not_found") {
      // Privacy-preserving success copy — no account enumeration.
      return json(
        200,
        {
          ok: true,
          code: "resend_accepted",
          confirmationEmailSent: false,
          message:
            "If this email has an unconfirmed Florisyn account, a new confirmation link will arrive shortly. Already confirmed? Use Sign in or Forgot Password."
        },
        process.env,
        event
      );
    }

    if (
      direct.reason === "email_from_not_configured" ||
      direct.reason === "provider_not_configured" ||
      direct.reason === "supabase_server_key_missing"
    ) {
      return json(
        503,
        {
          error: "Confirmation email is not fully configured yet. Please try again shortly or contact Florisyn support.",
          code: direct.reason,
          confirmationEmailSent: false
        },
        process.env,
        event
      );
    }

    if (direct.reason === "provider_error" || direct.reason === "generate_link_failed" || direct.reason === "user_lookup_failed") {
      return json(
        503,
        {
          error: "Confirmation email could not be sent right now. Please wait a minute and try again.",
          code: direct.reason === "provider_error" ? "auth_email_provider_unavailable" : direct.reason,
          confirmationEmailSent: false
        },
        process.env,
        event
      );
    }

    return json(
      503,
      {
        error: "Confirmation email could not be sent right now. Please try again shortly.",
        code: direct.reason || "auth_email_provider_unavailable",
        confirmationEmailSent: false
      },
      process.env,
      event
    );
  } catch (error) {
    return fail(error, process.env, event);
  }
}
