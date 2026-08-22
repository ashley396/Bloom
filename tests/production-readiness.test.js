import test from "node:test";
import assert from "node:assert/strict";
import {
  validateEmail,
  validatePhone,
  validateOrderCreateBody,
  validateCustomerBody,
  sanitizeClientErrorPayload
} from "../netlify/functions/_shared/validation.js";
import {
  getProductionConfig,
  safePublicError,
  checkRateLimit,
  BETA_READINESS_CHECKLIST
} from "../netlify/functions/_shared/production.js";
import { validateOrderCreateBody as orderBody } from "../netlify/functions/_shared/validation.js";

test("validateEmail rejects invalid addresses", () => {
  assert.equal(validateEmail("bad").ok, false);
  assert.equal(validateEmail("a@b.co").ok, true);
});

test("validatePhone accepts common florist formats", () => {
  assert.equal(validatePhone("(555) 123-4567").ok, true);
  assert.equal(validatePhone("12").ok, false);
});

test("validateOrderCreateBody requires customer and sane subtotal", () => {
  const bad = validateOrderCreateBody({ subtotal: -1, delivery_date: "2026-07-30", fulfillment: "PICKUP" });
  assert.equal(bad.valid, false);
  const good = validateOrderCreateBody({
    customer_name: "Sarah",
    subtotal: 50,
    delivery_date: "2026-07-30",
    fulfillment: "PICKUP"
  });
  assert.equal(good.valid, true);
});

test("validateOrderCreateBody requires delivery address for DELIVERY", () => {
  const bad = validateOrderCreateBody({
    customer_name: "Sarah",
    subtotal: 50,
    delivery_date: "2026-07-30",
    fulfillment: "DELIVERY"
  });
  assert.equal(bad.valid, false);
});

test("validateCustomerBody validates optional email", () => {
  const bad = validateCustomerBody({ name: "John", email: "not-email" });
  assert.equal(bad.valid, false);
});

test("sanitizeClientErrorPayload strips secrets", () => {
  const safe = sanitizeClientErrorPayload({ message: "fail", password: "x", path: "/orders" });
  assert.equal(safe.password, undefined);
  assert.equal(safe.message, "fail");
});

test("getProductionConfig warns when Stripe missing", () => {
  const cfg = getProductionConfig({});
  assert.equal(cfg.features.payments, false);
  assert.ok(cfg.warnings.some((w) => /Stripe/i.test(w)));
});

test("Stripe readiness requires the order webhook signing secret", () => {
  const cfg = getProductionConfig({
    STRIPE_SECRET_KEY: "sk_test_placeholder",
    STRIPE_WEBHOOK_SECRET: "whsec_subscription_placeholder"
  });
  assert.equal(cfg.features.payments, true);
  assert.equal(cfg.features.stripe_webhooks, false);
  assert.equal(cfg.features.stripe_subscription_webhooks, true);
  assert.ok(cfg.warnings.some((w) => /STRIPE_ORDER_WEBHOOK_SECRET/));

  const ready = getProductionConfig({
    STRIPE_SECRET_KEY: "sk_test_placeholder",
    STRIPE_ORDER_WEBHOOK_SECRET: "whsec_order_placeholder"
  });
  assert.equal(ready.features.stripe_webhooks, true);
  assert.equal(ready.warnings.some((w) => /STRIPE_ORDER_WEBHOOK_SECRET/.test(w)), false);
});

test("safePublicError hides internal 500 details", () => {
  assert.match(safePublicError({ statusCode: 500, message: "DB connection xyz" }), /Unexpected Florisyn/);
  assert.equal(safePublicError({ statusCode: 403, message: "nope" }), "You do not have permission to perform this action.");
});

test("safePublicError surfaces a plan_upgrade_required message instead of the generic 403 text", () => {
  const msg = "Wholesale marketplace seller tools are available on the Premium plan. Upgrade your plan to list products for sale in the wholesale marketplace.";
  assert.equal(safePublicError({ statusCode: 403, code: "plan_upgrade_required", message: msg }), msg);
});

test("checkRateLimit blocks excessive calls", () => {
  const event = { headers: { "x-forwarded-for": "1.2.3.4" } };
  let last = { allowed: true };
  for (let i = 0; i < 5; i++) last = checkRateLimit(event, { key: "test", limit: 3, windowMs: 60_000 });
  assert.equal(last.allowed, false);
});

test("beta readiness checklist covers core domains", () => {
  const ids = new Set(BETA_READINESS_CHECKLIST.map((c) => c.id));
  for (const id of ["auth", "orders", "marketplace", "lily", "admin"]) {
    assert.ok(ids.has(id));
  }
});

test("order lifecycle validation allows typical POS payload", () => {
  const v = orderBody({
    customer_name: "Walk-in",
    subtotal: 45,
    tax: 2.7,
    fulfillment: "PICKUP",
    delivery_date: "2026-07-30"
  });
  assert.equal(v.valid, true);
});
