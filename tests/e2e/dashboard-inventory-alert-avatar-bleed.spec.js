import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * On mobile, the Dashboard's full-bleed photo "Inventory Alert" banner ran
 * edge to edge right where the floating assistant avatar (.lily-fab, fixed
 * bottom-right) sits, so the avatar visually bled into/over the corner of
 * the banner's own photo. Verifies the banner's right edge stays clear of
 * the avatar's horizontal footprint at a mobile viewport.
 */
test("Inventory Alert banner doesn't run under the floating avatar on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.locator(".atelier-inventory-alert").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  const alertBox = await page.locator(".atelier-inventory-alert").boundingBox();
  const fabBox = await page.locator(".lily-fab").boundingBox();
  expect(alertBox).toBeTruthy();
  expect(fabBox).toBeTruthy();
  // The banner's right edge must not reach into the avatar's left edge.
  expect(alertBox.x + alertBox.width).toBeLessThanOrEqual(fabBox.x);
});
