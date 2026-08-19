import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession, mockAdminBackend, withFakeAdminSession } from "./fixtures.mjs";

/**
 * The admin executive dashboard and the wholesaler seller dashboard both
 * mixed "—" (missing data) and "$0"/"0" (a known zero) in the same row of
 * peer stat cards, for the exact same underlying reason — a thin/missing
 * API response. Both now consistently show "—" only for genuinely
 * missing data, and would show a real "$0"/"0" once the value is known.
 */
test("admin executive dashboard shows a consistent empty state across every KPI card", async ({ page }) => {
  await mockAdminBackend(page);
  await withFakeAdminSession(page);
  await page.goto("/admin");
  await expect(page.locator(".executive-grid")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);

  const values = await page.locator(".executive-grid .metric strong").allTextContents();
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) {
    expect(v.trim()).toBe("—");
  }
});

test("wholesaler dashboard shows a consistent empty state across every KPI card", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => window.showPage?.("wholesaleSellerPage"));
  await expect(page.locator(".wholesale-kpi-row")).toBeVisible();
  await page.waitForTimeout(300);

  const values = await page.locator(".wholesale-kpi-row strong").allTextContents();
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) {
    expect(v.trim()).toBe("—");
  }
});
