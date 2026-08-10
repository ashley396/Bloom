/**
 * Florist Community Beta — validation and response sanitization.
 * Never include customer, recipient, employee, payment, or order fields.
 */

import sharp from "sharp";

export const COMMUNITY_CATEGORIES = Object.freeze([
  "Design Help",
  "Business Advice",
  "Questions",
  "Celebrations",
  "Arrangement Share",
]);

export const COMMUNITY_GUIDELINES = Object.freeze([
  "Share florist-to-florist advice only — never customer names, phone numbers, addresses, or order details.",
  "Be kind. Encourage fellow florists; disagree respectfully.",
  "One arrangement photo per post. Upload only images you have rights to share.",
  "No spam, promotions for non-floral scams, or off-topic sales pitches.",
  "Report posts that break these guidelines. Moderators may hide or remove content.",
  "Add a profile photo so fellow florists recognize you — like social media, but florist-only.",
  "On arrangement photos, Lily can draft a stem-count recipe you can publish for other florists or add to your shop.",
  "This Community is a Beta. Features may change; private messaging and groups are not available.",
]);

export const COMMUNITY_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Decoded pixel budget (width * height) — keeps Netlify function memory bounded. */
export const COMMUNITY_IMAGE_MAX_PIXELS = 4096 * 4096;
export const COMMUNITY_IMAGE_MAX_DIMENSION = 8192;

/** Short-lived signed URL lifetime for private Community images (seconds). */
export const COMMUNITY_SIGNED_URL_SECONDS = 300;

export const COMMUNITY_IMAGE_ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const COMMUNITY_IMAGE_BUCKET = "florist-community";

const SHARP_FORMAT_TO_MIME = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const FORBIDDEN_KEYS = new Set([
  "customer_name",
  "customer_phone",
  "customer_email",
  "recipient_name",
  "recipient_phone",
  "delivery_address",
  "card_message",
  "order_id",
  "order_number",
  "payment_status",
  "amount_paid",
  "balance_due",
  "stripe",
  "pin_hash",
  "hourly_rate",
  "federal_tax_rate",
  "employee",
  "staff_id",
]);

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Maximum base64 character length whose decoded payload can fit in maxBytes.
 * base64 maps 3 bytes → 4 chars (with padding to a multiple of 4).
 */
export function maxBase64LengthForBytes(maxBytes = COMMUNITY_IMAGE_MAX_BYTES) {
  const n = Number(maxBytes);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.ceil(n / 3) * 4;
}

/**
 * Parse a data URL with size enforcement BEFORE base64 decoding.
 * Rejects oversized declared binary size, oversized base64 payload length,
 * and malformed base64. Returns { ok, mime, buffer } or { ok:false, error }.
 */
export function parseDataUrl(dataUrl, { maxBytes = COMMUNITY_IMAGE_MAX_BYTES, sizeBytes } = {}) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (!match) return { ok: false, error: "Invalid image encoding." };

  const mime = match[1].toLowerCase();
  const b64 = String(match[2] || "").replace(/\s+/g, "");
  if (!b64) return { ok: false, error: "Invalid image encoding." };

  if (Number.isFinite(Number(sizeBytes)) && Number(sizeBytes) > maxBytes) {
    return { ok: false, error: "Community photos must be under 2 MB." };
  }

  // Enforce encoded-size ceiling before Buffer.from allocates decoded bytes.
  const maxChars = maxBase64LengthForBytes(maxBytes);
  if (b64.length > maxChars) {
    return { ok: false, error: "Community photos must be under 2 MB." };
  }

  // Standard base64 alphabet + padding; length must be divisible by 4.
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    return { ok: false, error: "Invalid image encoding." };
  }

  let buffer;
  try {
    buffer = Buffer.from(b64, "base64");
  } catch {
    return { ok: false, error: "Invalid image encoding." };
  }

  // Node may decode leniently; still enforce decoded binary limit.
  if (!buffer || buffer.length <= 0) {
    return { ok: false, error: "Image file is empty." };
  }
  if (buffer.length > maxBytes) {
    return { ok: false, error: "Community photos must be under 2 MB." };
  }

  return { ok: true, mime, buffer };
}

