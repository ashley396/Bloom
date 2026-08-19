import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  normalizeContactPreferences,
  resolveContactPreferences,
  contactPreferenceAuditMetadata,
  CONTACT_METHODS,
} from "../netlify/functions/_shared/customer-preferences.js";
import {
  validateInventoryFreshnessFields,
  validateMarkupMultiplier,
} from "../netlify/functions/_shared/inventory-freshness.js";
import {
  validateProofCaptureBody,
  DELIVERY_PROOF_SIGNED_URL_SECONDS,
  isStoragePath,
} from "../netlify/functions/_shared/delivery-proof.js";
import {
  validateDeliveryProofUpload,
  DELIVERY_PROOF_MAX_BYTES,
} from "../netlify/functions/_shared/upload-validation.js";
import { requireRowShopId } from "../netlify/functions/_shared/shop-scope.js";
import { getFeatureFlags } from "../netlify/functions/_shared/feature-flags.js";
import { normalizeOrderStatus } from "../netlify/functions/_shared/order-status.js";

// ---------------------------------------------------------------------------
// Customer contact preferences
// ---------------------------------------------------------------------------

test("normalizeContactPreferences defaults marketing off on create", () => {
  const prefs = normalizeContactPreferences({}, { isCreate: true });
  assert.equal(prefs.marketing_opt_in, false);
  assert.equal(prefs.preferred_method, "none");
});

test("normalizeContactPreferences preserves explicit marketing opt-in", () => {
  const prefs = normalizeContactPreferences(
    { preferred_method: "text", marketing_opt_in: true },
    { isCreate: true },
  );
  assert.equal(prefs.preferred_method, "text");
  assert.equal(prefs.marketing_opt_in, true);
  assert.ok(prefs.marketing_opt_in_at);
});

test("marketing opt-out records timestamp on change", () => {
  const before = normalizeContactPreferences(
    { marketing_opt_in: true, marketing_opt_in_at: "2026-01-01T00:00:00Z" },
    { isCreate: false, previous: { marketing_opt_in: true } },
  );
  const after = normalizeContactPreferences(
    { marketing_opt_in: false },
    { isCreate: false, previous: before },
  );
  assert.equal(after.marketing_opt_in, false);
  assert.ok(after.marketing_opt_out_at);
});

test("resolveContactPreferences handles legacy null customers", () => {
  const prefs = resolveContactPreferences(null);
  assert.equal(prefs.preferred_method, "none");
  assert.equal(prefs.marketing_opt_in, false);
});

test("contactPreferenceAuditMetadata detects preference changes", () => {
  const meta = contactPreferenceAuditMetadata(
    { preferred_method: "phone", marketing_opt_in: false },
    { preferred_method: "email", marketing_opt_in: true },
  );
  assert.ok(meta?.preferred_method);
  assert.ok(meta?.marketing_opt_in);
});

test("customers API validates tenant scope on PATCH", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/customers.js"), "utf8");
  assert.match(src, /requireRowShopId/);
  assert.match(src, /customer_preferences_updated/);
  assert.match(src, /normalizeContactPreferences/);
});

test("cross-tenant customer access throws 403", () => {
  assert.throws(
    () => requireRowShopId({ shop_id: "shop-a" }, "shop-b", "Customer"),
    /does not belong to this shop/,
  );
});

test("contact methods include phone text email none", () => {
  assert.deepEqual([...CONTACT_METHODS], ["phone", "text", "email", "none"]);
});

// ---------------------------------------------------------------------------
// Delivery proof
// ---------------------------------------------------------------------------

test("validateDeliveryProofUpload accepts valid JPEG", () => {
  const tiny = Buffer.from("fakejpeg").toString("base64");
  const dataUrl = `data:image/jpeg;base64,${tiny}`;
  const result = validateDeliveryProofUpload({ dataUrl });
  assert.equal(result.valid, true);
});

test("validateDeliveryProofUpload rejects invalid mime", () => {
  const dataUrl = "data:application/pdf;base64,YQ==";
  const result = validateDeliveryProofUpload({ dataUrl });
  assert.equal(result.valid, false);
});

test("validateDeliveryProofUpload rejects oversized payload", () => {
  const big = Buffer.alloc(DELIVERY_PROOF_MAX_BYTES + 1).toString("base64");
  const result = validateDeliveryProofUpload({
    dataUrl: `data:image/jpeg;base64,${big}`,
  });
  assert.equal(result.valid, false);
});

test("validateProofCaptureBody requires reason for delivered without photo", () => {
  const result = validateProofCaptureBody({ delivered_without_photo: true, mark_delivered: true });
  assert.equal(result.valid, false);
});

test("deliveries proof uses private bucket and short signed URLs", () => {
  const deliverySrc = fs.readFileSync(
    path.join(process.cwd(), "netlify/functions/deliveries.js"),
    "utf8",
  );
  const proofSrc = fs.readFileSync(
    path.join(process.cwd(), "netlify/functions/_shared/delivery-proof.js"),
    "utf8",
  );
  assert.match(deliverySrc, /capture_proof/);
  assert.match(deliverySrc, /status_unchanged/);
  assert.match(proofSrc, /delivery-proofs/);
  assert.equal(DELIVERY_PROOF_SIGNED_URL_SECONDS, 300);
});

