import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  reconcileCartLines,
  validateStorefrontCheckout,
  deliveryDateValid,
  computeDepositAmount,
  buildPublicStripeSessionParams,
  mergeCommerceSettings,
  minOrderMet,
  storefrontCommerceHandoff
} from "../netlify/functions/_shared/bloom-storefront-commerce.js";
import { filterPublicProducts, normalizeShopProduct } from "../netlify/functions/_shared/bloom-storefront-core.js";

const catalog = filterPublicProducts([
  normalizeShopProduct({
    id: "p1",
    name: "Rose bouquet",
    retail_price: 85,
    publish_status: "published",
    sync: { available_online: true, show_price_online: true }
  })
]);

test("reconcile cart rejects tampered price", () => {
  const r = reconcileCartLines([{ id: "p1", name: "Rose bouquet", price: 1, qty: 1 }], catalog);
  assert.equal(r.valid, true);
  assert.equal(r.lines[0].price, 85);
});

test("reconcile cart rejects hidden product", () => {
  const hidden = normalizeShopProduct({
    id: "p2",
    name: "Hidden",
    retail_price: 10,
    publish_status: "draft",
    sync: { available_online: true }
  });
  const r = reconcileCartLines([{ id: "p2", qty: 1 }], [hidden]);
  assert.equal(r.valid, false);
});

test("checkout requires phone and delivery date", () => {
  const settings = mergeCommerceSettings({});
  const bad = validateStorefrontCheckout(
    { customer: { name: "A" }, options: { fulfillment: "PICKUP" }, payment_mode: "pay_later" },
    settings
  );
  assert.equal(bad.valid, false);
  const good = validateStorefrontCheckout(
    {
      customer: { name: "A", phone: "555-0100" },
      options: { fulfillment: "PICKUP", delivery_date: "2030-01-15" },
      payment_mode: "pay_later"
    },
    settings
  );
  assert.equal(good.valid, true);
});

test("delivery lead days enforced", () => {
  const r = deliveryDateValid("2026-01-01", 2, new Date("2026-07-28T12:00:00"));
  assert.equal(r.valid, false);
});

test("deposit percent computes charge", () => {
  assert.equal(computeDepositAmount(100, 50), 50);
  assert.equal(computeDepositAmount(100, 0), 100);
});

test("minimum order amount", () => {
  assert.equal(minOrderMet(20, 25).ok, false);
  assert.equal(minOrderMet(30, 25).ok, true);
});

test("public stripe session metadata for web checkout", () => {
  const params = buildPublicStripeSessionParams({
    order: { id: "o1", order_number: "WEB-1", shop_id: "s1" },
    shop: { id: "s1", name: "Petals", slug: "petals" },
    chargeAmount: 50,
    idempotencyKey: "k1",
    siteBase: "https://app.example.com",
    shopSlug: "petals"
  });
  assert.equal(params.metadata.bloom_web_checkout, "true");
  assert.equal(params.metadata.bloom_order_id, "o1");
  assert.match(params.success_url, /order_success/);
});

test("handoff preserves staff create-checkout guard", () => {
  const h = storefrontCommerceHandoff({
    order: { id: "o1", order_number: "WEB-1", total: 80, balance_due: 80 },
    paymentMode: "pay_later",
    settings: {}
  });
  assert.equal(h.create_checkout_requires_staff, true);
});

test("create-checkout staff auth unchanged", () => {
  const src = fs.readFileSync(new URL("../netlify/functions/create-checkout.js", import.meta.url), "utf8");
  assert.ok(src.includes("currentUser"));
  assert.ok(src.includes("requireRoles"));
});

test("storefront html includes commerce payment modes", () => {
  const html = fs.readFileSync(new URL("../public/storefront/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("payment_mode"));
  assert.ok(html.includes("delivery_date"));
});
