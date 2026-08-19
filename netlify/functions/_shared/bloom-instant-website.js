/** Bloom Instant Websites — themes, pages, SEO, domains (RC1 pure). */

import { buildPublishedSeoBundle } from "../../../lib/seo/published-site-seo.js";

export const LAUNCH_MODES = [
  { id: "classic_florist", label: "Classic Florist", fontPair: "elegant_serif_sans", palette: ["#faf7f2", "#c9899e", "#3d5c4a"] },
  { id: "luxury_boutique", label: "Luxury Boutique", fontPair: "modern_luxury_serif", palette: ["#fff9f5", "#8f3f68", "#2f2a2c"] },
  { id: "garden_cottage", label: "Garden & Cottage", fontPair: "traditional_florist", palette: ["#f5f8f0", "#9aab8e", "#5c4a3d"] },
  { id: "bright_gift", label: "Bright Gift Shop", fontPair: "clean_contemporary", palette: ["#fffdf8", "#e8a0b5", "#4a667a"] },
  { id: "wedding_studio", label: "Wedding Studio", fontPair: "elegant_serif_sans", palette: ["#fffcfa", "#d4b896", "#6b6166"] },
  { id: "sympathy_memorial", label: "Sympathy & Memorial", fontPair: "elegant_serif_sans", palette: ["#f8f6f4", "#9aab8e", "#4a4a4a"] },
  { id: "modern_minimal", label: "Modern Minimal", fontPair: "clean_contemporary", palette: ["#ffffff", "#2f2a2c", "#c9899e"] },
  { id: "rustic_farmhouse", label: "Rustic Farmhouse", fontPair: "traditional_florist", palette: ["#f7f2ea", "#8b6914", "#3d5c4a"] }
];

export const FONT_PAIRINGS = [
  { id: "elegant_serif_sans", heading: "Cormorant Garamond", body: "Source Sans 3", accent: null },
  { id: "romantic_script_accent", heading: "Cormorant Garamond", body: "Source Sans 3", accent: "Segoe Script" },
  { id: "modern_luxury_serif", heading: "Playfair Display", body: "Inter", accent: null },
  { id: "traditional_florist", heading: "Libre Baskerville", body: "Nunito Sans", accent: null },
  { id: "clean_contemporary", heading: "Inter", body: "Inter", accent: null }
];

export const DEFAULT_SITE_PAGES = [
  { slug: "home", title: "Home", nav: true, template: "home" },
  { slug: "shop", title: "Shop", nav: true, template: "collection" },
  { slug: "everyday-flowers", title: "Everyday Flowers", nav: true, template: "collection" },
  { slug: "birthday", title: "Birthday", nav: true, template: "collection" },
  { slug: "anniversary", title: "Anniversary", nav: true, template: "collection" },
  { slug: "romance", title: "Romance", nav: true, template: "collection" },
  { slug: "sympathy", title: "Sympathy", nav: true, template: "collection" },
  { slug: "funeral-flowers", title: "Funeral Flowers", nav: true, template: "collection" },
  { slug: "weddings", title: "Weddings", nav: true, template: "collection" },
  { slug: "plants", title: "Plants", nav: true, template: "collection" },
  { slug: "gifts", title: "Gifts", nav: true, template: "collection" },
  { slug: "seasonal", title: "Seasonal", nav: true, template: "collection" },
  { slug: "about", title: "About", nav: true, template: "about" },
  { slug: "contact", title: "Contact", nav: true, template: "contact" },
  { slug: "delivery", title: "Delivery Information", nav: true, template: "delivery" },
  { slug: "faq", title: "FAQ", nav: false, template: "faq" },
  { slug: "privacy", title: "Privacy Policy", nav: false, template: "legal", legal_starter: true },
  { slug: "terms", title: "Terms", nav: false, template: "legal", legal_starter: true },
  { slug: "refunds", title: "Refund & Cancellation", nav: false, template: "legal", legal_starter: true },
  { slug: "accessibility", title: "Accessibility", nav: false, template: "legal", legal_starter: true }
];

