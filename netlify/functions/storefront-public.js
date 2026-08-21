import Stripe from "stripe";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { admin, currentUser, fail } from "./_shared/supabase.js";
import { validateOrderCreateBody, clampText } from "./_shared/validation.js";
import { checkRateLimit } from "./_shared/production.js";
import {
  resolvePublishedSite,
  fallbackSiteFromProfile,
  filterPublicProducts,
  mergeCatalogProducts,
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
  minOrderMet
} from "./_shared/bloom-storefront-commerce.js";
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

async function loadPublicProducts(client, shopId) {
  const legacy = [];
  try {
    const { data, error } = await client.from("products").select("*").eq("shop_id", shopId);
    if (error) throw error;
    (data || []).forEach((p) => {
      legacy.push({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        image_url: p.image_url,
        categories: p.category ? [p.category] : [],
        publish_status: p.active === false ? "draft" : "published",
        sync: { available_online: p.show_online !== false, show_price_online: true }
      });
    });
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
  let catalog = [];
  try {
    const { data, error } = await client.from("bloom_shop_catalog_products").select("*").eq("shop_id", shopId);
    if (error) throw error;
    catalog = data || [];
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
  return mergeCatalogProducts(catalog, legacy);
}

function orderNumber() {
  return `WEB-${Date.now().toString().slice(-8)}`;
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

async function createWebCommerceOrder(client, { shop, bundle, body, event }) {
  const rate = checkRateLimit(event, { key: "storefront_checkout", limit: 30, windowMs: 60_000 });
  if (!rate.allowed) return json(429, { error: "Too many checkout attempts. Please wait a moment." });

  const settings = commerceSettingsFromBundle(bundle, shop);
  if (!settings.online_ordering_enabled) return json(403, { error: "Online ordering is not enabled." });
  if (bundle?.project?.status !== "published") {
    return json(403, { error: "Online ordering available when site is published." });
  }

  const catalog = filterPublicProducts(await loadPublicProducts(client, shop.id));
  const reconciled = reconcileCartLines(body.cart?.lines || [], catalog);
  if (!reconciled.valid) return json(400, { error: reconciled.errors[0] });

  const checkoutValid = validateStorefrontCheckout(body, settings);
  if (!checkoutValid.valid) return json(400, { error: checkoutValid.errors[0] });

  const minOk = minOrderMet(reconciled.subtotal, settings.min_order_amount);
  if (!minOk.ok) return json(400, { error: minOk.error });

  const options = {
    ...(body.options || {}),
    fulfillment: checkoutValid.sanitized.fulfillment,
    delivery_date: checkoutValid.sanitized.delivery_date,
    tax_rate: body.options?.tax_rate ?? shop.tax_rate
  };
  const totals = buildWebOrderTotals(reconciled.lines, shop, options, settings);
  const paymentMode = checkoutValid.sanitized.payment_mode;
  const total = totals.total;
  const { charge } = commerceCheckoutAmount(total, total, paymentMode, settings.deposit_percent);

  const description = reconciled.lines.map((l) => `${l.qty} × ${l.name}`).join("; ");
  const customer = body.customer || {};
  const row = {
    shop_id: shop.id,
    order_number: orderNumber(),
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
    notes: options.delivery_instructions ? clampText(options.delivery_instructions, 1000) : null
  };

  const payload = {
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    subtotal: row.subtotal
  };
  const validation = validateOrderCreateBody(payload);
  if (!validation.valid) return json(400, { error: validation.errors[0] });

  const { data: order, error } = await client.from("orders").insert(row).select("*").single();
  if (error) {
    if (missingTable(error)) return json(503, { error: "Orders table unavailable." });
    throw error;
  }

  await recordStorefrontEvent(client, shop.id, order.id, "web_order_created", {
    payment_mode: paymentMode,
    line_count: reconciled.lines.length
  });

  let checkoutUrl = null;
  let paymentLinkUrl = null;

  if (paymentMode === "pay_now" && charge >= 0.5) {
    if (!process.env.STRIPE_SECRET_KEY) {
      return json(503, { error: "Card payments are not configured for this shop." });
    }
    // Without this check, the Checkout Session below would still be
    // created and the customer would still be able to pay — just with no
    // transfer_data.destination, which means the money settles into
    // Florisyn's own platform Stripe balance instead of this shop's.
    // That's silent and effectively impossible for the florist to notice
    // until they go looking for a payout that never comes, so it's
    // blocked here instead of left to fail invisibly downstream.
    if (!shop.stripe_connect_account_id) {
      return json(409, {
        error: "This shop hasn't finished setting up card payments yet. Please choose pay-at-delivery, or contact the florist directly to arrange payment.",
        code: "stripe_connect_required"
      });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const siteBase = (process.env.SITE_URL || process.env.URL || event.headers?.origin || "").replace(/\/$/, "");
    if (!siteBase) return json(503, { error: "SITE_URL is not configured." });
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

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (!["GET", "POST"].includes(event.httpMethod)) return methodNotAllowed();

  const qs = event.queryStringParameters || {};
  const body = event.httpMethod === "POST" ? bodyOf(event) : {};
  const action = String(qs.action || body.action || "site").toLowerCase();

  try {
    if (action === "robots" && event.httpMethod === "GET") {
      const slug = qs.shop;
      const client = admin();
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
      const client = admin();
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
      const client = admin();
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
      const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
      return json(200, {
        preview,
        site: resolved,
        products,
        commerce: {
          ...commerce,
          stripe_available: stripeConfigured && commerce.stripe_checkout_enabled,
          payment_modes: [
            ...(commerce.stripe_checkout_enabled && stripeConfigured ? ["pay_now"] : []),
            ...(commerce.pay_later_enabled ? ["pay_later"] : [])
          ]
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
      const client = admin();
      const shop = await shopBySlug(client, slug);
      if (!shop) return json(404, { error: "Shop not found." });
      const bundle = await loadWebsiteBundle(client, shop.id);
      return createWebCommerceOrder(client, { shop, bundle, body, event });
    }

    if (action === "preview_token") {
      const ctx = await currentUser(event);
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
}

async function loadShopProfile(client, shopId) {
  const { data, error } = await client.from("shops").select("slug,name").eq("id", shopId).maybeSingle();
  if (error) throw error;
  return data;
}
