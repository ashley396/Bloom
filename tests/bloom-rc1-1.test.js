import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvePublishedSite,
  filterPublicProducts,
  previewTokenSecret,
  verifyPreviewToken,
  signPreviewToken,
  mergeCatalogProducts,
  normalizeShopProduct,
  webOrderPayloadFromCart,
  tenantIsolationCheck,
  buildSitemapEntries,
  robotsTxt
} from "../netlify/functions/_shared/bloom-storefront-core.js";
import {
  applyTextEdit,
  moveSectionKeyboard,
  publishRequiresApproval,
  sanitizeRichText,
  createEditHistory,
  restoreThemeSettings
} from "../netlify/functions/_shared/bloom-website-editor.js";
import {
  dryRunImport,
  approveImportBatch,
  duplicateReviewAction,
  libraryQualityDashboard,
  assertMasterLibraryImmutable
} from "../netlify/functions/_shared/floral-library-admin.js";
import { filterCustomerForRole, canViewSensitiveCustomerData } from "../netlify/functions/_shared/bloom-customer-profile.js";
import {
  validateGuidedStep,
  buildOrderBodyFromGuided,
  paymentHandoffAfterCreate
} from "../netlify/functions/_shared/bloom-guided-order.js";
import { switchThemePreserveContent, buildSiteFromShopProfile } from "../netlify/functions/_shared/bloom-instant-website.js";
import { productVisibleOnPublicSite } from "../netlify/functions/_shared/floral-library-core.js";
import fs from "node:fs";

test("public storefront hides draft project", () => {
  const r = resolvePublishedSite({ status: "draft" }, [], { name: "X" });
  assert.equal(r.allowed, false);
});

test("published content resolves theme", () => {
  const r = resolvePublishedSite({ status: "published", theme_id: "luxury_boutique" }, [{ slug: "home", visible: true }], { name: "Petals" });
  assert.equal(r.allowed, true);
  assert.equal(r.theme.mode.id, "luxury_boutique");
});

test("preview authorization token", () => {
  const exp = Date.now() + 60000;
  const token = signPreviewToken("shop-1", exp, "test-secret");
  assert.equal(verifyPreviewToken(token, "shop-1", Date.now(), "test-secret").valid, true);
  assert.equal(verifyPreviewToken(token, "shop-2", Date.now(), "test-secret").valid, false);
});

test("storefront preview fails closed without a configured secret", () => {
  assert.equal(previewTokenSecret({}), null);
  assert.throws(
    () => signPreviewToken("shop-1", Date.now() + 60000, null),
    /Storefront preview is not configured/
  );
  assert.deepEqual(
    verifyPreviewToken("attacker-token", "shop-1", Date.now(), null),
    { valid: false, error: "Storefront preview is not configured." }
  );
});

test("draft products hidden on public site", () => {
  const products = [
    { id: "1", publish_status: "draft", sync: { available_online: true } },
    { id: "2", publish_status: "published", sync: { available_online: true }, retail_price: 10 }
  ];
  const pub = filterPublicProducts(products.map(normalizeShopProduct));
  assert.equal(pub.length, 1);
});

test("theme switching preserves content", () => {
  const base = buildSiteFromShopProfile({ name: "A" });
  const switched = switchThemePreserveContent(base, "modern_minimal");
  assert.equal(switched.pages.length, base.pages.length);
});

test("text edit sanitizes script", () => {
  const section = { id: "1", type: "hero", props: {} };
  const next = applyTextEdit(section, "title", '<script>alert(1)</script>Hello');
  assert.ok(!String(next.props.title).includes("script"));
});

test("keyboard section reorder", () => {
  const sections = [
    { id: "a", order: 0 },
    { id: "b", order: 1 }
  ];
  const moved = moveSectionKeyboard(sections, "b", "up");
  assert.equal(moved[0].id, "b");
});

test("undo redo history", () => {
  const h = createEditHistory();
  h.push({ sections: [{ id: "1" }] });
  h.push({ sections: [{ id: "1" }, { id: "2" }] });
  const u = h.undo();
  assert.equal(u.sections.length, 1);
  const r = h.redo();
  assert.equal(r.sections.length, 2);
});

test("publish approval gate blocks lily draft", () => {
  assert.equal(publishRequiresApproval({ lilyDraft: true, approved: false, saved: true }).ok, false);
  assert.equal(publishRequiresApproval({ approved: true, saved: true }).ok, true);
});

test("theme restore", () => {
  const r = restoreThemeSettings({ palette: ["#fff"] }, { palette: ["#000"], font_pairing: "a" });
  assert.equal(r.restored, true);
  assert.deepEqual(r.settings.palette, ["#fff"]);
});

