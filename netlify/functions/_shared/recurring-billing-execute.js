/** Recurring billing execution — idempotent runs, inventory, delivery. */

import { nextDeliveryDate } from "./business-ecosystem.js";
import { buildRecurringBillingPlan } from "./payment-hub-experience.js";
import { chargeSavedStripeMethod, sanitizeChargeResultForClient } from "./payment-saved-charge.js";
import { reserveInventoryForOrder } from "./inventory-reservation.js";
import { createRecurringDelivery } from "./delivery-recurring.js";
import { shopDateStr } from "./shop-time.js";

// The run key is what actually prevents a subscription from being
// double-charged if this endpoint is invoked twice for the same billing
// cycle (see executeRecurringSubscriptionRun's skipIfExists check below).
// When next_delivery_date isn't set yet, the fallback "today" it folds in
// must be the shop's own calendar day — a UTC day would let two calls
// straddling UTC midnight (but landing on the same shop-local day) mint
// two different keys and charge the customer twice.
export function buildRecurringRunKey(subscription, billingDate, timezone) {
  const date = billingDate || subscription.next_delivery_date || shopDateStr(timezone);
  return `${subscription.id}:${subscription.shop_id}:${date}`;
}

export function subscriptionDueForBilling(sub, asOf = new Date(), timezone) {
  if (sub.status !== "active") return false;
  if (!sub.next_delivery_date) return true;
  // Compare calendar days directly in the shop's timezone rather than
  // building a UTC-anchored "end of day" instant — simpler, and correct
  // regardless of which timezone the due date and "now" each land in.
  const dueDateStr = String(sub.next_delivery_date).slice(0, 10);
  const todayStr = shopDateStr(timezone, asOf);
  return todayStr >= dueDateStr;
}

export function computeRecurringOrderTotals(sub, shopSettings = {}) {
  const subtotal = Number(sub.amount || 0);
  const taxRate = Number(shopSettings.tax_rate ?? shopSettings.sales_tax_rate ?? 0);
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  const deliveryFee = Number(sub.metadata?.delivery_fee ?? shopSettings.default_delivery_fee ?? 0);
  const total = Math.round((subtotal + tax + deliveryFee) * 100) / 100;
  return { subtotal, tax, deliveryFee, total };
}

