import Stripe from "stripe";
import { admin, env } from "./_shared/saas.js";

const stripe = new Stripe(env("STRIPE_SECRET_KEY"));

export async function handler(event) {
  try {
    const signature = event.headers["stripe-signature"];
    const stripeEvent = stripe.webhooks.constructEvent(event.body, signature, env("STRIPE_WEBHOOK_SECRET"));
    const client = admin();

    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;
      const shopId = session.metadata?.shop_id;
      if (shopId && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        await client.from("shop_subscriptions").upsert({
          shop_id: shopId,
          plan_code: session.metadata?.plan_code || sub.metadata?.plan_code || "professional",
          status: sub.status === "active" ? "active" : sub.status,
          stripe_customer_id: String(session.customer),
          stripe_subscription_id: sub.id,
          stripe_price_id: sub.items.data[0]?.price?.id || null,
          trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          current_period_ends_at: new Date(sub.current_period_end * 1000).toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end
        });
      }
    }

    if (["customer.subscription.updated", "customer.subscription.deleted"].includes(stripeEvent.type)) {
      const sub = stripeEvent.data.object;
      const shopId = sub.metadata?.shop_id;
      if (shopId) {
        await client.from("shop_subscriptions").update({
          status: sub.status,
          stripe_customer_id: String(sub.customer),
          stripe_subscription_id: sub.id,
          stripe_price_id: sub.items.data[0]?.price?.id || null,
          current_period_ends_at: new Date(sub.current_period_end * 1000).toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end
        }).eq("shop_id", shopId);
      }
    }

    return { statusCode: 200, body: "ok" };
  } catch (error) {
    console.error(error);
    return { statusCode: 400, body: `Webhook error: ${error.message}` };
  }
}
