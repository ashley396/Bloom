#!/usr/bin/env node
/**
 * Website publish smoke test — validates SEO + checklist pipeline without live DB.
 * Run: node scripts/verify-website-publish-smoke.mjs
 * Optional staging: SITE_URL=https://staging.florisyn.com SHOP_SLUG=demo node scripts/verify-website-publish-smoke.mjs --live
 */

import { buildPublishedSeoBundle, buildPublishedSitemapXml, publishedRobotsTxt } from "../lib/seo/published-site-seo.js";
import { buildPublishChecklist } from "../lib/website-studio/publish-checklist.js";
import { buildWizardPayload, LILY_INTERVIEW_STEPS } from "../lib/website-studio/lily-interview.js";
import { buildDnsInstructions, normalizeDomain } from "../lib/website-studio/domain-verification.js";
import { setPropValue, schemaForSectionType } from "../lib/website-studio/section-props-schema.js";

const shop = {
  name: "Lilies in Bloom",
  slug: "lilies-in-bloom",
  phone: "512-555-0100",
  address: "100 Main St, Austin, TX",
  delivery_radius: "Austin metro",
  hero_image_url: "/assets/demo/hero.jpg"
};

const pages = [
  { slug: "home", title: "Home", visible: true, sections: [{}, {}, {}, {}] },
  { slug: "shop", title: "Shop", visible: true },
  { slug: "contact", title: "Contact", visible: true },
  { slug: "delivery", title: "Delivery", visible: true, content: { radius: "Austin" } }
];

const products = Array.from({ length: 5 }, (_, i) => ({
  id: `p${i}`,
  publish_status: "published",
  sync: { available_online: true },
  primary_image: { url: "/img.jpg", alt: "Bouquet" }
}));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log("=== Florisyn website publish smoke (local) ===\n");

const seo = buildPublishedSeoBundle(shop, pages);
assert(seo.title.includes("Lilies"), "SEO title includes shop name");
assert(seo.meta_description.length <= 160, "Meta description length");
assert(seo.local_business_json_ld["@type"] === "Florist", "Florist JSON-LD");
console.log("✓ SEO bundle:", seo.canonical_url);

const sitemap = buildPublishedSitemapXml(seo.base_url, pages, products);
assert(sitemap.includes("<urlset"), "Sitemap XML");
assert(sitemap.includes("product/p0"), "Product URLs in sitemap");
console.log("✓ Sitemap entries:", pages.length + products.length);

const robots = publishedRobotsTxt({ allowIndex: true, sitemapUrl: `${seo.base_url}/sitemap.xml` });
assert(robots.includes("Sitemap:"), "Robots sitemap line");
console.log("✓ Robots.txt OK");

const checklist = buildPublishChecklist({
  project: { seo_settings: seo, commerce_settings: { online_ordering_enabled: true } },
  pages,
  products,
  shop,
  commerce: { online_ordering_enabled: true }
});
assert(checklist.kpis.readiness_score >= 70, `Readiness ${checklist.kpis.readiness_score}%`);
assert(checklist.kpis.seo_score >= 50, `SEO score ${checklist.kpis.seo_score}%`);
console.log("✓ Launch checklist ready:", checklist.ready, "| readiness", checklist.kpis.readiness_score + "%");

const lily = buildWizardPayload({
  specialty: "Weddings and sympathy",
  audience: "Austin families",
  launch_mode: "wedding_studio",
  occasions: "Wedding, Sympathy, Birthday"
});
assert(lily.launch_mode === "wedding_studio", "Lily wizard launch mode");
assert(LILY_INTERVIEW_STEPS.length >= 5, "Interview steps");
console.log("✓ Lily interview →", lily.launch_mode);

const dns = buildDnsInstructions("www.liliesinbloom.com", shop);
assert(normalizeDomain("https://WWW.Example.COM/") === "example.com", "Domain normalize");
assert(dns.records[0].type === "CNAME", "DNS instructions");
console.log("✓ DNS instructions CNAME →", dns.records[0].value);

const section = setPropValue({ id: "h1", type: "hero", props: {} }, "title", "Fresh flowers daily");
assert(section.props.title === "Fresh flowers daily", "Section prop set");
assert(schemaForSectionType("hero").length >= 3, "Hero schema fields");
console.log("✓ Section inspector schema OK");

const live = process.argv.includes("--live");
if (live) {
  const base = (process.env.SITE_URL || "https://www.florisyn.com").replace(/\/$/, "");
  const slug = process.env.SHOP_SLUG || shop.slug;
  console.log("\n=== Live staging checks ===");
  for (const path of [`/store/${slug}/robots.txt`, `/store/${slug}/sitemap.xml`]) {
    const url = `${base}${path}`;
    try {
      const res = await fetch(url);
      console.log(res.ok ? "✓" : "✗", url, res.status, res.headers.get("content-type") || "");
    } catch (e) {
      console.log("✗", url, e.message);
    }
  }
}

console.log("\n=== All local smoke checks passed ===\n");
