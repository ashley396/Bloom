import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail, requireRoles } from "./_shared/supabase.js";
import { writeShopAudit } from "./_shared/production.js";
import {
  FLOWER_SCHEDULES,
  FLOWER_SUBSCRIPTION_TYPES,
  MEMBERSHIP_TEMPLATES,
  LOYALTY_TIERS,
  REPORT_CATALOG,
  validateFlowerSubscription,
  nextDeliveryDate,
  computeLoyaltyEarn,
  computeLoyaltyTier,
  validatePointsRedeem,
  canTransitionPO,
  buildFinanceCenter,
  buildBusinessDashboardKpis,
  buildLilyBusinessCoach,
  portalCapabilities
} from "./_shared/business-ecosystem.js";

const ROLES = ["owner", "manager", "cashier", "accountant", "designer"];

function missingTable(error) {
  return error?.code === "42P01" || String(error?.message || "").includes("does not exist");
}

async function safeSelect(client, table, shopId, order = "created_at") {
  try {
    const { data, error } = await client.from(table).select("*").eq("shop_id", shopId).order(order, { ascending: false }).limit(200);
    if (error) throw error;
    return data || [];
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
}

async function buildHub(client, shopId) {
  const [subs, loyalty, plans, vendors, pos, deliveries, orders, expenses] = await Promise.all([
    safeSelect(client, "bloom_customer_subscriptions", shopId),
    safeSelect(client, "bloom_loyalty_accounts", shopId, "updated_at"),
    safeSelect(client, "bloom_membership_plans", shopId),
    safeSelect(client, "bloom_vendor_profiles", shopId),
    safeSelect(client, "bloom_purchase_orders", shopId),
    safeSelect(client, "bloom_delivery_details", shopId, "updated_at"),
    client.from("orders").select("total,payment_status,status,amount_paid").eq("shop_id", shopId).limit(300),
    client.from("expenses").select("amount").eq("shop_id", shopId).limit(300)
  ]);

  const orderRows = orders.error ? [] : orders.data || [];
  const expenseRows = expenses.error ? [] : expenses.data || [];
  let revenue = 0;
  let ar = 0;
  for (const o of orderRows) {
    if (String(o.payment_status).toUpperCase() === "PAID" && o.status !== "CANCELLED") revenue += Number(o.total || 0);
    else if (o.status !== "CANCELLED") ar += Math.max(0, Number(o.total || 0) - Number(o.amount_paid || 0));
  }
  const expTotal = expenseRows.reduce((s, e) => s + Number(e.amount || 0), 0);
  const recurring = subs.filter((s) => s.status === "active").reduce((sum, s) => sum + Number(s.amount || 0), 0);

  const finance = buildFinanceCenter({ revenue, expenses: expTotal, profit: revenue - expTotal }, { accounts_receivable: ar });

  return {
    version: "1.0",
    flower_subscriptions: { items: subs, schedules: FLOWER_SCHEDULES, types: FLOWER_SUBSCRIPTION_TYPES },
    loyalty: { tiers: LOYALTY_TIERS, accounts: loyalty },
    memberships: { templates: MEMBERSHIP_TEMPLATES, plans },
    finance_center: finance,
    vendors: vendors,
    purchase_orders: pos,
    delivery_management: deliveries,
    customer_portal: { capabilities: portalCapabilities(), note: "Customer-facing portal uses secure links; preview in shop." },
    reports: REPORT_CATALOG,
    kpis: buildBusinessDashboardKpis({}, { recurring_revenue: recurring, wholesale_sales: 0, marketplace_sales: 0 })
  };
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (!["GET", "POST"].includes(event.httpMethod)) return methodNotAllowed();

  try {
    const ctx = await currentUser(event);
    requireRoles(ctx, ROLES);
    const { client, shopId, user } = ctx;
    const body = event.httpMethod === "GET" ? {} : bodyOf(event);
    const action = String(body.action || event.queryStringParameters?.action || "hub").toLowerCase();

    if (event.httpMethod === "GET" && action === "hub") {
      const hub = await buildHub(client, shopId);
      return json(200, hub);
    }

    if (event.httpMethod === "GET" && action === "dashboard") {
      const hub = await buildHub(client, shopId);
      return json(200, { hub, business_kpis: hub.kpis });
    }

    if (action === "lily_coach") {
      const inv = await client.from("inventory").select("quantity,low_stock_level").eq("shop_id", shopId).limit(100);
      const low = (inv.data || []).filter((i) => Number(i.quantity) <= Number(i.low_stock_level || 5)).length;
      const subs = await safeSelect(client, "bloom_customer_subscriptions", shopId);
      const ord = await client.from("orders").select("payment_status,total,amount_paid").eq("shop_id", shopId).limit(50);
      let unpaid = 0;
      for (const o of ord.data || []) {
        if (String(o.payment_status).toUpperCase() !== "PAID") unpaid += Math.max(0, Number(o.total) - Number(o.amount_paid || 0));
      }
      const coach = buildLilyBusinessCoach({
        low_stock_count: low,
        subscription_count: subs.filter((s) => s.status === "active").length,
        unpaid_total: unpaid,
        waste_risk: "Medium",
        margin_health: 70
      });
      return json(200, { suggestions: coach });
    }

    if (action === "flower_subscription_create") {
      requireRoles(ctx, ["owner", "manager"]);
      const v = validateFlowerSubscription(body);
      if (!v.valid) return json(400, { errors: v.errors });
      const row = {
        shop_id: shopId,
        customer_id: body.customer_id || null,
        customer_name: body.customer_name,
        subscription_type: body.subscription_type || "fresh_flowers",
        schedule: body.schedule,
        custom_interval_days: body.custom_interval_days || null,
        amount: Number(body.amount),
        status: "active",
        next_delivery_date: nextDeliveryDate(body.schedule, new Date(), body.custom_interval_days),
        gift_recipient: body.gift_recipient || null
      };
      const { data, error } = await client.from("bloom_customer_subscriptions").insert(row).select("*").single();
      if (error) throw error;
      await writeShopAudit(client, { shopId, userId: user.id, eventType: "flower_subscription_created", entityId: data.id });
      return json(201, { subscription: data });
    }

    if (action === "flower_subscription_control") {
      const id = body.id;
      const op = body.op;
      const patch = { updated_at: new Date().toISOString() };
      if (op === "pause") patch.status = "paused";
      else if (op === "resume") {
        patch.status = "active";
        patch.next_delivery_date = nextDeliveryDate(body.schedule || "weekly", new Date(), body.custom_interval_days);
      } else if (op === "cancel") patch.status = "cancelled";
      else if (op === "skip") patch.next_delivery_date = nextDeliveryDate(body.schedule || "weekly", body.next_delivery_date || new Date(), body.custom_interval_days);
      else return json(400, { error: "Unknown subscription operation." });
      const { data, error } = await client.from("bloom_customer_subscriptions").update(patch).eq("id", id).eq("shop_id", shopId).select("*").single();
      if (error) throw error;
      return json(200, { subscription: data });
    }

    if (action === "loyalty_earn") {
      // Pass #3 security review: bloom_loyalty_accounts.customer_id is the
      // table's real primary key (not a (shop_id, customer_id) composite),
      // and this upsert's onConflict target is that bare customer_id. The
      // ownership check below only ever *read* with a shop_id filter — a
      // caller could still submit another shop's real customer_id, and the
      // upsert would hit that row's PK and attempt to overwrite its
      // shop_id to the caller's own shop, reassigning another shop's real
      // customer loyalty account (balance, tier, lifetime points) to the
      // attacker's shop. RLS may well block that specific write today, but
      // this must not be the only thing standing between one shop's
      // customer data and another's — verify ownership explicitly, the
      // same way every other write in this file does.
      const owner = await client.from("bloom_loyalty_accounts").select("*").eq("customer_id", body.customer_id).maybeSingle();
      if (!owner.error && owner.data && owner.data.shop_id !== shopId) {
        return json(403, { error: "That customer does not belong to this shop." });
      }
      const earned = computeLoyaltyEarn(body.amount, body.tier);
      const prev = owner.error ? null : owner.data;
      const balance = Number(prev?.points_balance || 0) + earned;
      const lifetime = Number(prev?.lifetime_points || 0) + earned;
      const { data, error } = await client
        .from("bloom_loyalty_accounts")
        .upsert(
          {
            shop_id: shopId,
            customer_id: body.customer_id,
            points_balance: balance,
            lifetime_points: lifetime,
            tier: computeLoyaltyTier(balance).id,
            updated_at: new Date().toISOString()
          },
          { onConflict: "customer_id" }
        )
        .select("*")
        .single();
      if (error && !missingTable(error)) throw error;
      return json(200, { account: data, points_earned: earned });
    }

    if (action === "loyalty_redeem") {
      const v = validatePointsRedeem(body.balance, body.points);
      if (!v.valid) return json(400, { error: v.error });
      await client.from("bloom_loyalty_transactions").insert({
        shop_id: shopId,
        customer_id: body.customer_id,
        points: -Number(body.points),
        kind: "redeem"
      });
      return json(200, { remaining: v.remaining });
    }

    if (action === "membership_seed") {
      requireRoles(ctx, ["owner", "manager"]);
      for (const t of MEMBERSHIP_TEMPLATES) {
        await client.from("bloom_membership_plans").upsert(
          { shop_id: shopId, plan_key: t.key, name: t.label, benefits: t.benefits, active: true },
          { onConflict: "shop_id,plan_key" }
        );
      }
      const plans = await safeSelect(client, "bloom_membership_plans", shopId);
      return json(200, { plans });
    }

    if (action === "vendor_create") {
      const { data, error } = await client
        .from("bloom_vendor_profiles")
        .insert({ shop_id: shopId, name: body.name, payment_terms: body.payment_terms || "net_30", supplier_id: body.supplier_id || null })
        .select("*")
        .single();
      if (error) throw error;
      return json(201, { vendor: data });
    }

    if (action === "po_create") {
      const { data, error } = await client
        .from("bloom_purchase_orders")
        .insert({ shop_id: shopId, vendor_id: body.vendor_id || null, status: "draft", total: Number(body.total || 0), notes: body.notes || "" })
        .select("*")
        .single();
      if (error) throw error;
      return json(201, { purchase_order: data });
    }

    if (action === "po_transition") {
      const { data: po } = await client.from("bloom_purchase_orders").select("status").eq("id", body.id).eq("shop_id", shopId).single();
      if (!po || !canTransitionPO(po.status, body.status)) return json(400, { error: "Invalid PO status transition." });
      const { data, error } = await client
        .from("bloom_purchase_orders")
        .update({ status: body.status, updated_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .select("*")
        .single();
      if (error) throw error;
      return json(200, { purchase_order: data });
    }

    if (action === "delivery_update") {
      const payload = {
        shop_id: shopId,
        delivery_id: body.delivery_id || null,
        order_id: body.order_id || null,
        driver: body.driver,
        route_name: body.route_name,
        gps_note: body.gps_note || "GPS integration placeholder",
        status: body.status || "scheduled",
        proof_photo_url: body.proof_photo_url,
        signature_data_url: body.signature_data_url,
        mileage: body.mileage,
        fuel_cost: body.fuel_cost,
        updated_at: new Date().toISOString()
      };
      if (body.id) {
        const { data, error } = await client.from("bloom_delivery_details").update(payload).eq("id", body.id).eq("shop_id", shopId).select("*").single();
        if (error) throw error;
        return json(200, { delivery: data });
      }
      const { data, error } = await client.from("bloom_delivery_details").insert(payload).select("*").single();
      if (error) throw error;
      return json(201, { delivery: data });
    }

    if (action === "portal_preview") {
      const customerId = body.customer_id;
      if (!customerId) return json(400, { error: "customer_id required for portal preview." });
      const [orders, subs, loyalty] = await Promise.all([
        client.from("orders").select("id,order_number,total,status,delivery_date").eq("shop_id", shopId).eq("customer_id", customerId).limit(20),
        client.from("bloom_customer_subscriptions").select("*").eq("shop_id", shopId).eq("customer_id", customerId),
        client.from("bloom_loyalty_accounts").select("*").eq("shop_id", shopId).eq("customer_id", customerId).maybeSingle()
      ]);
      return json(200, {
        portal: {
          orders: orders.data || [],
          subscriptions: subs.error ? [] : subs.data || [],
          loyalty: loyalty.error ? null : loyalty.data,
          capabilities: portalCapabilities()
        }
      });
    }

    if (action === "reports_snapshot") {
      const hub = await buildHub(client, shopId);
      return json(200, { catalog: REPORT_CATALOG, finance: hub.finance_center, subscription_count: hub.flower_subscriptions.items.length });
    }

    return json(400, { error: "Unknown ecosystem action." });
  } catch (error) {
    return fail(error);
  }
}
