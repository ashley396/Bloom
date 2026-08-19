import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Lily Step 73: the dashboard's Lily card used to show a static, fabricated
 * "I found new floral ideas that match your inventory" line regardless of
 * real data. It now shows a real "Needs Attention" list built server-side
 * (netlify/functions/dashboard.js + lib/assistants/needs-attention.js) from
 * the exact same numbers that already back Rose's spoken briefing — with an
 * honest empty state when nothing actually needs attention, and each item
 * deep-linking to the real page that resolves it.
 */

test("Needs Attention shows real items with working deep-links, not a fabricated suggestion", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);

  await page.route("**/.netlify/functions/dashboard**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        todaySales: 0, totalSales: 0, totalExpenses: 0, profit: 0,
        unpaidTotal: 42.5, ordersDueToday: 2, deliveriesToday: 0, deliveries: 0,
        lowStock: 3, customers: 0, weekSales: 0, ordersToday: 0, weeklySales: [],
        upcomingDeliveries: [], profitIntelligence: {},
        needsAttention: {
          items: [
            { id: "orders-due", label: "2 orders due today", page: "ordersPage", count: 2 },
            { id: "low-stock", label: "3 low-stock items", page: "inventoryPage", count: 3 },
            { id: "unpaid-balance", label: "$42.50 outstanding", page: "invoicesPage", count: 42.5 }
          ],
          summary: "3 things need a look: 2 orders due today, 3 low-stock items, $42.50 outstanding."
        }
      })
    })
  );

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

  await expect(page.locator("#lilySuggestionGreeting")).toHaveText("Needs Attention");
  await expect(page.locator("#needsAttentionSummary")).toContainText("3 things need a look");
  await expect(page.locator("#needsAttentionSummary")).not.toContainText("I found new floral ideas");

  const actions = page.locator("#needsAttentionActions button");
  await expect(actions).toHaveCount(3);
  await expect(actions.filter({ hasText: "2 orders due today" })).toHaveAttribute("data-page", "ordersPage");
  await expect(actions.filter({ hasText: "3 low-stock items" })).toHaveAttribute("data-page", "inventoryPage");
  await expect(actions.filter({ hasText: "$42.50 outstanding" })).toHaveAttribute("data-page", "invoicesPage");

  await actions.filter({ hasText: "3 low-stock items" }).click();
  await expect(page.locator("#inventoryPage")).toHaveClass(/active/);
});

test("a healthy shop with nothing to flag gets an honest empty state, not a fabricated suggestion", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);

  await page.route("**/.netlify/functions/dashboard**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        todaySales: 0, totalSales: 0, totalExpenses: 0, profit: 0,
        unpaidTotal: 0, ordersDueToday: 0, deliveriesToday: 0, deliveries: 0,
        lowStock: 0, customers: 0, weekSales: 0, ordersToday: 0, weeklySales: [],
        upcomingDeliveries: [], profitIntelligence: {},
        needsAttention: { items: [], summary: "You're all caught up — nothing needs attention right now." }
      })
    })
  );

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

  await expect(page.locator("#needsAttentionSummary")).toHaveText("You're all caught up — nothing needs attention right now.");
  await expect(page.locator("#needsAttentionActions button")).toHaveCount(0);
});
