(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.BloomMarketplaceVerification = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const VERIFICATION_REQUIRED_FIELDS = [
    'legal_name',
    'owner_name',
    'business_address',
    'phone',
    'email',
    'sales_tax_permit_number'
  ];
  const VERIFICATION_REQUIRED_DOCUMENTS = ['resale_certificate', 'government_id'];
  const VERIFICATION_UPLOAD_ACCEPT =
    'application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif';

  const fieldLabels = {
    legal_name: 'Legal business name',
    doing_business_as: 'DBA / business display name',
    owner_name: 'Owner or authorized representative',
    business_address: 'Business address',
    email: 'Email address',
    phone: 'Phone number',
    website: 'Business website',
    tax_id: 'EIN number',
    sales_tax_permit_number: 'State sales-tax permit number',
    resale_certificate: 'Resale certificate',
    government_id: 'Government-issued state ID'
  };

  const documentLabels = {
    resale_certificate: 'Resale certificate',
    government_id: 'Government-issued state ID'
  };

  function normalizeLegacyVerificationProfile(profile = {}) {
    const next = profile && typeof profile === 'object' ? { ...profile } : {};
    next.documents = next.documents && typeof next.documents === 'object' ? { ...next.documents } : {};
    if (!next.documents.government_id && next.documents.state_id) {
      next.documents.government_id = next.documents.state_id;
    }
    return next;
  }

  function getVerificationRules() {
    return {
      requiredFields: VERIFICATION_REQUIRED_FIELDS.slice(),
      requiredDocuments: VERIFICATION_REQUIRED_DOCUMENTS.slice()
    };
  }

  function normalizeMarketplaceVerificationProfile(profile = {}) {
    const normalized = normalizeLegacyVerificationProfile({
      status: profile.status || 'not_started',
      consent_confirmed: Boolean(profile.consent_confirmed),
      documents: profile.documents && typeof profile.documents === 'object' ? profile.documents : {},
      review_history: Array.isArray(profile.review_history) ? profile.review_history : [],
      submitted_at: profile.submitted_at || '',
      reviewed_at: profile.reviewed_at || '',
      review_notes: profile.review_notes || '',
      ...profile
    });
    normalized.documents = normalized.documents || {};
    normalized.review_history = Array.isArray(normalized.review_history) ? normalized.review_history : [];
    normalized.consent_confirmed = Boolean(normalized.consent_confirmed);
    normalized.status = normalized.status || 'not_started';
    return normalized;
  }

  function validateMarketplaceVerificationProfile(profile = {}, rules = {}) {
    const normalized = normalizeMarketplaceVerificationProfile(profile);
    const requiredFields = Array.isArray(rules.requiredFields) && rules.requiredFields.length
      ? rules.requiredFields
      : VERIFICATION_REQUIRED_FIELDS;
    const requiredDocuments = Array.isArray(rules.requiredDocuments) && rules.requiredDocuments.length
      ? rules.requiredDocuments
      : VERIFICATION_REQUIRED_DOCUMENTS;
    const errors = [];
    const missingFields = [];
    const missingDocuments = [];

    requiredFields.forEach((field) => {
      const label = fieldLabels[field] || field.replace(/_/g, ' ');
      const value = normalized[field];
      const empty = typeof value === 'string' ? value.trim() === '' : !Boolean(value);
      if (empty) {
        missingFields.push(field);
        errors.push(`Missing required field: ${label}`);
      }
    });

    if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
      errors.push('Please enter a valid email address.');
    }

    if (normalized.phone && !/^\+?[0-9().\-\s]{7,15}$/.test(normalized.phone)) {
      errors.push('Please enter a valid phone number.');
    }

    if (normalized.website && String(normalized.website).trim() && !/^https?:\/\//i.test(String(normalized.website))) {
      errors.push('Website should start with http:// or https://.');
    }

    const einDigits = String(normalized.tax_id || '').replace(/\D/g, '');
    if (normalized.tax_id && String(normalized.tax_id).trim() && (einDigits.length < 2 || einDigits.length > 12)) {
      errors.push('EIN should contain 2–12 digits when provided.');
    }

    requiredDocuments.forEach((docKey) => {
      if (!normalized.documents?.[docKey]) {
        missingDocuments.push(docKey);
        errors.push(`Missing required document: ${documentLabels[docKey] || docKey}`);
      }
    });

    if (!normalized.consent_confirmed) {
      errors.push('Consent confirmation is required before submission.');
    }

    return {
      valid: errors.length === 0,
      errors,
      missingFields,
      missingDocuments
    };
  }

  function buildVerificationProgress(profile = {}, rules = {}) {
    const resolved = getVerificationRules();
    const requiredFields = Array.isArray(rules.requiredFields) && rules.requiredFields.length
      ? rules.requiredFields
      : resolved.requiredFields;
    const requiredDocuments = Array.isArray(rules.requiredDocuments) && rules.requiredDocuments.length
      ? rules.requiredDocuments
      : resolved.requiredDocuments;
    const normalized = normalizeMarketplaceVerificationProfile(profile);
    const documents = normalized.documents || {};
    const completedFields = requiredFields.filter((field) => {
      const value = normalized[field];
      return typeof value === 'string' ? value.trim() !== '' : Boolean(value);
    }).length;
    const completedDocuments = requiredDocuments.filter((docKey) => Boolean(documents[docKey])).length;
    const missingFields = requiredFields.filter((field) => {
      const value = normalized[field];
      return typeof value === 'string' ? value.trim() === '' : !Boolean(value);
    });
    const missingDocuments = requiredDocuments.filter((docKey) => !Boolean(documents[docKey]));
    const percent = requiredFields.length + requiredDocuments.length === 0
      ? 100
      : Math.round(((completedFields + completedDocuments) / (requiredFields.length + requiredDocuments.length)) * 100);
    return {
      percent,
      completedFields,
      completedDocuments,
      missingFields,
      missingDocuments
    };
  }

  function getVerificationStatus(application = {}) {
    if (application.status === 'approved') return 'approved';
    if (application.status === 'rejected') return 'rejected';
    if (application.status === 'suspended') return 'suspended';
    if (application.status === 'expired') return 'expired';
    if (application.status === 'draft') return 'draft';
    if (application.needsMoreInfo || application.more_info_required) return 'more_info_required';
    if (application.status === 'submitted' || application.status === 'under_review') return 'under_review';
    if (application.status === 'submitted') return 'submitted';
    return 'not_started';
  }

  function maskTaxId(value = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= 4) return '*'.repeat(text.length);
    return `${'*'.repeat(text.length - 4)}${text.slice(-4)}`;
  }

  function buildMarketplaceVerificationSubmissionPayload(profile = {}, options = {}) {
    const normalized = normalizeMarketplaceVerificationProfile(profile);
    const payload = {
      user_id: options.userId || normalized.user_id || '',
      status: options.status || normalized.status || 'draft',
      consent_confirmed: Boolean(normalized.consent_confirmed),
      documents: normalized.documents || {},
      review_history: Array.isArray(normalized.review_history) ? normalized.review_history : [],
      submitted_at: normalized.submitted_at || '',
      reviewed_at: normalized.reviewed_at || '',
      review_notes: normalized.review_notes || ''
    };

    Object.entries(normalized).forEach(([key, value]) => {
      if (['status', 'consent_confirmed', 'documents', 'review_history', 'submitted_at', 'reviewed_at', 'review_notes', 'user_id'].includes(key)) {
        return;
      }
      if (value === undefined || value === null) {
        return;
      }
      payload[key] = value;
    });

    return payload;
  }

  return {
    VERIFICATION_UPLOAD_ACCEPT,
    buildVerificationProgress,
    buildMarketplaceVerificationSubmissionPayload,
    getVerificationRules,
    getVerificationStatus,
    maskTaxId,
    normalizeLegacyVerificationProfile,
    normalizeMarketplaceVerificationProfile,
    validateMarketplaceVerificationProfile
  };
});
