/**
 * HeyGen webhook signature verification — Creative AI engineering pass
 * (webhook architecture, per Ashley's approved Step-4-follow-up scope).
 *
 * Confidence note (same honesty convention as marketing-heygen-client.js's
 * file header): HIGH confidence on the overall mechanism — HeyGen signs
 * the RAW request body with HMAC-SHA256 using a per-endpoint secret
 * (returned when the webhook endpoint is created via HeyGen's "Create
 * Endpoint" API, not the general HEYGEN_API_KEY), delivered via a
 * `Heygen-Signature` header, with a `Heygen-Timestamp` header for replay
 * staleness (~300s skew documented). LOWER confidence on the *exact*
 * signed-string encoding (hex digest assumed here — the most common
 * convention — and the signature is verified against the raw body alone,
 * not a `timestamp.body` concatenation, since that concatenation wasn't
 * independently confirmed against a live payload). **Verify this against
 * a real HeyGen webhook delivery before trusting it beyond a first smoke
 * test** — exactly the same caveat already carried by
 * createHeygenPhotoAvatarGroup/trainHeygenPhotoAvatarGroup.
 *
 * This module is pure and side-effect-free: it never touches the network
 * or a database, and never trusts a payload it hasn't cryptographically
 * verified. The raw, unparsed request body MUST be what gets HMAC'd —
 * verifying a re-serialized JSON.stringify(JSON.parse(body)) can produce
 * a different byte sequence (key order, whitespace) and silently break
 * verification, so callers must pass the exact bytes Netlify handed them.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_MAX_SKEW_SECONDS = 300;

/**
 * @param {object} params
 * @param {string|Buffer} params.rawBody - the exact, unparsed request body bytes.
 * @param {string} params.signatureHeader - the `Heygen-Signature` header value.
 * @param {string} params.timestampHeader - the `Heygen-Timestamp` header value (unix seconds).
 * @param {string} params.secret - this webhook endpoint's signing secret (never the general API key).
 * @param {number} [params.now] - unix seconds "now", injectable for tests.
 * @param {number} [params.maxSkewSeconds]
 * @returns {{valid: boolean, reason?: string}}
 */
export function verifyHeygenWebhookSignature({
  rawBody,
  signatureHeader,
  timestampHeader,
  secret,
  now = Math.floor(Date.now() / 1000),
  maxSkewSeconds = DEFAULT_MAX_SKEW_SECONDS
} = {}) {
  if (!secret) return { valid: false, reason: "missing_endpoint_secret" };
  if (!signatureHeader) return { valid: false, reason: "missing_signature_header" };
  if (!timestampHeader) return { valid: false, reason: "missing_timestamp_header" };
  if (rawBody == null) return { valid: false, reason: "missing_body" };

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return { valid: false, reason: "invalid_timestamp" };
  const skew = Math.abs(now - timestamp);
  if (skew > maxSkewSeconds) return { valid: false, reason: "timestamp_out_of_range" };

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const expectedHex = createHmac("sha256", secret).update(bodyBuffer).digest("hex");

  // Strip an optional "sha256=" scheme prefix some HMAC-signature schemes
  // use (harmless if HeyGen never sends one — this only widens acceptance
  // of a format variant, never narrows correctness).
  const providedHex = String(signatureHeader).replace(/^sha256=/i, "").trim().toLowerCase();

  let providedBuffer, expectedBuffer;
  try {
    providedBuffer = Buffer.from(providedHex, "hex");
    expectedBuffer = Buffer.from(expectedHex, "hex");
  } catch {
    return { valid: false, reason: "malformed_signature" };
  }
  if (providedBuffer.length !== expectedBuffer.length) {
    return { valid: false, reason: "signature_mismatch" };
  }
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { valid: false, reason: "signature_mismatch" };
  }
  return { valid: true };
}
