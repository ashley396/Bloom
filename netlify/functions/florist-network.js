import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { isFeatureEnabled } from "./_shared/feature-flags.js";
import {
  validateWirePayload,
  generateWireNumber,
  canTransitionWire,
  WIRE_STATUS_LABELS,
  computeWireSettlement,
  FLORISYN_WIRE_PLATFORM_FEE_PERCENT,
  WIRE_ZERO_PLATFORM_POLICY,
} from "../../lib/florist-network/wire-orders.js";

function featureGate() {
  if (!isFeatureEnabled("FLORIST_NETWORK")) {
    const e = new Error("Florist Network is disabled.");
    e.statusCode = 503;
    throw e;
  }
}

function missingTable(error) {
  const msg = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || msg.includes("does not exist");
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
      let q = client
        .from("florist_network_profiles")
        .select("shop_id, display_name, city, state, service_zips, wire_fee_percent, bio, public_slug")
        .eq("is_active", true)
        .neq("shop_id", shopId)
        .limit(50);
      const { data, error } = await q;
      if (error) throw error;
      let items = data || [];
      if (zip) {
        items = items.filter(
          (p) => !p.service_zips?.length || p.service_zips.includes(zip)
        );
      }
      return json(200, { items });
    }

    if (event.httpMethod === "GET" && action === "profile") {
      const { data, error } = await client
        .from("florist_network_profiles")
        .select("*")
        .eq("shop_id", shopId)
        .maybeSingle();
      if (error) throw error;
      return json(200, { profile: data, wire_policy: WIRE_ZERO_PLATFORM_POLICY });
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
      return json(200, {
        items: (data || []).map((row) => ({
          ...row,
          status_label: WIRE_STATUS_LABELS[row.status] || row.status
        })),
        view,
        wire_policy: WIRE_ZERO_PLATFORM_POLICY,
        florisyn_platform_fee_percent: FLORISYN_WIRE_PLATFORM_FEE_PERCENT,
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
        service_zips: Array.isArray(body.service_zips) ? body.service_zips : [],
        wire_fee_percent: Math.max(0, Number(body.wire_fee_percent || 0)),
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
      const settlement = computeWireSettlement(v.payload.wire_amount);
      const record = {
        wire_number: generateWireNumber(),
        sending_shop_id: shopId,
        fulfilling_shop_id,
        source_order_id: body.source_order_id || null,
        status: body.send ? "sent" : "draft",
        ...v.payload,
        metadata: {
          florisyn_platform_fee: settlement.florisyn_platform_fee,
          fulfilling_shop_payout: settlement.fulfilling_shop_payout,
          partner_relay_fee: settlement.partner_relay_fee,
          wire_policy: WIRE_ZERO_PLATFORM_POLICY,
        },
        sent_at: body.send ? new Date().toISOString() : null,
        created_by: user?.id || null,
        updated_at: new Date().toISOString()
      };
      const { data, error } = await client.from("florist_wire_orders").insert(record).select().single();
      if (error) throw error;
      return json(201, { item: data, settlement });
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
      return json(503, { error: "Apply florist_network_growth_v1 migration in Supabase." });
    }
    return fail(error);
  }
}
