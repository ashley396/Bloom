import Stripe from "stripe";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import { createFloristWireCheckoutSession } from "./_shared/florist-wire-payment.js";
import {
  canInitiateWirePayment,
  partnerCanReceiveWirePayments,
  wirePaymentLabel,
} from "../../lib/florist-network/wire-payment.js";
import {
  validateWirePayload,
  generateWireNumber,
  canTransitionWire,
  WIRE_STATUS_LABELS,
  computeWireSettlement,
  DEFAULT_RELAY_FEE_PERCENT,
  FLORISYN_WIRE_PLATFORM_FEE_PERCENT,
  WIRE_ZERO_PLATFORM_POLICY,
} from "../../lib/florist-network/wire-orders.js";
import { uploadWireReferencePhoto, attachWireReferencePhotoUrls } from "./_shared/florist-wire-photo.js";

function featureGate() {
  if (!isFeatureEnabled("FLORIST_NETWORK")) {
    const e = new Error("Florist Network is disabled.");
    e.statusCode = 503;
    throw e;
  }
}

function missingTable(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST202" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find the table")
  );
}

function friendlyMissing() {
  const e = new Error(
    "Florist Network tables are not set up yet. Apply the florist network growth migrations in Supabase, then try again."
  );
  e.statusCode = 503;
  e.code = "florist_network_not_migrated";
  throw e;
}

function filterPartners(items, { zip = "", city = "", state = "" } = {}) {
  let result = items || [];
  const zipQ = String(zip || "").trim();
  const cityQ = String(city || "").trim().toLowerCase();
  const stateQ = String(state || "").trim().toUpperCase();
  if (zipQ) {
    result = result.filter((p) => !p.service_zips?.length || p.service_zips.includes(zipQ));
  }
  if (cityQ) {
    result = result.filter((p) => String(p.city || "").toLowerCase().includes(cityQ));
  }
  if (stateQ) {
    result = result.filter((p) => String(p.state || "").toUpperCase() === stateQ);
  }
  return result;
}

async function mapWireRows(client, rows) {
  const mapped = (rows || []).map((row) => ({
    ...row,
    status_label: WIRE_STATUS_LABELS[row.status] || row.status,
    payment_label: wirePaymentLabel(row.payment_status),
  }));
  return attachWireReferencePhotoUrls(client, mapped);
}

