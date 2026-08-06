import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createProviderAdapter } from "../netlify/functions/_shared/payment-hub-providers.js";

const handlerSource = fs.readFileSync(new URL("../netlify/functions/payment-hub.js", import.meta.url), "utf8");
const uiSource = fs.readFileSync(new URL("../public/payment-hub-ui.js", import.meta.url), "utf8");
const migrationSource = fs.readFileSync(
  new URL("../supabase/migrations/20260805154819_p0_19_refund_idempotency.sql", import.meta.url),
  "utf8"
);

test("Stripe refunds require and forward one idempotency key", async () => {
  const calls = [];
  const stripeClient = {
    refunds: {
      async create(payload, options) {
        calls.push({ payload, options });
        return { id: "re_123", status: "succeeded" };
      }
    }
  };
  const adapter = createProviderAdapter("stripe", { stripeClient });
  const result = await adapter.refund({
    paymentIntentId: "pi_123",
    amount: 25,
    reason: "customer_request",
    idempotencyKey: "refund:one"
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.idempotencyKey, "refund:one");
  assert.equal(calls[0].payload.amount, 2500);
});

test("Stripe refund adapter fails closed without idempotency", async () => {
  let calls = 0;
  const adapter = createProviderAdapter("stripe", {
    stripeClient: { refunds: { async create() { calls += 1; } } }
  });
  const result = await adapter.refund({ paymentIntentId: "pi_123", amount: 10 });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});

test("refund reservation is unique, tenant-scoped, and locks the payment", () => {
  assert.match(migrationSource, /unique index[\s\S]*\(shop_id, idempotency_key\)/i);
  assert.match(migrationSource, /where id = p_payment_id and shop_id = p_shop_id\s+for update/i);
  assert.match(migrationSource, /status in \('pending', 'completed'\)/i);
  assert.match(migrationSource, /Refund exceeds remaining refundable balance/i);
});

test("refund completion atomically updates the authoritative payment ledger", () => {
  assert.match(migrationSource, /create or replace function public\.complete_payment_refund/i);
  assert.match(migrationSource, /set refunded_amount = new_refunded/i);
  assert.match(migrationSource, /'REFUNDED' else 'PARTIALLY_REFUNDED'/i);
  assert.match(migrationSource, /revoke all on function public\.complete_payment_refund[\s\S]*authenticated/i);
});

test("authenticated clients cannot mutate refunds directly", () => {
  assert.match(migrationSource, /revoke insert, update, delete on public\.payment_hub_refunds from anon, authenticated/i);
  assert.match(migrationSource, /create policy "refunds tenant read"[\s\S]*for select[\s\S]*is_shop_member/i);
});

test("refund handler uses authoritative payment data and service-only RPCs", () => {
  assert.doesNotMatch(handlerSource, /body\.payment_amount/);
  assert.doesNotMatch(handlerSource, /body\.payment_intent_id/);
  assert.match(handlerSource, /const ledgerClient = admin\(\)/);
  assert.match(handlerSource, /ledgerClient\.rpc\("reserve_payment_refund"/);
  assert.match(handlerSource, /ledgerClient\.rpc\("complete_payment_refund"/);
});

test("refund failure states are explicit and recoverable", () => {
  assert.match(handlerSource, /payment_refund_provider_failed/);
  assert.match(handlerSource, /safe to retry with the same key/i);
  assert.match(handlerSource, /status: "reconciliation_required"/);
  assert.match(handlerSource, /return json\(202/);
});

test("refund handler maps isolation and over-refund failures safely", () => {
  assert.match(handlerSource, /return json\(404, \{ error: "Payment not found\." \}\)/);
  assert.match(handlerSource, /return json\(409, \{ error: "Refund exceeds the remaining refundable balance\." \}\)/);
  assert.match(handlerSource, /if \(!idempotencyKey\) return json\(400/);
});

test("refund UI sends payment id and idempotency key, never payment intent id", () => {
  assert.match(uiSource, /id="phRefundPaymentId"/);
  assert.match(uiSource, /id="phRefundIdempotencyKey"/);
  assert.match(uiSource, /payment_id:\s*paymentId/);
  assert.match(uiSource, /idempotency_key:\s*idempotencyKey/);
  assert.match(uiSource, /`refund:\$\{paymentId \|\| "missing"\}:\$\{Date\.now\(\)\}`/);
  assert.doesNotMatch(uiSource, /payment_intent_id/);
  assert.doesNotMatch(uiSource, /phRefundIntent/);
});