/** Detect real image type from magic bytes. Returns mime or null. */
export function detectImageMimeFromBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Fully decode and sanitize a Community image with sharp (single sanitization pass).
 * - Rejects oversized declared size and oversized base64 BEFORE decoding base64
 * - Requires declared MIME (jpeg/png/webp) to match magic bytes and sharp format
 * - Fully decodes pixels; rejects corrupt/truncated inputs
 * - Re-encodes and strips EXIF/GPS/metadata; returns only the sanitized buffer
 * - Enforces dimension, pixel, and post-sanitization size limits
 * Callers must pass the returned object to upload — do not sanitize again.
 * Does not trust client filename/extension. Filenames are server-generated.
 */
export async function validateCommunityImageUpload({
  mime,
  sizeBytes,
  dataUrl,
  buffer,
  maxBytes = COMMUNITY_IMAGE_MAX_BYTES,
  maxPixels = COMMUNITY_IMAGE_MAX_PIXELS,
  maxDimension = COMMUNITY_IMAGE_MAX_DIMENSION,
} = {}) {
  let resolvedBuffer = buffer && Buffer.isBuffer(buffer) ? buffer : null;
  let declaredMime = String(mime || "").toLowerCase();

  if (dataUrl) {
    const parsed = parseDataUrl(dataUrl, { maxBytes, sizeBytes });
    if (!parsed.ok) return { valid: false, error: parsed.error };
    resolvedBuffer = parsed.buffer;
    declaredMime = parsed.mime;
  }

  if (Number.isFinite(Number(sizeBytes)) && Number(sizeBytes) > maxBytes) {
    return { valid: false, error: "Community photos must be under 2 MB." };
  }

  if (!resolvedBuffer || resolvedBuffer.length <= 0) {
    return { valid: false, error: "Image file is empty." };
  }
  if (resolvedBuffer.length > maxBytes) {
    return { valid: false, error: "Community photos must be under 2 MB." };
  }

  if (!COMMUNITY_IMAGE_ALLOWED_MIMES.has(declaredMime)) {
    return {
      valid: false,
      error: "Community photos must be declared as image/jpeg, image/png, or image/webp.",
    };
  }

  const detected = detectImageMimeFromBytes(resolvedBuffer);
  if (!detected || !COMMUNITY_IMAGE_ALLOWED_MIMES.has(detected)) {
    return {
      valid: false,
      error: "Community photos must be a valid JPEG, PNG, or WebP image.",
    };
  }
  if (declaredMime !== detected) {
    return { valid: false, error: "Image content does not match the declared file type." };
  }

  let metadata;
  try {
    metadata = await sharp(resolvedBuffer, {
      failOn: "error",
      animated: true,
      limitInputPixels: maxPixels,
    }).metadata();
  } catch {
    return { valid: false, error: "Image file is corrupt, truncated, or cannot be decoded." };
  }

  const sharpMime = SHARP_FORMAT_TO_MIME[String(metadata.format || "").toLowerCase()];
  if (!sharpMime || sharpMime !== declaredMime) {
    return { valid: false, error: "Image content does not match the declared file type." };
  }

  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height || width < 1 || height < 1) {
    return { valid: false, error: "Image file is corrupt, truncated, or cannot be decoded." };
  }
  if (width > maxDimension || height > maxDimension) {
    return { valid: false, error: "Community photos exceed the maximum dimensions." };
  }
  if (width * height > maxPixels) {
    return { valid: false, error: "Community photos exceed the maximum decoded size." };
  }

  const pages = Number(metadata.pages || 1);
  const isAnimated = pages > 1 || (Array.isArray(metadata.delay) && metadata.delay.length > 1);
  // Decode only the first still frame; reject when multi-page content cannot be isolated.
  const decodeOptions = {
    failOn: "error",
    limitInputPixels: maxPixels,
    pages: 1,
    page: 0,
  };

  // rotate() applies EXIF orientation; re-encode does not copy EXIF/GPS/metadata by default.
  const pipeline = sharp(resolvedBuffer, decodeOptions).rotate();

  let sanitized;
  try {
    if (declaredMime === "image/jpeg") {
      sanitized = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    } else if (declaredMime === "image/png") {
      sanitized = await pipeline.png({ compressionLevel: 9, palette: false }).toBuffer();
    } else {
      sanitized = await pipeline.webp({ quality: 85, effort: 4 }).toBuffer();
    }
  } catch {
    return { valid: false, error: "Image file is corrupt, truncated, or cannot be decoded." };
  }

  if (!sanitized || sanitized.length <= 0) {
    return { valid: false, error: "Image sanitization produced an empty file." };
  }
  if (sanitized.length > maxBytes) {
    return { valid: false, error: "Community photos must be under 2 MB after sanitization." };
  }

  // Verify the sanitized output fully decodes again.
  let outMeta;
  try {
    outMeta = await sharp(sanitized, {
      failOn: "error",
      limitInputPixels: maxPixels,
    }).metadata();
  } catch {
    return { valid: false, error: "Sanitized image failed verification decode." };
  }
  const outMime = SHARP_FORMAT_TO_MIME[String(outMeta.format || "").toLowerCase()];
  if (outMime !== declaredMime) {
    return { valid: false, error: "Sanitized image format mismatch." };
  }
  const outW = Number(outMeta.width || 0);
  const outH = Number(outMeta.height || 0);
  if (!outW || !outH || outW * outH > maxPixels) {
    return { valid: false, error: "Sanitized image exceeds decoded size limits." };
  }

  return {
    valid: true,
    mime: declaredMime,
    sizeBytes: sanitized.length,
    width: outW,
    height: outH,
    buffer: sanitized,
    sanitized: true,
    animatedReduced: Boolean(isAnimated),
  };
}

