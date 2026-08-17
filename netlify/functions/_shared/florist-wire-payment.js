import {
  stripeApplicationFeeCents,
  buildWireCheckoutMetadata,
} from "../../../lib/florist-network/wire-payment.js";
import { computeWireSplit } from "../../../lib/florist-network/wire-orders.js";

/**
 * Only the fulfilling shop's share is ever charged here — the sending
 * shop's commission is kept from what they already collected from their
 * own customer and never passes through Florisyn at all. This is the
 * "the % just comes straight out of the sending shop's account" model:
 * the sending florist pays out exactly the partner's cut, nothing more.
 */
export async function createFloristWireCheckoutSession(stripe, {
  wire,
  sendingShopId,
  fulfillingShopId,
  fulfillingConnectAccountId,
  customerEmail,
  siteUrl,
}) {
  const split = computeWireSplit(wire.wire_amount, wire.sending_shop_percent);
  const cents = Math.round(split.fulfilling_shop_amount * 100);
  const applicationFee = stripeApplicationFeeCents();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: customerEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: cents,
          product_data: {
            name: `Florist Network wire ${wire.wire_number}`,
            description: `Partner's share ($${split.fulfilling_shop_amount.toFixed(2)}, ${(100 - split.sending_shop_percent).toFixed(0)}%) — your ${split.sending_shop_percent.toFixed(0)}% commission ($${split.sending_shop_amount.toFixed(2)}) stays with you. Florisyn fee $0.`,
          },
        },
      },
    ],
    payment_intent_data: {
      application_fee_amount: applicationFee,
      transfer_data: { destination: fulfillingConnectAccountId },
      metadata: buildWireCheckoutMetadata(wire, { sendingShopId, fulfillingShopId }),
    },
    metadata: buildWireCheckoutMetadata(wire, { sendingShopId, fulfillingShopId }),
    success_url: `${siteUrl}/?florist_wire=success&wire=${encodeURIComponent(wire.id)}`,
    cancel_url: `${siteUrl}/?florist_wire=cancelled&wire=${encodeURIComponent(wire.id)}`,
  });

  return { session, settlement: split };
}

export async function markFloristWirePaidFromCheckout(client, session) {
  const meta = session.metadata || {};
  const wireId = meta.florist_wire_id;
  if (!wireId || meta.florist_network !== "wire") return { ok: false, reason: "not_wire" };

  const { data: existing, error: loadError } = await client
    .from("florist_wire_orders")
    .select("id,metadata,payment_status")
    .eq("id", wireId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!existing) return { ok: false, reason: "wire_not_found" };
  if (existing.payment_status === "paid") return { ok: true, already: true };

  const priorMeta = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
  const { error } = await client
    .from("florist_wire_orders")
    .update({
      payment_status: "paid",
      paid_at: new Date().toISOString(),
      stripe_checkout_session_id: session.id,
      metadata: {
        ...priorMeta,
        stripe_payment_intent: session.payment_intent || null,
        paid_via: "stripe_checkout",
        florisyn_platform_fee: 0,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", wireId);
  if (error) throw error;
  return { ok: true, wire_id: wireId };
}
