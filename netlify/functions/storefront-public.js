import Stripe from "stripe";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { admin, currentUser, fail } from "./_shared/supabase.js";
import { validateOrderCreateBody, clampText } from "./_shared/validation.js";
import { checkRateLimit } from "./_shared/production.js";
import {
  resolvePublishedSite,
  fallbackSiteFromProfile,
  filterPublicProducts,
  verifyPreviewToken,
  signPreviewToken,
  buildPublishedSitemapXml,
  publishedRobotsTxt,
  resolvePublishedSiteBaseUrl
} from "./_shared/bloom-storefront-core.js";
import {
  mergeCommerceSettings,
  reconcileCartLines,
  validateStorefrontCheckout,
  buildWebOrderTotals,
  commerceCheckoutAmount,
  buildPublicStripeSessionParams,
  newWebCheckoutIdempotencyKey,
  storefrontCommerceHandoff,
  minOrderMet,
  earliestFulfillmentDate,
  generateWebOrderNumber,
  isOrderNumberConflict,
  resolveStorefrontPaymentModes,
  ONLINE_ORDERING_UNAVAILABLE_MESSAGE
} from "./_shared/bloom-storefront-commerce.js";
import { legacyProductIsPublic, loadPublicProducts } from "./_shared/bloom-storefront-products.js";
import {
  generatePaymentLinkToken,
  hashPaymentLinkToken,
  buildSecurePaymentUrl,
  validatePaymentLinkCreate
} from "./_shared/payment-hub-experience.js";
import { buildSiteFromShopProfile } from "./_shared/bloom-instant-website.js";

function missingTable(e) {
  return e?.code === "42P01";
}

async function shopBySlug(client, slug) {
  const { data, error } = await client.from("shops").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data;
}