export function sanitizeText(value, max) {
  const text = String(value ?? "")
    .replace(/\0/g, "")
    .trim()
    .slice(0, max);
  return text;
}

export function validateProfileBody(body = {}) {
  const display_name = sanitizeText(body.display_name, 80);
  const shop_display_name = sanitizeText(body.shop_display_name, 120);
  const city = sanitizeText(body.city, 80) || null;
  const region = sanitizeText(body.region, 80) || null;
  const bio = sanitizeText(body.bio, 500) || null;
  const errors = [];
  if (!display_name) errors.push("Display name is required.");
  if (!shop_display_name) errors.push("Shop name is required.");
  return {
    valid: errors.length === 0,
    errors,
    sanitized: { display_name, shop_display_name, city, region, bio },
  };
}

export async function validateProfileAvatarUpload(body = {}) {
  if (body.remove_avatar) {
    return { valid: true, remove: true, image: null };
  }
  if (!body.avatar_data_url) {
    return { valid: true, remove: false, image: null };
  }
  const image = await validateCommunityImageUpload({ dataUrl: body.avatar_data_url });
  if (!image.valid) {
    return { valid: false, error: image.error, remove: false, image: null };
  }
  return { valid: true, remove: false, image };
}

export async function validatePostBody(body = {}) {
  const category = String(body.category || "").trim();
  const caption = sanitizeText(body.caption, 280);
  const text = sanitizeText(body.body ?? body.text, 4000) || null;
  const errors = [];
  if (!COMMUNITY_CATEGORIES.includes(category)) {
    errors.push("Choose a valid category.");
  }
  if (!caption) errors.push("Caption is required.");
  let image = null;
  if (body.image_data_url) {
    image = await validateCommunityImageUpload({ dataUrl: body.image_data_url });
    if (!image.valid) errors.push(image.error);
  }
  return {
    valid: errors.length === 0,
    errors,
    sanitized: { category, caption, body: text },
    image,
  };
}

export function validateCommentBody(body = {}) {
  const text = sanitizeText(body.body ?? body.text, 1000);
  const errors = [];
  if (!text) errors.push("Comment cannot be empty.");
  return { valid: errors.length === 0, errors, sanitized: { body: text } };
}

export function validateReportBody(body = {}) {
  const reason = sanitizeText(body.reason, 500);
  const errors = [];
  if (reason.length < 3) errors.push("Please describe why you are reporting this post.");
  return { valid: errors.length === 0, errors, sanitized: { reason } };
}

