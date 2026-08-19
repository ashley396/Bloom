import { test, expect } from "@playwright/test";
import { mockAdminBackend, withFakeAdminSession } from "./fixtures.mjs";

/**
 * The admin Executive Dashboard's four chart cards (Revenue, New
 * customers, Marketplace orders, Subscription growth) rendered as a bare
 * heading with nothing underneath — not even an empty-state message —
 * whenever there was no chart data yet (a brand-new platform, or a thin
 * API response). Verifies each card now shows a real message instead of
 * silently rendering blank.
 */
test("admin dashboard chart cards show an empty-state message instead of rendering blank", async ({ page }) => {
  await mockAdminBackend(page);
  await withFakeAdminSession(page);
  await page.goto("/admin");
  await expect(page.locator(".charts-grid")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);

  const panels = page.locator(".charts-grid .chart-panel");
  await expect(panels).toHaveCount(4);
  for (const label of ["Revenue", "New customers", "Marketplace orders", "Subscription growth"]) {
    const panel = panels.filter({ hasText: label });
    await expect(panel).not.toBeEmpty();
    await expect(panel.locator(".chart-empty")).toHaveText(/no data/i);
  }
});
