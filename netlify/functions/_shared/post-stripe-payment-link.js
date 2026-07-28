/** Stripe Checkout completion for Bloom payment links (server-side amounts only). */

import { transitionPaymentLinkStatus } from "./payment-hub-experience.js";
import { writeShopAudit } from "./production.js";

const AMOUNT_TOLERANCE = 0.02;

export function parsePaymentLinkSessionMetadata(session = {}) {
  const m = session.metadata || {};
  return {
    paymentLinkId: m.bloom_payment_link_id || m.payment_link_id || null,
    shopId: m.bloom_shop_id || m.shop_id || null,
    orderId: m.bloom_order_id || m.order_id || null,
    customerId: m.bloom_customer_id || m.customer_id || null,
    intendedCents: m.bloom_intended_amount_cents != null ? Number(m.bloom_intended_amount_cents) : null
  };
}

export function validateStripePaidAmount({ sessionAmountCents, intendedCents, remainingDue }) {
  const paid = Number(sessionAmountCents || 0) / 100;
  const remaining = Math.round(Number(remainingDue || 0) * 100) / 100;
  if (paid <= 0) return { valid: false, error: "zero_amount", amount: 0 };
  if (paid > remaining + AMOUNT_TOLERANCE) return { valid: false, error: "exceeds_balance", amount: paid, remaining };
  if (intendedCents != null) {
    const intended = intendedCents / 100;
    if (Math.abs(paid - intended) > AMOUNT_TOLERANCE && paid > intended + AMOUNT_TOLERANCE) {
      return { valid: false, error: "amount_mismatch", amount: paid, intended };
    }
  }
  const applyAmount = Math.min(paid, remaining);
  return { valid: true, amount: Math.round(applyAmount * 100) / 100 };
}

export function computeLinkAfterPayment(link, applyAmount) {
  const due = Number(link.amount_due || 0);
  const prevPaid = Number(link.amount_paid || 0);
  const newPaid = Math.round((prevPaid + applyAmount) * 100) / 100;
  const fullyPaid = newPaid >= due - AMOUNT_TOLERANCE;
  const event = fullyPaid ? "paid" : "partial_pay";
  const tr = transitionPaymentLinkStatus(link.status, event);
  return {
    newPaid,
    fullyPaid,
    status: tr.ok ? tr.status : link.status
  };
}

export async function recordWebhookIdempotency(client, { providerEventId, shopId, eventType, resourceId, result }) {
  const { data, error } = await client
    .from("payment_hub_webhook_idempotency")
    .insert({
      provider_id: "stripe",
      provider_event_id: providerEventId,
      shop_id: shopId || null,
      event_type: eventType,
      resource_id: resourceId || null,
      result: result || {}
    })
    .select("id")
    .single();
  if (error?.code === "23505") return { duplicate: true };
  if (error?.code === "42P01") return { duplicate: false, skipped_table: true };
  if (error) throw error;
  return { duplicate: false, id: data?.id };
}

export async function findExistingWebhookEvent(client, providerEventId) {
  const { data, error } = await client
    .from("payment_hub_webhook_idempotency")
    .select("id,result")
    .eq("provider_id", "stripe")
    .eq("provider_event_id", providerEventId)
    .maybeSingle();
  if (error?.code === "42P01") return null;
  if (error) throw error;
  return data;
}

