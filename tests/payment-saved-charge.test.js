import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSavedMethodOwnership,
  mapStripePaymentIntentResult,
  chargeSavedStripeMethod,
  sanitizeChargeResultForClient,
} from "../netlify/functions/_shared/payment-saved-charge.js";

// payment-saved-charge.js had only 32.9% coverage despite being the code
// that actually moves real money off a florist's saved card — every
// Stripe call is against a fake stripe object here, never the network.

test("assertSavedMethodOwnership: a missing method is method_not_found", () => {
  assert.deepEqual(assertSavedMethodOwnership({ method: null, shopId: "s1" }), { ok: false, error: "method_not_found" });
});

test("assertSavedMethodOwnership: a method belonging to a different shop is cross_shop_denied — the real IDOR guard", () => {
  const result = assertSavedMethodOwnership({ method: { shop_id: "shop-a" }, shopId: "shop-b" });
  assert.deepEqual(result, { ok: false, error: "cross_shop_denied" });
});

test("assertSavedMethodOwnership: a customerId mismatch is caught, but only when a customerId was actually supplied", () => {
  const method = { shop_id: "shop-a", customer_id: "cust-1" };
  assert.deepEqual(assertSavedMethodOwnership({ method, shopId: "shop-a", customerId: "cust-2" }), { ok: false, error: "customer_mismatch" });
  assert.deepEqual(assertSavedMethodOwnership({ method, shopId: "shop-a" }), { ok: true });
});

test("assertSavedMethodOwnership: a correctly-scoped method is allowed", () => {
  const method = { shop_id: "shop-a", customer_id: "cust-1" };
  assert.deepEqual(assertSavedMethodOwnership({ method, shopId: "shop-a", customerId: "cust-1" }), { ok: true });
});

test("mapStripePaymentIntentResult: maps every real Stripe intent status to the app's own outcome vocabulary", () => {
  assert.deepEqual(mapStripePaymentIntentResult({ id: "pi_1", status: "succeeded" }), { outcome: "succeeded", intent_id: "pi_1" });
  assert.deepEqual(mapStripePaymentIntentResult({ id: "pi_2", status: "requires_action", client_secret: "secret" }), {
    outcome: "requires_customer_action",
    intent_id: "pi_2",
    client_secret: "secret",
  });
  assert.deepEqual(mapStripePaymentIntentResult({ id: "pi_3", status: "requires_payment_method" }), { outcome: "declined", intent_id: "pi_3" });
  assert.deepEqual(mapStripePaymentIntentResult({ id: "pi_4", status: "processing" }), { outcome: "failed", intent_id: "pi_4", status: "processing" });
});

test("chargeSavedStripeMethod: rejects a payment method ref that isn't a real Stripe pm_ id, before ever calling Stripe", async () => {
  const stripe = { paymentMethods: { retrieve() { throw new Error("must not be called"); } }, paymentIntents: { create() { throw new Error("must not be called"); } } };
  const result = await chargeSavedStripeMethod(stripe, { shop: { id: "shop-1" }, method: { provider_token_ref: "not-a-pm-id" }, amount: 20 });
  assert.deepEqual(result, { ok: false, error: "invalid_payment_method_ref" });
});

test("chargeSavedStripeMethod: rejects an amount below Stripe's real $0.50 minimum, before creating a payment intent", async () => {
  const stripe = { paymentIntents: { create() { throw new Error("must not be called"); } } };
  const result = await chargeSavedStripeMethod(stripe, { shop: { id: "shop-1" }, method: { provider_token_ref: "pm_123" }, amount: 0.1 });
  assert.deepEqual(result, { ok: false, error: "amount_too_small" });
});

test("chargeSavedStripeMethod: a payment method whose real Stripe customer doesn't match the local record is rejected — cross-account charge guard", async () => {
  const stripe = {
    paymentMethods: { retrieve: async () => ({ customer: "cus_other" }) },
    paymentIntents: { create() { throw new Error("must not be called"); } },
  };
  const result = await chargeSavedStripeMethod(stripe, {
    shop: { id: "shop-1" },
    method: { provider_token_ref: "pm_123", stripe_customer_id: "cus_mine" },
    amount: 20,
  });
  assert.deepEqual(result, { ok: false, error: "payment_method_customer_mismatch" });
});

