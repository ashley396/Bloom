/**
 * Florist Community image storage helpers.
 * Upload accepts only a prevalidated, sanitized image object — never a raw data URL.
 */

import {
  COMMUNITY_IMAGE_ALLOWED_MIMES,
  COMMUNITY_IMAGE_BUCKET,
  COMMUNITY_IMAGE_MAX_BYTES,
  communityAvatarPath,
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

async function uploadCommunityBuffer(client, path, buffer, mime, { storageClient = null, logCode = "community_image_upload_failed" } = {}) {
  const uploaders = storageClient && storageClient !== client ? [storageClient, client] : [client];
  for (const uploader of uploaders) {
    const { error } = await uploader.storage.from(COMMUNITY_IMAGE_BUCKET).upload(path, buffer, {
      contentType: mime,
      upsert: false,
    });
    if (!error) return { ok: true };
  }
  console.error(JSON.stringify({ level: "warn", message: logCode, bucket: COMMUNITY_IMAGE_BUCKET }));
  return { ok: false };
}

/**
 * Upload a prevalidated sanitized Community image.
 * Accepts only the sanitize result object (valid, sanitized, buffer, mime).
 * Uses service-role storage when provided (after server-side auth checks).
 */
export async function uploadPrevalidatedCommunityImage(
  client,
  shopId,
  userId,
  prevalidatedImage,
  { storageClient = null } = {}
) {
  const check = assertPrevalidatedCommunityImage(prevalidatedImage);
  if (!check.ok) return { ok: false, error: check.error };

  const path = communityImagePath(shopId, userId, prevalidatedImage.mime);
  const uploaded = await uploadCommunityBuffer(client, path, prevalidatedImage.buffer, prevalidatedImage.mime, {
    storageClient,
    logCode: "community_image_upload_failed",
  });
  if (!uploaded.ok) {
    return {
      ok: false,
      error:
        "Image upload failed. In Supabase, ensure the private florist-community storage bucket and upload policies are applied.",
    };
  }
  return { ok: true, path };
}

/** Upload a sanitized profile avatar to the private Community bucket. */
export async function uploadPrevalidatedCommunityAvatar(
  client,
  shopId,
  userId,
  prevalidatedImage,
  { storageClient = null } = {}
) {
  const check = assertPrevalidatedCommunityImage(prevalidatedImage);
  if (!check.ok) return { ok: false, error: check.error };

  const path = communityAvatarPath(shopId, userId, prevalidatedImage.mime);
  const uploaded = await uploadCommunityBuffer(client, path, prevalidatedImage.buffer, prevalidatedImage.mime, {
    storageClient,
    logCode: "community_avatar_upload_failed",
  });
  if (!uploaded.ok) {
    return {
      ok: false,
      error:
        "Profile photo upload failed. In Supabase, ensure the private florist-community storage bucket and upload policies are applied.",
    };
  }
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

/**
 * Download a community post image for server-side vision analysis.
 * Returns raw buffer + mime — never logged or returned to clients.
 */
export async function downloadCommunityImageBuffer(client, path, { adminClient = null } = {}) {
  if (!path || !isStoragePath(path)) return null;
  const clients = [client, adminClient].filter(Boolean);
  const seen = new Set();
  for (const storageClient of clients) {
    if (seen.has(storageClient)) continue;
    seen.add(storageClient);
    const { data, error } = await storageClient.storage.from(COMMUNITY_IMAGE_BUCKET).download(path);
    if (error || !data) continue;
    const buffer = Buffer.from(await data.arrayBuffer());
    if (!buffer.length || buffer.length > COMMUNITY_IMAGE_MAX_BYTES) return null;
    const ext = String(path).split(".").pop()?.toLowerCase();
    const mime =
      ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { buffer, mime, path };
  }
  return null;
}

/** Fetch a signed or public image URL into a vision buffer (server-side only). */
export async function fetchImageBufferFromUrl(url, { maxBytes = COMMUNITY_IMAGE_MAX_BYTES } = {}) {
  const raw = String(url || "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  try {
    const response = await fetch(raw, { redirect: "follow" });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxBytes) return null;
    const headerMime = String(response.headers.get("content-type") || "").split(";")[0].trim();
    const mime = /^image\//i.test(headerMime) ? headerMime : "image/jpeg";
    return { buffer, mime, path: "" };
  } catch {
    return null;
  }
}

/** Parse a browser data URL from the client's already-loaded arrangement photo. */
export function parseClientImageDataUrl(dataUrl, { maxBytes = COMMUNITY_IMAGE_MAX_BYTES } = {}) {
  const raw = String(dataUrl || "").trim();
  if (!/^data:image\//i.test(raw)) return null;
  const mime = raw.match(/^data:([^;]+);/i)?.[1] || "image/jpeg";
  const base64 = raw.replace(/^data:[^;]+;base64,/i, "");
  try {
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length || buffer.length > maxBytes) return null;
    return { buffer, mime, path: "" };
  } catch {
    return null;
  }
}

/**
 * Resolve arrangement photo bytes for Lily vision — storage download, then URL fallbacks.
 */
export async function resolveCommunityImageForVision(
  client,
  path,
  {
    adminClient = null,
    signedUrlHint = "",
    clientDataUrl = "",
    createSignedUrl = null,
    adminSignedUrl = null,
  } = {}
) {
  const fromClient = parseClientImageDataUrl(clientDataUrl);
  if (fromClient) return { payload: fromClient, source: "client_data_url" };

  const fromStorage = await downloadCommunityImageBuffer(client, path, { adminClient });
  if (fromStorage) return { payload: fromStorage, source: "storage" };

  const fromHint = await fetchImageBufferFromUrl(signedUrlHint);
  if (fromHint) return { payload: fromHint, source: "signed_url_hint" };

  if (typeof createSignedUrl === "function" && path) {
    try {
      const signed = await createSignedUrl(path);
      const fromSigned = await fetchImageBufferFromUrl(signed?.url || signed);
      if (fromSigned) return { payload: fromSigned, source: "signed_url" };
    } catch {
      /* try next path */
    }
  }

  if (typeof adminSignedUrl === "function" && path) {
    try {
      const url = await adminSignedUrl(path);
      const fromAdmin = await fetchImageBufferFromUrl(url);
      if (fromAdmin) return { payload: fromAdmin, source: "admin_signed_url" };
    } catch {
      /* exhausted */
    }
  }

  return null;
}
