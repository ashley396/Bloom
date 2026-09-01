/**
 * Durable flyer render — validation and approval-readiness rules shared
 * between finalize_flyer_render and approve_content (marketing-studio.js).
 *
 * Split into its own module so both the upload-time gate and the
 * approval-time gate read the exact same rules, and so each rule can be
 * unit-tested directly rather than only indirectly through the handler.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Generous for a canvas-rendered flyer PNG at any real ASPECT_RATIOS size
// (flyer-templates.js tops out well under 2000px on a side) — this is a
// ceiling against something wildly wrong, not a tight budget.
export const FLYER_RENDER_MAX_BYTES = 5 * 1024 * 1024;
export const FLYER_RENDER_MIN_DIMENSION = 200;
export const FLYER_RENDER_MAX_DIMENSION = 4000;

const BASE64_DATA_URL_RE = /^data:([^;,]+);base64,([\s\S]*)$/;

/**
 * Validates a flyer render submitted to finalize_flyer_render. Never trusts
 * the claimed MIME type in the data: URL prefix alone — decodes the bytes
 * and checks the real PNG file signature, rejects malformed base64 and
 * empty payloads, enforces a real byte-size ceiling BEFORE anything is
 * uploaded, and reads real width/height straight out of the PNG's own
 * IHDR chunk (no image library needed — IHDR is always the first chunk,
 * at a fixed offset, in a valid PNG). Only image/png is ever accepted —
 * SVG, HTML, and every other format are rejected by construction, not by
 * a blocklist that could miss one.
 */
export function validateFlyerRenderDataUrl(dataUrl) {
  const raw = String(dataUrl || "");
  const match = BASE64_DATA_URL_RE.exec(raw);
  if (!match) return { valid: false, error: "That doesn't look like a real image." };
  const [, claimedMime, base64Body] = match;
  if (claimedMime.trim().toLowerCase() !== "image/png") {
    return { valid: false, error: "Only PNG flyer renders are accepted." };
  }

  const cleaned = base64Body.replace(/\s/g, "");
  if (!cleaned.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned) || cleaned.length % 4 !== 0) {
    return { valid: false, error: "That image data is malformed." };
  }
  let buffer;
  try {
    buffer = Buffer.from(cleaned, "base64");
  } catch {
    return { valid: false, error: "That image data is malformed." };
  }
  if (!buffer.length) return { valid: false, error: "That image file is empty." };
  if (buffer.length > FLYER_RENDER_MAX_BYTES) {
    return { valid: false, error: `A rendered flyer must be under ${Math.round(FLYER_RENDER_MAX_BYTES / (1024 * 1024))} MB.` };
  }

  // Real file-signature check on the decoded bytes — the claimed
  // "image/png" prefix above is just a label; this is proof.
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { valid: false, error: "That doesn't look like a real PNG file." };
  }
  // PNG's IHDR chunk is always the very first chunk, immediately after the
  // 8-byte signature: 4-byte length, 4-byte "IHDR" tag, then 4-byte width
  // and 4-byte height, big-endian.
  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    return { valid: false, error: "That doesn't look like a real PNG file." };
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < FLYER_RENDER_MIN_DIMENSION ||
    height < FLYER_RENDER_MIN_DIMENSION ||
    width > FLYER_RENDER_MAX_DIMENSION ||
    height > FLYER_RENDER_MAX_DIMENSION
  ) {
    return { valid: false, error: "That image's dimensions don't look like a real flyer render." };
  }

  return { valid: true, buffer, mime: "image/png", width, height };
}

const TRUSTED_URL_RE = /^https:\/\//i;

/**
 * Whether a flyer asset is genuinely ready to approve — used by
 * approve_content. Deliberately checks more than "content.url is set":
 * a real render status, a real https/trusted URL, a real storage path
 * (proof it actually went through finalize_flyer_render, not a
 * hand-crafted content blob), a supported MIME, and that it hasn't been
 * quarantined (the field exists so a future moderation pass has
 * somewhere real to record that — nothing sets it today, so this is
 * forward-compatible plumbing, not a claim that quarantine scanning
 * exists yet). Returns null when the asset is approvable (or isn't a
 * flyer at all — the gate only ever applies to flyers), otherwise a
 * human-readable reason string.
 */
