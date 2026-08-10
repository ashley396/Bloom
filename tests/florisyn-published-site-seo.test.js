import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublishedSeoBundle,
  buildPublishedSitemapXml,
  publishedRobotsTxt,
  resolvePublishedSiteBaseUrl,
  productJsonLd
} from "../lib/seo/published-site-seo.js";
import { renderSection, renderSections } from "../lib/storefront/section-renderer.js";
import { buildPublishChecklist, validatePageSeoUpdate } from "../lib/website-studio/publish-checklist.js";

test("resolvePublishedSiteBaseUrl uses florisyn store path", () => {
  const url = resolvePublishedSiteBaseUrl({ slug: "petals" }, { SITE_URL: "https://www.florisyn.com" });
  assert.equal(url, "https://www.florisyn.com/store/petals");
});

test("resolvePublishedSiteBaseUrl prefers connected custom domain", () => {
  const url = resolvePublishedSiteBaseUrl(
    { slug: "petals", custom_domain: "flowers.example.com", domain_status: { connected: true } },
    { SITE_URL: "https://www.florisyn.com" }
  );
  assert.equal(url, "https://flowers.example.com");
});

test("buildPublishedSeoBundle includes florist JSON-LD fields", () => {
  const bundle = buildPublishedSeoBundle(
    { name: "Petals", address: "123 Main, Austin, TX", slug: "petals" },
    [{ slug: "home", visible: true }, { slug: "shop", visible: true }]
  );
  assert.ok(bundle.title.includes("Petals"));
  assert.ok(bundle.meta_description.length <= 160);
  assert.equal(bundle.local_business_json_ld["@type"], "Florist");
  assert.ok(bundle.sitemap.includes("shop"));
});

test("buildPublishedSitemapXml includes products", () => {
  const xml = buildPublishedSitemapXml(
    "https://www.florisyn.com/store/petals",
    [{ slug: "home", visible: true }],
    [{ id: "p1" }]
  );
  assert.match(xml, /<urlset/);
  assert.match(xml, /product\/p1/);
});

test("publishedRobotsTxt includes sitemap line when indexed", () => {
  const txt = publishedRobotsTxt({
    allowIndex: true,
    sitemapUrl: "https://www.florisyn.com/store/petals/sitemap.xml"
  });
  assert.match(txt, /Sitemap:/);
});

test("section renderer covers florist occasion tiles", () => {
  const html = renderSection(
    { type: "occasion_tiles", props: { title: "Occasions", occasions: ["Birthday", "Sympathy"] } },
    { shop: "petals" }
  );
  assert.match(html, /Birthday/);
  assert.match(html, /\/store\/petals\/sympathy/);
});

test("renderSections skips hidden blocks", () => {
  const html = renderSections(
    [
      { type: "hero", order: 0, props: { title: "Hi" } },
      { type: "cta_banner", order: 1, hidden: true, props: { text: "Hidden" } }
    ],
    { shop: "petals" }
  );
  assert.match(html, /Hi/);
  assert.doesNotMatch(html, /Hidden/);
});

test("productJsonLd emits offer url", () => {
  const ld = productJsonLd(
    { id: "r1", name: "Roses", retail_price: 59, sync: { show_price_online: true } },
    { name: "Petals" },
    "https://www.florisyn.com/store/petals"
  );
  assert.equal(ld.offers.url, "https://www.florisyn.com/store/petals/product/r1");
});

test("publish checklist scores readiness", () => {
  const result = buildPublishChecklist({
    project: { seo_settings: { title: "Petals — Florist in Austin | Delivery", meta_description: "x".repeat(55) } },
    pages: [
      { slug: "home", visible: true, sections: [{}, {}, {}] },
      { slug: "shop", visible: true },
      { slug: "contact", visible: true }
    ],
    products: [{ publish_status: "published", sync: { available_online: true } }, {}, {}],
    shop: { phone: "512-555-0100", name: "Petals" },
    commerce: { online_ordering_enabled: true }
  });
  assert.ok(result.kpis.readiness_score >= 50);
  assert.ok(result.kpis.seo_score >= 40);
});

test("validatePageSeoUpdate rejects long meta", () => {
  const v = validatePageSeoUpdate({ meta_description: "x".repeat(200) });
  assert.equal(v.valid, false);
});