async function loadWebsiteBundle(client, shopId) {
  try {
    const { data: project, error: projectError } = await client
      .from("bloom_website_projects")
      .select("*")
      .eq("shop_id", shopId)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!project) return null;
    const { data: pages, error: pagesError } = await client
      .from("bloom_website_pages")
      .select("*")
      .eq("shop_id", shopId)
      .eq("project_id", project.id)
      .order("nav_order");
    if (pagesError) throw pagesError;
    return { project, pages: pages || [] };
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

// Phase A-1 / A-1c: the one product reader lives in
// _shared/bloom-storefront-products.js so Website Studio's publish checklist
// counts exactly what this storefront shows. Re-exported for existing callers.
export { legacyProductIsPublic };

// A-1c (2026-09-28): card checkout readiness is a LIVE server-side Stripe
// fact — the shop's connected account must report charges_enabled. A saved
// stripe_connect_account_id alone proves nothing: stripe-connect.js saves it
// the moment the Express account is created, before onboarding finishes.
// Any Stripe error fails closed. Public page loads reuse a result for up to
// 5 minutes per function instance; checkout always asks Stripe fresh.
const CARD_READY_CACHE_MS = 5 * 60_000;
// A Stripe outage must hide pay-now, not stall the storefront page: the
// readiness lookup gets a short timeout, no retries, and a brief failure cache.
const CARD_READY_FAILURE_CACHE_MS = 60_000;
const CARD_READY_STRIPE_OPTIONS = { timeout: 3000, maxNetworkRetries: 0 };

function createCardReadinessCheck(createStripe) {
  const cache = new Map();
  return async function cardPaymentsReady(shop, { fresh = false } = {}) {
    if (!process.env.STRIPE_SECRET_KEY) return { ready: false, reason: "no_key" };
    const accountId = String(shop?.stripe_connect_account_id || "");
    if (!accountId) return { ready: false, reason: "no_account" };
    const cached = cache.get(accountId);
    if (!fresh && cached && Date.now() - cached.at < cached.ttl) return cached.result;
    let result;
    let ttl = CARD_READY_CACHE_MS;
    try {
      const account = await createStripe(process.env.STRIPE_SECRET_KEY, CARD_READY_STRIPE_OPTIONS).accounts.retrieve(accountId);
      result = account?.id === accountId && account.charges_enabled === true
        ? { ready: true, reason: "charges_enabled" }
        : { ready: false, reason: "charges_disabled" };
    } catch {
      result = { ready: false, reason: "stripe_unavailable" };
      ttl = CARD_READY_FAILURE_CACHE_MS;
    }
    cache.set(accountId, { at: Date.now(), ttl, result });
    return result;
  };
}

function commerceSettingsFromBundle(bundle, shop) {
  return mergeCommerceSettings(bundle?.project?.commerce_settings, shop);
}

async function recordStorefrontEvent(client, shopId, orderId, eventType, payload) {
  try {
    await client.from("bloom_storefront_order_events").insert({
      shop_id: shopId,
      order_id: orderId,
      event_type: eventType,
      payload: payload || {}
    });
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}

async function maybeCreatePaymentLink(client, { shopId, order, balance, customerEmail }) {
  if (balance < 0.5) return null;
  const v = validatePaymentLinkCreate({ orderTotal: balance, amountRequested: balance, allowPartial: false });
  if (!v.valid) return null;
  const token = generatePaymentLinkToken();
  const hash = hashPaymentLinkToken(token);
  const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
  const baseUrl = process.env.URL || process.env.SITE_URL || "";
  const url = buildSecurePaymentUrl(baseUrl, token);
  const row = {
    shop_id: shopId,
    order_id: order.id,
    token_hash: hash,
    amount_due: v.amount,
    amount_paid: 0,
    allow_partial: false,
    status: "active",
    expires_at: expiresAt,
    delivery_channels: { email: Boolean(customerEmail) },
    metadata: { source: "storefront_pay_later", customer_email: customerEmail || null }
  };
  const { error } = await client.from("payment_hub_payment_links").insert(row);
  if (error?.code === "42P01") return null;
  if (error) throw error;
  return url;
}

async function createWebCommerceOrder(client, {
  shop,
  bundle,
  body,
  event,
  createStripe = (key, options) => new Stripe(key, options),
  cardPaymentsReady = createCardReadinessCheck(createStripe),
  newOrderNumber = generateWebOrderNumber
}) {
  const rate = checkRateLimit(event, { key: "storefront_checkout", limit: 30, windowMs: 60_000 });
  if (!rate.allowed) return json(429, { error: "Too many checkout attempts. Please wait a moment." });

  const settings = commerceSettingsFromBundle(bundle, shop);
  if (!settings.online_ordering_enabled) return json(403, { error: "Online ordering is not enabled." });
  if (bundle?.project?.status !== "published") {
    return json(403, { error: "Online ordering available when site is published." });
  }

  // A-1c: fail closed BEFORE any work when the shop has no usable payment
  // option (pay-later off and card checkout not actually ready).
  const requestedMode = String(body.payment_mode || "pay_later").toLowerCase();
  // Stripe is only asked when card checkout is enabled for this shop at all.
  const card = settings.stripe_checkout_enabled && (requestedMode === "pay_now" || !settings.pay_later_enabled)
    ? await cardPaymentsReady(shop, { fresh: true })
    : { ready: false, reason: "not_checked" };
  if (!resolveStorefrontPaymentModes(settings, { cardReady: card.ready }).length) {
    return json(403, { error: ONLINE_ORDERING_UNAVAILABLE_MESSAGE, code: "online_ordering_unavailable" });
  }

  const catalog = filterPublicProducts(await loadPublicProducts(client, shop.id));
  const reconciled = reconcileCartLines(body.cart?.lines || [], catalog);
  if (!reconciled.valid) return json(400, { error: reconciled.errors[0] });

  // A-1c: "today" is the shop's own calendar day (shops.timezone).
  const checkoutValid = validateStorefrontCheckout(body, settings, new Date(), { timeZone: shop.timezone });
  if (!checkoutValid.valid) return json(400, { error: checkoutValid.errors[0] });

  const minOk = minOrderMet(reconciled.subtotal, settings.min_order_amount);
  if (!minOk.ok) return json(400, { error: minOk.error });

  const options = {
    ...(body.options || {}),
    fulfillment: checkoutValid.sanitized.fulfillment,
    delivery_date: checkoutValid.sanitized.delivery_date,
    // P1 #7 (2026-09-28): a web buyer never chooses their own tax rate —
    // the shop's configured rate is the only rate a storefront order gets.
    tax_rate: shop.tax_rate
  };
  const totals = buildWebOrderTotals(reconciled.lines, shop, options, settings);
  const paymentMode = checkoutValid.sanitized.payment_mode;
  const total = totals.total;
  const { charge } = commerceCheckoutAmount(total, total, paymentMode, settings.deposit_percent);

  const description = reconciled.lines.map((l) => `${l.qty} × ${l.name}`).join("; ");
  const customer = body.customer || {};

  // A-1b (2026-09-28): check every pay-now precondition BEFORE the order is
  // written. Previously the order row was inserted first, so each 503/409
  // below left an orphan UNPAID "Website" order for a checkout the customer
  // was told had failed.
  const wantsCardNow = paymentMode === "pay_now" && charge >= 0.5;
  let cardSiteBase = "";
  if (wantsCardNow) {
    if (card.reason === "no_key") {
      return json(503, { error: "Card payments are not configured for this shop." });
    }
    if (card.reason === "stripe_unavailable") {
      return json(503, { error: "Card payments are temporarily unavailable. Please choose pay later or try again shortly." });
    }
    // Without a connected account that can accept charges the Checkout
    // Session would either fail after the order was written or settle into
    // Florisyn's own platform balance instead of this shop's.
    if (!card.ready) {
      return json(409, {
        error: "This shop hasn't finished setting up card payments yet. Please choose pay-at-delivery, or contact the florist directly to arrange payment.",
        code: "stripe_connect_required"
      });
    }
    cardSiteBase = (process.env.SITE_URL || process.env.URL || event.headers?.origin || "").replace(/\/$/, "");
    if (!cardSiteBase) return json(503, { error: "SITE_URL is not configured." });
  }
  const row = {
    shop_id: shop.id,
    order_number: null,
    customer_name: clampText(customer.name || checkoutValid.sanitized.customer_name, 120),
    customer_phone: customer.phone || null,
    recipient_name: clampText(customer.recipient_name || customer.name, 120),
    fulfillment: totals.fulfillment,
    delivery_address: options.delivery_address ? clampText(options.delivery_address, 500) : null,
    delivery_date: options.delivery_date,
    status: "NEW",
    subtotal: totals.subtotal,
    tax: totals.tax,
    tax_rate: Number(options.tax_rate || 0),
    delivery_fee: totals.deliveryFee,
    total,
    amount_paid: 0,
    balance_due: total,
    payment_status: "UNPAID",
    order_source: "Website",
    arrangement_description: description,
    card_message: options.card_message ? clampText(options.card_message, 500) : null,
    notes: options.delivery_instructions ? clampText(options.delivery_instructions, 1000) : null,
    // A-1c: orders has no customer_email column; the order's own metadata is
    // the existing schema location (create_order_atomic stores p_order.metadata
    // the same way). Validated below by the shared order contract.
    metadata: {
      source: "storefront",
      ...(String(customer.email || "").trim() ? { customer_email: String(customer.email).trim() } : {})
    }
  };

  // A-1b (2026-09-28): the shared order contract is applied to the SAME
  // server-derived values the row will store. It used to receive only
  // name/phone/subtotal, so its required due/pickup/delivery date always
  // failed and every web order returned 400 ("Choose a due, pickup, or
  // delivery date.") since 2026-07-29.
  const validation = validateOrderCreateBody({
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    customer_email: customer.email || "",
    subtotal: row.subtotal,
    arrangement_description: row.arrangement_description,
    fulfillment: row.fulfillment,
    delivery_date: row.delivery_date,
    delivery_address: row.delivery_address,
    notes: row.notes
  });
  if (!validation.valid) return json(400, { error: validation.errors[0] });

  // A-1c: orders.order_number is globally UNIQUE; a collision leaves no row,
  // so retrying with a fresh number is safe.
  let order = null;
  let error = null;
  for (let attempt = 0; attempt < 3 && !order; attempt += 1) {
    row.order_number = newOrderNumber({ timeZone: shop.timezone });
    const result = await client.from("orders").insert(row).select("*").single();
    order = result.error ? null : result.data;
    error = result.error || null;
    if (error && !isOrderNumberConflict(error)) break;
  }
  if (!order) {
    if (missingTable(error)) return json(503, { error: "Orders table unavailable." });
    if (isOrderNumberConflict(error)) return json(503, { error: "We couldn't save your order just now. Please try again." });
    throw error;
  }

  await recordStorefrontEvent(client, shop.id, order.id, "web_order_created", {
    payment_mode: paymentMode,
    line_count: reconciled.lines.length
  });

  let checkoutUrl = null;
  let paymentLinkUrl = null;

  if (wantsCardNow) {
    const stripe = createStripe(process.env.STRIPE_SECRET_KEY);
    const siteBase = cardSiteBase;
    const idempotencyKey = newWebCheckoutIdempotencyKey();
    const sessionParams = buildPublicStripeSessionParams({
      order,
      shop,
      chargeAmount: charge,
      customerEmail: customer.email,
      idempotencyKey,
      siteBase,
      shopSlug: shop.slug,
      stripeConnectAccountId: shop.stripe_connect_account_id
    });
    const session = await stripe.checkout.sessions.create(sessionParams, { idempotencyKey });
    checkoutUrl = session.url;
    await recordStorefrontEvent(client, shop.id, order.id, "stripe_checkout_started", {
      session_id: session.id,
      amount: charge
    });
  } else if (paymentMode === "pay_later" && settings.auto_payment_link_on_pay_later) {
    paymentLinkUrl = await maybeCreatePaymentLink(client, {
      shopId: shop.id,
      order,
      balance: order.balance_due ?? order.total,
      customerEmail: customer.email
    });
    if (paymentLinkUrl) {
      await recordStorefrontEvent(client, shop.id, order.id, "payment_link_created", { auto: true });
    }
  }

  const handoff = storefrontCommerceHandoff({
    order,
    paymentMode,
    checkoutUrl,
    paymentLinkUrl,
    settings
  });

  return json(201, { order, handoff, commerce: { payment_mode: paymentMode, charge_preview: charge } });
}

/** Test seam — production uses the bound real service-role client and session helper via `handler`. */
export function createStorefrontPublicHandler(deps = {}) {
  const getAdmin = deps.admin || admin;
  const authenticate = deps.currentUser || currentUser;
  const createStripe = deps.createStripe || ((key, options) => new Stripe(key, options));
  const cardPaymentsReady = createCardReadinessCheck(createStripe);
  const newOrderNumber = deps.newOrderNumber || generateWebOrderNumber;

  return async function handler(event) {
    const ready = preflight(event);
    if (ready) return ready;
    if (!["GET", "POST"].includes(event.httpMethod)) return methodNotAllowed();

    const qs = event.queryStringParameters || {};
    const body = event.httpMethod === "POST" ? bodyOf(event) : {};
    const action = String(qs.action || body.action || "site").toLowerCase();

    try {
      if (action === "robots" && event.httpMethod === "GET") {
        const slug = qs.shop;
        const client = getAdmin();
        const shop = slug ? await shopBySlug(client, slug) : null;
        const bundle = shop ? await loadWebsiteBundle(client, shop.id) : null;
        const allow = bundle?.project?.status === "published";
        const baseUrl = shop ? resolvePublishedSiteBaseUrl(shop) : null;
        const sitemapUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/sitemap.xml` : null;
        return {
          statusCode: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
          body: publishedRobotsTxt({ allowIndex: allow, sitemapUrl: allow ? sitemapUrl : null })
        };
      }

      if (action === "sitemap" && event.httpMethod === "GET") {
        const slug = qs.shop;
        if (!slug) return json(400, { error: "shop slug required" });
        const client = getAdmin();
        const shop = await shopBySlug(client, slug);
        if (!shop) return json(404, { error: "Shop not found." });
        const bundle = await loadWebsiteBundle(client, shop.id);
        if (bundle?.project?.status !== "published") return json(403, { error: "Sitemap available when published." });
        const baseUrl = resolvePublishedSiteBaseUrl(shop);
        const pages = bundle?.pages?.length ? bundle.pages : buildSiteFromShopProfile(shop).pages;
        const products = filterPublicProducts(await loadPublicProducts(client, shop.id));
        const xml = buildPublishedSitemapXml(baseUrl, pages, products);
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
          body: xml
        };
      }

      if (event.httpMethod === "GET") {
        const slug = qs.shop;
        if (!slug) return json(400, { error: "shop query parameter required." });
        const client = getAdmin();
        const shop = await shopBySlug(client, slug);
        if (!shop) return json(404, { error: "Shop not found." });

        let preview = false;
        const token = qs.preview_token;
        if (token) {
          const v = verifyPreviewToken(token, shop.id);
          if (!v.valid) return json(403, { error: v.error });
          preview = true;
        }

        let bundle = await loadWebsiteBundle(client, shop.id);
        if (!bundle) {
          const site = fallbackSiteFromProfile(shop);
          bundle = { project: site.project, pages: site.pages };
        }

        const resolved = resolvePublishedSite(bundle.project, bundle.pages, shop, { preview });
        if (!resolved.allowed) return json(404, { error: resolved.error });

        const products = filterPublicProducts(await loadPublicProducts(client, shop.id), {
          collectionSlug: qs.collection || null,
          query: qs.q || ""
        });

        const commerce = commerceSettingsFromBundle(bundle, shop);
        // A-1c: card checkout is offered only when Stripe confirms the shop's
        // connected account can accept charges (see createCardReadinessCheck).
        const card = commerce.stripe_checkout_enabled ? await cardPaymentsReady(shop) : { ready: false };
        const paymentModes = resolveStorefrontPaymentModes(commerce, { cardReady: card.ready });
        const orderingAvailable = commerce.online_ordering_enabled !== false && paymentModes.length > 0;
        return json(200, {
          preview,
          site: resolved,
          products,
          commerce: {
            ...commerce,
            stripe_available: paymentModes.includes("pay_now"),
            payment_modes: paymentModes,
            ordering_available: orderingAvailable,
            unavailable_message: orderingAvailable ? null : ONLINE_ORDERING_UNAVAILABLE_MESSAGE,
            // Shop-local earliest pickup/delivery date (shops.timezone + lead days).
            earliest_date: earliestFulfillmentDate({ leadDays: commerce.delivery_lead_days, timeZone: shop.timezone })
          },
          domain: {
            // Launch-repair: this used to hardcode `${slug}.bloom-sites.com`
            // — a pre-rebrand domain with no real DNS/routing behind it at
            // all (there's no bloom-sites.com redirect anywhere in this
            // project). The site's actual, working temporary address is
            // exactly what `base_url` already resolves to (a florisyn.com
            // path, or the shop's connected custom domain) — derive `host`
            // from that instead of a second, independently-hardcoded string
            // that had drifted out of sync with the real routing.
            host: resolved.base_url ? resolved.base_url.replace(/^https?:\/\//i, "") : null,
            base_url: resolved.base_url,
            purchased: false,
            connected: !!shop.custom_domain,
            status: shop.custom_domain ? "pending_verification" : "bloom_subdomain"
          }
        });
      }

      if (action === "create_web_order" || action === "create_web_checkout") {
        const slug = body.shop_slug || qs.shop;
        if (!slug) return json(400, { error: "shop_slug required." });
        const client = getAdmin();
        const shop = await shopBySlug(client, slug);
        if (!shop) return json(404, { error: "Shop not found." });
        const bundle = await loadWebsiteBundle(client, shop.id);
        // A-1c: awaited so a rejection reaches the catch below (fail() → JSON 500)
        // instead of escaping the handler as an unhandled function error.
        return await createWebCommerceOrder(client, { shop, bundle, body, event, createStripe, cardPaymentsReady, newOrderNumber });
      }

      if (action === "preview_token") {
        const ctx = await authenticate(event);
        const expires = Date.now() + 1000 * 60 * 60 * 2;
        const token = signPreviewToken(ctx.shopId, expires);
        const shop = await loadShopProfile(ctx.client, ctx.shopId);
        return json(200, {
          token,
          expires_at: new Date(expires).toISOString(),
          preview_url: shop?.slug ? `/store/${shop.slug}/?preview_token=${encodeURIComponent(token)}` : null
        });
      }

      return json(400, { error: "Unsupported action." });
    } catch (error) {
      return fail(error);
    }
  };
}

export const handler = createStorefrontPublicHandler();

async function loadShopProfile(client, shopId) {
  const { data, error } = await client.from("shops").select("slug,name").eq("id", shopId).maybeSingle();
  if (error) throw error;
  return data;
}