export async function postStripePaymentLink(client, session, providerEventId) {
  if (session.payment_status !== "paid") return { paid: false, skipped: "not_paid" };

  const existing = await findExistingWebhookEvent(client, providerEventId);
  if (existing) return { paid: true, duplicate: true, prior: existing.result };

  const meta = parsePaymentLinkSessionMetadata(session);
  if (!meta.paymentLinkId || !meta.shopId) {
    throw new Error("Payment link session missing bloom_payment_link_id or bloom_shop_id metadata.");
  }

  const { data: link, error: linkErr } = await client
    .from("payment_hub_payment_links")
    .select("*")
    .eq("id", meta.paymentLinkId)
    .eq("shop_id", meta.shopId)
    .maybeSingle();
  if (linkErr?.code === "42P01") throw new Error("Payment links table not migrated.");
  if (linkErr) throw linkErr;
  if (!link) throw new Error("Payment link not found for webhook.");

  if (link.status === "paid" || link.status === "canceled") {
    await recordWebhookIdempotency(client, {
      providerEventId,
      shopId: meta.shopId,
      eventType: "checkout.session.completed",
      resourceId: link.id,
      result: { duplicate_link_state: link.status }
    });
    return { paid: true, duplicate: true, link_status: link.status };
  }

  const remaining = Math.max(0, Number(link.amount_due || 0) - Number(link.amount_paid || 0));
  const amountCheck = validateStripePaidAmount({
    sessionAmountCents: session.amount_total,
    intendedCents: meta.intendedCents,
    remainingDue: remaining
  });
  if (!amountCheck.valid) {
    try {
      await client.from("payment_hub_provider_events").insert({
        shop_id: meta.shopId,
        provider_id: "stripe",
        event_type: "payment_link_amount_rejected",
        status: "error",
        message: amountCheck.error,
        metadata: { session_id: session.id, ...amountCheck }
      });
    } catch {
      /* optional */
    }
    throw new Error(`Payment link amount rejected: ${amountCheck.error}`);
  }

  const { newPaid, fullyPaid, status } = computeLinkAfterPayment(link, amountCheck.amount);
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;

  await client
    .from("payment_hub_payment_links")
    .update({
      amount_paid: newPaid,
      status,
      paid_at: fullyPaid ? new Date().toISOString() : link.paid_at,
      updated_at: new Date().toISOString(),
      metadata: {
        ...(link.metadata && typeof link.metadata === "object" ? link.metadata : {}),
        last_stripe_session_id: session.id,
        last_payment_intent_id: pi
      }
    })
    .eq("id", link.id);

  let orderResult = null;
  const orderId = meta.orderId || link.order_id;
  if (orderId) {
    const idempotencyKey = `stripe-plink:${providerEventId}:${session.id}`;
    const { data, error } = await client.rpc("post_order_payment", {
      p_shop_id: meta.shopId,
      p_order_id: orderId,
      p_amount: amountCheck.amount,
      p_method: "Stripe",
      p_idempotency_key: idempotencyKey,
      p_actor_user_id: null,
      p_processor: "stripe",
      p_processor_session_id: session.id,
      p_processor_payment_intent_id: pi,
      p_metadata: { source: "payment_link", payment_link_id: link.id, stripe_event_id: providerEventId }
    });
    if (error && !String(error.message || "").includes("duplicate")) throw error;
    orderResult = data || { ok: true };
  }

  try {
    const { data: invoices } = await client.from("invoices").select("id,total,amount_paid").eq("shop_id", meta.shopId).eq("order_id", orderId).limit(1);
    const inv = invoices?.[0];
    if (inv) {
      const invPaid = Math.round((Number(inv.amount_paid || 0) + amountCheck.amount) * 100) / 100;
      await client.from("invoices").update({ amount_paid: invPaid, status: invPaid >= Number(inv.total) - 0.01 ? "paid" : "partial" }).eq("id", inv.id);
    }
  } catch {
    /* invoices optional */
  }

  await writeShopAudit(client, {
    shopId: meta.shopId,
    userId: null,
    eventType: "payment_link_paid",
    entityType: "payment_link",
    entityId: link.id,
    metadata: { amount: amountCheck.amount, fully_paid: fullyPaid, session_id: session.id, payment_intent_id: pi }
  });

  try {
    await client.from("payment_hub_provider_events").insert({
      shop_id: meta.shopId,
      provider_id: "stripe",
      event_type: "payment_link_paid",
      status: "ok",
      metadata: { link_id: link.id, amount: amountCheck.amount, fully_paid: fullyPaid }
    });
  } catch {
    /* optional */
  }

  const idem = await recordWebhookIdempotency(client, {
    providerEventId,
    shopId: meta.shopId,
    eventType: "checkout.session.completed",
    resourceId: link.id,
    result: { amount: amountCheck.amount, fully_paid: fullyPaid, order: orderResult }
  });

  return { paid: true, duplicate: idem.duplicate, amount: amountCheck.amount, fully_paid: fullyPaid, link_id: link.id };
}
