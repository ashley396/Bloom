/**
 * Auth email / provider failure mapping with redacted structured logging.
 * Never log passwords, tokens, reset links, or service keys.
 */

import { structuredLog } from "./production.js";
import { requestIdOf } from "./upstream.js";
import { json } from "./http.js";

const SENSITIVE_META_KEYS = /pass(word)?|token|secret|authorization|apikey|api_key|refresh|access_token|redirect|link|cookie/i;

export function redactAuthMeta(meta = {}) {
  const out = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (SENSITIVE_META_KEYS.test(key)) continue;
    if (typeof value === "string") {
      out[key] = value.length > 180 ? `${value.slice(0, 180)}…` : value;
    } else if (typeof value === "number" || typeof value === "boolean" || value == null) {
      out[key] = value;
    } else {
      out[key] = String(value).slice(0, 120);
    }
  }
  return out;
}

export function logAuthEvent(level, eventName, meta = {}, event = null) {
  structuredLog(level, eventName, redactAuthMeta({
    ...meta,
    request_id: meta.request_id || requestIdOf(event) || undefined
  }));
}

/**
 * Classify Supabase Auth / upstream email failures into safe client responses.
 * Returns { statusCode, error, code }.
 */
export function mapAuthProviderFailure(response, data = {}, { flow = "auth" } = {}) {
  const status = Number(response?.status || 0);
  const raw = String(data?.error_description || data?.msg || data?.message || data?.error || "").toLowerCase();

  if (status === 429 || /rate limit|too many/i.test(raw)) {
    return {
      statusCode: 429,
      code: "auth_rate_limited",
      error: "Too many email requests. Please wait a minute and try again.",
      retryAfterSeconds: 60
    };
  }

  if (status >= 500 || /smtp|mailer|provider|temporarily unavailable|timeout/i.test(raw)) {
    return {
      statusCode: 503,
      code: "auth_email_provider_unavailable",
      error: "Email delivery is temporarily unavailable. Try again shortly or contact Florisyn support."
    };
  }

  if (/email not confirmed|confirm your email/i.test(raw)) {
    return {
      statusCode: 401,
      code: "email_not_confirmed",
      error: "Email not confirmed. Check your inbox or resend the confirmation email."
    };
  }

  if (/already.*(registered|exists|been registered)|user already/i.test(raw)) {
    return {
      statusCode: 400,
      code: "account_already_registered",
      error: "An account with this email may already exist. Sign in or use Forgot Password."
    };
  }

  if (/invalid.*(email|format)|unable to validate email|email address.*invalid/i.test(raw)) {
    return {
      statusCode: 400,
      code: "invalid_email_domain",
      error: "Enter a valid business email address with a real domain."
    };
  }

  if (flow === "reset" || /expired|invalid.*(token|otp|link)|not allowed/i.test(raw)) {
    return {
      statusCode: 400,
      code: "reset_link_expired",
      error: "This reset link is invalid or expired. Request a new password reset email."
    };
  }

  if (flow === "signup") {
    return {
      statusCode: status >= 400 && status < 500 ? status : 400,
      code: "signup_failed",
      error: "Could not create account. Check your details or request a new confirmation email."
    };
  }

  if (flow === "resend") {
    return {
      statusCode: status >= 500 ? status : 200,
      code: status >= 500 ? "auth_email_provider_unavailable" : "resend_accepted",
      error: status >= 500
        ? "Email delivery is temporarily unavailable. Try again shortly."
        : null,
      ok: status < 500
    };
  }

  if (flow === "recover") {
    // Always generic success to callers; map only hard provider outages.
    if (status >= 500) {
      return {
        statusCode: 503,
        code: "auth_email_provider_unavailable",
        error: "Email delivery is temporarily unavailable. Try again shortly or contact Florisyn support."
      };
    }
    return {
      statusCode: 200,
      code: "recover_accepted",
      error: null,
      ok: true
    };
  }

  return {
    statusCode: status >= 400 && status < 600 ? status : 400,
    code: "auth_request_failed",
    error: "Could not complete this account request. Try again or contact support."
  };
}

export function jsonAuthError(mapped, env = process.env, event = null) {
  const body = { error: mapped.error, code: mapped.code };
  if (mapped.ok) body.ok = true;
  if (mapped.retryAfterSeconds) body.retryAfterSeconds = mapped.retryAfterSeconds;
  const response = json(mapped.statusCode, body, env, event);
  if (mapped.retryAfterSeconds) {
    response.headers = { ...response.headers, "Retry-After": String(mapped.retryAfterSeconds) };
  }
  if (mapped.requestId) {
    response.headers = { ...response.headers, "x-request-id": String(mapped.requestId) };
  }
  return response;
}
