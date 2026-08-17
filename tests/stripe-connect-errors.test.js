import test from "node:test";
import assert from "node:assert/strict";
import { friendlyStripeConnectError } from "../netlify/functions/_shared/stripe-connect-errors.js";

test("rewrites Stripe's raw 'signed up for Connect' error into an actionable platform-owner message", () => {
  const stripeError = new Error(
    "You can only create new accounts if you've signed up for Connect. You can do that here: https://dashboard.stripe.com/account/applications/settings"
  );
  const friendly = friendlyStripeConnectError(stripeError);
  assert.equal(friendly.statusCode, 503);
  assert.equal(friendly.code, "platform_connect_not_enabled");
  assert.match(friendly.message, /Florisyn's own Stripe account needs Connect turned on/);
  assert.match(friendly.message, /not something you did wrong/);
});

test("leaves unrelated Stripe errors untouched", () => {
  const stripeError = new Error("Your card was declined.");
  stripeError.statusCode = 402;
  const result = friendlyStripeConnectError(stripeError);
  assert.equal(result, stripeError);
  assert.equal(result.message, "Your card was declined.");
});

test("also catches the message when Stripe nests it under error.raw.message", () => {
  const stripeError = { raw: { message: "you've signed up for Connect somewhere in here" } };
  const friendly = friendlyStripeConnectError(stripeError);
  assert.equal(friendly.statusCode, 503);
});
