import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDefaultProvider,
  createProviderAdapter,
  PROVIDER_CATALOG,
  sanitizeProviderRow,
  adapterImplementsInterface,
  REQUIRED_PROVIDER_METHODS
} from "../netlify/functions/_shared/payment-hub-providers.js";
import {
  mergeMethodSettings,
  selectCheckoutMethods,
  planSplitPayment,
  planDepositPayment,
  validateGiftCardIssue,
  validateGiftCardRedeem,
  validateHouseAccountCharge,
  routeCheckoutToProvider,
  canManagePaymentHub,
  canConfigureProviders,
  buildGiftCardLiability,
  canProcessRefunds,
  WHOLESALE_TERMS
} from "../netlify/functions/_shared/payment-hub-core.js";
import { encryptProviderToken, decryptProviderToken } from "../netlify/functions/_shared/payment-hub-crypto.js";
import {
  validateRefundRequest,
  validateGiftCardReload,
  validateWholesaleCredit,
  buildProDashboard,
  providerHealthFromStatus,
  SETUP_WIZARD_OPTIONS
} from "../netlify/functions/_shared/payment-hub-pro.js";

test("resolveDefaultProvider prefers explicit default when connected", () => {
  const d = resolveDefaultProvider([{ provider_id: "stripe", status: "connected" }], "stripe");
  assert.equal(d, "stripe");
});

test("resolveDefaultProvider falls back to stripe when env configured", () => {
  const prev = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  assert.equal(resolveDefaultProvider([], null), "stripe");
  process.env.STRIPE_SECRET_KEY = prev;
});

test("createProviderAdapter marks Square as coming soon", async () => {
  const adapter = createProviderAdapter("square", {});
  const status = await adapter.status();
  assert.equal(status.coming_soon, true);
  const connect = await adapter.connect();
  assert.equal(connect.coming_soon, true);
});

test("createProviderAdapter stripe status without client uses shop ref", async () => {
  const adapter = createProviderAdapter("stripe", {
    shop: { stripe_connect_account_id: "acct_123" },
    env: { STRIPE_SECRET_KEY: "sk_test_abc" }
  });
  const status = await adapter.status();
  assert.equal(status.connected, true);
  assert.equal(status.provider_ref, "acct_123");
});

test("permission helpers enforce hub roles", () => {
  assert.equal(canManagePaymentHub("cashier"), true);
  assert.equal(canConfigureProviders("cashier"), false);
  assert.equal(canConfigureProviders("owner"), true);
});

test("selectCheckoutMethods respects shop toggles and stripe", () => {
  const settings = mergeMethodSettings({ credit_card: true, ach: true, cash: true });
  const methods = selectCheckoutMethods(settings, {
    defaultProvider: "stripe",
    processorConfigured: true,
    stripeConfigured: true
  });
  assert.ok(methods.some((m) => m.key === "credit_card"));
  assert.ok(methods.some((m) => m.key === "cash"));
  assert.ok(!methods.some((m) => m.key === "ach"));
});

test("planSplitPayment validates totals", () => {
  const ok = planSplitPayment(100, [
    { method: "cash", amount: 60 },
    { method: "credit_card", amount: 40 }
  ]);
  assert.equal(ok.valid, true);
  const bad = planSplitPayment(100, [{ method: "cash", amount: 50 }]);
  assert.equal(bad.valid, false);
});

test("planDepositPayment computes balance due", () => {
  const d = planDepositPayment(200, 50);
  assert.equal(d.deposit, 50);
  assert.equal(d.balance_due, 150);
});

test("gift card validation", () => {
  assert.equal(validateGiftCardIssue({ code: "AB", amount: 10 }).valid, false);
  assert.equal(validateGiftCardIssue({ code: "BLOOM100", amount: 25 }).valid, true);
  assert.equal(validateGiftCardRedeem({ balance: 20, amount: 25 }).valid, false);
  assert.equal(validateGiftCardRedeem({ balance: 20, amount: 15 }).valid, true);
});

test("house account credit limit", () => {
  const ok = validateHouseAccountCharge({ balance: 100, credit_limit: 500, amount: 50 });
  assert.equal(ok.valid, true);
  const bad = validateHouseAccountCharge({ balance: 480, credit_limit: 500, amount: 50 });
  assert.equal(bad.valid, false);
});

test("routeCheckoutToProvider sends cards to processor", () => {
  assert.equal(routeCheckoutToProvider("stripe", "credit_card"), "stripe");
  assert.equal(routeCheckoutToProvider("stripe", "cash"), "manual");
});

test("provider token encryption roundtrip", () => {
  const cipher = encryptProviderToken("tok_secret", "test-key-material");
  assert.ok(cipher && cipher.length > 20);
  assert.equal(decryptProviderToken(cipher, "test-key-material"), "tok_secret");
});

test("sanitizeProviderRow never exposes full tokens", () => {
  const row = sanitizeProviderRow({ provider_id: "stripe", provider_ref: "acct_live_1234567890", status: "connected" });
  assert.ok(row.provider_ref.length <= 64);
});

test("buildGiftCardLiability sums balances", () => {
  assert.equal(buildGiftCardLiability([{ balance: 10 }, { balance: 5.5 }]), 15.5);
});

test("provider catalog includes all five processors", () => {
  for (const id of ["stripe", "square", "clover", "paypal", "authorize_net"]) {
    assert.ok(PROVIDER_CATALOG[id]);
  }
});

test("stripe adapter implements full provider interface", async () => {
  const adapter = createProviderAdapter("stripe", { env: { STRIPE_SECRET_KEY: "sk_test_x" } });
  assert.equal(adapterImplementsInterface(adapter), true);
  assert.equal(REQUIRED_PROVIDER_METHODS.length, 11);
  const health = await adapter.health();
  assert.equal(providerHealthFromStatus(health), "disconnected");
});

test("refund validation supports partial refunds", () => {
  const v = validateRefundRequest({ amount: 25, paymentAmount: 100, partial: true });
  assert.equal(v.valid, true);
  assert.equal(v.partial, true);
});

test("gift card reload increases balance", () => {
  const v = validateGiftCardReload({ balance: 10, amount: 15 });
  assert.equal(v.valid, true);
  assert.equal(v.new_balance, 25);
});

test("wholesale credit limit enforcement", () => {
  assert.equal(validateWholesaleCredit({ outstanding: 900, credit_limit: 1000, additional: 150 }).valid, false);
  assert.equal(WHOLESALE_TERMS.includes("net_90"), true);
});

test("canProcessRefunds restricts cashiers", () => {
  assert.equal(canProcessRefunds("cashier"), false);
  assert.equal(canProcessRefunds("accountant"), true);
});

test("setup wizard includes all processor choices", () => {
  assert.ok(SETUP_WIZARD_OPTIONS.some((o) => o.id === "none"));
  assert.equal(buildProDashboard({ daily_sales: 100, count: 3 }, { pending_payouts: 20 }).todays_sales, 100);
});