export const SECTION_TYPES = [
  "hero",
  "featured_arrangements",
  "product_collection",
  "occasion_tiles",
  "sympathy_feature",
  "wedding_feature",
  "seasonal_banner",
  "about_florist",
  "shop_hours",
  "delivery_area",
  "testimonials",
  "map",
  "contact_form",
  "newsletter",
  "instagram",
  "custom_text_image",
  "cta_banner"
];

export function buildSiteFromShopProfile(shop = {}, options = {}) {
  const mode = LAUNCH_MODES.find((m) => m.id === options.launch_mode) || LAUNCH_MODES[0];
  const brief = normalizeFloristWebsiteBrief(options.brief || {});
  const enhancedShop = applyFloristWebsiteBrief(shop, brief);
  const pages = DEFAULT_SITE_PAGES.map((p) => ({
    ...p,
    id: `${p.slug}-v1`,
    visible: p.nav !== false,
    content: defaultPageContent(p, enhancedShop)
  }));
  const sections = defaultHomeSections(enhancedShop, mode, brief);
  return {
    project: {
      shop_id: shop.id,
      launch_mode: mode.id,
      theme_id: mode.id,
      status: options.status || "draft",
      temporary_url: shop.slug ? `${shop.slug}.bloom-sites.com` : null
    },
    theme_settings: {
      palette: mode.palette,
      font_pairing: mode.fontPair,
      corner_radius: options.corner_radius || "soft",
      button_style: "filled"
    },
    pages,
    navigation: pages.filter((p) => p.visible).map((p, i) => ({ page_id: p.id, label: p.title, order: i })),
    sections,
    seo: buildSeoBundle(enhancedShop, pages[0]),
    domain: domainPlaceholder(shop),
    florist_brief: brief
  };
}

export function normalizeFloristWebsiteBrief(brief = {}) {
  const clean = (value, fallback = "") => String(value || fallback).trim().slice(0, 220);
  const split = (value, fallback = []) =>
    String(value || "")
      .split(/[,;\n]/)
      .map((x) => clean(x).slice(0, 48))
      .filter(Boolean)
      .slice(0, 8)
      .concat(fallback)
      .slice(0, 8);
  return {
    style: clean(brief.style, "luxury boutique"),
    audience: clean(brief.audience, "local flower buyers"),
    specialty: clean(brief.specialty, "everyday flowers, sympathy, weddings, and gifts"),
    delivery_area: clean(brief.delivery_area),
    hero_goal: clean(brief.hero_goal, "Make ordering flowers feel simple, elegant, and trustworthy."),
    occasions: split(brief.occasions, ["Birthday", "Sympathy", "Wedding", "Plants"])
  };
}

function applyFloristWebsiteBrief(shop, brief) {
  const specialty = brief.specialty || "fresh flowers";
  return {
    ...shop,
    tagline: shop.tagline || `Elegant ${specialty} for ${brief.audience || "every occasion"}`,
    about_text:
      shop.about_text ||
      `${shop.name || "This florist"} creates ${specialty} with careful design, reliable service, and warm local delivery.`,
    delivery_radius: shop.delivery_radius || brief.delivery_area,
    seo_description:
      shop.seo_description ||
      `Order ${specialty} from ${shop.name || "your local florist"}. ${brief.delivery_area ? `Delivery available in ${brief.delivery_area}.` : "Pickup and delivery available."}`
  };
}

function defaultPageContent(page, shop) {
  const name = shop.name || "Your Florist";
  if (page.template === "legal") {
    return {
      body: `Starter ${page.title} for ${name}. Edit this page with your attorney — not legal advice.`,
      legal_starter: true
    };
  }
  if (page.slug === "about") return { body: shop.about_text || `${name} creates thoughtful floral designs for everyday moments and life's milestones.` };
  if (page.slug === "contact") return { phone: shop.phone, email: shop.email, address: shop.address };
  if (page.slug === "delivery") return { radius: shop.delivery_radius, fee: shop.default_delivery_fee };
  return { intro: `Welcome to ${name}.` };
}

