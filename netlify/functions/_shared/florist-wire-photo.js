/**
 * Florist Network wire reference photos — private storage paths and signed URLs.
 */

import { validateDeliveryProofUpload, parseDataUrl } from "./upload-validation.js";

export const FLORIST_WIRE_PHOTO_BUCKET = "florist-wire-photos";
export const FLORIST_WIRE_PHOTO_SIGNED_URL_SECONDS = 600;

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function isWirePhotoStoragePath(value) {
  const text = String(value || "");
  if (!text) return false;
  if (/^https?:\/\//i.test(text)) return false;
  return text.includes("/");
}

export async function uploadWireReferencePhoto(client, shopId, dataUrl) {
  if (!dataUrl) return { ok: true, path: null };
  const validation = validateDeliveryProofUpload({ dataUrl });
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { ok: false, error: "Invalid reference photo encoding." };
  const ext = MIME_EXT[parsed.mime] || "jpg";
  const path = `${shopId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage
    .from(FLORIST_WIRE_PHOTO_BUCKET)
    .upload(path, parsed.buffer, { contentType: parsed.mime, upsert: false });
  if (error) {
    return {
      ok: false,
      error: error.message || "Reference photo upload failed. Ensure the florist-wire-photos bucket exists.",
    };
  }
  return { ok: true, path, mime: parsed.mime, sizeBytes: parsed.buffer.length };
}

export async function attachWireReferencePhotoUrls(client, items) {
  return Promise.all(
    (items || []).map(async (item) => {
      const path = item.reference_photo_url;
      if (!path || !isWirePhotoStoragePath(path)) {
        return { ...item, reference_photo_signed_url: null };
      }
      const { data, error } = await client.storage
        .from(FLORIST_WIRE_PHOTO_BUCKET)
        .createSignedUrl(path, FLORIST_WIRE_PHOTO_SIGNED_URL_SECONDS);
      if (error) {
        return { ...item, reference_photo_signed_url: null, reference_photo_access_error: "Photo unavailable." };
      }
      return { ...item, reference_photo_signed_url: data?.signedUrl || null };
    })
  );
}