export async function executeRecurringSubscriptionRun(ctx) {
  const { client, stripe, shop, sub, settings, skipIfExists = true } = ctx;
  const runKey = buildRecurringRunKey(sub, null, shop?.timezone);
  if (skipIfExists) {
    const { data: existing } = await client
      .from("payment_hub_recurring_runs")
      .select("id,status,order_id")
      .eq("shop_id", sub.shop_id)
      .eq("run_key", runKey)
      .maybeSingle();
    if (existing && ["running", "completed"].includes(existing.status)) {
      return { outcome: "skipped", reason: "duplicate_run", run_key: runKey, order_id: existing.order_id };
    }
  }

  const plan = buildRecurringBillingPlan(sub);
  const totals = computeRecurringOrderTotals(sub, settings);
  let orderId = null;

  const orderPayload = {
    customer_id: sub.customer_id,
    customer_name: sub.customer_name || "Recurring customer",
    fulfillment: "PICKUP",
    subtotal: totals.subtotal,
    tax_rate: totals.subtotal > 0 ? (totals.tax / totals.subtotal) * 100 : 0,
    delivery_fee: totals.deliveryFee,
    notes: `Recurring: ${sub.subscription_type || "flowers"}`,
    order_source: "Recurring Subscription",
    metadata: {
      bloom_subscription_id: sub.id,
      recurring: true,
      run_key: runKey,
      inventory_status: "pending",
      delivery_status: "pending"
    }
  };

  try {
    const { data, error } = await client.rpc("create_order_atomic", {
      p_shop_id: sub.shop_id,
      p_order: orderPayload,
    });
    if (!error && data?.item) {
      orderId = data.item.id;
    }
  } catch {
    return { outcome: "failed", reason: "order_create_failed", run_key: runKey };
  }

  if (!orderId) return { outcome: "failed", reason: "order_create_failed", run_key: runKey };

  const inv = await reserveInventoryForOrder(client, { shopId: sub.shop_id, orderId, subscription: sub });
  let inventoryStatus = inv.ok ? "reserved" : "inventory_attention_required";

  const del = await createRecurringDelivery(client, { shopId: sub.shop_id, orderId, subscription: sub, customerId: sub.customer_id, timezone: shop?.timezone });
  let deliveryStatus = del.ok ? "scheduled" : "delivery_attention_required";

  let paymentOutcome = "payment_failed";
  let chargeResult = null;
  const { data: methods } = await client
    .from("payment_hub_saved_methods")
    .select("*")
    .eq("shop_id", sub.shop_id)
    .eq("customer_id", sub.customer_id)
    .order("is_default", { ascending: false })
    .limit(1);
  const method = methods?.[0];

  if (stripe && method) {
    chargeResult = await chargeSavedStripeMethod(stripe, {
      shop,
      method,
      amount: totals.total,
      orderId,
      idempotencyKey: `recurring:${runKey}`,
      metadata: { bloom_subscription_id: sub.id, recurring_run_key: runKey }
    });
    if (chargeResult.outcome === "succeeded") {
      paymentOutcome = "succeeded";
      await client.rpc("post_order_payment", {
        p_shop_id: sub.shop_id,
        p_order_id: orderId,
        p_amount: totals.total,
        p_method: "Stripe",
        p_idempotency_key: `recurring-pay:${runKey}`,
        p_actor_user_id: null,
        p_processor: "stripe",
        p_processor_session_id: null,
        p_processor_payment_intent_id: chargeResult.intent_id,
        p_metadata: { recurring: true, subscription_id: sub.id }
      }).catch(() => {});
    } else if (chargeResult.outcome === "requires_customer_action") {
      paymentOutcome = "requires_customer_action";
    }
  } else if (!method) {
    paymentOutcome = "payment_failed";
  }

  const runStatus =
    paymentOutcome === "succeeded"
      ? "completed"
      : paymentOutcome === "requires_customer_action"
        ? "running"
        : "failed";

  const runRecord = {
    shop_id: sub.shop_id,
    subscription_id: sub.id,
    status: runStatus,
    run_key: runKey,
    order_id: orderId,
    error_message: paymentOutcome !== "succeeded" ? paymentOutcome : null,
    plan: {
      ...plan,
      outcomes: { payment: paymentOutcome, inventory: inventoryStatus, delivery: deliveryStatus }
    }
  };

  try {
    const { error: upErr } = await client.from("payment_hub_recurring_runs").insert(runRecord);
    if (upErr?.code === "23505") {
      return { outcome: "skipped", reason: "duplicate_run", run_key: runKey, order_id: orderId };
    }
  } catch {
    /* table missing */
  }

  if (paymentOutcome === "succeeded" || paymentOutcome === "requires_customer_action") {
    const next = nextDeliveryDate(sub.schedule, new Date(), sub.custom_interval_days);
    await client
      .from("bloom_customer_subscriptions")
      .update({ next_delivery_date: next, updated_at: new Date().toISOString() })
      .eq("id", sub.id)
      .catch(() => {});
  }

  let outcome = paymentOutcome;
  if (inventoryStatus === "inventory_attention_required") outcome = "inventory_attention_required";
  if (deliveryStatus === "delivery_attention_required" && outcome === "succeeded") outcome = "delivery_attention_required";

  return {
    outcome,
    run_key: runKey,
    order_id: orderId,
    payment: sanitizeChargeResultForClient(chargeResult || { ok: false, outcome: paymentOutcome }),
    inventory: inv,
    delivery: del,
    notify_staff: true,
    notify_customer: paymentOutcome === "succeeded"
  };
}
