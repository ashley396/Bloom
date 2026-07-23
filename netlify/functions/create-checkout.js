import Stripe from "stripe";
import { json, methodNotAllowed, parseBody } from "./_shared/http.js";
import { requireUser, handleError } from "./_shared/supabase.js";

export async function handler(event) {
  if (event.httpMethod !== "POST") return methodNotAllowed();
  try {
    const { user } = await requireUser(event);
    const body = parseBody(event);
    const amount = Math.round(Number(body.amount || 0) * 100);
    if (!Number.isFinite(amount) || amount < 50) return json(400, { error: "Payment must be at least $0.50" });
    if (!process.env.STRIPE_SECRET_KEY) return json(503, { error: "STRIPE_SECRET_KEY is not configured in Netlify" });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const siteUrl = process.env.SITE_URL || event.headers.origin;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: body.description || "Bloom floral order" },
          unit_amount: amount
        },
        quantity: 1
      }],
      success_url: `${siteUrl}/?payment=success`,
      cancel_url: `${siteUrl}/?payment=cancelled`
    });
    return json(200, { url: session.url });
  } catch (error) { return handleError(error); }
}
