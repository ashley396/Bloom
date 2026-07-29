import Stripe from "stripe";
import crypto from "node:crypto";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail, requireRoles } from "./_shared/supabase.js";
import { requireRowShopId } from "./_shared/shop-scope.js";
import { writeShopAudit } from "./_shared/production.js";
import {
  PROVIDER_CATALOG,
  PROVIDER_IDS,
  createProviderAdapter,
  resolveDefaultProvider,
  sanitizeProviderRow
} from "./_shared/payment-hub-providers.js";
import {
  ALL_PAYMENT_METHODS,
  mergeMethodSettings,
  selectCheckoutMethods,
  planSplitPayment,
  planDepositPayment,
  buildTransactionSummary,
  buildGiftCardLiability,
  buildHouseAccountSummary,
  validateGiftCardIssue,
  validateGiftCardRedeem,
  validateHouseAccountCharge,
  routeCheckoutToProvider,
  canManagePaymentHub,
  canConfigureProviders,
  canProcessRefunds,
  WHOLESALE_TERMS
} from "./_shared/payment-hub-core.js";
import {
  SETUP_WIZARD_OPTIONS,
  FUTURE_PAYMENT_RAILS,
  REFUND_REASONS,
  buildProDashboard,
  buildSalesByProcessor,
  buildTipsReport,
  buildHouseAgingReport,
  validateRefundRequest,
  validateGiftCardReload,
  validateWholesaleCredit,
  giftCardQrPayload,
  providerHealthFromStatus
} from "./_shared/payment-hub-pro.js";
import {
  generatePaymentLinkToken,
  hashPaymentLinkToken,
  buildSecurePaymentUrl,
  paymentLinkQrPayload,
  validatePaymentLinkCreate,
  transitionPaymentLinkStatus,
  sanitizeSavedMethodRow,
  validateSavedMethodToken,
  planRecoveryAttempt,
  buildRecurringBillingPlan,
  buildExperienceReports,
  buildRefundAuditEntry,
  experienceSecurityChecklist,
  TERMINAL_CATALOG
} from "./_shared/payment-hub-experience.js";
import { nextDeliveryDate } from "./_shared/business-ecosystem.js";
import { sendPaymentLinkEmail } from "./_shared/notification-email.js";
import { sendPaymentLinkSms, assertSmsConsent } from "./_shared/notification-sms.js";
import { assertSavedMethodOwnership, chargeSavedStripeMethod, sanitizeChargeResultForClient } from "./_shared/payment-saved-charge.js";
import { executeRecurringSubscriptionRun, subscriptionDueForBilling } from "./_shared/recurring-billing-execute.js";
import { runPaymentRecovery, shouldStopRecovery } from "./_shared/payment-recovery-automation.js";
import { adapterImplementsInterface } from "./_shared/payment-hub-providers.js";
import { encryptProviderToken, tokenKeyMaterial } from "./_shared/payment-hub-crypto.js";

const HUB_ROLES = ["owner", "manager", "cashier", "accountant"];

async function loadShop(client, shopId) {
  const { data, error } = await client
    .from("shops")
    .select("id,name,stripe_connect_account_id")
    .eq("id", shopId)
    .single();
  if (error) throw error;
  return data;
}

async function loadProviderRows(client, shopId) {
  const { data, error } = await client.from("payment_hub_providers").select("*").eq("shop_id", shopId);
  if (error) {
    if (error.code === "42P01") return [];
    throw error;
  }
  return data || [];
}

async function loadMethodSettings(client, shopId) {
  const { data, error } = await client.from("payment_hub_method_settings").select("methods").eq("shop_id", shopId).maybeSingle();
  if (error) {
    if (error.code === "42P01") return mergeMethodSettings({});
    throw error;
  }
  return mergeMethodSettings(data?.methods || {});
}

async function loadHubSettings(client, shopId) {
  const { data, error } = await client.from("payment_hub_settings").select("*").eq("shop_id", shopId).maybeSingle();
  if (error) {
    if (error.code === "42P01") return { default_provider_id: null, wholesale_terms: {} };
    throw error;
  }
  return data || { default_provider_id: null, wholesale_terms: {} };
}