test("tenant isolation", () => {
  assert.equal(tenantIsolationCheck("a", "a"), true);
  assert.equal(tenantIsolationCheck("a", "b"), false);
});

test("customer sensitive fields hidden from cashier", () => {
  assert.equal(canViewSensitiveCustomerData("cashier"), false);
  const c = filterCustomerForRole({ name: "A", tax_id: "secret", saved_payment_methods: [{ brand: "visa", last4: "4242", pan: "nope" }] }, "cashier");
  assert.equal(c.tax_id, undefined);
  assert.equal(c.saved_payment_methods[0].last4, "4242");
  assert.equal(c.saved_payment_methods[0].pan, undefined);
});

test("guided order step validation", () => {
  assert.equal(validateGuidedStep("customer", {}).valid, false);
  assert.equal(validateGuidedStep("customer", { customer_name: "Sam" }).valid, true);
});

test("guided order body matches orders API shape", () => {
  const body = buildOrderBodyFromGuided({
    customer_name: "Sam",
    recipient_name: "Sam",
    subtotal: 100,
    tax_rate: 6,
    fulfillment: "PICKUP"
  });
  assert.equal(body.customer_name, "Sam");
  assert.equal(body.tax, 6);
  for (const field of ["amount_paid", "balance_due", "payment_status", "payment_method", "paid_at"]) {
    assert.equal(field in body, false);
  }
});

test("guided order keeps product amount separate from labor for server pricing", () => {
  const body = buildOrderBodyFromGuided({
    customer_name: "Sam",
    recipient_name: "Sam",
    subtotal: 100,
    labor_charge: 20,
    discount: 10,
    tax_rate: 10,
    fulfillment: "PICKUP"
  });
  assert.equal(body.subtotal, 100);
  assert.equal(body.labor_charge, 20);
  assert.equal(body.discount, 10);
  assert.equal(body.tax, 11);
  assert.equal(body.total_preview, 121);
});

test("payment handoff regression guard", () => {
  const handoff = paymentHandoffAfterCreate({ id: "o1", total: 100, balance_due: 50 });
  assert.equal(handoff.route, "existing_payment_center");
  assert.equal(handoff.use_create_checkout, true);
  const src = fs.readFileSync(new URL("../netlify/functions/create-checkout.js", import.meta.url), "utf8");
  assert.ok(src.includes("bloom_order_id"));
});

test("master library import permissions", () => {
  assert.equal(assertMasterLibraryImmutable({ scope: "master" }).allowed, false);
});

test("manifest validation rejects bad license", () => {
  const report = dryRunImport([{ product_id: "x", product_name: "Y", image_url: "http://x.jpg", license_source: "invalid" }]);
  assert.ok(report.invalid.length >= 1);
});

test("partial import approval", () => {
  const batch = { manifest: [{ product_id: "a" }, { product_id: "b" }] };
  const r = approveImportBatch(batch, { approveIds: ["a"], rejectIds: ["b"] });
  assert.equal(r.status, "approved");
  assert.equal(r.approved.length, 1);
});

test("duplicate review action audit", () => {
  const r = duplicateReviewAction({ id: "1", hash: "h" }, "approve_note", "ok");
  assert.equal(r.ok, true);
  assert.ok(r.audit.action);
});

test("Lily draft requires approval via publish gate", () => {
  assert.equal(publishRequiresApproval({ lilyDraft: true, approved: false, saved: true }).ok, false);
});

test("SEO sitemap and robots", () => {
  const entries = buildSitemapEntries("https://shop.bloom-sites.com", [{ slug: "home", visible: true }, { slug: "shop", visible: true }]);
  assert.ok(entries.length >= 2);
  assert.match(robotsTxt({ allowIndex: true }), /Allow/);
});

test("percentage tax in web order payload", () => {
  const payload = webOrderPayloadFromCart({ lines: [{ name: "Rose", price: 100, qty: 1 }] }, { name: "A" }, { tax_rate: 6 });
  assert.equal(payload.tax, 6);
});

test("mobile navigation markup in storefront html", () => {
  const html = fs.readFileSync(new URL("../public/storefront/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("storefront-nav-toggle"));
  assert.ok(html.includes("aria-live"));
});

test("accessibility announcements helper", () => {
  const h = createEditHistory();
  const a = h.announceAction("Undo");
  assert.equal(a.live, "polite");
});

test("product visibility respects online flag", () => {
  assert.equal(productVisibleOnPublicSite({ publish_status: "published", sync: { available_online: false } }), false);
});
