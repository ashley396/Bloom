import { test, expect } from "@playwright/test";
import { withFakeSession, mockBackend } from "./fixtures.mjs";

/**
 * Billion-dollar design pass, Phase 5 (Community / Florist Network /
 * Wholesale / Marketing) audit fix.
 *
 * Confirmed bug: the general florist onboarding checklist mounts once at
 * app boot and stays (until dismissed/completed) in #app .content on every
 * page. loadWholesaleSeller() mounts a second, wholesaler-specific
 * checklist banner into that same host when visiting the Seller Dashboard
 * — a real, independent checklist, not a duplicate — but both used the
 * identical "WELCOME TO FLORISYN" eyebrow, so the page showed two
 * back-to-back cards with the same headline, reading as a rendering bug
 * rather than two intentional checklists.
 */
test("Seller Dashboard shows both onboarding checklists, clearly labeled as separate", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
  await page.evaluate(() => window.showPage && window.showPage("wholesaleSellerPage"));
  await page.waitForTimeout(400);

  const banners = page.locator(".bloom-onboarding-banner");
  await expect(banners).toHaveCount(2);

  const eyebrows = await banners.locator(".eyebrow").allTextContents();
  // Both checklists must still be present (nothing removed)...
  expect(eyebrows).toHaveLength(2);
  // ...but must not carry the same headline, so they don't read as a
  // duplicated/rendering-bug pair.
  expect(new Set(eyebrows).size, `both banners must have distinct eyebrow text, got: ${JSON.stringify(eyebrows)}`).toBe(2);

  const wholesalerBanner = page.locator('.bloom-onboarding-banner[data-mode="wholesaler"]');
  const floristBanner = page.locator('.bloom-onboarding-banner[data-mode="florist"]');
  await expect(wholesalerBanner.locator(".eyebrow")).not.toHaveText("WELCOME TO FLORISYN");
  await expect(floristBanner.locator(".eyebrow")).toHaveText("WELCOME TO FLORISYN");

  // The underlying checklists themselves are unchanged — still two real,
  // independently-progressing lists, not merged or dropped.
  await expect(wholesalerBanner).toContainText("Complete wholesale verification");
  await expect(floristBanner).toContainText("Confirm shop name and branding");
});
