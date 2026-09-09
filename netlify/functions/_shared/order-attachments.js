/**
 * Order inspiration photos (Homecoming/Prom special-event details) —
 * private storage paths and short-lived signed URLs.
 *
 * Modeled directly on delivery-proof.js: same bucket-private / RLS-by-
 * shop-id-prefix / signed-URL-only pattern, applied to a second bucket so
 * this feature's storage lifecycle and policies stay independent of
 * delivery proofs.
 */

import {
  validateOrderInspirationPhotoUpload,
  parseDataUrl,
} from "./upload-validation.js";
import { isStoragePath } from "./delivery-proof.js";

export const ORDER_ATTACHMENT_BUCKET = "order-attachments";
export const ORDER_ATTACHMENT_SIGNED_URL_SECONDS = 300;

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export { isStoragePath };

export async function uploadOrderInspirationPhoto(client, shopId, dataUrl) {
  if (!dataUrl) return { ok: true, path: null };
  const validation = validateOrderInspirationPhotoUpload({ dataUrl });
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { ok: false, error: "Invalid inspiration photo encoding." };
  const ext = MIME_EXT[parsed.mime] || "jpg";
  const path = `${shopId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage
    .from(ORDER_ATTACHMENT_BUCKET)
    .upload(path, parsed.buffer, { contentType: parsed.mime, upsert: false });
  if (error) return { ok: false, error: error.message || "Inspiration photo upload failed." };
  return { ok: true, path, mime: parsed.mime, sizeBytes: parsed.buffer.length };
}

export async function getOrderInspirationPhotoSignedUrl(client, path) {
  if (!path || !isStoragePath(path)) return { signed_url: null, expires_in: null };
  const { data, error } = await client.storage
    .from(ORDER_ATTACHMENT_BUCKET)
    .createSignedUrl(path, ORDER_ATTACHMENT_SIGNED_URL_SECONDS);
  if (error) {
    return { signed_url: null, expires_in: null, error: "Inspiration photo unavailable." };
  }
  return { signed_url: data?.signedUrl || null, expires_in: ORDER_ATTACHMENT_SIGNED_URL_SECONDS };
}

// Deletes a superseded/removed inspiration photo. Callers must only invoke
// this AFTER the order row that stops referencing `path` has been
// successfully persisted — never before, and never merely because a PATCH
// happened to omit the photo field. `path` must already have been read back
// from that same shop's own order row (never taken from client input
// directly), and this still re-checks the shop_id prefix itself as a second,
// app-layer guard on top of storage.objects' RLS (which independently
// enforces is_shop_member() for every operation on this bucket) — belt and
// suspenders, not a replacement for RLS.
export async function deleteOrderInspirationPhoto(client, shopId, path) {
  if (!path || !isStoragePath(path)) return { ok: true, skipped: true };
  if (!String(path).startsWith(`${shopId}/`)) {
    return { ok: false, error: "Refusing to delete a storage object outside the caller's shop." };
  }
  const { error } = await client.storage.from(ORDER_ATTACHMENT_BUCKET).remove([path]);
  if (error) return { ok: false, error: error.message || "Could not remove the previous inspiration photo." };
  return { ok: true };
}
