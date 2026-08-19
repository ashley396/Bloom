/**
 * Website Studio media library — public storage bucket + metadata rows.
 * Mirrors the delivery-proofs upload pattern (parseDataUrl → validate →
 * upload → return path), but this bucket is PUBLIC: published storefronts
 * are unauthenticated, so hero/product/gallery images must be readable
 * without a signed URL. See supabase/migrations/20260815000000_website_media_library.sql.
 */

import { parseDataUrl } from "./upload-validation.js";

export const WEBSITE_MEDIA_BUCKET = "website-media";
export const WEBSITE_MEDIA_MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

export function validateWebsiteMediaUpload({ dataUrl } = {}) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { valid: false, error: "Invalid image encoding." };
  if (!ALLOWED_MIMES.has(parsed.mime)) {
    return { valid: false, error: "Images must be JPEG, PNG, WebP, or GIF." };
  }
  if (!parsed.buffer.length) return { valid: false, error: "Image file is empty." };
  if (parsed.buffer.length > WEBSITE_MEDIA_MAX_BYTES) {
    return { valid: false, error: `Images must be under ${WEBSITE_MEDIA_MAX_BYTES / (1024 * 1024)} MB.` };
  }
  return { valid: true, mime: parsed.mime, buffer: parsed.buffer };
}

export async function uploadWebsiteMedia(client, shopId, { dataUrl, filename } = {}) {
  const validation = validateWebsiteMediaUpload({ dataUrl });
  if (!validation.valid) return { ok: false, error: validation.error };
  const ext = MIME_EXT[validation.mime] || "jpg";
  const path = `${shopId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage
    .from(WEBSITE_MEDIA_BUCKET)
    .upload(path, validation.buffer, { contentType: validation.mime, upsert: false });
  if (error) return { ok: false, error: error.message || "Image upload failed." };
  return {
    ok: true,
    path,
    mime: validation.mime,
    sizeBytes: validation.buffer.length,
    filename: String(filename || "image").slice(0, 120)
  };
}

export function publicWebsiteMediaUrl(client, path) {
  const { data } = client.storage.from(WEBSITE_MEDIA_BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

/** Which pages/sections currently reference this image path, by scanning
 * live section props for an image whose url ends with the storage path.
 * Computed at read time on purpose — see migration comment for why. */
export function findMediaUsage(pages = [], storagePath) {
  const usage = [];
  for (const page of pages) {
    for (const section of page.sections || []) {
      const urls = collectImageUrls(section.props);
      if (urls.some((u) => typeof u === "string" && u.includes(storagePath))) {
        usage.push({ slug: page.slug, page_title: page.title, section_id: section.id, section_type: section.type });
      }
    }
  }
  return usage;
}

function collectImageUrls(node, depth = 0, acc = []) {
  if (!node || depth > 4) return acc;
  if (Array.isArray(node)) {
    node.forEach((n) => collectImageUrls(n, depth + 1, acc));
    return acc;
  }
  if (typeof node === "object") {
    if (typeof node.url === "string") acc.push(node.url);
    Object.values(node).forEach((v) => collectImageUrls(v, depth + 1, acc));
  }
  return acc;
}
