import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * The Orders page used to get a SECOND, unstyled search box
 * (.bloom-orders-toolbar / #bloomOrderSearch) injected above the real,
 * properly-styled one (#ordSearch) every time the order board refreshed —
 * a leftover from an early "polish" pass that was never reconciled with
 * the later florisyn-luxury-orders.js search box. Verifies only the real
 * one exists and still works.
 */
test("Orders page has exactly one search box, not a duplicate", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => window.showPage?.("ordersPage"));
  await page.waitForTimeout(500);

  await expect(page.locator("#ordSearch")).toBeVisible();
  await expect(page.locator(".bloom-orders-toolbar")).toHaveCount(0);
  await expect(page.locator("#bloomOrderSearch")).toHaveCount(0);
});
