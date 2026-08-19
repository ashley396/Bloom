import Stripe from "stripe";
import { admin, fail } from "./_shared/supabase.js";
import { postStripePayment } from "./_shared/post-stripe-payment.js";
import { postStripePaymentLink } from "./_shared/post-stripe-payment-link.js";
import { markFloristWirePaidFromCheckout } from "./_shared/florist-wire-payment.js";
import { assertStripeLivemodeMatchesKey } from "./_shared/stripe-mode.js";

/**
 * Core webhook logic, dependency-injectable for handler-level tests (see
 * tests/stripe-order-webhook.test.js) without a real Stripe/Supabase
 * connection. `handler` below is the thin Netlify entrypoint that always
 * uses the real dependencies.
 */
export async function handleStripeOrderWebhook(event, dependencies = {}) {
  const getClient = dependencies.admin || admin;
  const createStripe = dependencies.createStripe || ((key) => new Stripe(key));
  const postPayment = dependencies.postStripePayment || postStripePayment;
  const postPaymentLink = dependencies.postStripePaymentLink || postStripePaymentLink;
  const markWirePaid = dependencies.markFloristWirePaidFromCheckout || markFloristWirePaidFromCheckout;

  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_ORDER_WEBHOOK_SECRET) {
      const e = new Error("Stripe order webhook is not configured in Netlify.");
      e.statusCode = 503;
      throw e;
    }
    const stripe = createStripe(process.env.STRIPE_SECRET_KEY);
    const signature = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : event.body || "";
    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(raw, signature, process.env.STRIPE_ORDER_WEBHOOK_SECRET);
    } catch (e) {
      return { statusCode: 400, body: "Webhook signature verification failed." };
    }

    const modeCheck = assertStripeLivemodeMatchesKey(
      process.env.STRIPE_SECRET_KEY,
      Boolean(stripeEvent.livemode),
    );
    if (!modeCheck.ok) {
      console.warn(JSON.stringify({ level: "warn", message: "stripe_webhook_mode_mismatch", reason: modeCheck.reason }));
      return { statusCode: 400, body: JSON.stringify({ error: modeCheck.reason }) };
    }

    const client = getClient();
    if (stripeEvent.type === "checkout.session.completed" || stripeEvent.type === "checkout.session.async_payment_succeeded") {
      const session = stripeEvent.data.object;
      const meta = session.metadata || {};
      if (meta.florist_network === "wire" && meta.florist_wire_id) {
        try {
          await markWirePaid(client, session);
        } catch (wireErr) {
          console.warn(JSON.stringify({ level: "warn", message: "florist_wire_payment_skipped", reason: String(wireErr?.message || wireErr) }));
        }
      } else if (meta.marketplace === "wholesale") {
        try {
          await client
            .from("marketplace_wholesale_orders")
            .update({
              status: "paid",
              paid_at: new Date().toISOString(),
              metadata: {
                stripe_checkout_session_id: session.id,
                stripe_payment_intent: session.payment_intent || null
              }
            })
            .eq("metadata->>stripe_checkout_session_id", session.id);
        } catch (marketErr) {
          console.warn(JSON.stringify({ level: "warn", message: "marketplace_wholesale_order_update_skipped", reason: String(marketErr?.message || marketErr) }));
        }
      } else if (meta.bloom_payment_link_id) {
        await postPaymentLink(client, session, stripeEvent.id);
      } else if (meta.bloom_order_id && meta.bloom_shop_id) {
        await postPayment(client, session);
      }
    } else if (stripeEvent.type === "charge.refunded") {
      // Reactive only — this records what Stripe already did (a refund
      // issued from the seller's own Connect Express dashboard, per the
      // marketplace vision's payment-hardening approach), it never
      // triggers a refund itself. A partial refund updates the amount
      // without touching status; only a full refund moves the order to
      // "refunded".
      const charge = stripeEvent.data.object;
      if (charge.payment_intent) {
        try {
          const refundedAmount = Number(charge.amount_refunded || 0) / 100;
          const fullyRefunded = Number(charge.amount_refunded || 0) >= Number(charge.amount || 0);
          const update = { refunded_amount: refundedAmount, refunded_at: new Date().toISOString() };
          if (fullyRefunded) update.status = "refunded";
          await client
            .from("marketplace_wholesale_orders")
            .update(update)
            .eq("metadata->>stripe_payment_intent", charge.payment_intent);
        } catch (refundErr) {
          console.warn(JSON.stringify({ level: "warn", message: "marketplace_wholesale_order_refund_update_skipped", reason: String(refundErr?.message || refundErr) }));
        }
      }
    } else if (stripeEvent.type === "charge.dispute.created") {
      const dispute = stripeEvent.data.object;
      if (dispute.payment_intent) {
        try {
          await client
            .from("marketplace_wholesale_orders")
            .update({ status: "disputed", disputed_at: new Date().toISOString() })
            .eq("metadata->>stripe_payment_intent", dispute.payment_intent);
        } catch (disputeErr) {
          console.warn(JSON.stringify({ level: "warn", message: "marketplace_wholesale_order_dispute_update_skipped", reason: String(disputeErr?.message || disputeErr) }));
        }
      }
    } else if (stripeEvent.type === "charge.dispute.closed") {
      // Only reverts an order this webhook itself put into "disputed" —
      // never overwrites a status this event didn't cause.
      const dispute = stripeEvent.data.object;
      if (dispute.payment_intent && dispute.status === "won") {
        try {
          await client
            .from("marketplace_wholesale_orders")
            .update({ status: "paid" })
            .eq("metadata->>stripe_payment_intent", dispute.payment_intent)
            .eq("status", "disputed");
        } catch (disputeErr) {
          console.warn(JSON.stringify({ level: "warn", message: "marketplace_wholesale_order_dispute_close_skipped", reason: String(disputeErr?.message || disputeErr) }));
        }
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ received: true })
    };
  } catch (error) {
    return fail(error);
  }
}

export async function handler(event) {
  return handleStripeOrderWebhook(event);
}
