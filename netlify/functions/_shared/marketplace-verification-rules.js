/** Shared florist verification rules (server + mirrored in public/marketplace-verification.js). */

export const VERIFICATION_REQUIRED_FIELDS = [
  "legal_name",
  "owner_name",
  "business_address",
  "phone",
  "email",
  "sales_tax_permit_number"
];

export const VERIFICATION_OPTIONAL_FIELDS = [
  "doing_business_as",
  "tax_id",
  "website"
];

export const VERIFICATION_REQUIRED_DOCUMENTS = ["resale_certificate", "government_id"];

export const LEGACY_DOCUMENT_KEYS = [
  "sales_tax_permit",
  "business_license",
  "ein_confirmation",
  "state_id"
];

export const VERIFICATION_UPLOAD_ACCEPT =
  "application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif";

export const VERIFICATION_FIELD_LABELS = {
  legal_name: "Legal business name",
  doing_business_as: "DBA / business display name",
  owner_name: "Owner or authorized representative",
  business_address: "Business address",
  email: "Email address",
  phone: "Phone number",
  website: "Business website",
  tax_id: "EIN number",
  sales_tax_permit_number: "State sales-tax permit number",
  resale_certificate: "Resale certificate",
  government_id: "Government-issued state ID"
};

export const VERIFICATION_DOCUMENT_LABELS = {
  resale_certificate: "Resale certificate",
  government_id: "Government-issued state ID"
};

export function getVerificationRules() {
  return {
    requiredFields: [...VERIFICATION_REQUIRED_FIELDS],
    optionalFields: [...VERIFICATION_OPTIONAL_FIELDS],
    requiredDocuments: [...VERIFICATION_REQUIRED_DOCUMENTS]
  };
}

/** Keep legacy stored profiles readable; do not require retired uploads. */
export function normalizeLegacyVerificationProfile(profile = {}) {
  const next = profile && typeof profile === "object" ? { ...profile } : {};
  next.documents = next.documents && typeof next.documents === "object" ? { ...next.documents } : {};
  if (!next.documents.government_id && next.documents.state_id) {
    next.documents.government_id = next.documents.state_id;
  }
  return next;
}

export function validateVerificationProfile(profile = {}, { submitting = true } = {}) {
  const normalized = normalizeLegacyVerificationProfile(profile);
  const errors = [];
  const missingFields = [];
  const missingDocuments = [];

  for (const field of VERIFICATION_REQUIRED_FIELDS) {
    const value = normalized[field];
    const empty = typeof value === "string" ? value.trim() === "" : !value;
    if (empty) {
      missingFields.push(field);
      errors.push(`Missing required field: ${VERIFICATION_FIELD_LABELS[field] || field}`);
    }
  }

  if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(normalized.email))) {
    errors.push("Please enter a valid email address.");
  }

  if (normalized.phone && !/^\+?[0-9().\-\s]{7,15}$/.test(String(normalized.phone))) {
    errors.push("Please enter a valid phone number.");
  }

  if (normalized.website && String(normalized.website).trim() && !/^https?:\/\//i.test(String(normalized.website))) {
    errors.push("Website should start with http:// or https://.");
  }

  const einDigits = String(normalized.tax_id || "").replace(/\D/g, "");
  if (normalized.tax_id && String(normalized.tax_id).trim() && (einDigits.length < 2 || einDigits.length > 12)) {
    errors.push("EIN should contain 2–12 digits when provided.");
  }

  if (submitting) {
    for (const docKey of VERIFICATION_REQUIRED_DOCUMENTS) {
      if (!normalized.documents?.[docKey]) {
        missingDocuments.push(docKey);
        errors.push(`Missing required document: ${VERIFICATION_DOCUMENT_LABELS[docKey] || docKey}`);
      }
    }
    if (!normalized.consent_confirmed) {
      errors.push("Consent confirmation is required before submission.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    missingFields,
    missingDocuments
  };
}