async function syncStripeProviderRow(client, shopId, shop, stripeStatus) {
  const payload = {
    shop_id: shopId,
    provider_id: "stripe",
    status: stripeStatus.connected ? "connected" : shop.stripe_connect_account_id ? "pending" : "disconnected",
    mode: stripeStatus.mode === "live" ? "live" : stripeStatus.mode === "test" ? "test" : "unconfigured",
    provider_ref: stripeStatus.provider_ref || shop.stripe_connect_account_id || null,
    coming_soon: false,
    last_sync_at: stripeStatus.last_sync || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const { error } = await client.from("payment_hub_providers").upsert(payload, { onConflict: "shop_id,provider_id" });
  if (error && error.code !== "42P01") throw error;
}

async function buildHubView(ctx, stripe) {
  const { client, shopId } = ctx;
  const shop = await loadShop(client, shopId);
  const rows = await loadProviderRows(client, shopId);
  const methods = await loadMethodSettings(client, shopId);
  const settings = await loadHubSettings(client, shopId);

  const stripeAdapter = createProviderAdapter("stripe", { stripeClient: stripe, shop });
  const stripeStatus = await stripeAdapter.status();

  await syncStripeProviderRow(client, shopId, shop, stripeStatus);

  const connections = PROVIDER_IDS.map((id) => {
    const row = rows.find((r) => r.provider_id === id);
    const catalog = PROVIDER_CATALOG[id];
    if (id === "stripe") {
      return sanitizeProviderRow({
        provider_id: id,
        status: stripeStatus.connected ? "connected" : row?.status || "disconnected",
        mode: stripeStatus.mode || row?.mode || "test",
        is_default: false,
        provider_ref: stripeStatus.provider_ref || shop.stripe_connect_account_id,
        last_sync_at: stripeStatus.last_sync,
        coming_soon: false
      });
    }
    return sanitizeProviderRow({
      provider_id: id,
      status: row?.status || "disconnected",
      mode: catalog?.integrated ? row?.mode || "test" : "coming_soon",
      is_default: Boolean(row?.is_default),
      provider_ref: row?.provider_ref,
      last_sync_at: row?.last_sync_at,
      coming_soon: !catalog?.integrated
    });
  });

  const defaultProvider = resolveDefaultProvider(
    connections.map((c) => ({ ...c, status: c.status })),
    settings.default_provider_id
  );
  for (const c of connections) c.is_default = c.provider_id === defaultProvider;

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { data: payments } = await client
    .from("payments")
    .select("amount,method,payment_method,received_at,created_at,processor,metadata")
    .eq("shop_id", shopId)
    .gte("received_at", since.toISOString())
    .limit(500);

  let pendingPayouts = 0;
  let failedPayments = 0;
  if (stripe && shop.stripe_connect_account_id && defaultProvider === "stripe") {
    try {
      const sync = await createProviderAdapter("stripe", { stripeClient: stripe, shop }).sync();
      pendingPayouts = sync.pending_payouts || 0;
    } catch {
      pendingPayouts = 0;
    }
  }
  failedPayments = (payments || []).filter((p) => Number(p.amount || 0) === 0 || String(p.metadata?.status || "") === "failed").length;

  let giftCards = [];
  let houseAccounts = [];
  try {
    const gc = await client.from("gift_cards").select("balance").eq("shop_id", shopId).eq("active", true);
    if (!gc.error) giftCards = gc.data || [];
    const ha = await client.from("house_accounts").select("*").eq("shop_id", shopId).eq("active", true);
    if (!ha.error) houseAccounts = ha.data || [];
  } catch {
    /* pre-migration */
  }

  const summary = buildTransactionSummary(payments || [], { since: since.toISOString() });
  const connectedIntegrated = connections.some((c) => c.status === "connected" && !c.coming_soon);
  const checkoutMethods = selectCheckoutMethods(methods, {
    defaultProvider,
    processorConfigured: connectedIntegrated,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY)
  });

  const enrichedProviders = await Promise.all(
    connections.map(async (c) => {
      const adapter = createProviderAdapter(c.provider_id, { stripeClient: stripe, shop });
      const health = await adapter.health();
      return {
        ...c,
        health_status: providerHealthFromStatus(health),
        webhook_status: health.webhook_status || "unknown",
        permissions_ok: health.permissions_ok !== false,
        configuration: { charges_enabled: health.charges_enabled, payouts_enabled: health.payouts_enabled }
      };
    })
  );

  let refundsHistory = [];
  try {
    const rr = await client.from("payment_hub_refunds").select("*").eq("shop_id", shopId).order("created_at", { ascending: false }).limit(25);
    if (!rr.error) refundsHistory = rr.data || [];
  } catch {
    refundsHistory = [];
  }

  let setupWizard = settings.setup_wizard || {};
  if (!setupWizard.completed && !setupWizard.skipped) setupWizard.show_wizard = true;

  let paymentLinks = [];
  try {
    const pl = await client.from("payment_hub_payment_links").select("status,amount_due,amount_paid").eq("shop_id", shopId).limit(500);
    if (!pl.error) paymentLinks = pl.data || [];
  } catch {
    paymentLinks = [];
  }

  let activeSubs = [];
  try {
    const sb = await client.from("bloom_customer_subscriptions").select("amount,status").eq("shop_id", shopId);
    if (!sb.error) activeSubs = sb.data || [];
  } catch {
    activeSubs = [];
  }

  const experience_reports = buildExperienceReports({
    payments: payments || [],
    links: paymentLinks,
    refunds: refundsHistory,
    subscriptions: activeSubs
  });

  return {
    version: "1.2-experience",
    providers: enrichedProviders,
    catalog: PROVIDER_CATALOG,
    default_provider: defaultProvider,
    method_settings: methods,
    payment_methods: ALL_PAYMENT_METHODS,
    future_payment_rails: FUTURE_PAYMENT_RAILS,
    checkout_methods: checkoutMethods,
    mode_indicator: stripeStatus.mode || (process.env.STRIPE_SECRET_KEY?.startsWith("sk_live") ? "live" : "test"),
    dashboard: buildProDashboard(summary, { pending_payouts: pendingPayouts, failed_payments: failedPayments }),
    transaction_summary: summary,
    reports: {
      daily_sales: summary.daily_sales,
      refunds: summary.refunds,
      payment_type_breakdown: summary.by_type,
      sales_by_processor: buildSalesByProcessor(payments || []),
      tips: buildTipsReport(payments || []),
      gift_card_liability: buildGiftCardLiability(giftCards),
      house_account_balances: buildHouseAccountSummary(houseAccounts),
      outstanding_balances: houseAccounts.reduce((s, a) => s + Number(a.balance || 0), 0),
      aging: buildHouseAgingReport(houseAccounts, [])
    },
    refunds: { reasons: REFUND_REASONS, history: refundsHistory },
    experience: {
      terminals: TERMINAL_CATALOG,
      reports: experience_reports,
      security: experienceSecurityChecklist()
    },
    setup_wizard: { options: SETUP_WIZARD_OPTIONS, state: setupWizard },
    wholesale_terms: settings.wholesale_terms || { default_term: "net_30", credit_enabled: true },
    wholesale_term_options: WHOLESALE_TERMS
  };
}

