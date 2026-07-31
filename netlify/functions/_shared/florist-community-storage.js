/**
 * Florist Community image storage helpers.
 * Upload accepts only a prevalidated, sanitized image object — never a raw data URL.
 */

import {
  COMMUNITY_IMAGE_ALLOWED_MIMES,
  COMMUNITY_IMAGE_BUCKET,
  COMMUNITY_IMAGE_MAX_BYTES,
  communityImagePath,
  isStoragePath,
} from "./florist-community.js";

/**
 * Verify a prevalidated sanitize result before storage upload.
 * Does not decode or re-sanitize.
 */
export function assertPrevalidatedCommunityImage(image, { maxBytes = COMMUNITY_IMAGE_MAX_BYTES } = {}) {
  if (!image || typeof image !== "object") {
    return { ok: false, error: "Image validation result is required." };
  }
  if (image.valid !== true) {
    return { ok: false, error: image.error || "Image validation failed." };
  }
  if (image.sanitized !== true) {
    return { ok: false, error: "Image must be sanitized before upload." };
  }
  if (!Buffer.isBuffer(image.buffer) || image.buffer.length <= 0) {
    return { ok: false, error: "Sanitized image buffer is missing." };
  }
  if (!COMMUNITY_IMAGE_ALLOWED_MIMES.has(String(image.mime || "").toLowerCase())) {
    return { ok: false, error: "Community photos must be a valid JPEG, PNG, or WebP image." };
  }
  if (image.buffer.length > maxBytes) {
    return { ok: false, error: "Community photos must be under 2 MB after sanitization." };
  }
  return { ok: true };
}

/**
 * Upload a prevalidated sanitized Community image.
 * Accepts only the sanitize result object (valid, sanitized, buffer, mime).
 * Does not decode payloads or re-run image sanitization.
 */
export async function uploadPrevalidatedCommunityImage(client, shopId, userId, prevalidatedImage) {
  const check = assertPrevalidatedCommunityImage(prevalidatedImage);
  if (!check.ok) return { ok: false, error: check.error };

  const path = communityImagePath(shopId, userId, prevalidatedImage.mime);
  const { error } = await client.storage
    .from(COMMUNITY_IMAGE_BUCKET)
    .upload(path, prevalidatedImage.buffer, {
      contentType: prevalidatedImage.mime,
      upsert: false,
    });
  if (error) return { ok: false, error: "Image upload failed." };
  return { ok: true, path };
}

/**
 * Best-effort object removal. Logs safely without exposing paths/secrets to callers.
 */
export async function removeCommunityImageQuietly(client, path) {
  if (!path || !isStoragePath(path)) return { ok: true, skipped: true };
  try {
    const { error } = await client.storage.from(COMMUNITY_IMAGE_BUCKET).remove([path]);
    if (error) {
      console.error("Community image cleanup failed:", error?.message || "unknown_error");
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    console.error("Community image cleanup failed:", error?.message || "unknown_error");
    return { ok: false };
  }
}