export function canModerateCommunity({ role, isPlatformAdmin, post, shopId } = {}) {
  if (!post) return false;
  if (isPlatformAdmin) return true;
  const r = String(role || "").toLowerCase();
  if (["owner", "manager", "admin"].includes(r) && post.shop_id && post.shop_id === shopId) {
    return true;
  }
  return false;
}

export function canEditOwnContent({ userId, authorUserId }) {
  return Boolean(userId && authorUserId && userId === authorUserId);
}

/** Strip any accidental sensitive keys from API payloads. */
export function assertCommunitySafePayload(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const key of Object.keys(cur)) {
      if (FORBIDDEN_KEYS.has(key)) {
        delete cur[key];
        continue;
      }
      const val = cur[key];
      if (val && typeof val === "object") stack.push(val);
    }
  }
  return obj;
}

export function publicProfile(row, { avatarUrl = null, avatarExpiresIn = null } = {}) {
  if (!row) return null;
  return assertCommunitySafePayload({
    user_id: row.user_id,
    shop_id: row.shop_id,
    display_name: row.display_name,
    shop_display_name: row.shop_display_name,
    city: row.city || null,
    region: row.region || null,
    bio: row.bio || null,
    avatar_url: avatarUrl,
    avatar_url_expires_in: avatarExpiresIn,
    updated_at: row.updated_at || null,
  });
}

export function publicPost(
  row,
  {
    liked = false,
    isMine = false,
    canModerate = false,
    imageUrl = null,
    imageExpiresIn = null,
    publishedRecipe = null,
  } = {}
) {
  if (!row) return null;
  const recipeStatus = String(row.recipe_status || "none");
  const payload = {
    id: row.id,
    category: row.category,
    caption: row.caption,
    body: row.body || null,
    image_path: row.image_path || null,
    image_url: imageUrl,
    image_url_expires_in: imageExpiresIn,
    status: row.status,
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    liked: Boolean(liked),
    is_mine: Boolean(isMine),
    can_moderate: Boolean(canModerate),
    recipe_status: recipeStatus,
    can_build_recipe: Boolean(
      isMine && row.image_path && recipeStatus !== "published" && recipeStatus !== "imported"
    ),
    published_recipe: publishedRecipe || null,
    author: row.author
      ? publicProfile(row.author)
      : {
          user_id: row.author_user_id,
          shop_id: row.shop_id,
          display_name: row.author_display_name || "Florist",
          shop_display_name: row.shop_display_name || "Flower shop",
          city: row.author_city || null,
          region: row.author_region || null,
          bio: null,
        },
  };
  if (isMine && row.recipe_draft) {
    payload.recipe_draft = row.recipe_draft;
  }
  return assertCommunitySafePayload(payload);
}

export function publicComment(row, { isMine = false, canModerate = false } = {}) {
  if (!row) return null;
  return assertCommunitySafePayload({
    id: row.id,
    post_id: row.post_id,
    body: row.body,
    status: row.status,
    created_at: row.created_at,
    is_mine: Boolean(isMine),
    can_moderate: Boolean(canModerate),
    author: row.author
      ? publicProfile(row.author)
      : {
          user_id: row.author_user_id,
          shop_id: row.shop_id,
          display_name: row.author_display_name || "Florist",
          shop_display_name: row.shop_display_name || "Flower shop",
        },
  });
}

/** @deprecated Public permanent URLs are forbidden — use signed URLs. */
export function communityImagePublicUrl() {
  return null;
}

export function communityImagePath(shopId, userId, mime) {
  const ext = MIME_EXT[mime] || "jpg";
  return `${shopId}/${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
}

/** Profile avatar path — same bucket, distinct filename prefix for readability RPC. */
export function communityAvatarPath(shopId, userId, mime) {
  const ext = MIME_EXT[mime] || "jpg";
  return `${shopId}/${userId}/avatar-${Date.now()}-${crypto.randomUUID()}.${ext}`;
}

export function isStoragePath(value) {
  const text = String(value || "");
  if (!text) return false;
  if (/^https?:\/\//i.test(text)) return false;
  return text.includes("/");
}
