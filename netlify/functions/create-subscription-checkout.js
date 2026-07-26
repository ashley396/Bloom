import Stripe from "stripe";
import { authenticatedUser, env, fail, json } from "./_shared/saas.js";

const stripe = new Stripe(env("STRIPE_SECRET_KEY"));
const priceMap = {
  starter: process.env.STRIPE_PRICE_STARTER,
  professional: process.env.STRIPE_PRICE_PROFESSIONAL,
  premium: process.env.STRIPE_PRICE_PREMIUM
};

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const { planCode } = JSON.parse(event.body || "{}");
    const price = priceMap[planCode];
    if (!price) throw Object.assign(new Error("That subscription plan is not configured"), { statusCode: 400 });

    const { client, user } = await authenticatedUser(event);
    const { data: profile, error: profileError } = await client.from("profiles").select("default_shop_id").eq("id", user.id).single();
    if (profileError || !profile.default_shop_id) throw Object.assign(new Error("Complete shop setup first"), { statusCode: 400 });

    const { data: subscription } = await client.from("shop_subscriptions").select("stripe_customer_id").eq("shop_id", profile.default_shop_id).maybeSingle();
    const siteUrl = env("SITE_URL").replace(/\/$/, "");

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: subscription?.stripe_customer_id || undefined,
      customer_email: subscription?.stripe_customer_id ? undefined : user.email,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${siteUrl}/?subscription=success`,
      cancel_url: `${siteUrl}/?subscription=cancelled`,
      metadata: { shop_id: profile.default_shop_id, user_id: user.id, plan_code: planCode },
      subscription_data: { metadata: { shop_id: profile.default_shop_id, plan_code: planCode } }
    });

    return json(200, { url: checkout.url });
  } catch (error) {
    return fail(error);
  }
}