export function flyerApprovalBlockReason(asset) {
  if (!asset || asset.asset_type !== "flyer") return null;
  const c = asset.content || {};
  if (c.quarantined) return "This flyer was flagged and can't be approved. Contact support.";
  const notReady = "This flyer hasn't finished rendering yet — open it again so it can finish preparing, then approve.";
  if (c.render_status !== "rendered") return notReady;
  if (typeof c.url !== "string" || !TRUSTED_URL_RE.test(c.url)) return notReady;
  if (typeof c.storage_path !== "string" || !c.storage_path.length) return notReady;
  if (c.mime !== "image/png") return notReady;
  return null;
}

/**
 * Batch 3, Part D/E — the full approve_content readiness gate across every
 * asset type this route actually persists, not just flyers.
 *
 * Real gap this closes: `asset.status === "quarantined"` is the REAL
 * signal a revoked-consent asset is marked with (see marketing-studio.js's
 * own revoked-media quarantine handling, and the identical
 * `assetResult.data?.status === "quarantined"` check the publishing
 * worker already uses) — flyerApprovalBlockReason's own `content.quarantined`
 * check is real, tested plumbing for a future moderation pass, but nothing
 * in this codebase actually SETS that field today. Approval must fail
 * closed on the real signal too, not just the one nothing writes yet.
 *
 * Asset-type-scoped requirements (never one blanket rule for every type):
 *   - flyer: delegates to flyerApprovalBlockReason unchanged (a real
 *     finalized render, checked above).
 *   - image: requires a real, trusted current photo url — an "image" post
 *     with no url is exactly as unfinished as a flyer with no render.
 *   - everything else (social_copy, video_concept, background, ...): no
 *     extra requirement here — a text-only or concept-only asset was never
 *     supposed to have a flyer/photo of its own to check.
 */
export function contentApprovalBlockReason(asset) {
  if (!asset) return null;
  if (asset.status === "quarantined") return "This asset was flagged and can't be approved. Contact support.";
  if (asset.asset_type === "flyer") return flyerApprovalBlockReason(asset);
  if (asset.asset_type === "image") {
    const url = asset.content?.url;
    if (typeof url !== "string" || !TRUSTED_URL_RE.test(url)) {
      return "This photo hasn't finished uploading or generating yet — open it again so it can finish, then approve.";
    }
  }
  return null;
}

/**
 * Batch 3, Part F — verifies a flyer's final render object genuinely
 * exists in Storage, not just that the DB row's own fields claim it does.
 * Uses `.list()` (a real, lightweight metadata check — no bytes
 * downloaded) rather than downloading the whole file merely to prove
 * existence.
 *
 * Returns `{ ok: true, verified: boolean }` when the check itself
 * completed (verified tells the caller whether the object was actually
 * found), or `{ ok: false, error }` when verification itself could not be
 * performed (no storage_path to check, a storage error, an unavailable
 * client, or an unexpected exception) — the caller must treat `ok: false`
 * as "unreadable state," never as "verified." Deliberately never throws.
 */
export async function verifyFlyerStorageObjectExists(client, storagePath, { bucket = "website-media" } = {}) {
  const path = String(storagePath || "");
  if (!path) return { ok: false, error: "no storage_path to verify" };
  const lastSlash = path.lastIndexOf("/");
  const folder = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
  const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  try {
    const { data, error } = await client.storage.from(bucket).list(folder, { search: filename, limit: 1 });
    if (error) return { ok: false, error: error.message || String(error) };
    const found = Array.isArray(data) && data.some((entry) => entry?.name === filename);
    return { ok: true, verified: found };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}
