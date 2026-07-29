import crypto from "node:crypto";
import { validateVerificationProfile } from "./marketplace-verification-rules.js";

export const BUCKET = "marketplace-verification-documents";
export const TABLE = "marketplace_verification_applications";
export const AUDIT_TABLE = "marketplace_verification_audit_events";
export const TAX_TABLE = "marketplace_verification_tax_secrets";
export const EMAIL_TABLE = "marketplace_verification_email_outbox";

export const ALLOWED_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "more_info_required",
  "approved",
  "rejected",
  "expired",
  "suspended"
];

export const FLORIST_ALLOWED_TARGET_STATUSES = new Set(["draft", "submitted", "more_info_required"]);
export const ADMIN_REVIEW_DECISIONS = new Set(["approve", "reject", "request_more_info", "suspend"]);

const DEFAULT_DOCUMENT_TTL_DAYS = Number(process.env.MARKETPLACE_VERIFICATION_DOCUMENT_TTL_DAYS || 365);
const DEFAULT_APPROVAL_TTL_DAYS = Number(process.env.MARKETPLACE_VERIFICATION_APPROVAL_TTL_DAYS || 365);

export function normalizeTaxDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

export function taxIdLastFour(value = "") {
  const digits = normalizeTaxDigits(value);
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

export function maskTaxId(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 4) return "*".repeat(text.length);
  return `${"*".repeat(text.length - 4)}${text.slice(-4)}`;
}

function encryptionKey(keyMaterial) {
  if (!keyMaterial) {
    const error = new Error("MARKETPLACE_TAX_ENCRYPTION_KEY is not configured in Netlify.");
    error.statusCode = 503;
    throw error;
  }
  return crypto.createHash("sha256").update(String(keyMaterial)).digest();
}

export function encryptTaxId(plaintext, keyMaterial) {
  const digits = normalizeTaxDigits(plaintext);
  if (!digits) return null;
  const key = encryptionKey(keyMaterial);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(digits, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    tax_id_ciphertext: Buffer.concat([iv, tag, encrypted]),
    tax_id_last_four: taxIdLastFour(digits)
  };
}

export function decryptTaxId(ciphertext, keyMaterial) {
  if (!ciphertext) return "";
  const buffer = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext);
  if (buffer.length < 29) return "";
  const key = encryptionKey(keyMaterial);
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function stripTaxIdFromProfileData(profileData = {}) {
  if (!profileData || typeof profileData !== "object") return {};
  const next = { ...profileData };
  delete next.tax_id;
  return next;
}

export function resolveFloristTargetStatus(currentStatus, requestedStatus, { submitting = false } = {}) {
  const current = ALLOWED_STATUSES.includes(currentStatus) ? currentStatus : "draft";
  let target = FLORIST_ALLOWED_TARGET_STATUSES.has(requestedStatus) ? requestedStatus : "draft";

  if (["approved", "rejected", "expired", "suspended", "under_review"].includes(current)) {
    if (current === "more_info_required" && (target === "submitted" || target === "draft")) {
      return submitting ? "submitted" : target;
    }
    return current;
  }

  if (submitting && target === "submitted") {
    return "submitted";
  }

  if (current === "submitted" && target === "draft") {
    return "submitted";
  }

  return target;
}

export function withDocumentExpirationMetadata(documents = {}, ttlDays = DEFAULT_DOCUMENT_TTL_DAYS) {
  if (!documents || typeof documents !== "object") return {};
  const ttlMs = Math.max(1, ttlDays) * 24 * 60 * 60 * 1000;
  const next = {};
  for (const [key, value] of Object.entries(documents)) {
    if (!value || typeof value !== "object") {
      next[key] = value;
      continue;
    }
    const uploadedAt = value.uploaded_at || value.uploadedAt || new Date().toISOString();
    const expiresAt = value.expires_at || value.expiresAt || new Date(Date.parse(uploadedAt) + ttlMs).toISOString();
    next[key] = {
      ...value,
      uploaded_at: uploadedAt,
      expires_at: expiresAt
    };
  }
  return next;
}

export function documentsAreExpired(documents = {}, now = Date.now()) {
  return Object.values(documents || {}).some((doc) => {
    if (!doc || typeof doc !== "object") return false;
    const expiresAt = doc.expires_at || doc.expiresAt;
    return expiresAt ? Date.parse(expiresAt) < now : false;
  });
}

export function approvalIsExpired(approvalExpiresAt, now = Date.now()) {
  if (!approvalExpiresAt) return false;
  return Date.parse(approvalExpiresAt) < now;
}

