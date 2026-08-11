/** Bloom RC1.1 — public storefront rendering (pure, testable). */

import crypto from "node:crypto";
import {
  LAUNCH_MODES,
  FONT_PAIRINGS,
  buildSiteFromShopProfile,
  buildSeoBundle,
  tenantIsolationCheck
} from "./bloom-instant-website.js";
import {
  buildPublishedSeoBundle,
  resolvePublishedSiteBaseUrl,
  renderPublishedPageMeta,
  buildPublishedSitemapXml,
  publishedRobotsTxt,
  productJsonLd as publishedProductJsonLd,
} from "../../../lib/seo/published-site-seo.js";
import { productVisibleOnPublicSite } from "./floral-library-core.js";

export { buildPublishedSitemapXml, publishedRobotsTxt, resolvePublishedSiteBaseUrl, tenantIsolationCheck };

export const COLLECTION_SLUGS = [
  "shop",
  "everyday-flowers",
  "birthday",
  "anniversary",
  "romance",
  "sympathy",
  "funeral-flowers",
  "weddings",
  "plants",
  "gifts",
  "seasonal"
];

export function previewTokenSecret(env = process.env) {
  return env.BLOOM_STOREFRONT_PREVIEW_SECRET || env.PAYMENT_HUB_TOKEN_KEY || null;
}

