import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSiteFromShopProfile } from "../../netlify/functions/_shared/bloom-instant-website.js";
import { resolvePublishedSite } from "../../netlify/functions/_shared/bloom-storefront-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SHOP = {
  id: "shop-1",
  name: "Rose & Co Florist",
  slug: "rose-and-co",
  phone: "(555) 123-4567",
  email: "hello@roseandco.test",
  address: "123 Main St, Austin, TX",
  hours: "Mon-Sat 9am-6pm",
};

function buildFixture() {
  const site = buildSiteFromShopProfile(SHOP, { status: "published" });
  const resolved = resolvePublishedSite({ ...site.project, status: "published" }, site.pages, SHOP, { preview: false });
  return {
    preview: false,
    site: resolved,
    products: [],
    commerce: { online_ordering_enabled: true, stripe_checkout_enabled: false, pay_later_enabled: true, stripe_available: false, payment_modes: ["pay_later"] },
    // Matches the real backend shape post launch-repair: host is derived
    // from base_url (the site's actual routable address), not a separate
    // hardcoded bloom-sites.com string with no DNS/routing behind it.
    domain: { host: resolved.base_url.replace(/^https?:\/\//i, ""), base_url: resolved.base_url, purchased: false, connected: false, status: "bloom_subdomain" },
  };
}

/**
 * The storefront footer used to show "Domain status: Florisyn temporary
 * address — not a purchase confirmation." to real customers — internal
 * infra/debug language with no meaning to a shopper. When the shop failed
 * to load at all, the empty page showed the raw thrown error message
 * (e.g. "Shop not found.") instead of a friendly explanation. Verifies
 * both now show customer-appropriate text.
 */
test("storefront footer shows a normal copyright line, not internal domain-status text", async ({ page }) => {
  const fixture = buildFixture();
  await page.route("**/.netlify/functions/storefront-public**", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) });
  });
  await page.goto("/storefront/index.html?shop=rose-and-co");
  await expect(page.locator("#storefrontFooter")).toBeVisible({ timeout: 10_000 });
  const footerText = await page.locator("#storefrontFooter").textContent();
  expect(footerText).not.toMatch(/domain status/i);
  expect(footerText).not.toMatch(/purchase confirmation/i);
  expect(footerText).toMatch(/©/);
});

test("storefront shows a friendly message, not a raw error string, when the shop fails to load", async ({ page }) => {
  await page.route("**/.netlify/functions/storefront-public**", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Shop not found." }) });
  });
  await page.goto("/storefront/index.html?shop=does-not-exist");
  await expect(page.locator("#main")).toBeVisible({ timeout: 10_000 });
  const mainText = await page.locator("#main").textContent();
  expect(mainText).not.toContain("Shop not found.");
  expect(mainText).toMatch(/trouble|try again|unavailable/i);
});
