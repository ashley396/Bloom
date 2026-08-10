import test from "node:test";
import assert from "node:assert/strict";
import { stripePriceEnvKey, stripePriceId } from "../netlify/functions/_shared/stripe-prices.js";

test("stripe price env keys for monthly and annual plans", () => {
  assert.equal(stripePriceEnvKey("starter", "monthly"), "STRIPE_PRICE_STARTER");
  assert.equal(stripePriceEnvKey("pro", "monthly"), "STRIPE_PRICE_PROFESSIONAL");
  assert.equal(stripePriceEnvKey("premium", "annual"), "STRIPE_PRICE_PREMIUM_ANNUAL");
});

test("stripe price id resolves from env map", () => {
  const env = {
    STRIPE_PRICE_STARTER: "price_starter_m",
    STRIPE_PRICE_STARTER_ANNUAL: "price_starter_y"
  };
  assert.equal(stripePriceId("starter", "monthly", env), "price_starter_m");
  assert.equal(stripePriceId("starter", "annual", env), "price_starter_y");
});
