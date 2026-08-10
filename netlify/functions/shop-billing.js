import Stripe from "stripe";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail, requireRoles } from "./_shared/supabase.js";
import { writeShopAudit } from "./_shared/production.js";
import {
  PLAN_CATALOG,
  PLAN_ORDER,
  planLabel,
  planPrice,
  upgradeTarget,
  downgradeTarget,
  formatBillingDate,
  subscriptionStatusLabel,
  canManageShopBilling
} from "./_shared/shop-billing.js";
import {
  EXIT_SURVEY_REASONS,
  normalizePlanCode,
  buildCancellationSummary,
  subscriptionEventType
} from "./_shared/subscription-center.js";
import { stripePriceId } from "./_shared/stripe-prices.js";

async function loadSubscription(client, shopId) {
  const { data, error } = await client.from("shop_subscriptions").select("*").eq("shop_id", shopId).maybeSingle();
  if (error) throw error;
  return data || { shop_id: shopId, plan_code: "trial", status: "trialing" };
}

async function logSubscriptionEvent(client, { shopId, userId, eventType, reasonCode, metadata = {} }) {
  try {
    await client.from("shop_subscription_events").insert({
      shop_id: shopId,
      event_type: subscriptionEventType(eventType) || eventType,
      reason_code: reasonCode || null,
      actor_user_id: userId,
      metadata
    });
  } catch {
    /* table may not exist pre-migration */
  }
  await writeShopAudit(client, {
    shopId,
    userId,
    eventType: `subscription_${eventType}`,
    entityType: "subscription",
    entityId: shopId,
    metadata: { reason_code: reasonCode, ...metadata }
  });
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

async function loadBillingHistory(client, shopId, sub, stripe) {
  const eventsRes = await client
    .from("shop_subscription_events")
    .select("event_type,reason_code,created_at,metadata")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(50);
  const events = eventsRes.error ? [] : eventsRes.data || [];

  let invoices = [];
  if (stripe && sub.stripe_customer_id) {
    try {
      const list = await stripe.invoices.list({ customer: sub.stripe_customer_id, limit: 12 });
      invoices = (list.data || []).map((inv) => ({
        id: inv.id,
        number: inv.number,
        amount: (inv.amount_paid || 0) / 100,
        status: inv.status,
        created: inv.created ? new Date(inv.created * 1000).toISOString() : null,
        pdf: inv.invoice_pdf
      }));
    } catch {
      invoices = [];
    }
  }
  return { events, invoices };
}

function buildView(sub, extra = {}) {
  const code = normalizePlanCode(sub.plan_code);
  const upgrade = upgradeTarget(code);
  const downgrade = downgradeTarget(code);
  const cancelSummary = buildCancellationSummary(sub);
  return {
    current_plan: {
      code,
      label: planLabel(code),
      price: planPrice(code),
      price_display: planPrice(code) ? `$${planPrice(code)}/month` : "Free trial"
    },
    next_billing: formatBillingDate(sub.current_period_ends_at || sub.trial_ends_at),
    final_billing_date: formatBillingDate(cancelSummary.final_billing_date),
    access_expiration_date: formatBillingDate(cancelSummary.access_expiration_date),
    status: subscriptionStatusLabel(sub.status, sub.cancel_at_period_end),
    status_raw: sub.status,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    paused: sub.status === "paused",
    can_resume: sub.status === "paused",
    can_reactivate: Boolean(sub.cancel_at_period_end) || sub.status === "canceled",
    has_stripe_customer: Boolean(sub.stripe_customer_id),
    upgrade_plan: upgrade ? { code: upgrade, label: planLabel(upgrade), price: planPrice(upgrade) } : null,
    downgrade_plan: downgrade ? { code: downgrade, label: planLabel(downgrade), price: planPrice(downgrade) } : null,
    plans: PLAN_ORDER.map((c) => ({ ...PLAN_CATALOG[c], current: c === code })),
    cancellation: cancelSummary,
    exit_survey: {
      reasons: EXIT_SURVEY_REASONS,
      pending: Boolean(extra.pending_exit_survey)
    },
    history: extra.history || { events: [], invoices: [] }
  };
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (!["GET", "POST"].includes(event.httpMethod)) return methodNotAllowed();

  try {
    const ctx = await currentUser(event);
    requireRoles(ctx, ["owner", "manager"]);
    const { client, shopId, user, role } = ctx;

    let stripe = null;
    if (process.env.STRIPE_SECRET_KEY) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    if (event.httpMethod === "GET") {
      const sub = await loadSubscription(client, shopId);
      const history = await loadBillingHistory(client, shopId, sub, stripe);
      let pendingSurvey = false;
      try {
        const s = await client
          .from("shop_subscription_exit_surveys")
          .select("id")
          .eq("shop_id", shopId)
          .gte("created_at", new Date(Date.now() - 86400000 * 7).toISOString())
          .limit(1);
        pendingSurvey = sub.cancel_at_period_end && !s.error && !(s.data || []).length;
      } catch {
        pendingSurvey = false;
      }
      return json(200, {
        center: buildView(sub, { history, pending_exit_survey: pendingSurvey }),
        billing: buildView(sub, { history, pending_exit_survey: pendingSurvey }),
        can_manage: canManageShopBilling(role)
      });
    }

    if (!canManageShopBilling(role)) {
      const e = new Error("Only the shop owner can change subscription billing.");
      e.statusCode = 403;
      throw e;
    }

    const body = bodyOf(event);
    const action = String(body.action || "").toLowerCase();
    const sub = await loadSubscription(client, shopId);

    if (action === "pause") {
      const { data, error } = await client
        .from("shop_subscriptions")
        .upsert(
          {
            shop_id: shopId,
            status: "paused",
            paused_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          { onConflict: "shop_id" }
        )
        .select("*")
        .single();
      if (error) throw error;
      await logSubscriptionEvent(client, { shopId, userId: user.id, eventType: "pause" });
      return json(200, { center: buildView(data), message: "Subscription paused. Resume anytime with one click." });
    }

    if (action === "resume") {
      const { data, error } = await client
        .from("shop_subscriptions")
        .upsert(
          {
            shop_id: shopId,
            status: "active",
            paused_at: null,
            updated_at: new Date().toISOString()
          },
          { onConflict: "shop_id" }
        )
        .select("*")
        .single();
      if (error) throw error;
      await logSubscriptionEvent(client, { shopId, userId: user.id, eventType: "resume" });
      return json(200, { center: buildView(data), message: "Subscription resumed." });
    }

    if (action === "cancel") {
      const { data, error } = await client
        .from("shop_subscriptions")
        .upsert(
          {
            shop_id: shopId,
            cancel_at_period_end: true,
            updated_at: new Date().toISOString()
          },
          { onConflict: "shop_id" }
        )
        .select("*")
        .single();
      if (error) throw error;
      if (stripe && sub.stripe_subscription_id) {
        await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
      }
      await logSubscriptionEvent(client, { shopId, userId: user.id, eventType: "cancel" });
      const view = buildView(data, { pending_exit_survey: true });
      return json(200, {
        center: view,
        message: "Subscription canceled.",
        cancellation: view.cancellation,
        show_exit_survey: true
      });
    }

    if (action === "reactivate") {
      const patch = {
        shop_id: shopId,
        status: "active",
        cancel_at_period_end: false,
        reactivated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const { data, error } = await client.from("shop_subscriptions").upsert(patch, { onConflict: "shop_id" }).select("*").single();
      if (error) throw error;
      if (stripe && sub.stripe_subscription_id) {
        await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: false });
      }
      await logSubscriptionEvent(client, { shopId, userId: user.id, eventType: "reactivate" });
      return json(200, { center: buildView(data), message: "Welcome back — your subscription is active again." });
    }

    if (action === "exit_survey") {
      const skipped = body.skip === true;
      try {
        await client.from("shop_subscription_exit_surveys").insert({
          shop_id: shopId,
          reason_code: skipped ? null : body.reason_code || null,
          feedback: body.feedback || null,
          skipped,
          actor_user_id: user.id
        });
      } catch {
        /* pre-migration */
      }
      await logSubscriptionEvent(client, {
        shopId,
        userId: user.id,
        eventType: "cancel",
        reasonCode: body.reason_code,
        metadata: { exit_survey: true, skipped }
      });
      return json(200, { ok: true });
    }

    if (action === "upgrade" || action === "downgrade" || action === "change_plan") {
      const planCode = body.plan_code || (action === "upgrade" ? upgradeTarget(sub.plan_code) : downgradeTarget(sub.plan_code));
      if (!planCode || !PLAN_ORDER.includes(planCode)) {
        return json(400, { error: "That plan change is not available." });
      }
      if (!stripe) return json(503, { error: "Stripe billing is not configured." });
      const interval = body.billing_interval === "annual" ? "annual" : "monthly";
      const price = stripePriceId(planCode, interval);
      if (!price) return json(503, { error: `Stripe price for ${planCode} (${interval}) is not configured.` });
      const site = stripeRedirectBaseUrl();
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: sub.stripe_customer_id || undefined,
        customer_email: sub.stripe_customer_id ? undefined : user.email,
        line_items: [{ price, quantity: 1 }],
        success_url: `${site}/?page=subscriptionPage&subscription=success`,
        cancel_url: `${site}/?page=subscriptionPage&subscription=cancelled`,
        metadata: { bloom_shop_id: String(shopId), plan_code: planCode, billing_interval: interval },
        subscription_data: { metadata: { shop_id: shopId, plan_code: planCode, billing_interval: interval } }
      });
      await logSubscriptionEvent(client, { shopId, userId: user.id, eventType: action, metadata: { plan_code: planCode } });
      return json(200, { url: session.url, plan_code: planCode });
    }

    if (action === "billing_portal" || action === "payment_methods" || action === "invoices") {
      if (!stripe || !sub.stripe_customer_id) {
        return json(400, { error: "No billing profile yet. Choose a paid plan first." });
      }
      const site = stripeRedirectBaseUrl();
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: `${site}/?page=subscriptionPage`
      });
      await logSubscriptionEvent(client, { shopId, userId: user.id, eventType: "portal", metadata: { target: action } });
      return json(200, { url: portal.url });
    }

    if (action === "download_data") {
      const [orders, customers, payments] = await Promise.all([
        client.from("orders").select("id,order_number,customer_name,total,created_at").eq("shop_id", shopId).limit(500),
        client.from("customers").select("id,name,email,phone,created_at").eq("shop_id", shopId).limit(500),
        client.from("payments").select("id,amount,method,received_at").eq("shop_id", shopId).limit(500)
      ]);
      await logSubscriptionEvent(client, { shopId, userId: user.id, eventType: "download_data" });
      return json(200, {
        download: {
          exported_at: new Date().toISOString(),
          shop_id: shopId,
          orders: orders.data || [],
          customers: customers.data || [],
          payments: payments.data || []
        },
        filename: `bloom-shop-export-${shopId.slice(0, 8)}.json`
      });
    }

    return json(400, { error: "Unknown subscription action." });
  } catch (error) {
    return fail(error);
  }
}
