import { structuredLog } from "./production.js";
import { applyOrderPaymentFromRpcResult } from "./manual-order-payment.js";

export function isPostOrderPaymentRpcMissing(error) {
  const code = String(error?.code || "");
  const msg = String(error?.message || "");
  return (
    code === "PGRST202" ||
    /Could not find the function.*post_order_payment/i.test(msg) ||
    /function public\.post_order_payment\(.* does not exist/i.test(msg)
  );
}

function computeNextOrderPayment(order, amount, method) {
  const total = Math.max(0, Number(order.total || 0));
  const currentPaid = Math.max(0, Number(order.amount_paid || 0));
  const balanceBefore = Math.max(
    0,
    Number.isFinite(Number(order.balance_due)) ? Number(order.balance_due) : total - currentPaid
  );
  if (amount > balanceBefore + 0.005) {
    const e = new Error("Payment exceeds remaining balance");
    e.statusCode = 400;
    throw e;
  }
  const newPaid = Math.min(total, Math.round((currentPaid + amount) * 100) / 100);
  const newBalance = Math.max(0, Math.round((total - newPaid) * 100) / 100);
  const newStatus = newBalance <= 0.005 ? "PAID" : "PARTIAL";
  return {
    amount_paid: newPaid,
    balance_due: newBalance,
    payment_status: newStatus,
    payment_method: method,
    paid_at: newStatus === "PAID" ? order.paid_at || new Date().toISOString() : null
  };
}

/** Service-role ledger append when RPC is not deployed (preview DB without v18.5 migration). */
export async function postOrderPaymentFallback(service, rpcArgs) {
  const {
    p_shop_id: shopId,
    p_order_id: orderId,
    p_amount: amount,
    p_method: method,
    p_idempotency_key: idempotencyKey,
    p_actor_user_id: actorUserId,
    p_processor: processor,
    p_processor_session_id: processorSessionId,
    p_processor_payment_intent_id: processorPaymentIntentId,
    p_metadata: metadata
  } = rpcArgs;

  const { data: existing, error: existingErr } = await service
    .from("payments")
    .select("*")
    .eq("shop_id", shopId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingErr) throw existingErr;

  const { data: order, error: orderErr } = await service
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (orderErr) throw orderErr;
  if (!order) {
    const e = new Error("Order not found");
    e.statusCode = 404;
    throw e;
  }

  if (existing) {
    return applyOrderPaymentFromRpcResult({ payment: existing, order, duplicate: true });
  }

  const next = computeNextOrderPayment(order, amount, method);

  const { data: payment, error: payErr } = await service
    .from("payments")
    .insert({
      shop_id: shopId,
      order_id: orderId,
      customer_id: order.customer_id || null,
      amount: Math.round(amount * 100) / 100,
      method,
      status: "SUCCEEDED",
      processor: processor || "manual",
      processor_session_id: processorSessionId || null,
      processor_payment_intent_id: processorPaymentIntentId || null,
      idempotency_key: idempotencyKey,
      received_by: actorUserId || null,
      metadata: metadata || {}
    })
    .select("*")
    .single();
  if (payErr) throw payErr;

  const { data: updatedOrder, error: updErr } = await service
    .from("orders")
    .update({
      amount_paid: next.amount_paid,
      balance_due: next.balance_due,
      payment_status: next.payment_status,
      payment_method: next.payment_method,
      paid_at: next.paid_at
    })
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .select("*")
    .single();
  if (updErr) throw updErr;

  structuredLog("warn", "post_order_payment_fallback_used", {
    shopId,
    orderId,
    amount,
    method,
    reason: "rpc_unavailable"
  });

  return applyOrderPaymentFromRpcResult({ payment, order: updatedOrder, duplicate: false });
}

export async function executePostOrderPayment(service, rpcArgs) {
  const { data, error } = await service.rpc("post_order_payment", rpcArgs);
  if (!error) {
    return { ...applyOrderPaymentFromRpcResult(data), via: "rpc" };
  }
  if (isPostOrderPaymentRpcMissing(error)) {
    const fallback = await postOrderPaymentFallback(service, rpcArgs);
    return { ...fallback, via: "fallback" };
  }
  throw error;
}
