/** Bloom Instant Websites — themes, pages, SEO, domains (RC1 pure). */

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
  const pages = DEFAULT_SITE_PAGES.map((p) => ({
    ...p,
    id: `${p.slug}-v1`,
    visible: p.nav !== false,
    content: defaultPageContent(p, shop)
  }));
  const sections = defaultHomeSections(shop, mode);
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
    seo: buildSeoBundle(shop, pages[0]),
    domain: domainPlaceholder(shop)
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

function defaultHomeSections(shop, mode) {
  return [
    { id: "hero-1", type: "hero", order: 0, props: { title: shop.hero_title || shop.name, subtitle: shop.tagline || "Fresh flowers, delivered with care", image: shop.hero_image_url } },
    { id: "feat-1", type: "featured_arrangements", order: 1, props: { collection: "featured" } },
    { id: "occ-1", type: "occasion_tiles", order: 2, props: { occasions: ["Birthday", "Sympathy", "Wedding", "Plants"] } },
    { id: "about-1", type: "about_florist", order: 3, props: { text: shop.about_text } },
    { id: "hours-1", type: "shop_hours", order: 4, props: { hours: shop.hours || "Mon–Sat 9–6" } },
    { id: "cta-1", type: "cta_banner", order: 5, props: { text: "Order flowers for delivery or pickup", action: "shop" } }
  ];
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
    return { mode: "custom", host: shop.custom_domain, status: "pending_verification", ssl: "pending", dns_instructions: "Add CNAME to Bloom sites host.", purchased: false };
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
  const name = shop.name || "Florist";
  return {
    title: shop.seo_title || `${name} — Local Florist & Delivery`,
    meta_description: shop.seo_description || `Order flowers from ${name}. Delivery and pickup available.`,
    canonical_url: shop.custom_domain ? `https://${shop.custom_domain}` : null,
    og_image: shop.hero_image_url || shop.logo_url,
    local_business_json_ld: {
      "@type": "Florist",
      name,
      telephone: shop.phone,
      address: shop.address
    },
    sitemap: DEFAULT_SITE_PAGES.map((p) => p.slug),
    robots: "index,follow"
  };
}

export function computeWebsiteHealthScore(site = {}, products = []) {
  let score = 100;
  const tips = [];
  if (!site.seo?.meta_description) {
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
