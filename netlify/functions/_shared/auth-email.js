/**
 * Auth email / provider failure mapping with redacted structured logging.
 * Never log passwords, tokens, reset links, or service keys.
 */

import { structuredLog } from "./production.js";
import { requestIdOf } from "./upstream.js";

const SENSITIVE_META_KEYS = /pass(word)?|token|secret|authorization|apikey|api_key|refresh|access_token|redirect|link|cookie/i;

// Password-recovery rate-limit countdown (forgot-password only — see
// resolveProviderRetryAfterSeconds below): a conservative bound applied
// whenever Supabase's 429 gives us no trustworthy wait duration of its
// own. Deliberately not an invented "provider reset timestamp" — just a
// safe, clearly-labeled fallback the client can count down from.
export const FALLBACK_RATE_LIMIT_RETRY_SECONDS = 60;
const MIN_TRUSTED_RETRY_AFTER_SECONDS = 1;
// A malformed/hostile Retry-After (header or body) should never produce
// an absurd countdown — clamp anything provider-supplied to 15 minutes.
const MAX_TRUSTED_RETRY_AFTER_SECONDS = 900;

function clampRetryAfterSeconds(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const rounded = Math.ceil(seconds);
  if (rounded < MIN_TRUSTED_RETRY_AFTER_SECONDS) return null;
  return Math.min(rounded, MAX_TRUSTED_RETRY_AFTER_SECONDS);
}

/**
 * Looks for a trustworthy provider-supplied retry duration — a real
 * Retry-After response header (seconds or an HTTP-date), or a numeric
 * retry_after field some GoTrue rate-limit bodies include — and never
 * guesses one. Returns { seconds, source: "provider_header" |
 * "provider_body" } or null when nothing trustworthy is present.
 */
export function resolveProviderRetryAfterSeconds(response, data) {
  const header = typeof response?.headers?.get === "function" ? response.headers.get("retry-after") : null;
  if (header) {
    const trimmed = String(header).trim();
    if (/^\d+$/.test(trimmed)) {
      const seconds = clampRetryAfterSeconds(Number(trimmed));
      if (seconds) return { seconds, source: "provider_header" };
    } else {
      const parsedDate = Date.parse(trimmed);
      if (Number.isFinite(parsedDate)) {
        const seconds = clampRetryAfterSeconds((parsedDate - Date.now()) / 1000);
        if (seconds) return { seconds, source: "provider_header" };
      }
    }
  }
  const bodyRetryAfter = data?.retry_after ?? data?.retryAfter;
  if (typeof bodyRetryAfter === "number") {
    const seconds = clampRetryAfterSeconds(bodyRetryAfter);
    if (seconds) return { seconds, source: "provider_body" };
  }
  return null;
}

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
    const result = {
      statusCode: 429,
      code: "auth_rate_limited",
      error: "Too many email requests. Please wait a minute and try again."
    };
    // Retry-after countdown is scoped to the forgot-password (recover)
    // flow only — other flows keep their existing response shape exactly.
    if (flow === "recover") {
      const resolved = resolveProviderRetryAfterSeconds(response, data);
      if (resolved) {
        result.retryAfterSeconds = resolved.seconds;
        result.retryAfterSource = resolved.source;
      } else {
        result.retryAfterSeconds = FALLBACK_RATE_LIMIT_RETRY_SECONDS;
        result.retryAfterSource = "fallback";
      }
    }
    return result;
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

export function jsonAuthError(mapped) {
  const body = { error: mapped.error, code: mapped.code };
  if (mapped.ok) body.ok = true;
  if (typeof mapped.retryAfterSeconds === "number") body.retry_after_seconds = mapped.retryAfterSeconds;
  return {
    statusCode: mapped.statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
