import test from "node:test";
import assert from "node:assert/strict";
import {
  validateTerminalAmount,
  buildTerminalIntentParams,
  buildTerminalLocationParams,
  friendlyTerminalError,
  MIN_TERMINAL_AMOUNT
} from "../netlify/functions/_shared/payment-terminal.js";

test("validateTerminalAmount: an order with no balance is rejected before any Stripe call would happen", () => {
  const result = validateTerminalAmount({ total: 50, amount_paid: 50, balance_due: 0 }, undefined);
  assert.equal(result.valid, false);
  assert.match(result.error, /no card-payable balance/i);
});

test("validateTerminalAmount: defaults to the full remaining balance when no amount is requested", () => {
  const result = validateTerminalAmount({ total: 80, amount_paid: 20, balance_due: 60 }, undefined);
  assert.equal(result.valid, true);
  assert.equal(result.amount, 60);
  assert.equal(result.balance, 60);
});

test(`validateTerminalAmount: rejects below the $${MIN_TERMINAL_AMOUNT.toFixed(2)} floor`, () => {
  const result = validateTerminalAmount({ total: 10, amount_paid: 0, balance_due: 10 }, 0.1);
  assert.equal(result.valid, false);
  assert.match(result.error, /at least/i);
});

test("validateTerminalAmount: rejects a request that exceeds the order's remaining balance", () => {
  const result = validateTerminalAmount({ total: 30, amount_paid: 0, balance_due: 30 }, 45);
  assert.equal(result.valid, false);
  assert.match(result.error, /cannot exceed the remaining balance of \$30\.00/);
});

test("validateTerminalAmount: falls back to total minus amount_paid when balance_due is missing (same rule create-checkout.js uses)", () => {
  const result = validateTerminalAmount({ total: 100, amount_paid: 40 }, undefined);
  assert.equal(result.valid, true);
  assert.equal(result.balance, 60);
});

test("buildTerminalIntentParams: a destination charge — no application fee, funds land on the shop's Connect account", () => {
  const order = { id: "order-1", order_number: "F1001" };
  const shop = { id: "shop-1", stripe_connect_account_id: "acct_123" };
  const params = buildTerminalIntentParams({ order, shop, amount: 45.5, idempotencyKey: "key-1", actorUserId: "user-1" });
  assert.equal(params.amount, 4550);
  assert.equal(params.currency, "usd");
  assert.deepEqual(params.payment_method_types, ["card_present"]);
  assert.equal(params.capture_method, "automatic");
  assert.equal(params.transfer_data.destination, "acct_123");
  assert.equal(params.application_fee_amount, undefined, "a shop's own order payment takes no platform cut");
  assert.equal(params.metadata.bloom_order_id, "order-1");
  assert.equal(params.metadata.bloom_shop_id, "shop-1");
  assert.equal(params.metadata.bloom_idempotency_key, "key-1");
  assert.equal(params.metadata.channel, "terminal");
});

test("buildTerminalLocationParams: uses the shop's real address, never a placeholder when one is on file", () => {
  const params = buildTerminalLocationParams({ name: "Petal & Stem", address: "123 Main St", city: "Austin", state: "TX", zip: "78701" });
  assert.equal(params.display_name, "Petal & Stem — counter");
  assert.equal(params.address.line1, "123 Main St");
  assert.equal(params.address.city, "Austin");
  assert.equal(params.address.country, "US");
});

test("buildTerminalLocationParams: a shop with no address on file yet still gets a valid, non-blocking params object", () => {
  const params = buildTerminalLocationParams({});
  assert.equal(params.address.line1, "Address not yet set");
  assert.equal(params.display_name, "Florisyn shop counter");
});

test("friendlyTerminalError: rewrites Stripe's raw pairing-code error into something a cashier can act on", () => {
  const msg = friendlyTerminalError({ message: "Invalid registration code" });
  assert.match(msg, /pairing code/i);
});

test("friendlyTerminalError: an unrecognized error still returns real text, never a blank message", () => {
  const msg = friendlyTerminalError({ message: "some other stripe error" });
  assert.equal(msg, "some other stripe error");
});
