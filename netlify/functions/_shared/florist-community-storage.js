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

/** Florisyn-owned categorical log codes only — never provider-supplied values. */
export const COMMUNITY_IMAGE_LOG_CODES = Object.freeze([
  "query_error",
  "query_throw",
  "query_shape",
  "remove_error",
  "remove_throw",
  "unknown",
]);

const COMMUNITY_IMAGE_LOG_CODE_SET = new Set(COMMUNITY_IMAGE_LOG_CODES);

/**
 * Normalize to a Florisyn-owned categorical log code.
 * Ignores provider error.code / message entirely.
 */
export function safeCommunityImageErrorCode(code) {
  if (typeof code === "string" && COMMUNITY_IMAGE_LOG_CODE_SET.has(code)) return code;
  return "unknown";
}

function logCommunityImageEvent(event, code) {
  console.error(event, { code: safeCommunityImageErrorCode(code) });
}

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
 * Best-effort object removal. Logs a stable redacted event only (no paths/secrets/raw messages).
 */
export async function removeCommunityImageQuietly(client, path) {
  if (!path || !isStoragePath(path)) return { ok: true, skipped: true };
  try {
    const { error } = await client.storage.from(COMMUNITY_IMAGE_BUCKET).remove([path]);
    if (error) {
      logCommunityImageEvent("community_image_cleanup_failed", "remove_error");
      return { ok: false };
    }
    return { ok: true };
  } catch {
    logCommunityImageEvent("community_image_cleanup_failed", "remove_throw");
    return { ok: false };
  }
}

/**
 * After an ambiguous create/update write error, decide whether the newly uploaded
 * image is safe to remove.
 *
 * Safety priority: retain a private orphan temporarily rather than delete an
 * image that a committed post may already reference.
 *
 * Only an actual JavaScript array is a conclusive query response:
 * - non-empty array → referenced (retain)
 * - empty array → confirmed orphan (remove)
 * - null / undefined / object / string / other → retain (query_shape)
 */
export async function reconcileCommunityImageAfterWriteError(client, imagePath) {
  if (!imagePath || !isStoragePath(imagePath)) {
    return { action: "skipped", reason: "invalid_path" };
  }

  let data;
  let error;
  try {
    const result = await client
      .from("florist_community_posts")
      .select("id")
      .eq("image_path", imagePath)
      .limit(1);
    data = result?.data;
    error = result?.error;
  } catch {
    logCommunityImageEvent("community_image_reconcile_deferred", "query_throw");
    return { action: "retained", reason: "query_throw" };
  }

  if (error) {
    logCommunityImageEvent("community_image_reconcile_deferred", "query_error");
    return { action: "retained", reason: "query_error" };
  }

  // Fail-closed: only a real array is conclusive.
  if (!Array.isArray(data)) {
    logCommunityImageEvent("community_image_reconcile_deferred", "query_shape");
    return { action: "retained", reason: "query_shape" };
  }

  if (data.length > 0) {
    return { action: "retained", reason: "referenced" };
  }

  // Conclusive empty array: no post references this path — safe to remove orphan.
  const removed = await removeCommunityImageQuietly(client, imagePath);
  if (!removed.ok) {
    return { action: "retained", reason: "remove_error" };
  }
  if (removed.skipped) {
    return { action: "skipped", reason: "invalid_path" };
  }
  return { action: "removed", reason: "orphan" };
}
