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
