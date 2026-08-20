/**
 * Applies a succeeded Stripe Terminal (card-present) PaymentIntent to its
 * order — the Terminal counterpart to post-stripe-payment.js, which does
 * the same thing for a Checkout Session. Terminal never creates a
 * Checkout Session (there's no hosted redirect — the reader collects the
 * card directly), so it reads PaymentIntent fields instead of Session
 * fields, but posts through the exact same idempotent post_order_payment
 * RPC every other payment method already uses.
 *
 * Called from two places, both safe to call redundantly thanks to the
 * RPC's own idempotency key: the synchronous confirm the POS calls right
 * after the reader finishes (so the cashier isn't staring at a screen
 * waiting on webhook delivery), and the payment_intent.succeeded webhook
 * branch, kept as a backstop for a confirm call that never lands (tab
 * closed, network drop) mid-transaction.
 */
export async function postStripeTerminalPayment(client, paymentIntent) {
  if (paymentIntent.status !== "succeeded") return { paid: false };
  const m = paymentIntent.metadata || {};
  const orderId = m.bloom_order_id;
  const shopId = m.bloom_shop_id;
  if (!orderId || !shopId) throw new Error("Stripe Terminal payment is missing Florisyn order metadata.");
  const amount = Number(paymentIntent.amount || 0) / 100;
  const { data, error } = await client.rpc("post_order_payment", {
    p_shop_id: shopId,
    p_order_id: orderId,
    p_amount: amount,
    p_method: "Stripe",
    p_idempotency_key: m.bloom_idempotency_key || `stripe-terminal:${paymentIntent.id}`,
    p_actor_user_id: m.bloom_actor_user_id || null,
    p_processor: "stripe",
    p_processor_session_id: null,
    p_processor_payment_intent_id: paymentIntent.id,
    p_metadata: { stripe_event_source: "terminal", channel: "terminal" }
  });
  if (error) throw error;
  return { paid: true, amount, ...data };
}