test("isStoragePath distinguishes private paths from public URLs", () => {
  assert.equal(isStoragePath("shop-id/123-photo.jpg"), true);
  assert.equal(isStoragePath("https://cdn.example.com/photo.jpg"), false);
});

test("failed proof save must not mark delivered (handler contract)", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/deliveries.js"), "utf8");
  assert.match(src, /status_unchanged/);
  assert.match(src, /proof_saved: false/);
});

// ---------------------------------------------------------------------------
// Inventory freshness
// ---------------------------------------------------------------------------

test("validateInventoryFreshnessFields accepts received and use_by dates", () => {
  const result = validateInventoryFreshnessFields({
    received_at: "2026-07-01",
    use_by: "2026-07-08",
    markup_multiplier: 3.5,
  });
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.received_at, "2026-07-01");
  assert.equal(result.sanitized.use_by, "2026-07-08");
});

test("validateInventoryFreshnessFields rejects use_by before received_at", () => {
  const result = validateInventoryFreshnessFields({
    received_at: "2026-07-10",
    use_by: "2026-07-01",
  });
  assert.equal(result.valid, false);
});

test("validateMarkupMultiplier enforces bounds", () => {
  assert.equal(validateMarkupMultiplier(3).ok, true);
  assert.equal(validateMarkupMultiplier(0).ok, false);
  assert.equal(validateMarkupMultiplier(100).ok, false);
});

test("inventory API wires Foundation freshness fields", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/inventory.js"), "utf8");
  assert.match(src, /received_at/);
  assert.match(src, /use_by/);
  assert.match(src, /markup_multiplier/);
  assert.match(src, /requireRowShopId/);
});

test("legacy inventory without freshness fields remains valid", () => {
  const result = validateInventoryFreshnessFields({ name: "Rose", quantity: 10 });
  assert.equal(result.valid, true);
});

// ---------------------------------------------------------------------------
// React Orders preview
// ---------------------------------------------------------------------------

test("REACT_ORDERS_PREVIEW defaults false", () => {
  const flags = getFeatureFlags({});
  assert.equal(flags.REACT_ORDERS_PREVIEW, false);
});

test("React OrdersPage checks feature flag before API wiring", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "frontend/src/pages/OrdersPage.tsx"),
    "utf8",
  );
  assert.match(src, /REACT_ORDERS_PREVIEW=false/);
  assert.match(src, /useOrdersPreview/);
  assert.match(src, /Open production Orders/);
});

test("React order status maps legacy NEW to pending", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "frontend/src/lib/order-status.ts"),
    "utf8",
  );
  assert.match(src, /NEW.*PENDING/);
  assert.equal(normalizeOrderStatus("NEW"), "PENDING");
});

test("orders-api uses bearer token for tenant-safe requests", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "frontend/src/lib/orders-api.ts"),
    "utf8",
  );
  assert.match(src, /Authorization.*Bearer/);
  assert.match(src, /production-health/);
});

// ---------------------------------------------------------------------------
// Regression protection (preserved surfaces)
// ---------------------------------------------------------------------------

test("Today dashboard page markup preserved", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  assert.match(html, /id="dashboardPage"/);
  assert.match(html, /Point of Sale/);
});

test("Payment Center sidebar label preserved", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  assert.match(html, /paymentsPage.*Payment Center|Payment Center/);
});

test("launch feature flags match growth rollout defaults", () => {
  const flags = getFeatureFlags({});
  assert.equal(flags.MARKETPLACE_PUBLIC, true);
  assert.equal(flags.WHOLESALE_SELLER, true);
  assert.equal(flags.BUSINESS_ECOSYSTEM, true);
  assert.equal(flags.INVENTORY_AI_INTAKE, false);
  assert.equal(flags.INVENTORY_RECIPE_DEDUCTIONS, true);
  // Flipped true 2026-08-16: the tabbed shell, page CRUD, media library,
  // revision history, and enforced pre-publish checklist shipped 2026-08-15
  // and were already live for every florist with no flag enforcement
  // anywhere in the code — the flag now matches reality instead of
  // contradicting it.
  assert.equal(flags.WEBSITE_STUDIO_V2, true);
});

test("customer UI includes contact preference fields", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  assert.match(html, /name="preferred_method"/);
  assert.match(html, /name="marketing_opt_in"/);
});

test("delivery proof dialog exists in production UI", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
  assert.match(html, /id="deliveryProofDialog"/);
});

test("Website Studio blueprint and architecture bible exist", () => {
  assert.ok(fs.existsSync(path.join(process.cwd(), "docs/FLORISYN_WEBSITE_STUDIO_BLUEPRINT.md")));
  assert.ok(fs.existsSync(path.join(process.cwd(), "docs/FLORISYN_MASTER_ARCHITECTURE_BIBLE.md")));
  const checklist = fs.readFileSync(
    path.join(process.cwd(), "docs/FLORISYN_MASTER_BUILD_CHECKLIST.md"),
    "utf8",
  );
  assert.match(checklist, /WS-0.*Architecture/);
  assert.match(checklist, /WEBSITE_STUDIO_V2/);
});
