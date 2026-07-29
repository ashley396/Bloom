import Stripe from "stripe";
import { admin, fail } from "./_shared/supabase.js";
import { postStripePayment } from "./_shared/post-stripe-payment.js";
import { postStripePaymentLink } from "./_shared/post-stripe-payment-link.js";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_ORDER_WEBHOOK_SECRET) {
      const e = new Error("Stripe order webhook is not configured in Netlify.");
      e.statusCode = 503;
      throw e;
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const signature = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : event.body || "";
    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(raw, signature, process.env.STRIPE_ORDER_WEBHOOK_SECRET);
    } catch (e) {
      return { statusCode: 400, body: `Webhook signature error: ${e.message}` };
    }

    const client = admin();
    if (stripeEvent.type === "checkout.session.completed" || stripeEvent.type === "checkout.session.async_payment_succeeded") {
      const session = stripeEvent.data.object;
      const meta = session.metadata || {};
      if (meta.bloom_payment_link_id) {
        await postStripePaymentLink(client, session, stripeEvent.id);
      } else if (meta.bloom_order_id && meta.bloom_shop_id) {
        await postStripePayment(client, session);
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