export function buildApprovalExpiryDate(days = DEFAULT_APPROVAL_TTL_DAYS) {
  return new Date(Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
}

export function buildDocumentsExpiryDate(days = DEFAULT_DOCUMENT_TTL_DAYS) {
  return new Date(Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
}

export function sanitizeApplicationForClient(application, profileData = {}, taxMeta = {}) {
  const stripped = stripTaxIdFromProfileData(profileData);
  const masked = taxMeta.tax_id_last_four ? maskTaxId(taxMeta.tax_id_last_four.padStart(9, "*")) : "";
  return {
    ...application,
    profile_data: {
      ...stripped,
      tax_id_masked: masked || undefined,
      tax_id_on_file: Boolean(taxMeta.tax_id_last_four)
    }
  };
}

export function adminDecisionToStatus(decision) {
  switch (decision) {
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "request_more_info":
      return "more_info_required";
    case "suspend":
      return "suspended";
    default:
      return null;
  }
}

export function canPurchaseWithVerification(application, now = Date.now()) {
  if (!application) {
    return { allowed: false, reason: "missing_application" };
  }
  if (application.status !== "approved") {
    return { allowed: false, reason: "not_approved" };
  }
  if (application.documents_expire_at && Date.parse(application.documents_expire_at) < now) {
    return { allowed: false, reason: "documents_expired" };
  }
  const documents = application.profile_data?.documents || {};
  if (documentsAreExpired(documents, now)) {
    return { allowed: false, reason: "documents_expired" };
  }
  if (approvalIsExpired(application.approval_expires_at, now)) {
    return { allowed: false, reason: "approval_expired" };
  }
  return { allowed: true, reason: null };
}

export function checkoutListingSelectFields() {
  return "id, product_name, price, shop_id, active, shops(stripe_connect_account_id)";
}

export function mapCheckoutListing(item) {
  if (!item) return null;
  return {
    id: item.id,
    name: item.product_name,
    price: item.price,
    shop_id: item.shop_id,
    active: item.active,
    stripe_connect_account_id: item.shops?.stripe_connect_account_id || null
  };
}

export function assertSignedDocumentPathForUser(userId, storagePath) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedPath = String(storagePath || "").trim();
  if (!normalizedUserId || !normalizedPath) {
    const error = new Error("Invalid document storage path.");
    error.statusCode = 400;
    throw error;
  }
  if (!normalizedPath.startsWith(`${normalizedUserId}/`)) {
    const error = new Error("You can only access your own verification documents.");
    error.statusCode = 403;
    throw error;
  }
  return normalizedPath;
}

export function wholesalerCanAccessApplication(application, { shopId } = {}) {
  if (!application || !shopId) return false;
  const wholesalerShopId = application.wholesaler_shop_id || null;
  if (!wholesalerShopId) return false;
  return wholesalerShopId === shopId;
}

export async function loadTaxMetaForApplication(client, applicationId) {
  const { data, error } = await client
    .from(TAX_TABLE)
    .select("tax_id_last_four")
    .eq("application_id", applicationId)
    .maybeSingle();
  if (error) {
    if (isMissingVerificationTableError(error)) return {};
    throw error;
  }
  return data || {};
}

export async function sanitizeApplicationRecord(client, application) {
  if (!application) return null;
  const taxMeta = await loadTaxMetaForApplication(client, application.id);
  return sanitizeApplicationForClient(application, application.profile_data || {}, taxMeta);
}

export function isMissingVerificationTableError(error) {
  if (!error) return false;
  const message = String(error.message || error.details || "").toLowerCase();
  const code = String(error.code || "");
  return (
    code === "42P01"
    || code === "PGRST205"
    || message.includes("does not exist")
    || message.includes("could not find the table")
    || message.includes("schema cache")
  );
}

export async function writeVerificationAudit(client, { applicationId, actorUserId, action, metadata = {} }) {
  const { error } = await client.from(AUDIT_TABLE).insert({
    application_id: applicationId,
    actor_user_id: actorUserId || null,
    action,
    metadata
  });
  if (error) throw error;
}

export async function enqueueVerificationEmail(client, { userId, recipientEmail, eventType, applicationId, payload = {} }) {
  const record = {
    user_id: userId,
    recipient_email: recipientEmail || null,
    event_type: eventType,
    application_id: applicationId,
    payload,
    status: "pending"
  };
  const { data, error } = await client.from(EMAIL_TABLE).insert(record).select("id").single();
  if (error) throw error;

  const webhookUrl = process.env.MARKETPLACE_VERIFICATION_EMAIL_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...record, id: data.id })
      });
      if (response.ok) {
        await client.from(EMAIL_TABLE).update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", data.id);
      }
    } catch (hookError) {
      console.error("Marketplace verification email webhook failed:", hookError);
    }
  }

  return data;
}

export async function upsertTaxSecret(client, { applicationId, userId, taxId, keyMaterial }) {
  const encrypted = encryptTaxId(taxId, keyMaterial);
  if (!encrypted) return null;
  const { error } = await client.from(TAX_TABLE).upsert(
    {
      application_id: applicationId,
      user_id: userId,
      tax_id_ciphertext: encrypted.tax_id_ciphertext,
      tax_id_last_four: encrypted.tax_id_last_four,
      updated_at: new Date().toISOString()
    },
    { onConflict: "application_id" }
  );
  if (error) throw error;
  return { tax_id_last_four: encrypted.tax_id_last_four };
}

export function validateProfileForSubmission(profileData = {}) {
  return validateVerificationProfile(profileData, { submitting: true });
}

export function parseOptionalTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) {
    const error = new Error("Invalid timestamp value.");
    error.statusCode = 400;
    throw error;
  }
  return new Date(parsed).toISOString();
}
