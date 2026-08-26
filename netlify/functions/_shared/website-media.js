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

/** Shared upload primitive — every caller in this file funnels through
 * here so there is exactly one place that actually talks to Storage.
 * `path` lets a caller request a deterministic key instead of a fresh
 * random one (idempotent overwrite via upsert); omitting it keeps the
 * original random-path, no-overwrite behavior every existing caller
 * already relies on. */
async function uploadWebsiteMediaBuffer(client, shopId, { buffer, mime, ext, path, upsert = false } = {}) {
  const finalPath = path || `${shopId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage.from(WEBSITE_MEDIA_BUCKET).upload(finalPath, buffer, { contentType: mime, upsert });
  if (error) return { ok: false, error: error.message || "Image upload failed." };
  return { ok: true, path: finalPath, mime, sizeBytes: buffer.length };
}

export async function uploadWebsiteMedia(client, shopId, { dataUrl, filename } = {}) {
  const validation = validateWebsiteMediaUpload({ dataUrl });
  if (!validation.valid) return { ok: false, error: validation.error };
  const ext = MIME_EXT[validation.mime] || "jpg";
  const result = await uploadWebsiteMediaBuffer(client, shopId, { buffer: validation.buffer, mime: validation.mime, ext });
  if (!result.ok) return result;
  return { ...result, filename: String(filename || "image").slice(0, 120) };
}

/**
 * Uploads an already-validated flyer render (see flyer-render.js's
 * validateFlyerRenderDataUrl) to a DETERMINISTIC path keyed by the asset
 * it belongs to: `${shopId}/flyers/${assetId}.png`. This is the whole
 * idempotency strategy — retrying finalize_flyer_render for the same
 * asset (a double-click, a dropped response, a client retry) always
 * writes to the exact same storage key with upsert:true, so a retry
 * overwrites the one real file for that asset rather than accumulating
 * orphaned duplicates. Callers must have already confirmed the asset is
 * genuinely the content item's current revision — this function has no
 * opinion about that, it only uploads.
 */
export async function uploadFlyerRenderBuffer(client, shopId, assetId, { buffer, mime }) {
  const path = `${shopId}/flyers/${assetId}.png`;
  return uploadWebsiteMediaBuffer(client, shopId, { buffer, mime, path, upsert: true });
}

export const CLONE_AUDIO_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Uploads a raw audio buffer (e.g. an ElevenLabs-synthesized voice track)
 * into the same public website-media bucket, under a clone-audio/ prefix.
 * Not a Website Studio media-library asset — no website_media row is
 * inserted, and it never appears in that UI — this exists purely so a
 * generative-video provider (HeyGen) has a real, publicly-fetchable URL
 * to pull the audio from. Reuses the bucket rather than provisioning a
 * new one since it's already public with the right storage policies.
 */
export async function uploadClonedVoiceAudio(client, shopId, buffer, filename) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return { ok: false, error: "Audio buffer is empty." };
  if (buffer.length > CLONE_AUDIO_MAX_BYTES) {
    return { ok: false, error: `Audio must be under ${CLONE_AUDIO_MAX_BYTES / (1024 * 1024)} MB.` };
  }
  const path = `${shopId}/clone-audio/${crypto.randomUUID()}-${String(filename || "voice").slice(0, 80).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error } = await client.storage
    .from(WEBSITE_MEDIA_BUCKET)
    .upload(path, buffer, { contentType: "audio/mpeg", upsert: false });
  if (error) return { ok: false, error: error.message || "Audio upload failed." };
  return { ok: true, path, url: publicWebsiteMediaUrl(client, path) };
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
