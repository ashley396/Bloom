import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * The floating assistant avatar (.lily-fab) is position:fixed, bottom-right
 * — its footprint is (bottom offset + height) tall by (right offset + width)
 * wide. A mobile-only media query (<820px) reserved bottom padding on
 * .content so the fab wouldn't sit on top of real content once scrolled to
 * the bottom of a page, but desktop widths had no such reservation, so on
 * a normal desktop viewport the last row of a scrolled page (e.g. the
 * Inventory page's flower-color filter tabs, or an order card's action
 * row) could end up permanently hidden under the avatar bubble. Verifies
 * .content reserves enough bottom padding to clear the fab's footprint at
 * this suite's desktop viewport width.
 */
test("desktop page content reserves enough bottom padding to clear the floating avatar", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => window.showPage?.("inventoryPage"));
  await page.waitForTimeout(500);

  const fab = page.locator(".lily-fab");
  await expect(fab).toBeVisible();

  const { fabFootprint, contentPaddingBottom } = await page.evaluate(() => {
    const fabEl = document.querySelector(".lily-fab");
    const cs = getComputedStyle(fabEl);
    const footprint = parseFloat(cs.bottom) + fabEl.getBoundingClientRect().height;
    const contentEl = document.querySelector(".content");
    return {
      fabFootprint: footprint,
      contentPaddingBottom: parseFloat(getComputedStyle(contentEl).paddingBottom),
    };
  });

  expect(contentPaddingBottom).toBeGreaterThanOrEqual(fabFootprint);
});
