/**
 * Stripe Terminal (card-present, in-person payments) — Switching Barrier
 * Register Wave 6. Payments Hub's own provider catalog has listed
 * "stripe_terminal" as status:"coming_soon" since it was written; this is
 * what actually closes that gap.
 *
 * Money movement deliberately mirrors create-checkout.js exactly — the
 * proven, already-live card-not-present flow: the PaymentIntent is
 * created on the PLATFORM account with transfer_data.destination set to
 * the shop's Connect account (a destination charge), no application fee,
 * same balance-validation rule (min $0.50, never exceed the order's
 * remaining balance). The only real differences are payment_method_types
 * (card_present instead of the implicit card default) and how the
 * PaymentIntent gets collected — a physical/simulated reader instead of
 * a hosted Checkout redirect.
 */

export const MIN_TERMINAL_AMOUNT = 0.5;

/** Same balance rule create-checkout.js applies inline — pulled out here
 * so it's independently testable instead of only provable by reading the
 * handler's source. */
export function validateTerminalAmount(order, requestedAmount) {
  const balance = Math.max(0, Number(order?.balance_due ?? (Number(order?.total || 0) - Number(order?.amount_paid || 0))));
  if (balance < MIN_TERMINAL_AMOUNT) {
    return { valid: false, error: "This order has no card-payable balance." };
  }
  const requested = Number(requestedAmount ?? balance);
  if (!Number.isFinite(requested) || requested < MIN_TERMINAL_AMOUNT) {
    return { valid: false, error: `Payment must be at least $${MIN_TERMINAL_AMOUNT.toFixed(2)}` };
  }
  if (requested > balance + 0.005) {
    return { valid: false, error: `Payment cannot exceed the remaining balance of $${balance.toFixed(2)}.` };
  }
  return { valid: true, amount: requested, balance };
}

/**
 * Params for stripe.paymentIntents.create() — a destination charge, same
 * shape as create-checkout.js's Checkout Session payment_intent_data,
 * plus card_present and automatic capture (the reader completes the
 * charge itself; there's no separate manual-capture step to wire up).
 * channel:"terminal" in metadata is what lets the webhook (backstop) and
 * any future reporting tell a counter sale apart from an online one,
 * without a new payments.method value — the DB check constraint only
 * allows 'Stripe' among the card-processor methods, and a card-present
 * Stripe charge is still, correctly, a Stripe payment.
 */
export function buildTerminalIntentParams({ order, shop, amount, idempotencyKey, actorUserId }) {
  return {
    amount: Math.round(Number(amount) * 100),
    currency: "usd",
    payment_method_types: ["card_present"],
    capture_method: "automatic",
    transfer_data: { destination: shop.stripe_connect_account_id },
    metadata: {
      bloom_order_id: order.id,
      bloom_order_number: order.order_number || "",
      bloom_shop_id: String(shop.id),
      bloom_actor_user_id: actorUserId || "",
      bloom_idempotency_key: idempotencyKey,
      channel: "terminal"
    }
  };
}

/** A Terminal reader belongs to a Stripe Terminal "Location" — required
 * before any real (non-simulated) reader can be registered. Built from
 * the shop's own address so there's nothing new for the florist to type;
 * falls back to a placeholder only when the shop truly has no address on
 * file yet, so registration doesn't hard-block onboarding order. */
export function buildTerminalLocationParams(shop = {}) {
  const line1 = String(shop.address || "").trim();
  return {
    display_name: shop.name ? `${shop.name} — counter` : "Florisyn shop counter",
    address: {
      line1: line1 || "Address not yet set",
      city: shop.city || "",
      state: shop.state || "",
      country: "US",
      postal_code: shop.zip || ""
    }
  };
}

export function friendlyTerminalError(error) {
  const msg = String(error?.message || error || "");
  if (/no such location/i.test(msg)) return "This shop's card reader location needs to be set up again — try Settings → Payments.";
  if (/registration code/i.test(msg)) return "That pairing code wasn't recognized. Codes are shown on the reader's own screen and expire quickly — read it again and retry.";
  if (/card_present.*not (enabled|supported)/i.test(msg)) return "In-person card payments aren't enabled on this Stripe account yet. Contact Stripe support to enable Terminal.";
  return msg || "Card reader error. Try again.";
}
