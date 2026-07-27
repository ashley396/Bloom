(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.BloomMarketplaceVerification = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeMarketplaceVerificationProfile(profile = {}) {
    const normalized = {
      status: profile.status || 'not_started',
      consent_confirmed: Boolean(profile.consent_confirmed),
      documents: profile.documents && typeof profile.documents === 'object' ? profile.documents : {},
      review_history: Array.isArray(profile.review_history) ? profile.review_history : [],
      submitted_at: profile.submitted_at || '',
      reviewed_at: profile.reviewed_at || '',
      review_notes: profile.review_notes || '',
      ...profile
    };
    normalized.documents = normalized.documents || {};
    normalized.review_history = Array.isArray(normalized.review_history) ? normalized.review_history : [];
    normalized.consent_confirmed = Boolean(normalized.consent_confirmed);
    normalized.status = normalized.status || 'not_started';
    return normalized;
  }

  function validateMarketplaceVerificationProfile(profile = {}, rules = {}) {
    const normalized = normalizeMarketplaceVerificationProfile(profile);
    const requiredFields = Array.isArray(rules.requiredFields) ? rules.requiredFields : [];
    const requiredDocuments = Array.isArray(rules.requiredDocuments) ? rules.requiredDocuments : [];
    const errors = [];
    const missingFields = [];
    const missingDocuments = [];

    const fieldLabels = {
      legal_name: 'Legal business name',
      doing_business_as: 'Doing-business-as name',
      owner_name: 'Owner or authorized representative',
      business_address: 'Business address',
      billing_address: 'Billing address',
      shipping_address: 'Shipping address',
      email: 'Email',
      phone: 'Phone',
      website: 'Website',
      business_type: 'Business type',
      year_established: 'Year established',
      bloom_account_id: 'Bloom account ID',
      state_of_registration: 'State of registration',
      tax_id: 'Tax ID',
      sales_tax_permit_number: 'Sales-tax permit number',
      resale_certificate_number: 'Resale certificate number',
      business_license_number: 'Business license number'
    };

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

    if (normalized.website && !/^https?:\/\//i.test(normalized.website)) {
      errors.push('Website should start with http:// or https://.');
    }

    if (normalized.tax_id && !/^\d{2,12}$/.test(String(normalized.tax_id).replace(/\D/g, ''))) {
      errors.push('Tax ID should contain only numbers.');
    }

    requiredDocuments.forEach((docKey) => {
      if (!normalized.documents?.[docKey]) {
        missingDocuments.push(docKey);
        errors.push(`Missing required document: ${docKey}`);
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
    const requiredFields = Array.isArray(rules.requiredFields) ? rules.requiredFields : [];
    const requiredDocuments = Array.isArray(rules.requiredDocuments) ? rules.requiredDocuments : [];
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
    buildVerificationProgress,
    buildMarketplaceVerificationSubmissionPayload,
    getVerificationStatus,
    maskTaxId,
    normalizeMarketplaceVerificationProfile,
    validateMarketplaceVerificationProfile
  };
});