function manualMethodLabel(methodKey) {
  const map = {
    cash: "Cash",
    check: "Check",
    gift_card: "Gift Card",
    store_credit: "Store Credit",
    house_account: "House Account",
    purchase_order: "Purchase Order",
    wire_transfer: "Wire Transfer",
    other: "Other"
  };
  return map[methodKey] || null;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (!["GET", "POST", "PATCH"].includes(event.httpMethod)) return methodNotAllowed();

  try {
    const ctx = await currentUser(event);
    requireRoles(ctx, HUB_ROLES);
    if (!canManagePaymentHub(ctx.role)) {
      const e = new Error("You do not have permission to manage the Payment Hub.");
      e.statusCode = 403;
      throw e;
    }

    const { client, shopId, user } = ctx;
    const body = event.httpMethod === "GET" ? {} : bodyOf(event);
    const action = String(body.action || event.queryStringParameters?.action || "hub").toLowerCase();

    let stripe = null;
    if (process.env.STRIPE_SECRET_KEY) {
      stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    }

    if (event.httpMethod === "GET" && (action === "hub" || !body.action)) {
      const hub = await buildHubView(ctx, stripe);
      return json(200, hub);
    }

    if (action === "checkout_methods") {
      const hub = await buildHubView(ctx, stripe);
      return json(200, { checkout_methods: hub.checkout_methods, default_provider: hub.default_provider });
    }

    if (action === "plan_split") {
      return json(200, planSplitPayment(body.total, body.parts || []));
    }

    if (action === "plan_deposit") {
      return json(200, planDepositPayment(body.total, body.deposit));
    }

    if (action === "route_checkout") {
      const provider = routeCheckoutToProvider(body.default_provider, body.method_key);
      return json(200, { provider, method_key: body.method_key });
    }

    if (action === "connect_provider") {
      requireRoles(ctx, ["owner", "manager"]);
      if (!canConfigureProviders(ctx.role)) {
        const e = new Error("Only owners and managers can connect payment providers.");
        e.statusCode = 403;
        throw e;
      }
      const providerId = String(body.provider_id || "");
      if (!PROVIDER_IDS.includes(providerId)) return json(400, { error: "Unknown provider." });
      const shop = await loadShop(client, shopId);
      const adapter = createProviderAdapter(providerId, { stripeClient: stripe, shop });
      const result = await adapter.connect(body);
      if (result.coming_soon) return json(501, result);
      if (!result.ok) return json(400, result);

      const keyMat = tokenKeyMaterial();
      const tokenCipher = body.access_token && keyMat ? encryptProviderToken(body.access_token, keyMat) : null;

      const upsert = {
        shop_id: shopId,
        provider_id: providerId,
        status: result.needs_onboarding ? "pending" : "connected",
        mode: providerId === "stripe" && process.env.STRIPE_SECRET_KEY?.startsWith("sk_live") ? "live" : "test",
        provider_ref: result.provider_ref || shop.stripe_connect_account_id || null,
        token_ciphertext: tokenCipher,
        coming_soon: false,
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const { error } = await client.from("payment_hub_providers").upsert(upsert, { onConflict: "shop_id,provider_id" });
      if (error && error.code !== "42P01") throw error;

      await writeShopAudit(client, {
        shopId,
        userId: user.id,
        eventType: "payment_hub_connect",
        entityType: "payment_provider",
        entityId: providerId,
        metadata: { provider_ref: upsert.provider_ref }
      });

      return json(200, { ...result, provider: sanitizeProviderRow({ ...upsert, status: upsert.status }) });
    }

    if (action === "disconnect_provider") {
      requireRoles(ctx, ["owner", "manager"]);
      const providerId = String(body.provider_id || "");
      if (providerId === "stripe") {
        return json(400, {
          error: "Stripe remains managed via stripe-connect; set another default when additional processors launch."
        });
      }
      const adapter = createProviderAdapter(providerId, {});
      await adapter.disconnect();
      await client
        .from("payment_hub_providers")
        .update({
          status: "disconnected",
          token_ciphertext: null,
          provider_ref: null,
          updated_at: new Date().toISOString()
        })
        .eq("shop_id", shopId)
        .eq("provider_id", providerId);
      return json(200, { ok: true });
    }

    if (action === "set_default_provider") {
      requireRoles(ctx, ["owner", "manager"]);
      const providerId = String(body.provider_id || "");
      if (!PROVIDER_IDS.includes(providerId)) return json(400, { error: "Unknown provider." });
      const catalog = PROVIDER_CATALOG[providerId];
      if (!catalog?.integrated) return json(400, { error: `${catalog.label} is coming soon.` });
      await client.from("payment_hub_providers").update({ is_default: false }).eq("shop_id", shopId);
      await client
        .from("payment_hub_providers")
        .upsert(
          { shop_id: shopId, provider_id: providerId, is_default: true, updated_at: new Date().toISOString() },
          { onConflict: "shop_id,provider_id" }
        );
      await client
        .from("payment_hub_settings")
        .upsert({ shop_id: shopId, default_provider_id: providerId, updated_at: new Date().toISOString() }, { onConflict: "shop_id" });
      return json(200, { default_provider: providerId });
    }

    if (action === "update_payment_methods") {
      requireRoles(ctx, ["owner", "manager"]);
      const methods = mergeMethodSettings(body.methods || {});
      await client
        .from("payment_hub_method_settings")
        .upsert({ shop_id: shopId, methods, updated_at: new Date().toISOString() }, { onConflict: "shop_id" });
      return json(200, { methods });
    }

    if (action === "update_wholesale_terms") {
      requireRoles(ctx, ["owner", "manager"]);
      const wholesale_terms = {
        default_term: WHOLESALE_TERMS.includes(body.default_term) ? body.default_term : "net_30",
        credit_enabled: body.credit_enabled !== false,
        partial_payments: body.partial_payments !== false,
        deposits: body.deposits !== false
      };
      await client
        .from("payment_hub_settings")
        .upsert({ shop_id: shopId, wholesale_terms, updated_at: new Date().toISOString() }, { onConflict: "shop_id" });
      return json(200, { wholesale_terms });
    }

    if (action === "gift_card_issue") {
      const v = validateGiftCardIssue({ amount: body.amount, code: body.code });
      if (!v.valid) return json(400, { errors: v.errors });
      const code = String(body.code).trim().toUpperCase();
      const amount = Math.round(Number(body.amount) * 100) / 100;
      const barcode = giftCardQrPayload(shopId, code);
      const { data: card, error } = await client
        .from("gift_cards")
        .insert({
          shop_id: shopId,
          code,
          initial_amount: amount,
          balance: amount,
          expires_at: body.expires_at || null,
          issued_by: user.id,
          barcode
        })
        .select("*")
        .single();
      if (error) throw error;
      await client.from("gift_card_transactions").insert({
        shop_id: shopId,
        gift_card_id: card.id,
        amount,
        kind: "issue",
        actor_user_id: user.id
      });
      return json(201, { card: { id: card.id, code: card.code, balance: card.balance, expires_at: card.expires_at, barcode: card.barcode || barcode, qr_payload: barcode } });
    }

    if (action === "gift_card_lookup") {
      const code = String(body.code || event.queryStringParameters?.code || "")
        .trim()
        .toUpperCase();
      if (!code) return json(400, { error: "Gift card code required." });
      const { data: card, error } = await client.from("gift_cards").select("*").eq("shop_id", shopId).eq("code", code).maybeSingle();
      if (error) throw error;
      if (!card) return json(404, { error: "Gift card not found." });
      const { data: transactions } = await client
        .from("gift_card_transactions")
        .select("*")
        .eq("gift_card_id", card.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return json(200, { card, transactions: transactions || [] });
    }

    if (action === "gift_card_redeem") {
      const code = String(body.code || "").trim().toUpperCase();
      const amount = Math.round(Number(body.amount || 0) * 100) / 100;
      const { data: card, error } = await client.from("gift_cards").select("*").eq("shop_id", shopId).eq("code", code).maybeSingle();
      if (error) throw error;
      if (!card) return json(404, { error: "Gift card not found." });
      if (card.expires_at && new Date(card.expires_at) < new Date()) return json(400, { error: "Gift card expired." });
      const v = validateGiftCardRedeem({ balance: card.balance, amount });
      if (!v.valid) return json(400, { error: v.error });
      await client.from("gift_cards").update({ balance: v.remaining, updated_at: new Date().toISOString() }).eq("shop_id", shopId).eq("id", card.id);
      await client.from("gift_card_transactions").insert({
        shop_id: shopId,
        gift_card_id: card.id,
        order_id: body.order_id || null,
        amount: -amount,
        kind: "redeem",
        actor_user_id: user.id
      });
      if (body.order_id) {
        await client.rpc("post_order_payment", {
          p_shop_id: shopId,
          p_order_id: body.order_id,
          p_amount: amount,
          p_method: "Gift Card",
          p_idempotency_key: String(body.idempotency_key || crypto.randomUUID()),
          p_actor_user_id: user.id,
          p_processor: "gift_card",
          p_metadata: { gift_card_id: card.id, code }
        });
      }
      return json(200, { applied: amount, remaining: v.remaining, code });
    }

    if (action === "house_account_charge") {
      const accountId = body.house_account_id;
      const amount = Math.round(Number(body.amount || 0) * 100) / 100;
      if (!accountId || amount <= 0) return json(400, { error: "Valid house account and amount required." });
      const { data: account, error } = await client.from("house_accounts").select("*").eq("shop_id", shopId).eq("id", accountId).maybeSingle();
      if (error) throw error;
      if (!account) return json(404, { error: "House account not found." });
      const v = validateHouseAccountCharge({ balance: account.balance, credit_limit: account.credit_limit, amount });
      if (!v.valid) return json(400, { error: v.error });
      await client.from("house_accounts").update({ balance: v.new_balance, updated_at: new Date().toISOString() }).eq("shop_id", shopId).eq("id", accountId);
      await client.from("house_account_transactions").insert({
        shop_id: shopId,
        house_account_id: accountId,
        order_id: body.order_id || null,
        amount,
        kind: "charge",
        actor_user_id: user.id
      });
      if (body.order_id) {
        await client.rpc("post_order_payment", {
          p_shop_id: shopId,
          p_order_id: body.order_id,
          p_amount: amount,
          p_method: "House Account",
          p_idempotency_key: String(body.idempotency_key || crypto.randomUUID()),
          p_actor_user_id: user.id,
          p_processor: "house_account",
          p_metadata: { house_account_id: accountId }
        });
      }
      return json(200, { new_balance: v.new_balance });
    }

    if (action === "split_payment") {
      const plan = planSplitPayment(body.total, body.parts || []);
      if (!plan.valid) return json(400, { error: "Split payment amounts must equal the order total.", plan });
      const results = [];
      for (const part of plan.parts) {
        const processor = routeCheckoutToProvider(body.default_provider, part.method);
        if (processor === "stripe" && ["credit_card", "debit_card", "apple_pay", "google_pay"].includes(part.method)) {
          results.push({ ...part, route: "create-checkout", processor: "stripe" });
          continue;
        }
        const methodLabel = manualMethodLabel(part.method);
        if (methodLabel && body.order_id) {
          await client.rpc("post_order_payment", {
            p_shop_id: shopId,
            p_order_id: body.order_id,
            p_amount: part.amount,
            p_method: methodLabel,
            p_idempotency_key: crypto.randomUUID(),
            p_actor_user_id: user.id,
            p_processor: "manual",
            p_metadata: { split: true, tip: part.tip }
          });
          results.push({ ...part, recorded: true, method: methodLabel });
        } else {
          results.push({ ...part, recorded: false });
        }
      }
      return json(200, { plan, results });
    }

    if (action === "provider_status") {
      const providerId = String(body.provider_id || "stripe");
      const shop = await loadShop(client, shopId);
      const adapter = createProviderAdapter(providerId, { stripeClient: stripe, shop });
      return json(200, await adapter.status());
    }

    if (action === "provider_health") {
      const providerId = String(body.provider_id || "stripe");
      const shop = await loadShop(client, shopId);
      const adapter = createProviderAdapter(providerId, { stripeClient: stripe, shop });
      const health = await adapter.health();
      return json(200, { ...health, interface_ok: adapterImplementsInterface(adapter) });
    }

    if (action === "provider_sync" || action === "reconnect_provider") {
      requireRoles(ctx, ["owner", "manager"]);
      const providerId = String(body.provider_id || "stripe");
      const shop = await loadShop(client, shopId);
      const adapter = createProviderAdapter(providerId, { stripeClient: stripe, shop });
      const result = action === "reconnect_provider" ? await adapter.reconnect(body) : await adapter.sync();
      if (result.coming_soon) return json(501, result);
      await client
        .from("payment_hub_providers")
        .upsert(
          {
            shop_id: shopId,
            provider_id: providerId,
            last_sync_at: result.synced_at || new Date().toISOString(),
            health_status: providerHealthFromStatus(result.status || result),
            updated_at: new Date().toISOString()
          },
          { onConflict: "shop_id,provider_id" }
        );
      return json(200, result);
    }

    if (action === "setup_wizard_complete") {
      requireRoles(ctx, ["owner", "manager"]);
      const choice = String(body.choice || "none");
      const wizard = {
        choice,
        completed: true,
        completed_at: new Date().toISOString(),
        skipped: choice === "none"
      };
      await client
        .from("payment_hub_settings")
        .upsert({ shop_id: shopId, setup_wizard: wizard, updated_at: new Date().toISOString() }, { onConflict: "shop_id" });
      if (choice !== "none" && SETUP_WIZARD_OPTIONS.some((o) => o.id === choice)) {
        return json(200, { wizard, next: choice === "stripe" ? "stripe-connect" : "connect_provider", provider_id: choice });
      }
      return json(200, { wizard });
    }

    if (action === "gift_card_reload") {
      const code = String(body.code || "").trim().toUpperCase();
      const amount = Math.round(Number(body.amount || 0) * 100) / 100;
      const { data: card, error } = await client.from("gift_cards").select("*").eq("shop_id", shopId).eq("code", code).maybeSingle();
      if (error) throw error;
      if (!card) return json(404, { error: "Gift card not found." });
      const v = validateGiftCardReload({ balance: card.balance, amount });
      if (!v.valid) return json(400, { error: v.error });
      await client.from("gift_cards").update({ balance: v.new_balance, updated_at: new Date().toISOString() }).eq("shop_id", shopId).eq("id", card.id);
      await client.from("gift_card_transactions").insert({
        shop_id: shopId,
        gift_card_id: card.id,
        amount,
        kind: "adjust",
        actor_user_id: user.id
      });
      return json(200, { balance: v.new_balance, code });
    }

    if (action === "house_account_create") {
      requireRoles(ctx, ["owner", "manager", "accountant"]);
      const name = String(body.name || "").trim();
      if (!name) return json(400, { error: "Account name required." });
      const credit_limit = Math.max(0, Number(body.credit_limit || 0));
      const payment_term = WHOLESALE_TERMS.includes(body.payment_term) ? body.payment_term : "net_30";
      const { data, error } = await client
        .from("house_accounts")
        .insert({
          shop_id: shopId,
          customer_id: body.customer_id || null,
          name,
          credit_limit,
          wholesale_credit_limit: Number(body.wholesale_credit_limit || credit_limit),
          payment_term,
          balance: 0
        })
        .select("*")
        .single();
      if (error) throw error;
      return json(201, { account: data });
    }

    if (action === "house_account_payment") {
      const accountId = body.house_account_id;
      const amount = Math.round(Number(body.amount || 0) * 100) / 100;
      if (!accountId || amount <= 0) return json(400, { error: "Valid account and payment amount required." });
      const { data: account, error } = await client.from("house_accounts").select("*").eq("shop_id", shopId).eq("id", accountId).maybeSingle();
      if (error) throw error;
      if (!account) return json(404, { error: "House account not found." });
      if (account.suspended_at) return json(400, { error: "Account is suspended." });
      const newBalance = Math.max(0, Math.round((Number(account.balance) - amount) * 100) / 100);
      await client.from("house_accounts").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("shop_id", shopId).eq("id", accountId);
      await client.from("house_account_transactions").insert({
        shop_id: shopId,
        house_account_id: accountId,
        amount: -amount,
        kind: "payment",
        actor_user_id: user.id
      });
      return json(200, { new_balance: newBalance });
    }

    if (action === "house_account_suspend") {
      requireRoles(ctx, ["owner", "manager"]);
      const accountId = body.house_account_id;
      const suspend = body.suspend !== false;
      const { error } = await client
        .from("house_accounts")
        .update({ suspended_at: suspend ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq("shop_id", shopId)
        .eq("id", accountId);
      if (error) throw error;
      return json(200, { suspended: suspend });
    }

    if (action === "house_accounts_list") {
      const { data, error } = await client.from("house_accounts").select("*").eq("shop_id", shopId).order("name");
      if (error) throw error;
      let transactions = [];
      try {
        const tx = await client.from("house_account_transactions").select("*").eq("shop_id", shopId).limit(200);
        if (!tx.error) transactions = tx.data || [];
      } catch {
        transactions = [];
      }
      return json(200, {
        accounts: data || [],
        aging: buildHouseAgingReport(data || [], transactions),
        summary: buildHouseAccountSummary(data || [])
      });
    }

    if (action === "refund_create") {
      if (!canProcessRefunds(ctx.role)) {
        const e = new Error("You do not have permission to issue refunds.");
        e.statusCode = 403;
        throw e;
      }
      const providerId = String(body.provider_id || "stripe");
      const paymentAmount = Number(body.payment_amount || body.amount || 0);
      const v = validateRefundRequest({ amount: body.amount, paymentAmount, partial: body.partial });
      if (!v.valid) return json(400, { error: v.error });
      const shop = await loadShop(client, shopId);
      const adapter = createProviderAdapter(providerId, { stripeClient: stripe, shop });
      let providerResult = { ok: true, provider_ref: body.provider_ref || null };
      if (body.payment_intent_id && providerId === "stripe") {
        providerResult = await adapter.refund({
          paymentIntentId: body.payment_intent_id,
          amount: v.amount,
          reason: body.reason
        });
        if (!providerResult.ok) return json(400, providerResult);
      }
      const row = {
        shop_id: shopId,
        provider_id: providerId,
        payment_id: body.payment_id || null,
        provider_ref: providerResult.refund_id || body.provider_ref,
        amount: v.amount,
        reason: body.reason || "customer_request",
        notes: body.notes || null,
        status: providerResult.ok ? "completed" : "pending",
        partial: v.partial,
        actor_user_id: user.id,
        metadata: { payment_intent_id: body.payment_intent_id || null, notes: body.notes || null }
      };
      const { data: refundRow, error } = await client.from("payment_hub_refunds").insert(row).select("*").single();
      if (error && error.code !== "42P01") throw error;
      await writeShopAudit(client, {
        shopId,
        userId: user.id,
        eventType: "payment_refund",
        entityType: "refund",
        entityId: refundRow?.id || body.payment_id || "refund",
        metadata: buildRefundAuditEntry(refundRow || row, { userId: user.id })
      });
      return json(201, { refund: refundRow || row, provider: providerResult });
    }

    if (action === "refund_void") {
      if (!canProcessRefunds(ctx.role)) {
        const e = new Error("You do not have permission to void refunds.");
        e.statusCode = 403;
        throw e;
      }
      const refundId = body.refund_id;
      const { error } = await client.from("payment_hub_refunds").update({ status: "voided" }).eq("shop_id", shopId).eq("id", refundId);
      if (error) throw error;
      return json(200, { ok: true });
    }

    if (action === "reports_pro") {
      const hub = await buildHubView(ctx, stripe);
      return json(200, { reports: hub.reports, dashboard: hub.dashboard, experience: hub.experience });
    }

    if (action === "reports_experience") {
      const hub = await buildHubView(ctx, stripe);
      return json(200, hub.experience?.reports || {});
    }

    if (action === "terminals_catalog") {
      return json(200, { terminals: TERMINAL_CATALOG });
    }

    if (action === "experience_security") {
      return json(200, experienceSecurityChecklist());
    }

    if (action === "payment_link_create") {
      const orderId = body.order_id;
      if (!orderId) return json(400, { error: "order_id required." });
      const { data: order, error: oErr } = await client
        .from("orders")
        .select("id,total,amount_paid,customer_id,payment_status")
        .eq("shop_id", shopId)
        .eq("id", orderId)
        .maybeSingle();
      if (oErr) throw oErr;
      if (!order) return json(404, { error: "Order not found." });
      const balance = Math.max(0, Number(order.total || 0) - Number(order.amount_paid || 0));
      const v = validatePaymentLinkCreate({
        orderTotal: balance,
        amountRequested: body.amount,
        allowPartial: body.allow_partial !== false
      });
      if (!v.valid) return json(400, { error: v.error });
      const token = generatePaymentLinkToken();
      const hash = hashPaymentLinkToken(token);
      const expiresDays = Number(body.expires_days || 14);
      const expiresAt = new Date(Date.now() + expiresDays * 86400000).toISOString();
      const baseUrl = body.base_url || process.env.URL || "";
      const url = buildSecurePaymentUrl(baseUrl, token);
      const row = {
        shop_id: shopId,
        order_id: orderId,
        customer_id: order.customer_id,
        token_hash: hash,
        amount_due: v.amount,
        amount_paid: 0,
        allow_partial: v.partial || body.allow_partial !== false,
        status: "active",
        expires_at: expiresAt,
        delivery_channels: { email: Boolean(body.email), sms: Boolean(body.sms) },
        metadata: { created_by: user.id, qr: paymentLinkQrPayload(url) }
      };
      const { data: linkRow, error } = await client.from("payment_hub_payment_links").insert(row).select("*").single();
      if (error && error.code === "42P01") return json(503, { error: "Apply payment experience migration to enable links." });
      if (error) throw error;
      await writeShopAudit(client, {
        shopId,
        userId: user.id,
        eventType: "payment_link_created",
        entityType: "order",
        entityId: orderId,
        metadata: { link_id: linkRow?.id, partial: v.partial }
      });
      return json(201, {
        link: linkRow ? { ...linkRow, token_hash: undefined } : null,
        url,
        token,
        qr_payload: paymentLinkQrPayload(url)
      });
    }

    if (action === "payment_link_send") {
      const linkId = body.link_id;
      const url = body.url;
      if (!linkId || !url) return json(400, { error: "link_id and url required." });
      const { data: link } = await client.from("payment_hub_payment_links").select("*").eq("shop_id", shopId).eq("id", linkId).maybeSingle();
      const shop = await loadShop(client, shopId);
      let customer = null;
      if (link?.customer_id) {
        const { data: c } = await client.from("customers").select("name,email,phone,sms_consent").eq("shop_id", shopId).eq("id", link.customer_id).maybeSingle();
        customer = c;
      }
      const delivery = { email: null, sms: null };
      if (body.email) {
        const to = body.email_to || customer?.email;
        delivery.email = await sendPaymentLinkEmail({
          to,
          shopName: shop.name,
          customerName: customer?.name || link?.metadata?.customer_name,
          orderNumber: body.order_number,
          amountDue: Math.max(0, Number(link?.amount_due || 0) - Number(link?.amount_paid || 0)),
          payUrl: url,
          expiresAt: link?.expires_at,
          shopPhone: body.shop_phone,
          shopEmail: body.shop_email
        });
      }
      if (body.sms && customer?.phone) {
        if (assertSmsConsent(customer).allowed) {
          delivery.sms = await sendPaymentLinkSms({
            to: body.sms_to || customer.phone,
            shopName: shop.name,
            amountDue: Math.max(0, Number(link?.amount_due || 0) - Number(link?.amount_paid || 0)),
            payUrl: url
          });
        } else {
          delivery.sms = { ok: false, code: "no_consent", sent: false };
        }
      } else if (body.sms) {
        delivery.sms = { ok: false, code: "provider_not_configured", sent: false };
      }
      await writeShopAudit(client, {
        shopId,
        userId: user.id,
        eventType: "payment_link_sent",
        entityType: "payment_link",
        entityId: linkId,
        metadata: { delivery }
      });
      const messages = [];
      if (delivery.email && !delivery.email.ok) messages.push(`Email: ${delivery.email.code || "failed"}`);
      if (delivery.sms && !delivery.sms.sent && !delivery.sms.ok) messages.push(`SMS: ${delivery.sms.code || "not_sent"}`);
      return json(200, {
        ok: true,
        delivery,
        message: messages.length ? messages.join(" · ") : "Notification dispatched where configured."
      });
    }

    if (action === "payment_link_cancel") {
      const linkId = body.link_id;
      const { error } = await client
        .from("payment_hub_payment_links")
        .update({ status: "canceled", canceled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("shop_id", shopId)
        .eq("id", linkId);
      if (error && error.code !== "42P01") throw error;
      return json(200, { ok: true });
    }

    if (action === "payment_link_list") {
      try {
        const { data, error } = await client
          .from("payment_hub_payment_links")
          .select("id,order_id,status,amount_due,amount_paid,expires_at,viewed_at,paid_at,created_at")
          .eq("shop_id", shopId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        return json(200, { links: data || [] });
      } catch (e) {
        if (e.code === "42P01") return json(200, { links: [] });
        throw e;
      }
    }

    if (action === "saved_methods_list") {
      const customerId = body.customer_id;
      if (!customerId) return json(400, { error: "customer_id required." });
      try {
        const { data, error } = await client
          .from("payment_hub_saved_methods")
          .select("*")
          .eq("shop_id", shopId)
          .eq("customer_id", customerId)
          .order("is_default", { ascending: false });
        if (error) throw error;
        return json(200, { methods: (data || []).map(sanitizeSavedMethodRow) });
      } catch (e) {
        if (e.code === "42P01") return json(200, { methods: [] });
        throw e;
      }
    }

    if (action === "saved_method_save") {
      const v = validateSavedMethodToken(body);
      if (!v.valid) return json(400, { error: v.error });
      if (!body.customer_id) return json(400, { error: "customer_id required." });
      const tokenRef = body.payment_method_id || body.provider_token_ref;
      const row = {
        shop_id: shopId,
        customer_id: body.customer_id,
        provider_id: body.provider_id || "stripe",
        provider_token_ref: tokenRef,
        brand: body.brand || null,
        last4: body.last4 || "****",
        exp_month: body.exp_month || null,
        exp_year: body.exp_year || null,
        is_default: Boolean(body.is_default),
        metadata: { source: "tokenization" }
      };
      if (row.is_default) {
        await client.from("payment_hub_saved_methods").update({ is_default: false }).eq("shop_id", shopId).eq("customer_id", body.customer_id);
      }
      const { data, error } = await client.from("payment_hub_saved_methods").insert(row).select("*").single();
      if (error && error.code === "42P01") return json(503, { error: "Saved methods require migration." });
      if (error) throw error;
      return json(201, { method: sanitizeSavedMethodRow(data) });
    }

    if (action === "saved_method_remove") {
      const methodId = body.method_id;
      const { error } = await client.from("payment_hub_saved_methods").delete().eq("shop_id", shopId).eq("id", methodId);
      if (error && error.code !== "42P01") throw error;
      return json(200, { ok: true });
    }

    if (action === "saved_method_set_default") {
      const methodId = body.method_id;
      const { data: method, error: mErr } = await client
        .from("payment_hub_saved_methods")
        .select("customer_id")
        .eq("shop_id", shopId)
        .eq("id", methodId)
        .maybeSingle();
      if (mErr) throw mErr;
      if (!method) return json(404, { error: "Method not found." });
      await client.from("payment_hub_saved_methods").update({ is_default: false }).eq("shop_id", shopId).eq("customer_id", method.customer_id);
      await client.from("payment_hub_saved_methods").update({ is_default: true }).eq("shop_id", shopId).eq("id", methodId);
      return json(200, { ok: true });
    }

    if (action === "saved_method_charge") {
      requireRoles(ctx, ["owner", "manager", "cashier"]);
      const methodId = body.method_id;
      const orderId = body.order_id;
      const amount = Number(body.amount || 0);
      if (!methodId || !orderId || amount <= 0) return json(400, { error: "method_id, order_id, and amount required." });
      const { data: method, error: mErr } = await client.from("payment_hub_saved_methods").select("*").eq("shop_id", shopId).eq("id", methodId).maybeSingle();
      if (mErr) throw mErr;
      const own = assertSavedMethodOwnership({ method, shopId, customerId: body.customer_id });
      if (!own.ok) return json(403, { error: own.error });
      const shop = await loadShop(client, shopId);
      if (!stripe) return json(503, { error: "Stripe not configured." });
      const charge = await chargeSavedStripeMethod(stripe, {
        shop,
        method,
        amount,
        orderId,
        idempotencyKey: body.idempotency_key || `saved:${methodId}:${orderId}:${amount}`
      });
      if (charge.outcome === "succeeded") {
        await client.rpc("post_order_payment", {
          p_shop_id: shopId,
          p_order_id: orderId,
          p_amount: amount,
          p_method: "Stripe",
          p_idempotency_key: body.idempotency_key || `saved-charge:${charge.intent_id}`,
          p_actor_user_id: user.id,
          p_processor: "stripe",
          p_processor_session_id: null,
          p_processor_payment_intent_id: charge.intent_id,
          p_metadata: { saved_method_id: methodId }
        }).catch(() => {});
      }
      await writeShopAudit(client, {
        shopId,
        userId: user.id,
        eventType: "saved_method_charge",
        entityType: "payment_method",
        entityId: methodId,
        metadata: sanitizeChargeResultForClient(charge)
      });
      return json(charge.outcome === "succeeded" ? 200 : 402, { charge: sanitizeChargeResultForClient(charge) });
    }

    if (action === "payment_recovery_run") {
      const settings = await loadHubSettings(client, shopId);
      const config = settings.recovery_config || {};
      const orderId = body.order_id;
      let order = null;
      let customer = null;
      let link = null;
      if (orderId) {
        const { data: o } = await client.from("orders").select("*").eq("shop_id", shopId).eq("id", orderId).maybeSingle();
        order = o;
        if (o?.customer_id) {
          const { data: c } = await client.from("customers").select("name,email,phone,sms_consent").eq("shop_id", shopId).eq("id", o.customer_id).maybeSingle();
          customer = c;
        }
      }
      if (body.payment_link_id) {
        const { data: l } = await client
          .from("payment_hub_payment_links")
          .select("*")
          .eq("shop_id", shopId)
          .eq("id", body.payment_link_id)
          .maybeSingle();
        link = l;
        if (link) requireRowShopId(link, shopId, "Payment link");
      }
      const stop = shouldStopRecovery({ order, link, subscription: null });
      if (stop.stop) return json(200, { stopped: true, reason: stop.reason });
      const shop = await loadShop(client, shopId);
      const attemptNumber = Number(body.attempt_number || 0);
      const recovery = await runPaymentRecovery({
        client,
        config,
        order,
        customer,
        shop,
        attemptNumber,
        payUrl: body.pay_url,
        link,
        env: process.env
      });
      const row = {
        shop_id: shopId,
        order_id: orderId || null,
        payment_id: body.payment_id || null,
        payment_link_id: body.payment_link_id || null,
        attempt_number: recovery.plan?.attempt || attemptNumber + 1,
        status: recovery.exhausted ? "exhausted" : "sent",
        channel: recovery.results?.channels?.[0]?.channel || "email",
        message: "Payment recovery",
        metadata: recovery
      };
      try {
        await client.from("payment_hub_recovery_attempts").insert(row);
      } catch (e) {
        if (e.code !== "42P01") throw e;
      }
      await writeShopAudit(client, {
        shopId,
        userId: user.id,
        eventType: "payment_recovery",
        entityType: "order",
        entityId: orderId || "unknown",
        metadata: recovery
      });
      return json(200, recovery);
    }

    if (action === "payment_recovery_retry_now") {
      requireRoles(ctx, ["owner", "manager"]);
      body.attempt_number = Number(body.attempt_number || 0);
      const settings = await loadHubSettings(client, shopId);
      const config = settings.recovery_config || {};
      const orderId = body.order_id;
      const { data: order } = await client.from("orders").select("*").eq("shop_id", shopId).eq("id", orderId).maybeSingle();
      let customer = null;
      if (order?.customer_id) {
        const { data: c } = await client.from("customers").select("*").eq("shop_id", shopId).eq("id", order.customer_id).maybeSingle();
        customer = c;
      }
      const shop = await loadShop(client, shopId);
      const recovery = await runPaymentRecovery({
        client,
        config,
        order,
        customer,
        shop,
        attemptNumber: body.attempt_number,
        payUrl: body.pay_url,
        env: process.env
      });
      return json(200, { manual: true, ...recovery });
    }

    if (action === "recurring_billing_process") {
      requireRoles(ctx, ["owner", "manager"]);
      const subId = body.subscription_id;
      let subs = [];
      if (subId) {
        const { data, error } = await client.from("bloom_customer_subscriptions").select("*").eq("shop_id", shopId).eq("id", subId);
        if (error && error.code !== "42P01") throw error;
        subs = data || [];
      } else {
        const { data, error } = await client
          .from("bloom_customer_subscriptions")
          .select("*")
          .eq("shop_id", shopId)
          .eq("status", "active")
          .limit(25);
        if (error && error.code !== "42P01") throw error;
        subs = (data || []).filter((s) => subscriptionDueForBilling(s));
      }
      const shop = await loadShop(client, shopId);
      const settings = await loadHubSettings(client, shopId);
      const results = [];
      for (const sub of subs) {
        const result = await executeRecurringSubscriptionRun({
          client,
          stripe,
          shop,
          sub,
          settings,
          skipIfExists: body.force !== true
        });
        results.push(result);
        await writeShopAudit(client, {
          shopId,
          userId: user.id,
          eventType: "recurring_billing_run",
          entityType: "subscription",
          entityId: sub.id,
          metadata: { outcome: result.outcome, run_key: result.run_key }
        });
      }
      return json(200, { processed: results.length, results });
    }

    return json(400, { error: "Unknown Payment Hub action." });
  } catch (error) {
    return fail(error);
  }
}
