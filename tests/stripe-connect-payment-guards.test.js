import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Three separate payment paths — POS checkout, the public storefront's
 * "pay now" checkout, and payment links — all create a Stripe Checkout
 * Session for the customer to pay. Before this fix, none of them checked
 * whether the shop had connected Stripe first: the customer's payment
 * would still succeed, but with no transfer_data.destination the money
 * settled straight into Florisyn's own platform Stripe balance instead of
 * the shop's, silently. These tests guard against that regressing.
 */
const files = {
  createCheckout: fs.readFileSync(path.join(process.cwd(), "netlify/functions/create-checkout.js"), "utf8"),
  storefrontPublic: fs.readFileSync(path.join(process.cwd(), "netlify/functions/storefront-public.js"), "utf8"),
  paymentLinkPublic: fs.readFileSync(path.join(process.cwd(), "netlify/functions/payment-link-public.js"), "utf8"),
};

test("POS checkout (create-checkout.js) refuses to start a card session for a shop with no connected Stripe account", () => {
  const src = files.createCheckout;
  assert.match(src, /stripe_connect_account_id/);
  assert.match(src, /if\(!shop\?\.stripe_connect_account_id\)return json\(409/);
  assert.match(src, /code:"stripe_connect_required"/);
  // The check must run before the Stripe session is created, not after.
  const checkIndex = src.indexOf("stripe_connect_required");
  const sessionIndex = src.indexOf("stripe.checkout.sessions.create");
  assert.ok(checkIndex > -1 && sessionIndex > -1 && checkIndex < sessionIndex);
});

test("POS checkout routes the customer's payment to the shop's own connected account, not the platform's", () => {
  assert.match(files.createCheckout, /transfer_data:\{destination:shop\.stripe_connect_account_id\}/);
});

test("Website 'pay now' checkout (storefront-public.js) refuses to charge a customer when the shop has no connected Stripe account", () => {
  const src = files.storefrontPublic;
  assert.match(src, /if \(!shop\.stripe_connect_account_id\) \{/);
  assert.match(src, /code: "stripe_connect_required"/);
  const checkIndex = src.indexOf("stripe_connect_required");
  const sessionIndex = src.indexOf("stripe.checkout.sessions.create");
  assert.ok(checkIndex > -1 && sessionIndex > -1 && checkIndex < sessionIndex);
});

test("Payment links (payment-link-public.js) refuse to charge a customer when the shop has no connected Stripe account", () => {
  const src = files.paymentLinkPublic;
  assert.match(src, /if \(!shop\?\.stripe_connect_account_id\) \{/);
  assert.match(src, /code: "stripe_connect_required"/);
  const checkIndex = src.indexOf("stripe_connect_required");
  const sessionIndex = src.indexOf("stripe.checkout.sessions.create");
  assert.ok(checkIndex > -1 && sessionIndex > -1 && checkIndex < sessionIndex);
});
