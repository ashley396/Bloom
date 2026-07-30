/**
 * Delivery proof-of-delivery — private storage paths and short-lived signed URLs.
 */

import {
  validateDeliveryProofUpload,
  parseDataUrl,
} from "./upload-validation.js";

export const DELIVERY_PROOF_BUCKET = "delivery-proofs";
export const DELIVERY_PROOF_SIGNED_URL_SECONDS = 300;

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function isStoragePath(value) {
  const text = String(value || "");
  if (!text) return false;
  if (/^https?:\/\//i.test(text)) return false;
  return text.includes("/");
}

export async function uploadDeliveryProof(client, shopId, dataUrl) {
  if (!dataUrl) return { ok: true, path: null };
  const validation = validateDeliveryProofUpload({ dataUrl });
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { ok: false, error: "Invalid delivery proof image encoding." };
  const ext = MIME_EXT[parsed.mime] || "jpg";
  const path = `${shopId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage
    .from(DELIVERY_PROOF_BUCKET)
    .upload(path, parsed.buffer, { contentType: parsed.mime, upsert: false });
  if (error) return { ok: false, error: error.message || "Delivery proof upload failed." };
  return { ok: true, path, mime: parsed.mime, sizeBytes: parsed.buffer.length };
}

export async function attachDeliveryProofUrls(client, items) {
  return Promise.all(
    (items || []).map(async (item) => {
      const path = item.proof_photo_url || item.proof_url;
      if (!path || !isStoragePath(path)) {
        return { ...item, proof_signed_url: null, proof_url_expires_in: null };
      }
      const { data, error } = await client.storage
        .from(DELIVERY_PROOF_BUCKET)
        .createSignedUrl(path, DELIVERY_PROOF_SIGNED_URL_SECONDS);
      if (error) {
        return {
          ...item,
          proof_signed_url: null,
          proof_url_expires_in: null,
          proof_access_error: "Proof photo unavailable.",
        };
      }
      return {
        ...item,
        proof_signed_url: data?.signedUrl || null,
        proof_url_expires_in: DELIVERY_PROOF_SIGNED_URL_SECONDS,
      };
    }),
  );
}

export function validateProofCaptureBody(body = {}) {
  const errors = [];
  const deliveredWithoutPhoto = Boolean(body.delivered_without_photo);
  const noPhotoReason = String(body.no_photo_reason || body.without_photo_reason || "").trim();

  if (deliveredWithoutPhoto && !noPhotoReason) {
    errors.push("Enter a reason when marking delivered without a photo.");
  }
  if (!deliveredWithoutPhoto && !body.proof_data_url && body.mark_delivered) {
    errors.push("Delivery photo is required unless using delivered without photo.");
  }
  if (noPhotoReason.length > 500) {
    errors.push("Delivery reason is too long.");
  }

  return {
    valid: errors.length === 0,
    errors,
    deliveredWithoutPhoto,
    noPhotoReason,
  };
}
