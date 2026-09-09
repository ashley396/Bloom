/**
 * Server-side upload validation for delivery proof and similar assets.
 */

export const DELIVERY_PROOF_MAX_BYTES = 5 * 1024 * 1024;

export const DELIVERY_PROOF_ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], "base64") };
}

export function validateDeliveryProofUpload({ mime, sizeBytes, dataUrl } = {}) {
  let resolvedMime = String(mime || "").toLowerCase();
  let resolvedSize = Number(sizeBytes);

  if (dataUrl) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return { valid: false, error: "Invalid delivery proof image encoding." };
    resolvedMime = parsed.mime;
    resolvedSize = parsed.buffer.length;
  }

  if (!DELIVERY_PROOF_ALLOWED_MIMES.has(resolvedMime)) {
    return {
      valid: false,
      error: "Delivery proof must be a JPEG, PNG, or WebP image.",
    };
  }
  if (!Number.isFinite(resolvedSize) || resolvedSize <= 0) {
    return { valid: false, error: "Delivery proof file is empty." };
  }
  if (resolvedSize > DELIVERY_PROOF_MAX_BYTES) {
    return {
      valid: false,
      error: `Delivery proof must be under ${DELIVERY_PROOF_MAX_BYTES / (1024 * 1024)} MB.`,
    };
  }
  return { valid: true, mime: resolvedMime, sizeBytes: resolvedSize };
}

// Order inspiration photos (Homecoming/Prom special-event details) — same
// shape and limits as delivery proof uploads, kept as its own named export
// so the two features can diverge later without one accidentally changing
// the other's validation.
export const ORDER_INSPIRATION_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export const ORDER_INSPIRATION_PHOTO_ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function validateOrderInspirationPhotoUpload({ mime, sizeBytes, dataUrl } = {}) {
  let resolvedMime = String(mime || "").toLowerCase();
  let resolvedSize = Number(sizeBytes);

  if (dataUrl) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return { valid: false, error: "Invalid inspiration photo encoding." };
    resolvedMime = parsed.mime;
    resolvedSize = parsed.buffer.length;
  }

  if (!ORDER_INSPIRATION_PHOTO_ALLOWED_MIMES.has(resolvedMime)) {
    return {
      valid: false,
      error: "Inspiration photo must be a JPEG, PNG, WebP, or HEIC image.",
    };
  }
  if (!Number.isFinite(resolvedSize) || resolvedSize <= 0) {
    return { valid: false, error: "Inspiration photo file is empty." };
  }
  if (resolvedSize > ORDER_INSPIRATION_PHOTO_MAX_BYTES) {
    return {
      valid: false,
      error: `Inspiration photo must be under ${ORDER_INSPIRATION_PHOTO_MAX_BYTES / (1024 * 1024)} MB.`,
    };
  }
  return { valid: true, mime: resolvedMime, sizeBytes: resolvedSize };
}