export function signPreviewToken(shopId, expiresAtMs, secret = previewTokenSecret()) {
  if (!secret) throw new Error("Storefront preview is not configured.");
  const payload = `${shopId}:${expiresAtMs}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifyPreviewToken(token, shopId, now = Date.now(), secret = previewTokenSecret()) {
  if (!token) return { valid: false, error: "Preview token required." };
  if (!secret) return { valid: false, error: "Storefront preview is not configured." };
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const [sid, exp, sig] = raw.split(":");
    if (sid !== String(shopId)) return { valid: false, error: "Token shop mismatch." };
    if (Number(exp) < now) return { valid: false, error: "Preview token expired." };
    const expected = crypto.createHmac("sha256", secret).update(`${sid}:${exp}`).digest("hex");
    const actualBuffer = Buffer.from(sig || "", "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
      return { valid: false, error: "Invalid preview token." };
    }
    return { valid: true, mode: "preview" };
  } catch {
    return { valid: false, error: "Malformed preview token." };
  }
}

export function normalizeShopProduct(row = {}) {
  const data = row.data && typeof row.data === "object" ? row.data : row;
  const sync = { ...(data.sync || row.sync || {}) };
  return {
    id: row.id || data.id,
    name: data.name || row.name,
    description: data.description || row.description,
    short_description: data.short_description || row.short_description,
    categories: data.categories || row.categories || [],
    collections: data.collections || row.collections || [],
    primary_image: data.primary_image || row.primary_image || (row.image_url ? { url: row.image_url, alt: row.name } : null),
    retail_price: data.retail_price ?? row.price ?? data.price,
    sync: {
      available_online: sync.available_online !== false,
      available_pos: sync.available_pos !== false,
      show_price_online: sync.show_price_online !== false,
      pickup_eligible: sync.pickup_eligible !== false,
      delivery_eligible: sync.delivery_eligible !== false,
      allow_substitutions: sync.allow_substitutions !== false,
      featured: !!sync.featured,
      seasonal: !!sync.seasonal,
      out_of_stock_behavior: sync.out_of_stock_behavior || "hide"
    },
    publish_status: data.publish_status || row.publish_status || row.status || "draft",
    inventory: data.inventory || row.inventory,
    recipe: data.recipe || row.recipe,
    master_library_id: row.master_library_id || data.master_library_id
  };
}

export function mergeCatalogProducts(shopProducts = [], legacyProducts = []) {
  const byId = new Map();
  for (const p of legacyProducts.map(normalizeShopProduct)) {
    if (p.id) byId.set(String(p.id), p);
  }
  for (const p of shopProducts.map(normalizeShopProduct)) {
    if (p.id) byId.set(String(p.id), { ...byId.get(String(p.id)), ...p });
  }
  return [...byId.values()];
}

export function filterPublicProducts(products, { collectionSlug = null, query = "" } = {}) {
  let list = products.filter((p) => productVisibleOnPublicSite(p));
  if (collectionSlug && collectionSlug !== "shop") {
    const needle = collectionSlug.replace(/-/g, " ").toLowerCase();
    list = list.filter((p) => {
      const cats = (p.categories || []).join(" ").toLowerCase();
      const cols = (p.collections || []).join(" ").toLowerCase();
      return cats.includes(needle) || cols.includes(needle) || slugMatchesCollection(collectionSlug, p);
    });
  }
  const q = query.trim().toLowerCase();
  if (q) {
    list = list.filter((p) => [p.name, p.description, ...(p.categories || [])].join(" ").toLowerCase().includes(q));
  }
  return list;
}

function slugMatchesCollection(slug, product) {
  const map = {
    "everyday-flowers": /everyday/i,
    birthday: /birthday/i,
    anniversary: /anniversary/i,
    romance: /romance|rose/i,
    sympathy: /sympathy/i,
    "funeral-flowers": /funeral|sympathy|spray|wreath/i,
    weddings: /wedding/i,
    plants: /plant|orchid|succulent/i,
    gifts: /gift|balloon|basket/i,
    seasonal: /seasonal|valentine|christmas|easter/i
  };
  const re = map[slug];
  if (!re) return false;
  return re.test((product.categories || []).join(" "));
}

export function resolvePublishedSite(project, pages, shop, { preview = false } = {}) {
  if (!preview && project?.status !== "published") {
    return { allowed: false, error: "Site not published." };
  }
  const mode = LAUNCH_MODES.find((m) => m.id === (project?.theme_id || project?.launch_mode)) || LAUNCH_MODES[0];
  const fonts = FONT_PAIRINGS.find((f) => f.id === project?.theme_settings?.font_pairing) || FONT_PAIRINGS[0];
  const visiblePages = (pages || []).filter((p) => p.visible !== false);
  const baseUrl = resolvePublishedSiteBaseUrl(shop);
  const seo =
    project?.seo_settings && Object.keys(project.seo_settings).length
      ? { ...project.seo_settings, base_url: project.seo_settings.base_url || baseUrl }
      : buildPublishedSeoBundle(shop, visiblePages, { preview });
  if (preview) seo.robots = "noindex,nofollow";
  return {
    allowed: true,
    project,
    theme: { mode, fonts, settings: project?.theme_settings || {} },
    pages: visiblePages,
    seo,
    base_url: baseUrl,
    shop: sanitizePublicShop(shop)
  };
}

function sanitizePublicShop(shop = {}) {
  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    phone: shop.phone,
    email: shop.email,
    address: shop.address || shop.address_line_1,
    hours: shop.hours,
    logo_url: shop.logo_url,
    hero_image_url: shop.hero_image_url,
    about_text: shop.about_text,
    tagline: shop.tagline,
    delivery_radius: shop.delivery_radius,
    default_delivery_fee: shop.default_delivery_fee,
    tax_rate: shop.tax_rate,
    custom_domain: shop.custom_domain,
    domain_status: shop.domain_status || { purchased: false, connected: false }
  };
}

export function fallbackSiteFromProfile(shop = {}) {
  const site = buildSiteFromShopProfile(shop, { status: "draft" });
  return {
    project: { ...site.project, status: "draft" },
    pages: site.pages,
    theme_settings: site.theme_settings,
    seo_settings: site.seo
  };
}

export function renderPageMeta(page, siteSeo, baseUrl) {
  const meta = renderPublishedPageMeta(page, siteSeo, baseUrl || siteSeo?.base_url);
  return {
    title: meta.title,
    description: meta.description,
    canonical: meta.canonical,
    og_image: meta.og?.image || siteSeo?.og_image,
    robots: meta.robots,
    og: meta.og,
    twitter: meta.twitter,
  };
}

export function productJsonLd(product, shop, baseUrl) {
  return publishedProductJsonLd(product, shop, baseUrl || resolvePublishedSiteBaseUrl(shop));
}

export function buildSitemapEntries(baseUrl, pages) {
  const root = baseUrl.replace(/\/$/, "");
  return (pages || [])
    .filter((p) => p.visible !== false && p.slug)
    .map((p) => ({
      loc: p.slug === "home" ? `${root}/` : `${root}/${p.slug}`,
      slug: p.slug
    }));
}

export function robotsTxt({ allowIndex = true, sitemapUrl = null } = {}) {
  if (!allowIndex) return "User-agent: *\nDisallow: /\n";
  const lines = ["User-agent: *", "Allow: /"];
  if (sitemapUrl) lines.push("", `Sitemap: ${sitemapUrl}`);
  return `${lines.join("\n")}\n`;
}

export function breadcrumbTrail(slug, pages) {
  const page = pages?.find((p) => p.slug === slug);
  const crumbs = [{ label: "Home", slug: "home" }];
  if (page && slug !== "home") crumbs.push({ label: page.title, slug: page.slug });
  return crumbs;
}

export function storefrontCartTotals(lines, taxRate = 0, deliveryFee = 0, discount = 0) {
  const subtotal = lines.reduce((s, l) => s + Number(l.price || 0) * Number(l.qty || 1), 0);
  const afterDiscount = Math.max(0, subtotal - Number(discount || 0));
  const tax = Math.round(afterDiscount * (Number(taxRate || 0) / 100) * 100) / 100;
  const total = afterDiscount + tax + Number(deliveryFee || 0);
  return { subtotal, tax, deliveryFee: Number(deliveryFee || 0), discount: Number(discount || 0), total };
}

export function webOrderPayloadFromCart(cart, customer, shop, options = {}) {
  const { subtotal, tax, deliveryFee, total } = storefrontCartTotals(
    cart.lines,
    options.tax_rate ?? shop.tax_rate,
    options.delivery_fee ?? 0,
    options.discount ?? 0
  );
  const description = cart.lines.map((l) => `${l.qty} × ${l.name}`).join("; ");
  return {
    customer_name: customer.name,
    customer_phone: customer.phone || null,
    customer_email: customer.email || null,
    recipient_name: customer.recipient_name || customer.name,
    fulfillment: options.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
    delivery_address: options.delivery_address || null,
    delivery_date: options.delivery_date || new Date().toISOString().slice(0, 10),
    order_source: "Website",
    arrangement_description: description,
    card_message: options.card_message || null,
    notes: options.notes || null,
    subtotal,
    tax_rate: Number(options.tax_rate ?? shop.tax_rate ?? 0),
    tax,
    delivery_fee: deliveryFee,
    discount: Number(options.discount || 0),
    payment_status: "UNPAID",
    amount_paid: Number(options.deposit || 0),
    total_preview: total
  };
}