function defaultHomeSections(shop, mode, brief = {}) {
  return [
    { id: "hero-1", type: "hero", order: 0, props: { title: shop.hero_title || shop.name, subtitle: shop.tagline || "Fresh flowers, delivered with care", text: brief.hero_goal, image: shop.hero_image_url } },
    { id: "feat-1", type: "featured_arrangements", order: 1, props: { title: "Signature arrangements", collection: "featured", style: brief.style } },
    { id: "occ-1", type: "occasion_tiles", order: 2, props: { title: "Shop by occasion", occasions: brief.occasions?.length ? brief.occasions : ["Birthday", "Sympathy", "Wedding", "Plants"] } },
    { id: "delivery-1", type: "delivery_area", order: 3, props: { title: "Local delivery", text: shop.delivery_radius ? `Delivering throughout ${shop.delivery_radius}.` : "Add your delivery area so customers know where you serve." } },
    { id: "about-1", type: "about_florist", order: 3, props: { text: shop.about_text } },
    { id: "hours-1", type: "shop_hours", order: 4, props: { hours: shop.hours || "Mon–Sat 9–6" } },
    { id: "cta-1", type: "cta_banner", order: 5, props: { text: "Order flowers for delivery or pickup", action: "shop" } }
  ].map((section, order) => ({ ...section, order }));
}

export function switchThemePreserveContent(site, newModeId) {
  const mode = LAUNCH_MODES.find((m) => m.id === newModeId) || LAUNCH_MODES[0];
  return {
    ...site,
    project: { ...site.project, launch_mode: mode.id, theme_id: mode.id },
    theme_settings: {
      ...site.theme_settings,
      palette: mode.palette,
      font_pairing: mode.fontPair
    }
  };
}

export function reorderSections(sections, fromIndex, toIndex) {
  const list = [...sections].sort((a, b) => a.order - b.order);
  const [item] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, item);
  return list.map((s, i) => ({ ...s, order: i }));
}

export function restorePageVersion(current, versionSnapshot) {
  if (!versionSnapshot?.content) return current;
  return { ...current, content: versionSnapshot.content, sections: versionSnapshot.sections || current.sections };
}

export function domainPlaceholder(shop = {}) {
  if (shop.custom_domain) {
    return { mode: "custom", host: shop.custom_domain, status: "pending_verification", ssl: "pending", dns_instructions: "Add the CNAME provided by Florisyn.", purchased: false };
  }
  return {
    mode: shop.slug ? "bloom_subdomain" : "unset",
    host: shop.slug ? `${shop.slug}.bloom-sites.com` : null,
    status: "active",
    ssl: "active",
    purchased: false,
    provider_integration_required: true
  };
}

export function buildSeoBundle(shop, homePage) {
  const pages = homePage
    ? [{ slug: "home", title: homePage.title || "Home", visible: true, content: homePage.content || {} }]
    : DEFAULT_SITE_PAGES.map((p) => ({ slug: p.slug, title: p.title, visible: p.nav !== false, content: {} }));
  return buildPublishedSeoBundle(shop, pages);
}

export function computeWebsiteHealthScore(site = {}, products = []) {
  let score = 100;
  const tips = [];
  const seo = site.seo || site.seo_settings || {};
  if (!seo.meta_description) {
    score -= 8;
    tips.push("Add a homepage meta description.");
  }
  const sympathy = products.filter((p) => (p.categories || []).some((c) => /sympathy/i.test(c)));
  if (sympathy.length < 4) tips.push("Add at least four sympathy products.");
  if (!site.pages?.find((p) => p.slug === "delivery")?.content?.radius) {
    score -= 6;
    tips.push("Your delivery page is missing a service area.");
  }
  const missingAlt = products.filter((p) => !p.primary_image?.alt).length;
  if (missingAlt) tips.push(`Add alt text to ${missingAlt} product image(s).`);
  return { score: Math.max(0, score), tips, disclaimer: "Health score is guidance only — not a ranking guarantee." };
}

export function lilyWebsiteDraftRequiresApproval(draft) {
  return { canPublish: false, requiresApproval: true, draft_id: draft?.id || null };
}

export function seasonalScheduleValid({ publish_at, remove_at }) {
  if (!publish_at) return { valid: false, error: "Publish date required." };
  if (remove_at && new Date(remove_at) <= new Date(publish_at)) return { valid: false, error: "Removal must be after publish." };
  return { valid: true };
}

export function tenantIsolationCheck(recordShopId, sessionShopId) {
  return String(recordShopId) === String(sessionShopId);
}