function stripeRedirectBaseUrl() {
  const site = String(process.env.SITE_URL || process.env.URL || "").trim().replace(/\/$/, "");
  if (!site) {
    const e = new Error("SITE_URL is not configured in Netlify.");
    e.statusCode = 503;
    throw e;
  }
  return site;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    featureGate();
    const { client, shopId, user } = await currentUser(event);
    const body = bodyOf(event);
    const action = body.action || event.queryStringParameters?.action || "inbox";

    if (event.httpMethod === "GET" && action === "partners") {
      const zip = String(event.queryStringParameters?.zip || "").trim();
      const city = String(event.queryStringParameters?.city || "").trim();
      const state = String(event.queryStringParameters?.state || "").trim();
      let q = client
        .from("florist_network_profiles")
        .select("shop_id, display_name, city, state, service_zips, wire_fee_percent, bio, public_slug")
        .eq("is_active", true)
        .neq("shop_id", shopId)
        .limit(100);
      const { data, error } = await q;
      if (error) throw error;
      let items = data || [];
      if (items.length) {
        const shopIds = items.map((p) => p.shop_id);
        const { data: shops } = await client
          .from("shops")
          .select("id, stripe_connect_account_id")
          .in("id", shopIds);
        const shopMap = new Map((shops || []).map((s) => [s.id, s]));
        items = items.map((p) => ({
          ...p,
          can_receive_payments: partnerCanReceiveWirePayments(shopMap.get(p.shop_id)),
        }));
      }
      items = filterPartners(items, { zip, city, state });
      return json(200, { items: items.slice(0, 50) });
    }

    if (event.httpMethod === "GET" && action === "profile") {
      const { data, error } = await client
        .from("florist_network_profiles")
        .select("*")
        .eq("shop_id", shopId)
        .maybeSingle();
      if (error) throw error;
      return json(200, { profile: data, wire_policy: WIRE_ZERO_PLATFORM_POLICY, default_relay_fee_percent: DEFAULT_RELAY_FEE_PERCENT });
    }

    if (event.httpMethod === "GET") {
      const view = action === "outbox" ? "sending" : "fulfilling";
      const col = view === "sending" ? "sending_shop_id" : "fulfilling_shop_id";
      const { data, error } = await client
        .from("florist_wire_orders")
        .select("*")
        .eq(col, shopId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const items = await mapWireRows(client, data);
      return json(200, {
        items,
        view,
        wire_policy: WIRE_ZERO_PLATFORM_POLICY,
        florisyn_platform_fee_percent: FLORISYN_WIRE_PLATFORM_FEE_PERCENT,
        default_relay_fee_percent: DEFAULT_RELAY_FEE_PERCENT,
      });
    }

    if (event.httpMethod === "POST" && action === "save-profile") {
      const { data: shop } = await client.from("shops").select("name, city, state").eq("id", shopId).single();
      const slug =
        body.public_slug ||
        String(shop?.name || "shop")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 40);
      const record = {
        shop_id: shopId,
        display_name: body.display_name || shop?.name || "Florist",
        public_slug: slug,
        city: body.city || shop?.city || null,
        state: body.state || shop?.state || null,
        accepts_incoming_wires: body.accepts_incoming_wires !== false,
        sends_outgoing_wires: body.sends_outgoing_wires !== false,
        service_zips: Array.isArray(body.service_zips)
          ? body.service_zips
          : String(body.service_zips || "")
              .split(/[,\s]+/)
              .map((z) => z.trim())
              .filter(Boolean),
        wire_fee_percent: Math.min(100, Math.max(0, Number(body.wire_fee_percent ?? DEFAULT_RELAY_FEE_PERCENT))),
        wire_fee_flat: Math.max(0, Number(body.wire_fee_flat || 0)),
        bio: body.bio || null,
        is_active: body.is_active !== false,
        updated_at: new Date().toISOString()
      };
      const { data, error } = await client
        .from("florist_network_profiles")
        .upsert(record)
        .select()
        .single();
      if (error) throw error;
      return json(200, { profile: data, wire_policy: WIRE_ZERO_PLATFORM_POLICY });
    }

    if (event.httpMethod === "POST" && action === "send-wire") {
      const v = validateWirePayload(body);
      if (!v.ok) return json(400, { error: v.error });
      const fulfilling_shop_id = body.fulfilling_shop_id;
      if (!fulfilling_shop_id) return json(400, { error: "Select a fulfilling florist." });
      const relayPercent = Math.min(
        100,
        Math.max(0, Number(body.relay_fee_percent ?? body.wire_fee_percent ?? DEFAULT_RELAY_FEE_PERCENT))
      );
      const settlement = computeWireSettlement(v.payload.wire_amount, { relayPercent });
      let reference_photo_url = null;
      if (body.reference_photo_data_url) {
        const upload = await uploadWireReferencePhoto(client, shopId, body.reference_photo_data_url);
        if (!upload.ok) return json(400, { error: upload.error });
        reference_photo_url = upload.path;
      }
      const record = {
        wire_number: generateWireNumber(),
        sending_shop_id: shopId,
        fulfilling_shop_id,
        source_order_id: body.source_order_id || null,
        status: body.send ? "sent" : "draft",
        ...v.payload,
        relay_fee_percent: relayPercent,
        reference_photo_url,
        payment_status: "unpaid",
        metadata: {
          florisyn_platform_fee: settlement.florisyn_platform_fee,
          fulfilling_shop_payout: settlement.fulfilling_shop_payout,
          partner_relay_fee: settlement.partner_relay_fee,
          relay_fee_percent: relayPercent,
          wire_policy: WIRE_ZERO_PLATFORM_POLICY,
        },
        sent_at: body.send ? new Date().toISOString() : null,
        created_by: user?.id || null,
        updated_at: new Date().toISOString()
      };
      const { data, error } = await client.from("florist_wire_orders").insert(record).select().single();
      if (error) throw error;
      return json(201, { item: data, settlement, pay_next: true });
    }

    if (event.httpMethod === "POST" && action === "pay-wire") {
      if (!process.env.STRIPE_SECRET_KEY) {
        return json(503, { error: "Stripe is not configured in Netlify. Wire payment requires STRIPE_SECRET_KEY." });
      }
      if (!body.id) return json(400, { error: "Missing wire order id." });
      const { data: wire, error: wireError } = await client
        .from("florist_wire_orders")
        .select("*")
        .eq("id", body.id)
        .maybeSingle();
      if (wireError) throw wireError;
      const payCheck = canInitiateWirePayment(wire, shopId);
      if (!payCheck.ok) return json(400, { error: payCheck.error });

      const { data: fulfillingShop, error: shopError } = await client
        .from("shops")
        .select("id, name, stripe_connect_account_id")
        .eq("id", wire.fulfilling_shop_id)
        .maybeSingle();
      if (shopError) throw shopError;
      if (!partnerCanReceiveWirePayments(fulfillingShop)) {
        return json(409, {
          error:
            "Your partner florist must connect Stripe in Payment Center before they can receive wire payments online.",
        });
      }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const site = stripeRedirectBaseUrl();
      const { session, settlement } = await createFloristWireCheckoutSession(stripe, {
        wire,
        sendingShopId: shopId,
        fulfillingShopId: wire.fulfilling_shop_id,
        fulfillingConnectAccountId: fulfillingShop.stripe_connect_account_id,
        customerEmail: user.email,
        siteUrl: site,
      });

      const priorMeta = wire.metadata && typeof wire.metadata === "object" ? wire.metadata : {};
      await client
        .from("florist_wire_orders")
        .update({
          payment_status: "pending_payment",
          stripe_checkout_session_id: session.id,
          metadata: { ...priorMeta, checkout_started_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        })
        .eq("id", wire.id);

      return json(200, {
        url: session.url,
        settlement,
        wire_policy: WIRE_ZERO_PLATFORM_POLICY,
      });
    }

    if (event.httpMethod === "POST" && action === "mark-paid-offline") {
      if (!body.id) return json(400, { error: "Missing wire order id." });
      const { data: wire, error: wireError } = await client
        .from("florist_wire_orders")
        .select("*")
        .eq("id", body.id)
        .maybeSingle();
      if (wireError) throw wireError;
      if (!wire || wire.sending_shop_id !== shopId) {
        return json(403, { error: "Only the sending shop can mark a wire paid." });
      }
      if (wire.payment_status === "paid") return json(200, { item: wire });
      const priorMeta = wire.metadata && typeof wire.metadata === "object" ? wire.metadata : {};
      const { data, error } = await client
        .from("florist_wire_orders")
        .update({
          payment_status: "paid",
          paid_at: new Date().toISOString(),
          metadata: {
            ...priorMeta,
            paid_via: "offline",
            offline_note: String(body.note || "").trim() || null,
            florisyn_platform_fee: 0,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.id)
        .select()
        .single();
      if (error) throw error;
      return json(200, { item: data });
    }

    if (event.httpMethod === "POST" && action === "transition") {
      const { data: row, error: loadErr } = await client
        .from("florist_wire_orders")
        .select("*")
        .eq("id", body.id)
        .maybeSingle();
      if (loadErr) throw loadErr;
      if (!row) return json(404, { error: "Wire order not found." });
      const isSender = row.sending_shop_id === shopId;
      const isFulfiller = row.fulfilling_shop_id === shopId;
      if (!isSender && !isFulfiller) return json(403, { error: "Not authorized for this wire." });
      const next = body.status;
      if (!canTransitionWire(row.status, next)) {
        return json(400, { error: `Cannot move from ${row.status} to ${next}.` });
      }
      const patch = { status: next, updated_at: new Date().toISOString() };
      if (next === "accepted") patch.accepted_at = new Date().toISOString();
      if (next === "delivered") patch.delivered_at = new Date().toISOString();
      const { data, error } = await client
        .from("florist_wire_orders")
        .update(patch)
        .eq("id", body.id)
        .select()
        .single();
      if (error) throw error;
      return json(200, { item: data });
    }

    return json(400, { error: "Unknown florist network action." });
  } catch (error) {
    if (missingTable(error)) {
      try {
        friendlyMissing();
      } catch (missing) {
        return fail(missing);
      }
    }
    return fail(error);
  }
}
