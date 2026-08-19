import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * On a brand-new/empty shop, two of the four dashboard KPI cards used to
 * compare today's zero against a synthetic Math.max(1, ...) baseline
 * (never the real zero), producing an alarming red "-100.0% vs last
 * period" badge on day one — even though nothing actually declined.
 * Customer Happiness separately showed a hardcoded "+0.8% vs last month"
 * delta right next to its own "—" (no data) headline value, contradicting
 * itself. Verifies both are gone on an empty account.
 */
test("dashboard never shows a misleading decline badge or a self-contradicting delta on a brand-new shop", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);

  for (const id of ["#kpiRevenueDelta", "#kpiSalesDelta", "#kpiOrdersDelta"]) {
    await expect(page.locator(id)).not.toContainText("-100");
  }
  await expect(page.locator("#kpiRetention")).toHaveText("—");
  await expect(page.locator("#kpiRetentionDelta")).not.toContainText("+0.8%");
});
