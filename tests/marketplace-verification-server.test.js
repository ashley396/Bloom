import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveFloristTargetStatus,
  canPurchaseWithVerification,
  documentsAreExpired,
  wholesalerCanAccessApplication,
  sanitizeApplicationForClient,
  checkoutListingSelectFields,
  assertSignedDocumentPathForUser,
  isMissingVerificationTableError,
  mapCheckoutListing,
  stripTaxIdFromProfileData,
  sanitizeApplicationRecord
} from "../netlify/functions/_shared/marketplace-verification.js";

test("resolveFloristTargetStatus blocks florist from self-approving", () => {
  assert.equal(resolveFloristTargetStatus("draft", "approved"), "draft");
  assert.equal(resolveFloristTargetStatus("submitted", "approved"), "submitted");
  assert.equal(resolveFloristTargetStatus("more_info_required", "submitted", { submitting: true }), "submitted");
});

test("canPurchaseWithVerification requires approved non-expired verification", () => {
  const approved = canPurchaseWithVerification({
    status: "approved",
    profile_data: { documents: {} },
    approval_expires_at: new Date(Date.now() + 86400000).toISOString()
  });
  assert.equal(approved.allowed, true);

  const pending = canPurchaseWithVerification({ status: "submitted", profile_data: { documents: {} } });
  assert.equal(pending.allowed, false);
  assert.equal(pending.reason, "not_approved");

  const expiredDocs = canPurchaseWithVerification({
    status: "approved",
    profile_data: {
      documents: {
        resale_certificate: { expires_at: new Date(Date.now() - 1000).toISOString() }
      }
    }
  });
  assert.equal(expiredDocs.allowed, false);
  assert.equal(expiredDocs.reason, "documents_expired");
});

test("documentsAreExpired detects expired document metadata", () => {
  assert.equal(
    documentsAreExpired({
      permit: { expires_at: new Date(Date.now() + 3600000).toISOString() }
    }),
    false
  );
  assert.equal(
    documentsAreExpired({
      permit: { expires_at: new Date(Date.now() - 3600000).toISOString() }
    }),
    true
  );
});

test("wholesalerCanAccessApplication enforces shop boundaries", () => {
  const application = { wholesaler_shop_id: "shop-a" };
  assert.equal(wholesalerCanAccessApplication(application, { shopId: "shop-a" }), true);
  assert.equal(wholesalerCanAccessApplication(application, { shopId: "shop-b" }), false);
  assert.equal(wholesalerCanAccessApplication(application, { shopId: "shop-b", listingShopId: "shop-a" }), false);
});

test("wholesalerCanAccessApplication denies null wholesaler_shop_id", () => {
  assert.equal(wholesalerCanAccessApplication({ wholesaler_shop_id: null }, { shopId: "shop-a" }), false);
  assert.equal(wholesalerCanAccessApplication({}, { shopId: "shop-a" }), false);
});

test("sanitizeApplicationRecord removes tax_id from profile_data", async () => {
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: { tax_id_last_four: "6789" }, error: null })
              };
            }
          };
        }
      };
    }
  };
  const sanitized = await sanitizeApplicationRecord(client, {
    id: "app-1",
    status: "submitted",
    profile_data: { legal_name: "Bloom", tax_id: "123456789" }
  });
  assert.equal(sanitized.profile_data.tax_id, undefined);
  assert.equal(sanitized.profile_data.tax_id_on_file, true);
  assert.ok(sanitized.profile_data.tax_id_masked.includes("6789"));
});

test("sanitizeApplicationForClient removes tax_id and exposes masked metadata", () => {
  const sanitized = sanitizeApplicationForClient(
    { id: "app-1", status: "draft" },
    { legal_name: "Bloom", tax_id: "123456789" },
    { tax_id_last_four: "6789" }
  );
  assert.equal(sanitized.profile_data.legal_name, "Bloom");
  assert.equal(sanitized.profile_data.tax_id, undefined);
  assert.equal(sanitized.profile_data.tax_id_on_file, true);
  assert.ok(sanitized.profile_data.tax_id_masked.includes("6789"));
  assert.equal(stripTaxIdFromProfileData({ tax_id: "1" }).tax_id, undefined);
});

test("checkoutListingSelectFields and mapCheckoutListing match live listings schema", () => {
  const fields = checkoutListingSelectFields();
  assert.match(fields, /product_name/);
  assert.match(fields, /shops\(stripe_connect_account_id\)/);
  const mapped = mapCheckoutListing({
    id: "listing-1",
    product_name: "Garden Roses",
    price: 24.5,
    shop_id: "shop-1",
    active: true,
    shops: { stripe_connect_account_id: "acct_123" }
  });
  assert.equal(mapped.name, "Garden Roses");
  assert.equal(mapped.stripe_connect_account_id, "acct_123");
});

test("assertSignedDocumentPathForUser rejects cross-user paths", () => {
  assert.equal(assertSignedDocumentPathForUser("user-1", "user-1/2026/resale.pdf"), "user-1/2026/resale.pdf");
  assert.throws(
    () => assertSignedDocumentPathForUser("user-1", "user-2/2026/resale.pdf"),
    (error) => error.statusCode === 403
  );
});

test("isMissingVerificationTableError recognizes schema-missing failures", () => {
  assert.equal(isMissingVerificationTableError({ code: "42P01", message: "relation missing" }), true);
  assert.equal(isMissingVerificationTableError({ code: "PGRST205", message: "Could not find the table" }), true);
  assert.equal(isMissingVerificationTableError({ code: "23505", message: "duplicate" }), false);
});
