import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * The dashboard's "needs your attention" strip (bloom-rc2.1-founder-polish.js)
 * used to repeat Today's revenue / Orders today / Deliveries — the exact
 * same three numbers already shown one screen higher in the dashboard's own
 * Total Revenue / Orders Today / Deliveries Today KPI cards, in a
 * differently-styled card row right below them. Verifies each of those
 * three no longer appears twice, while the genuinely new information
 * (Pickups due, Inventory alerts, Outstanding) still does.
 */
test("dashboard doesn't show revenue/orders/deliveries twice in two different card styles", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);

  const strip = page.locator(".bloom-command-center");
  await expect(strip).toBeVisible();
  await expect(strip).not.toContainText("Today's revenue");
  await expect(strip).not.toContainText("Orders today");
  await expect(strip.getByText("Deliveries", { exact: true })).toHaveCount(0);

  await expect(strip).toContainText("Pickups due");
  await expect(strip).toContainText("Inventory alerts");
  await expect(strip).toContainText("Outstanding");

  // The top KPI row still has its own Total Revenue / Orders Today /
  // Deliveries Today — this isn't asserting those disappeared, just that
  // the second strip stopped repeating them.
  await expect(page.locator(".atelier-kpi-row")).toContainText("Total Revenue");
});
