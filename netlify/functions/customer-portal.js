import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, admin, fail, requireRoles } from "./_shared/supabase.js";
import { portalCapabilities } from "./_shared/business-ecosystem.js";
import { sanitizeSavedMethodRow, hashPaymentLinkToken } from "./_shared/payment-hub-experience.js";
import {
  resolveCustomerPortalSession,
  assertPortalCustomer,
  generatePortalToken,
  hashPortalToken
} from "./_shared/customer-portal-auth.js";

function missingTable(error) {
  return error?.code === "42P01" || String(error?.message || "").includes("does not exist");
}

async function loadCustomerData(client, shopId, customerId) {
  const [orders, subs, loyalty, invoices, payments, methods, links] = await Promise.all([
    client.from("orders").select("id,order_number,total,status,delivery_date,payment_status,amount_paid,created_at").eq("shop_id", shopId).eq("customer_id", customerId).order("created_at", { ascending: false }).limit(25),
    client.from("bloom_customer_subscriptions").select("*").eq("shop_id", shopId).eq("customer_id", customerId),
    client.from("bloom_loyalty_accounts").select("*").eq("shop_id", shopId).eq("customer_id", customerId).maybeSingle(),
    client.from("invoices").select("id,total,amount_paid,status,due_date,order_id").eq("shop_id", shopId).limit(20),
    client.from("payments").select("id,amount,received_at,method,processor,metadata").eq("shop_id", shopId).order("received_at", { ascending: false }).limit(40),
    client.from("payment_hub_saved_methods").select("*").eq("shop_id", shopId).eq("customer_id", customerId),
    client.from("payment_hub_payment_links").select("id,status,amount_due,amount_paid,expires_at,created_at").eq("shop_id", shopId).eq("customer_id", customerId).in("status", ["active", "viewed", "partially_paid"]).limit(10)
  ]);
  const orderIds = new Set((orders.data || []).map((o) => o.id));
  const paymentHistory = (payments.error ? [] : payments.data || []).filter((p) => {
    const oid = p.metadata?.order_id;
    return !oid || orderIds.has(oid);
  });
  const customerInvoices = (invoices.error ? [] : invoices.data || []).filter((i) => !i.order_id || orderIds.has(i.order_id));
  return {
    orders: orders.data || [],
    subscriptions: subs.error ? [] : subs.data || [],
    loyalty: loyalty.error ? null : loyalty.data,
    invoices: customerInvoices,
    payment_history: paymentHistory.slice(0, 25),
    saved_methods: methods.error ? [] : (methods.data || []).map(sanitizeSavedMethodRow),
    active_payment_links: links.error ? [] : links.data || []
  };
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (!["GET", "POST"].includes(event.httpMethod)) return methodNotAllowed();

  try {
    if (event.httpMethod === "GET") {
      return json(200, {
        capabilities: portalCapabilities(),
        payments_experience: ["invoices", "pay_invoices", "payment_history", "saved_methods", "receipts", "subscriptions"]
      });
    }

    const body = bodyOf(event);
    const action = String(body.action || "preview").toLowerCase();
    const portalToken = body.portal_token || body.customer_portal_token;

    if (action === "issue_portal_token") {
      const ctx = await currentUser(event);
      requireRoles(ctx, ["owner", "manager", "cashier"]);
      const customerId = body.customer_id;
      if (!customerId) return json(400, { error: "customer_id required." });
      const token = generatePortalToken();
      const hash = hashPortalToken(token);
      const expires = new Date(Date.now() + Number(body.ttl_hours || 72) * 3600000).toISOString();
      const { error } = await ctx.client.from("customer_portal_access").insert({
        shop_id: ctx.shopId,
        customer_id: customerId,
        token_hash: hash,
        expires_at: expires
      });
      if (error?.code === "42P01") return json(503, { error: "Apply payments live wiring migration for portal tokens." });
      if (error) throw error;
      return json(201, { portal_token: token, expires_at: expires });
    }

    let scope = null;
    if (portalToken) {
      scope = await resolveCustomerPortalSession(admin(), portalToken);
      if (!scope.ok) return json(401, { error: scope.error });
    } else {
      const ctx = await currentUser(event);
      requireRoles(ctx, ["owner", "manager", "cashier"]);
      scope = { ok: true, shopId: ctx.shopId, customerId: body.customer_id, staffPreview: true, client: ctx.client, user: ctx.user };
      if (!body.customer_id) return json(400, { error: "customer_id or portal_token required." });
    }

    const client = scope.client || admin();
    const shopId = scope.shopId;
    const customerId = scope.customerId;

    if (action === "customer_payments" || action === "preview" || action === "hub") {
      const data = await loadCustomerData(client, shopId, customerId);
      const balanceDue = data.orders.reduce((s, o) => s + Math.max(0, Number(o.total || 0) - Number(o.amount_paid || 0)), 0);
      return json(200, {
        capabilities: portalCapabilities(),
        balance_due: Math.round(balanceDue * 100) / 100,
        ...data,
        receipts_note: "Print or save receipts from payment history.",
        pay_note: "Use active payment links or ask your florist to send a secure link."
      });
    }

    if (action === "remove_saved_method") {
      if (!portalToken && !scope.staffPreview) return json(403, { error: "Forbidden." });
      const check = assertPortalCustomer(scope, body.customer_id || customerId);
      if (!check.ok) return json(403, { error: check.error });
      await client.from("payment_hub_saved_methods").delete().eq("shop_id", shopId).eq("customer_id", customerId).eq("id", body.method_id);
      return json(200, { ok: true });
    }

    if (action === "set_default_method") {
      const check = assertPortalCustomer(scope, body.customer_id || customerId);
      if (!check.ok) return json(403, { error: check.error });
      await client.from("payment_hub_saved_methods").update({ is_default: false }).eq("shop_id", shopId).eq("customer_id", customerId);
      await client.from("payment_hub_saved_methods").update({ is_default: true }).eq("shop_id", shopId).eq("id", body.method_id).eq("customer_id", customerId);
      return json(200, { ok: true });
    }

    if (action === "cancel_flower_subscription") {
      const check = assertPortalCustomer(scope, body.customer_id || customerId);
      if (!check.ok) return json(403, { error: check.error });
      await client
        .from("bloom_customer_subscriptions")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("shop_id", shopId)
        .eq("customer_id", customerId)
        .eq("id", body.subscription_id);
      return json(200, { ok: true });
    }

    if (action === "subscription_update_payment_method") {
      return json(501, { error: "Attach a saved Stripe payment method via florist Payment Hub tokenization, then set as default." });
    }

    return json(400, { error: "Unknown portal action." });
  } catch (error) {
    if (missingTable(error)) return json(503, { error: "Portal payments require database migration." });
    return fail(error);
  }
}
