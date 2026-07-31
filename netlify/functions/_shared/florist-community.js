/**
 * Florist Community Beta — validation and response sanitization.
 * Never include customer, recipient, employee, payment, or order fields.
 */

export const COMMUNITY_CATEGORIES = Object.freeze([
  "Design Help",
  "Business Advice",
  "Questions",
  "Celebrations",
]);

export const COMMUNITY_GUIDELINES = Object.freeze([
  "Share florist-to-florist advice only — never customer names, phone numbers, addresses, or order details.",
  "Be kind. Encourage fellow florists; disagree respectfully.",
  "One arrangement photo per post. Upload only images you have rights to share.",
  "No spam, promotions for non-floral scams, or off-topic sales pitches.",
  "Report posts that break these guidelines. Moderators may hide or remove content.",
  "This Community is a Beta. Features may change; private messaging and groups are not available.",
]);

export const COMMUNITY_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export const COMMUNITY_IMAGE_ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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

export function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], "base64") };
}

export function validateCommunityImageUpload({ mime, sizeBytes, dataUrl } = {}) {
  let resolvedMime = String(mime || "").toLowerCase();
  let resolvedSize = Number(sizeBytes);

  if (dataUrl) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return { valid: false, error: "Invalid image encoding." };
    resolvedMime = parsed.mime;
    resolvedSize = parsed.buffer.length;
  }

  if (!COMMUNITY_IMAGE_ALLOWED_MIMES.has(resolvedMime)) {
    return { valid: false, error: "Community photos must be JPEG, PNG, or WebP." };
  }
  if (!Number.isFinite(resolvedSize) || resolvedSize <= 0) {
    return { valid: false, error: "Image file is empty." };
  }
  if (resolvedSize > COMMUNITY_IMAGE_MAX_BYTES) {
    return { valid: false, error: "Community photos must be under 2 MB." };
  }
  return { valid: true, mime: resolvedMime, sizeBytes: resolvedSize };
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

export function validatePostBody(body = {}) {
  const category = String(body.category || "").trim();
  const caption = sanitizeText(body.caption, 280);
  const text = sanitizeText(body.body ?? body.text, 4000) || null;
  const errors = [];
  if (!COMMUNITY_CATEGORIES.includes(category)) {
    errors.push("Choose a valid category.");
  }
  if (!caption) errors.push("Caption is required.");
  if (body.image_data_url) {
    const img = validateCommunityImageUpload({ dataUrl: body.image_data_url });
    if (!img.valid) errors.push(img.error);
  }
  return {
    valid: errors.length === 0,
    errors,
    sanitized: { category, caption, body: text },
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

export function canModerateCommunity({ userId, role, isPlatformAdmin, post } = {}) {
  if (!post) return false;
  if (isPlatformAdmin) return true;
  const r = String(role || "").toLowerCase();
  if (["owner", "manager", "admin"].includes(r) && post.shop_id) {
    return true; // caller must also verify shop_id matches moderator's shop
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

export function publicProfile(row) {
  if (!row) return null;
  return assertCommunitySafePayload({
    user_id: row.user_id,
    shop_id: row.shop_id,
    display_name: row.display_name,
    shop_display_name: row.shop_display_name,
    city: row.city || null,
    region: row.region || null,
    bio: row.bio || null,
    updated_at: row.updated_at || null,
  });
}

export function publicPost(row, { liked = false, isMine = false, canModerate = false, imageUrl = null } = {}) {
  if (!row) return null;
  return assertCommunitySafePayload({
    id: row.id,
    category: row.category,
    caption: row.caption,
    body: row.body || null,
    image_url: imageUrl,
    status: row.status,
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    liked: Boolean(liked),
    is_mine: Boolean(isMine),
    can_moderate: Boolean(canModerate),
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
  });
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

export function communityImagePublicUrl(supabaseUrl, path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = String(supabaseUrl || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/florist-community/${path}`;
}

export const COMMUNITY_IMAGE_BUCKET = "florist-community";

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function communityImagePath(shopId, userId, mime) {
  const ext = MIME_EXT[mime] || "jpg";
  return `${shopId}/${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
}
