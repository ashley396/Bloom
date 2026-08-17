import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Regression test for a real report: the dashboard's "Top Bouquets" cards
 * showed a flower-emoji placeholder instead of a real photo. Root cause
 * was in parseProductImages() (public/launch-polish-core.js) — it only
 * accepted absolute http(s):// URLs, silently dropping any site-relative
 * photo path (e.g. /assets/floral-library/..., what a product gets when
 * added via Floral Library's "Add to shop") — so a product with a real,
 * working local photo still fell back to the emoji everywhere this
 * helper is used, including here.
 */
test("a product with a relative (site-local) photo shows the real image on the dashboard, not the emoji placeholder", async ({ page }) => {
  const product = {
    id: "prod-1",
    name: "Garden Hydrangea Arrangement",
    price: 49.99,
    image_url: "/assets/floral-library/funeral/fn-21-casket-spray-red-white-silver.jpg",
  };

  await mockBackend(page);
  await page.route("**/.netlify/functions/products**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [product] }) }),
  );
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

  const tile = page.locator("#atelierTopBouquets .atelier-bouquet-tile", { hasText: "Garden Hydrangea Arrangement" });
  await expect(tile).toBeVisible();
  await expect(tile.locator("img")).toHaveAttribute("src", product.image_url);
  await expect(tile.locator(".atelier-bouquet-art")).toHaveCount(0); // no emoji-placeholder fallback
});
