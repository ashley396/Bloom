import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Marketing Step 87 (part 2): the Calendar aggregates real dated events
 * from campaigns/promotions/holiday peaks (lazy-loaded, read-only — no
 * second scheduling system), and Analytics shows only real counts,
 * explicitly refusing to fabricate revenue/ROI it can't actually compute.
 */

test("Calendar groups real events by month and only loads once the tab is opened", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  await withFakeSession(page);

  let calendarRequested = false;
  await page.route("**/.netlify/functions/marketing-campaigns**", async (route) => {
    const url = route.request().url();
    if (url.includes("action=calendar")) {
      calendarRequested = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            { date: "2027-05-01", type: "campaign", label: "Mother's Day", sublabel: "active", edge: "start" },
            { date: "2027-05-09", type: "campaign", label: "Mother's Day", sublabel: "active", edge: "end" },
          ],
          months: [
            {
              month: "2027-05",
              items: [
                { date: "2027-05-01", type: "campaign", label: "Mother's Day", sublabel: "active", edge: "start" },
                { date: "2027-05-09", type: "campaign", label: "Mother's Day", sublabel: "active", edge: "end" },
              ],
            },
          ],
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="marketingPage"]').click();

  expect(calendarRequested).toBe(false);

  await page.locator('[data-marketing-tab="calendar"]').click();
  await expect(page.locator(".marketing-calendar-month")).toContainText("May 2027");
  await expect(page.locator(".marketing-calendar-list")).toContainText("Mother's Day (starts)");
  await expect(page.locator(".marketing-calendar-list")).toContainText("Mother's Day (ends)");
  expect(calendarRequested).toBe(true);

  expect(consoleErrors).toEqual([]);
});

test("Analytics shows only real counts and explicitly states revenue attribution isn't available", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);

  await page.route("**/.netlify/functions/marketing-campaigns**", async (route) => {
    const url = route.request().url();
    if (url.includes("action=analytics")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          campaignsTotal: 5,
          campaignsByStatus: { draft: 1, ready: 0, scheduled: 1, active: 2, completed: 1, paused: 0 },
          promotionsTotal: 3,
          promotionsByStatus: { draft: 1, active: 1, ended: 1 },
          holidayPeaksTotal: 2,
          subscriberCount: 27,
          attributionAvailable: false,
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="marketingPage"]').click();
  await page.locator('[data-marketing-tab="analytics"]').click();

  await expect(page.locator("#marketingRoot")).toContainText("5"); // campaigns total
  await expect(page.locator("#marketingRoot")).toContainText("27"); // subscribers
  await expect(page.locator("#marketingRoot")).toContainText("Not available yet");
  // Never a fabricated dollar figure.
  await expect(page.locator("#marketingRoot")).not.toContainText("$0.00");
  await expect(page.locator("#marketingRoot")).not.toContainText(/ROI:\s*\d/);
});
