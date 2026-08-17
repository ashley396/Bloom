import Stripe from "stripe";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { admin, fail } from "./_shared/supabase.js";
import {
  hashPaymentLinkToken,
  transitionPaymentLinkStatus,
  validatePaymentLinkCreate
} from "./_shared/payment-hub-experience.js";
import { resolvePublicSiteUrl } from "./_shared/site-url.js";

function missingTable(error) {
  return error?.code === "42P01" || String(error?.message || "").includes("does not exist");
}

async function loadLinkByToken(client, token) {
  const hash = hashPaymentLinkToken(token);
  const { data, error } = await client.from("payment_hub_payment_links").select("*").eq("token_hash", hash).maybeSingle();
  if (error) throw error;
  return data;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  const client = admin();

  try {
    if (event.httpMethod === "GET") {
      const token = event.queryStringParameters?.t || event.queryStringParameters?.token;
      if (!token) return json(400, { error: "Payment link token required." });
      let link;
      try {
        link = await loadLinkByToken(client, token);
      } catch (e) {
        if (missingTable(e)) return json(503, { error: "Payment links are not available until migration is applied." });
        throw e;
      }
      if (!link) return json(404, { error: "Payment link not found or expired." });
      if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
        await client.from("payment_hub_payment_links").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", link.id);
        return json(410, { error: "This payment link has expired." });
      }
      if (link.status === "canceled" || link.status === "paid") {
        return json(410, { error: `Link is ${link.status}.` });
      }
      const viewed = transitionPaymentLinkStatus(link.status, "viewed");
      if (viewed.ok && link.status === "active") {
        await client
          .from("payment_hub_payment_links")
          .update({ status: "viewed", viewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", link.id);
      }
      const remaining = Math.max(0, Number(link.amount_due) - Number(link.amount_paid || 0));
      return json(200, {
        status: viewed.ok ? viewed.status : link.status,
        amount_due: remaining,
        allow_partial: link.allow_partial,
        shop_id: link.shop_id,
        order_id: link.order_id
      });
    }

    if (event.httpMethod === "POST") {
      const body = bodyOf(event);
      const action = String(body.action || "pay").toLowerCase();
      const token = body.token || body.t;
      if (!token) return json(400, { error: "Token required." });
      let link;
      try {
        link = await loadLinkByToken(client, token);
      } catch (e) {
        if (missingTable(e)) return json(503, { error: "Payment links not configured." });
        throw e;
      }
      if (!link) return json(404, { error: "Invalid link." });

      const remaining = Math.max(0, Number(link.amount_due) - Number(link.amount_paid || 0));
      const payAmount = body.amount != null ? Number(body.amount) : remaining;
      const v = validatePaymentLinkCreate({ orderTotal: remaining, amountRequested: payAmount, allowPartial: link.allow_partial });
      if (!v.valid) return json(400, { error: v.error });

      if (action === "pay") {
        if (!process.env.STRIPE_SECRET_KEY) {
          return json(503, { error: "Card payments are not configured for this shop." });
        }
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const { data: shop } = await client.from("shops").select("name,stripe_connect_account_id").eq("id", link.shop_id).maybeSingle();
        // Without this check the Checkout Session below still gets
        // created with no transfer_data.destination when the shop hasn't
        // connected Stripe — the customer's payment would silently land
        // in Florisyn's own platform balance instead of this shop's.
        if (!shop?.stripe_connect_account_id) {
          return json(409, {
            error: "This shop hasn't finished setting up card payments yet. Please contact them directly to arrange payment.",
            code: "stripe_connect_required"
          });
        }
        const siteBase = (body.return_url || resolvePublicSiteUrl(process.env, event.headers?.origin || "")).replace(/\/$/, "");
        const sessionParams = {
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: Math.round(v.amount * 100),
                product_data: { name: `Order payment — ${shop?.name || "Florisyn florist"}` }
              },
              quantity: 1
            }
          ],
          success_url: `${siteBase}/pay.html?t=${encodeURIComponent(token)}&paid=1`,
          cancel_url: `${siteBase}/pay.html?t=${encodeURIComponent(token)}`,
          metadata: {
            bloom_payment_link_id: link.id,
            bloom_shop_id: String(link.shop_id),
            bloom_order_id: link.order_id ? String(link.order_id) : "",
            bloom_customer_id: link.customer_id ? String(link.customer_id) : "",
            bloom_intended_amount_cents: String(Math.round(v.amount * 100))
          },
          payment_intent_data: {
            metadata: {
              bloom_payment_link_id: link.id,
              bloom_shop_id: String(link.shop_id),
              bloom_order_id: link.order_id ? String(link.order_id) : "",
              bloom_customer_id: link.customer_id ? String(link.customer_id) : "",
              bloom_intended_amount_cents: String(Math.round(v.amount * 100))
            }
          }
        };
        if (shop?.stripe_connect_account_id) {
          sessionParams.payment_intent_data = { transfer_data: { destination: shop.stripe_connect_account_id } };
        }
        const session = await stripe.checkout.sessions.create(sessionParams);
        return json(200, { checkout_url: session.url, amount: v.amount, partial: v.partial });
      }

      if (action === "mark_paid") {
        return json(403, { error: "Payments are confirmed via Stripe webhooks only." });
      }

      return json(400, { error: "Unknown action." });
    }

    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}
