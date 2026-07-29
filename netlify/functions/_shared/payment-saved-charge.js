/** Charge saved Stripe payment methods — server-side only. */

export function assertSavedMethodOwnership({ method, shopId, customerId }) {
  if (!method) return { ok: false, error: "method_not_found" };
  if (String(method.shop_id) !== String(shopId)) return { ok: false, error: "cross_shop_denied" };
  if (customerId && String(method.customer_id) !== String(customerId)) return { ok: false, error: "customer_mismatch" };
  return { ok: true };
}

export function mapStripePaymentIntentResult(intent = {}) {
  const status = intent.status;
  if (status === "succeeded") return { outcome: "succeeded", intent_id: intent.id };
  if (status === "requires_action") return { outcome: "requires_customer_action", intent_id: intent.id, client_secret: intent.client_secret };
  if (status === "requires_payment_method") return { outcome: "declined", intent_id: intent.id };
  return { outcome: "failed", intent_id: intent.id, status };
}

export async function chargeSavedStripeMethod(stripe, { shop, method, amount, orderId, idempotencyKey, metadata = {} }) {
  const pmId = method.provider_token_ref;
  const customerId = method.stripe_customer_id || method.metadata?.stripe_customer_id;
  if (!pmId || !String(pmId).startsWith("pm_")) {
    return { ok: false, error: "invalid_payment_method_ref" };
  }
  if (customerId) {
    try {
      const pm = await stripe.paymentMethods.retrieve(pmId);
      if (pm.customer && String(pm.customer) !== String(customerId)) {
        return { ok: false, error: "payment_method_customer_mismatch" };
      }
    } catch (e) {
      return { ok: false, error: "payment_method_unavailable", detail: e.message };
    }
  }

  const cents = Math.round(Number(amount) * 100);
  if (cents < 50) return { ok: false, error: "amount_too_small" };

  const params = {
    amount: cents,
    currency: "usd",
    payment_method: pmId,
    confirm: true,
    off_session: true,
    metadata: {
      bloom_shop_id: String(shop.id),
      bloom_order_id: orderId || "",
      bloom_saved_method_id: method.id,
      ...metadata
    }
  };
  if (customerId) params.customer = customerId;
  if (shop.stripe_connect_account_id) {
    params.transfer_data = { destination: shop.stripe_connect_account_id };
  }

  try {
    const intent = await stripe.paymentIntents.create(params, { idempotencyKey: idempotencyKey || undefined });
    const mapped = mapStripePaymentIntentResult(intent);
    return { ok: mapped.outcome === "succeeded" || mapped.outcome === "requires_customer_action", ...mapped };
  } catch (e) {
    const code = e.code || e.type || "stripe_error";
    if (code === "authentication_required") {
      return { ok: false, outcome: "requires_customer_action", error: code };
    }
    return { ok: false, outcome: "declined", error: code, message: e.message };
  }
}

export function sanitizeChargeResultForClient(result = {}) {
  return {
    ok: result.ok,
    outcome: result.outcome,
    error: result.error,
    intent_id: result.intent_id
  };
}
