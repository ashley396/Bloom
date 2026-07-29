import test from "node:test";
import assert from "node:assert/strict";
import {
  getVerificationRules,
  normalizeLegacyVerificationProfile,
  validateVerificationProfile
} from "../netlify/functions/_shared/marketplace-verification-rules.js";
import { normalizeMarketplaceCategory } from "../netlify/functions/_shared/marketplace-categories.js";
import { parseMarketplaceCsv } from "../netlify/functions/_shared/marketplace-csv.js";
import { validateProfileForSubmission, canPurchaseWithVerification, wholesalerCanAccessApplication } from "../netlify/functions/_shared/marketplace-verification.js";

test("verification rules require sales tax permit and two documents only", () => {
  const rules = getVerificationRules();
  assert.deepEqual(rules.requiredDocuments, ["resale_certificate", "government_id"]);
  assert.ok(rules.requiredFields.includes("sales_tax_permit_number"));
  assert.ok(!rules.requiredFields.includes("tax_id"));
  assert.ok(!rules.requiredDocuments.includes("ein_confirmation"));
});

test("EIN and website remain optional during validation", () => {
  const validation = validateVerificationProfile({
    legal_name: "Bloom LLC",
    owner_name: "Ada",
    business_address: "1 Main",
    phone: "555-0100",
    email: "ada@example.com",
    sales_tax_permit_number: "ST-123",
    consent_confirmed: true,
    documents: {
      resale_certificate: { name: "resale.pdf" },
      government_id: { name: "id.jpg" }
    }
  });
  assert.equal(validation.valid, true);
});

test("validation rejects missing required uploads and sales tax permit number", () => {
  const missingDocs = validateVerificationProfile({
    legal_name: "Bloom LLC",
    owner_name: "Ada",
    business_address: "1 Main",
    phone: "555-0100",
    email: "ada@example.com",
    sales_tax_permit_number: "ST-123",
    consent_confirmed: true,
    documents: { resale_certificate: { name: "resale.pdf" } }
  });
  assert.equal(missingDocs.valid, false);
  assert.ok(missingDocs.missingDocuments.includes("government_id"));

  const missingPermit = validateVerificationProfile({
    legal_name: "Bloom LLC",
    owner_name: "Ada",
    business_address: "1 Main",
    phone: "555-0100",
    email: "ada@example.com",
    consent_confirmed: true,
    documents: {
      resale_certificate: { name: "resale.pdf" },
      government_id: { name: "id.jpg" }
    }
  });
  assert.equal(missingPermit.valid, false);
  assert.ok(missingPermit.missingFields.includes("sales_tax_permit_number"));
});

test("legacy verification profiles remain readable", () => {
  const legacy = normalizeLegacyVerificationProfile({
    legal_name: "Legacy Shop",
    documents: {
      state_id: { name: "id.pdf" },
      business_license: { name: "old.pdf" },
      ein_confirmation: { name: "legacy.pdf" }
    }
  });
  assert.equal(legacy.documents.government_id.name, "id.pdf");
  assert.equal(legacy.documents.business_license.name, "old.pdf");
});

test("validateProfileForSubmission matches shared verification rules", () => {
  const result = validateProfileForSubmission({
    legal_name: "Bloom",
    owner_name: "Owner",
    business_address: "123",
    phone: "555-0101",
    email: "shop@example.com",
    sales_tax_permit_number: "TX-1",
    consent_confirmed: true,
    documents: {
      resale_certificate: { name: "resale.pdf" },
      government_id: { name: "id.pdf" }
    }
  });
  assert.equal(result.valid, true);
});

test("category normalization preserves legacy listing categories", () => {
  const legacy = normalizeMarketplaceCategory("Flowers");
  assert.equal(legacy.slug, "fresh-flowers");
  assert.equal(legacy.legacy, true);
  const canonical = normalizeMarketplaceCategory("Fresh Flowers");
  assert.equal(canonical.slug, "fresh-flowers");
  assert.equal(canonical.legacy, false);
});

test("CSV validation requires product_name and price", () => {
  const invalid = parseMarketplaceCsv("product_name,unit\nRose,each");
  assert.equal(invalid.valid, false);
  const valid = parseMarketplaceCsv("product_name,price\nRose,12.5");
  assert.equal(valid.valid, true);
  assert.equal(valid.rows.length, 1);
});

test("checkout still blocks unapproved buyers", () => {
  const blocked = canPurchaseWithVerification({ status: "submitted", profile_data: { documents: {} } });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "not_approved");
});

test("wholesaler access remains shop-scoped", () => {
  assert.equal(wholesalerCanAccessApplication({ wholesaler_shop_id: "a" }, { shopId: "b" }), false);
  assert.equal(wholesalerCanAccessApplication({ wholesaler_shop_id: "a" }, { shopId: "a" }), true);
});