test("chargeSavedStripeMethod: a payment-method lookup failure degrades to a clear error, not a thrown exception", async () => {
  const stripe = {
    paymentMethods: { retrieve: async () => { throw new Error("network down"); } },
  };
  const result = await chargeSavedStripeMethod(stripe, {
    shop: { id: "shop-1" },
    method: { provider_token_ref: "pm_123", stripe_customer_id: "cus_mine" },
    amount: 20,
  });
  assert.deepEqual(result, { ok: false, error: "payment_method_unavailable", detail: "network down" });
});

test("chargeSavedStripeMethod: a successful charge is off_session/confirm:true, carries the real idempotency key, and routes Connect transfer only when the shop has an account", async () => {
  let capturedParams, capturedOptions;
  const stripe = {
    paymentIntents: {
      create: async (params, options) => {
        capturedParams = params;
        capturedOptions = options;
        return { id: "pi_ok", status: "succeeded" };
      },
    },
  };
  const result = await chargeSavedStripeMethod(stripe, {
    shop: { id: "shop-1", stripe_connect_account_id: "acct_partner" },
    method: { id: "method-1", provider_token_ref: "pm_123" },
    amount: 25.5,
    orderId: "order-1",
    idempotencyKey: "idem-key-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.intent_id, "pi_ok");
  assert.equal(capturedParams.amount, 2550, "amount must be converted to real cents");
  assert.equal(capturedParams.confirm, true);
  assert.equal(capturedParams.off_session, true);
  assert.equal(capturedParams.transfer_data.destination, "acct_partner");
  assert.equal(capturedParams.metadata.bloom_order_id, "order-1");
  assert.equal(capturedOptions.idempotencyKey, "idem-key-1");
});

test("chargeSavedStripeMethod: no Connect account on the shop means no transfer_data at all, not a null/empty one", async () => {
  let capturedParams;
  const stripe = { paymentIntents: { create: async (params) => { capturedParams = params; return { id: "pi_ok", status: "succeeded" }; } } };
  await chargeSavedStripeMethod(stripe, { shop: { id: "shop-1" }, method: { id: "m1", provider_token_ref: "pm_123" }, amount: 20 });
  assert.equal(capturedParams.transfer_data, undefined);
});

test("chargeSavedStripeMethod: a requires_action intent maps to requires_customer_action, ok:true (it's a real in-progress state, not a failure)", async () => {
  const stripe = { paymentIntents: { create: async () => ({ id: "pi_2", status: "requires_action", client_secret: "secret" }) } };
  const result = await chargeSavedStripeMethod(stripe, { shop: { id: "shop-1" }, method: { id: "m1", provider_token_ref: "pm_123" }, amount: 20 });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "requires_customer_action");
  assert.equal(result.client_secret, "secret");
});

test("chargeSavedStripeMethod: authentication_required errors map to requires_customer_action rather than a hard decline", async () => {
  const stripe = { paymentIntents: { create: async () => { const err = new Error("auth required"); err.code = "authentication_required"; throw err; } } };
  const result = await chargeSavedStripeMethod(stripe, { shop: { id: "shop-1" }, method: { id: "m1", provider_token_ref: "pm_123" }, amount: 20 });
  assert.deepEqual(result, { ok: false, outcome: "requires_customer_action", error: "authentication_required" });
});

test("chargeSavedStripeMethod: a real card decline is reported as declined with the actual Stripe error code and message, never thrown", async () => {
  const stripe = { paymentIntents: { create: async () => { const err = new Error("Your card was declined."); err.code = "card_declined"; throw err; } } };
  const result = await chargeSavedStripeMethod(stripe, { shop: { id: "shop-1" }, method: { id: "m1", provider_token_ref: "pm_123" }, amount: 20 });
  assert.deepEqual(result, { ok: false, outcome: "declined", error: "card_declined", message: "Your card was declined." });
});

test("sanitizeChargeResultForClient: strips internal detail fields (like a raw error message) before anything reaches the client", () => {
  const sanitized = sanitizeChargeResultForClient({
    ok: false,
    outcome: "declined",
    error: "card_declined",
    intent_id: "pi_1",
    message: "Your card was declined by the issuing bank for internal reason X",
    detail: "some stack trace",
  });
  assert.deepEqual(sanitized, { ok: false, outcome: "declined", error: "card_declined", intent_id: "pi_1" });
});

test("sanitizeChargeResultForClient: handles an empty/missing result without crashing", () => {
  assert.deepEqual(sanitizeChargeResultForClient(), { ok: undefined, outcome: undefined, error: undefined, intent_id: undefined });
});
