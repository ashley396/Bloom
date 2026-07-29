import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/marketplace-verification.js');
const { buildVerificationProgress, buildMarketplaceVerificationSubmissionPayload, getVerificationStatus, getVerificationRules, maskTaxId, normalizeMarketplaceVerificationProfile, validateMarketplaceVerificationProfile } = globalThis.BloomMarketplaceVerification;

test('buildVerificationProgress reports completed steps', () => {
  const progress = buildVerificationProgress({
    legal_name: 'Bloom Florals',
    owner_name: 'Ada Rose',
    email: 'ada@example.com',
    phone: '555-0100',
    business_address: '123 Main St',
    documents: { resale_certificate: { name: 'resale.pdf' } }
  }, {
    requiredFields: ['legal_name', 'owner_name', 'email', 'phone'],
    requiredDocuments: ['resale_certificate']
  });

  assert.equal(progress.percent, 100);
  assert.equal(progress.completedFields, 4);
  assert.equal(progress.completedDocuments, 1);
  assert.deepEqual(progress.missingFields, []);
  assert.deepEqual(progress.missingDocuments, []);
});

test('getVerificationStatus uses review flags for correction requests', () => {
  const status = getVerificationStatus({ status: 'submitted', needsMoreInfo: true });
  assert.equal(status, 'more_info_required');
});

test('maskTaxId preserves only the last four characters', () => {
  assert.equal(maskTaxId('123456789'), '*****6789');
  assert.equal(maskTaxId(''), '');
});

test('normalizeMarketplaceVerificationProfile creates a consistent review structure', () => {
  const profile = normalizeMarketplaceVerificationProfile({ legal_name: 'Bloom Florals', documents: null });
  assert.equal(profile.status, 'not_started');
  assert.deepEqual(profile.documents, {});
  assert.deepEqual(profile.review_history, []);
  assert.equal(profile.consent_confirmed, false);
});

test('validateMarketplaceVerificationProfile reports missing fields and invalid values', () => {
  const validation = validateMarketplaceVerificationProfile({ email: 'not-an-email' }, { requiredFields: ['legal_name', 'email'], requiredDocuments: ['resale_certificate', 'government_id'] });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((message) => message.includes('Legal business name')));
  assert.ok(validation.errors.some((message) => message.includes('valid email')));
  assert.deepEqual(validation.missingDocuments, ['resale_certificate', 'government_id']);
});

test('validateMarketplaceVerificationProfile does not require EIN or website', () => {
  const validation = validateMarketplaceVerificationProfile({
    legal_name: 'Bloom Florals',
    owner_name: 'Ada Rose',
    business_address: '123 Main St',
    phone: '555-0100',
    email: 'ada@example.com',
    sales_tax_permit_number: 'ST-999',
    consent_confirmed: true,
    documents: {
      resale_certificate: { name: 'resale.pdf' },
      government_id: { name: 'id.jpg' }
    }
  }, getVerificationRules());
  assert.equal(validation.valid, true);
});

test('buildMarketplaceVerificationSubmissionPayload strips sensitive values and keeps review metadata', () => {
  const payload = buildMarketplaceVerificationSubmissionPayload({
    legal_name: 'Bloom Florals',
    tax_id: '123456789',
    documents: { resale_certificate: { name: 'resale.pdf' } },
    review_history: [{ status: 'submitted' }],
    consent_confirmed: true
  }, { userId: 'user-1', status: 'submitted' });

  assert.equal(payload.user_id, 'user-1');
  assert.equal(payload.status, 'submitted');
  assert.equal(payload.tax_id, '123456789');
  assert.equal(payload.documents.resale_certificate.name, 'resale.pdf');
  assert.equal(payload.review_history.length, 1);
  assert.equal(payload.consent_confirmed, true);
});
