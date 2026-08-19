/**
 * Pre-publish checklist and SEO KPIs for florist websites.
 */

import { resolvePublishedSiteBaseUrl } from "../seo/published-site-seo.js";

const REQUIRED_SLUGS = ["home", "shop", "contact"];

export function buildPublishChecklist({
  project = {},
  pages = [],
  products = [],
  commerce = {},
  shop = {},
  seo = {}
} = {}) {
  const visible = pages.filter((p) => p.visible !== false);
  const publishedProducts = products.filter((p) => p.publish_status !== "draft" && p.sync?.available_online !== false);
  const home = pages.find((p) => p.slug === "home");
  const sections = home?.sections || [];
  const seoBundle = seo?.title ? seo : project?.seo_settings || {};

  const items = [
    check("home_sections", "Home page has content sections", sections.length >= 3, "Add at least three sections on Home."),
    check("shop_page", "Shop page is visible", visible.some((p) => p.slug === "shop"), "Enable the Shop page in navigation."),
    check("contact_info", "Phone or email on file", Boolean(shop.phone || shop.email), "Add phone or email in shop settings."),
    check("delivery_area", "Delivery area described", Boolean(shop.delivery_radius || pages.find((p) => p.slug === "delivery")?.content?.radius), "Describe your delivery area.", true),
    check("products_online", "Products available online", publishedProducts.length >= 3, "Publish at least three products for online ordering."),
    check("product_images", "Product photos with alt text", publishedProducts.filter((p) => p.primary_image?.url && p.primary_image?.alt).length >= 2, "Add alt text to product images for accessibility and SEO.", true),
    check("seo_title", "SEO title configured", Boolean(seoBundle.title && seoBundle.title.length > 10), "Set a descriptive SEO title (shop name + city)."),
    check("seo_description", "Meta description configured", Boolean(seoBundle.meta_description && seoBundle.meta_description.length >= 50), "Write a 50–160 character meta description."),
    check("hero_image", "Hero or logo image", Boolean(shop.hero_image_url || shop.logo_url || sections.some((s) => s.props?.image)), "Add a hero or logo image.", true),
    check("commerce_ready", "Online ordering enabled", commerce.online_ordering_enabled !== false, "Enable online ordering in commerce settings.", true),
    check("legal_pages", "Legal starter pages present", pages.some((p) => p.slug === "privacy"), "Privacy policy page exists (edit before launch).", true)
  ];

  for (const slug of REQUIRED_SLUGS) {
    if (!visible.some((p) => p.slug === slug)) {
      items.push(check(`nav_${slug}`, `${slug} in navigation`, false, `Show the ${slug} page in your site menu.`));
    }
  }

  const passed = items.filter((i) => i.pass).length;
  const required = items.filter((i) => !i.optional);
  const requiredPassed = required.filter((i) => i.pass).length;
  const readinessScore = Math.round((requiredPassed / Math.max(required.length, 1)) * 100);
  const seoScore = scoreSeo(seoBundle, pages, shop);
  const kpis = {
    readiness_score: readinessScore,
    seo_score: seoScore,
    sections_count: sections.length,
    visible_pages: visible.length,
    online_products: publishedProducts.length,
    canonical_base: resolvePublishedSiteBaseUrl(shop)
  };

  return {
    items,
    kpis,
    ready: required.every((i) => i.pass),
    disclaimer: "Scores guide launch quality — they are not search ranking guarantees."
  };
}

function check(id, label, pass, fix, optional = false) {
  return { id, label, pass: !!pass, fix, optional };
}

function scoreSeo(seo, pages, shop) {
  let score = 0;
  if (seo.title?.length > 15) score += 20;
  if (seo.meta_description?.length >= 50) score += 25;
  if (seo.og_image) score += 15;
  if (seo.local_business_json_ld || shop.address) score += 15;
  const withPageSeo = pages.filter((p) => p.content?.seo_title || p.content?.meta_description).length;
  score += Math.min(25, withPageSeo * 5);
  return Math.min(100, score);
}

export function mergePageSeo(page = {}, siteSeo = {}) {
  return {
    seo_title: page.content?.seo_title || "",
    meta_description: page.content?.meta_description || "",
    site_title: siteSeo.title || "",
    site_description: siteSeo.meta_description || ""
  };
}

export function validatePageSeoUpdate({ seo_title = "", meta_description = "" } = {}) {
  const errors = [];
  if (seo_title.length > 70) errors.push("SEO title should be under 70 characters.");
  if (meta_description.length > 160) errors.push("Meta description should be under 160 characters.");
  if (meta_description.length > 0 && meta_description.length < 30) errors.push("Meta description is very short — aim for 50–160 characters.");
  return { valid: errors.length === 0, errors };
}
