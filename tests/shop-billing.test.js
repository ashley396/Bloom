import test from "node:test";
import assert from "node:assert/strict";
import {
  upgradeTarget,
  downgradeTarget,
  planLabel,
  planPrice,
  subscriptionStatusLabel,
  canManageShopBilling
} from "../netlify/functions/_shared/shop-billing.js";

test("professional plan upgrade path", () => {
  assert.equal(planLabel("professional"), "Pro");
  assert.equal(upgradeTarget("professional"), "premium");
  assert.equal(downgradeTarget("professional"), "starter");
});

test("subscription status shows cancel pending", () => {
  assert.equal(subscriptionStatusLabel("active", true), "Cancels at period end");
});

test("plan prices reflect current catalog", () => {
  assert.equal(planPrice("starter"), 59);
  assert.equal(planPrice("professional"), 99);
  assert.equal(planPrice("pro"), 99);
  assert.equal(planPrice("premium"), 149);
});
