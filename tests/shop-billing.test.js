import test from "node:test";
import assert from "node:assert/strict";
import {
  upgradeTarget,
  downgradeTarget,
  planLabel,
  subscriptionStatusLabel,
  canManageShopBilling
} from "../netlify/functions/_shared/shop-billing.js";

test("professional plan upgrade path", () => {
  assert.equal(planLabel("professional"), "Professional");
  assert.equal(upgradeTarget("professional"), "premium");
  assert.equal(downgradeTarget("professional"), "starter");
});

test("subscription status shows cancel pending", () => {
  assert.equal(subscriptionStatusLabel("active", true), "Cancels at period end");
});

test("only owner manages billing", () => {
  assert.equal(canManageShopBilling("owner"), true);
  assert.equal(canManageShopBilling("manager"), false);
});
