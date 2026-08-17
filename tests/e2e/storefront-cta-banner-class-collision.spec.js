import { test, expect } from "@playwright/test";
import { buildSiteFromShopProfile } from "../../netlify/functions/_shared/bloom-instant-website.js";
import { resolvePublishedSite } from "../../netlify/functions/_shared/bloom-storefront-core.js";

const SHOP = { id: "shop-1", name: "Rose & Co Florist", slug: "rose-and-co", hours: "Mon-Sat 9am-6pm" };

function buildFixture() {
  const site = buildSiteFromShopProfile(SHOP, { status: "published" });
  // Mirror instant-website.js's own nesting step so the home page's
  // sections (including the cta_banner) actually reach the page.
  const pages = site.pages.map((p) => ({ ...p, sections: p.slug === "home" ? site.sections : [] }));
  const resolved = resolvePublishedSite({ ...site.project, status: "published" }, pages, SHOP, { preview: false });
  return {
    preview: false,
    site: resolved,
    products: [],
    commerce: { online_ordering_enabled: true, stripe_checkout_enabled: false, pay_later_enabled: true, stripe_available: false, payment_modes: ["pay_later"] },
    domain: { host: "rose-and-co.bloom-sites.com", base_url: resolved.base_url, purchased: false, connected: false, status: "bloom_subdomain" },
  };
}

/**
 * storefront/index.html's <body> carries the shared florisyn-atelier-shell
 * class (the whole app's chrome styling), and
 * body.florisyn-atelier-shell .cta is a pill-button gradient meant for
 * actual <button>/<a> CTAs elsewhere in the app — not a section wrapper.
 * The home page's generated cta_banner section used class="sf-section
 * cta", so it picked up that button styling on the whole section,
 * producing an overlapping dark pill with the real "Shop now" button and
 * banner text fighting for the same space. Verifies the banner renders
 * as one clean block with the button visually distinct from the text.
 */
test("storefront home page's CTA banner doesn't collide with the app's global .cta button styling", async ({ page }) => {
  const fixture = buildFixture();
  await page.route("**/.netlify/functions/storefront-public**", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) });
  });
  await page.goto("/storefront/index.html?shop=rose-and-co");

  const banner = page.locator(".sf-cta-banner");
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("section.cta")).toHaveCount(0);

  const bannerBox = await banner.boundingBox();
  const buttonBox = await banner.locator("a.primary").boundingBox();
  // The button must sit fully inside the banner, not overlapping the
  // banner's own text at the same coordinates.
  expect(buttonBox.x).toBeGreaterThanOrEqual(bannerBox.x);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(bannerBox.x + bannerBox.width + 1);
});
