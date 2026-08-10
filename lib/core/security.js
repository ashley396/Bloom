/**
 * Security utilities — input validation, sanitization, and request guards.
 */

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** Strip control characters and trim; cap length to prevent oversized payloads. */
export function sanitizeText(value, maxLen = 8000) {
  if (value == null) return "";
  return String(value).replace(CONTROL_CHARS, "").trim().slice(0, maxLen);
}

/** Basic email shape check (not a full RFC parser — good enough for API guards). */
export function isValidEmail(value) {
  const v = sanitizeText(value, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Reject paths that could be used for traversal or injection in file lookups. */
export function isSafeRelativePath(value) {
  const v = sanitizeText(value, 512);
  if (!v || v.includes("..") || v.includes("\\")) return false;
  return /^\/[a-zA-Z0-9/_\-.]+$/.test(v) || /^[a-zA-Z0-9/_\-.]+$/.test(v);
}

/**
 * In-memory token-bucket rate limiter keyed by client id.
 * Suitable for serverless warm instances; combine with edge/CDN limits at scale.
 */
export function createRateLimiter(options = {}) {
  const capacity = options.capacity ?? 120;
  const refillPerSec = options.refillPerSec ?? 2;
  const buckets = new Map();

  function take(key, cost = 1) {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, updatedAt: now };
      buckets.set(key, bucket);
    }
    const elapsed = (now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSec);
    bucket.updatedAt = now;
    if (bucket.tokens < cost) {
      return { allowed: false, retryAfterMs: Math.ceil(((cost - bucket.tokens) / refillPerSec) * 1000) };
    }
    bucket.tokens -= cost;
    return { allowed: true, remaining: Math.floor(bucket.tokens) };
  }

  return { take };
}

/** Derive a stable client key from Netlify/AWS Lambda event headers. */
export function clientKeyFromEvent(event) {
  const h = event?.headers || {};
  const forwarded = h["x-forwarded-for"] || h["X-Forwarded-For"] || "";
  const ip = String(forwarded).split(",")[0].trim() || h["client-ip"] || "anonymous";
  const auth = h.authorization || h.Authorization || "";
  const user = auth.startsWith("Bearer ") ? auth.slice(7, 24) : "";
  return `${ip}:${user}`;
}
