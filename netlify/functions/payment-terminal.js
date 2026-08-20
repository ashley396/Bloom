import Stripe from "stripe";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail, requireRoles, admin, resolveSupabaseServerKey } from "./_shared/supabase.js";
import { writeShopAudit, structuredLog } from "./_shared/production.js";
import { friendlyStripeConnectError } from "./_shared/stripe-connect-errors.js";
import {
  validateTerminalAmount,
  buildTerminalIntentParams,
  buildTerminalLocationParams,
  friendlyTerminalError
} from "./_shared/payment-terminal.js";
import { postStripeTerminalPayment } from "./_shared/post-stripe-terminal-payment.js";

const ALLOWED = ["owner", "manager", "cashier", "accountant"];

function requireStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const e = new Error("Stripe is not configured in Netlify.");
    e.statusCode = 503;
    throw e;
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

async function loadShop(client, shopId) {
  const { data: shop, error } = await client
    .from("shops")
    .select("id,name,address,city,state,zip,stripe_connect_account_id,stripe_terminal_location_id")
    .eq("id", shopId)
    .single();
  if (error) throw error;
  if (!shop.stripe_connect_account_id) {
    const e = new Error("Connect this shop's Stripe account before taking in-person card payments (Payment Center → Connect Stripe).");
    e.statusCode = 400;
    throw e;
  }
  return shop;
}

/** Every reader/location/connection-token call for this shop happens
 * scoped to the shop's own Connect account (never the platform account) —
 * the physical reader lives at that specific florist's counter, so
 * Stripe's own Connect-with-Terminal guidance is to manage it directly on
 * the connected account, the same way the destination-charge PaymentIntent
 * still lands the money there via transfer_data. */
function connectedAccountOptions(shop) {
  return { stripeAccount: shop.stripe_connect_account_id };
}

async function ensureLocation(stripe, client, shopId, shop) {
  if (shop.stripe_terminal_location_id) {
    try {
      const location = await stripe.terminal.locations.retrieve(shop.stripe_terminal_location_id, connectedAccountOptions(shop));
      return location.id;
    } catch {
      // Location was deleted or belonged to a stale/disconnected account — fall through and recreate.
    }
  }
  const location = await stripe.terminal.locations.create(buildTerminalLocationParams(shop), connectedAccountOptions(shop));
  const { error } = await client.from("shops").update({ stripe_terminal_location_id: location.id }).eq("id", shopId);
  if (error) throw error;
  return location.id;
}

async function loadOrder(client, shopId, orderId) {
  const { data: order, error } = await client
    .from("orders")
    .select("id,order_number,customer_name,total,amount_paid,balance_due,payment_status")
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error) throw error;
  return order;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();
  try {
    const ctx = await currentUser(event);
    requireRoles(ctx, ALLOWED);
    const { client, shopId, user } = ctx;
    const body = bodyOf(event);
    const action = String(body.action || "").toLowerCase();
    const stripe = requireStripe();

    if (action === "connection_token") {
      const shop = await loadShop(client, shopId);
      try {
        const token = await stripe.terminal.connectionTokens.create({}, connectedAccountOptions(shop));
        return json(200, { secret: token.secret });
      } catch (error) {
        throw friendlyStripeConnectError(error);
      }
    }

    if (action === "location") {
      const shop = await loadShop(client, shopId);
      const locationId = await ensureLocation(stripe, client, shopId, shop);
      return json(200, { location_id: locationId });
    }

    if (action === "register_reader") {
      const shop = await loadShop(client, shopId);
      const registrationCode = String(body.registration_code || "").trim();
      if (!registrationCode) return json(400, { error: "Enter the pairing code shown on the reader's screen." });
      const locationId = await ensureLocation(stripe, client, shopId, shop);
      try {
        const reader = await stripe.terminal.readers.create(
          { registration_code: registrationCode, location: locationId, label: String(body.label || "").trim() || undefined },
          connectedAccountOptions(shop)
        );
        return json(201, { reader: { id: reader.id, label: reader.label, status: reader.status, device_type: reader.device_type } });
      } catch (error) {
        return json(400, { error: friendlyTerminalError(error) });
      }
    }

    if (action === "list_readers") {
      const shop = await loadShop(client, shopId);
      const readers = await stripe.terminal.readers.list({ limit: 20 }, connectedAccountOptions(shop));
      return json(200, {
        readers: readers.data.map((r) => ({ id: r.id, label: r.label, status: r.status, device_type: r.device_type }))
      });
    }

    if (action === "create_intent") {
      const orderId = String(body.order_id || "").trim();
      if (!orderId) return json(400, { error: "Choose an order first." });
      const shop = await loadShop(client, shopId);
      const order = await loadOrder(client, shopId, orderId);
      if (!order) return json(404, { error: "Order not found." });
      const check = validateTerminalAmount(order, body.amount);
      if (!check.valid) return json(400, { error: check.error });

      const idempotencyKey = String(body.idempotency_key || `terminal:${orderId}:${Date.now()}`);
      const params = buildTerminalIntentParams({ order, shop, amount: check.amount, idempotencyKey, actorUserId: user.id });
      try {
        const intent = await stripe.paymentIntents.create(params, { idempotencyKey });
        return json(200, { client_secret: intent.client_secret, payment_intent_id: intent.id, amount: check.amount, balance: check.balance });
      } catch (error) {
        return json(400, { error: friendlyTerminalError(error) });
      }
    }

    if (action === "confirm") {
      const paymentIntentId = String(body.payment_intent_id || "").trim();
      if (!paymentIntentId) return json(400, { error: "Missing payment_intent_id." });
      if (!resolveSupabaseServerKey()) {
        const e = new Error(
          "Recording in-person card payments requires SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) on this Netlify site. Add it under Site configuration → Environment variables, then redeploy."
        );
        e.statusCode = 503;
        e.code = "supabase_server_key_missing";
        throw e;
      }
      const shop = await loadShop(client, shopId);
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, connectedAccountOptions(shop));
      if (intent.metadata?.bloom_shop_id !== String(shopId)) {
        return json(403, { error: "That payment does not belong to this shop." });
      }
      if (intent.status !== "succeeded") {
        return json(409, { error: `Card was not approved (status: ${intent.status}). Try the reader again.` });
      }
      const service = admin();
      try {
        const result = await postStripeTerminalPayment(service, intent);
        await writeShopAudit(client, {
          shopId,
          userId: user.id,
          eventType: "payment_recorded",
          entityType: "order",
          entityId: intent.metadata.bloom_order_id,
          metadata: { amount: result.amount, method: "Stripe", channel: "terminal", duplicate: Boolean(result.duplicate) }
        });
        return json(201, result);
      } catch (error) {
        structuredLog("error", "terminal_payment_confirm_failed", {
          shopId,
          paymentIntentId,
          message: error.message,
          code: error.code
        });
        throw error;
      }
    }

    return json(400, { error: "Unknown action." });
  } catch (error) {
    return fail(error);
  }
}
