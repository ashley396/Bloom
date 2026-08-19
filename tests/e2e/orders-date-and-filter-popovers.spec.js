import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Real bug, reported directly by the user: the Orders page's "date range"
 * button was completely fake — its label was hardcoded HTML text
 * ("May 1 - May 12, 2026") that never changed no matter what, and clicking
 * it just toasted that same fake string back. It never filtered anything.
 * The "More filters" button beside it (a three-bars icon easily read as a
 * hamburger menu) only ever said "coming soon." Both are now real,
 * working popovers wired into filteredRows().
 *
 * Also covers a related bug found while fixing this: formatDate() ran a
 * bare "YYYY-MM-DD" delivery_date through `new Date()`, which parses as
 * UTC midnight — one calendar day early in every US timezone once read
 * back with local getters. Every order's displayed delivery date could be
 * off by a day.
 */
function orderPayload({ id, order_number, customer_name, delivery_date, fulfillment, payment_status }) {
  return {
    id,
    order_number,
    customer_name,
    status: "PENDING",
    payment_status,
    total: 95,
    delivery_date,
    fulfillment,
    delivery_address: fulfillment === "DELIVERY" ? "123 Main St" : "",
    items: []
  };
}

const ORDERS = [
  orderPayload({ id: "o-early", order_number: "F-1", customer_name: "Early Order", delivery_date: "2026-08-10", fulfillment: "DELIVERY", payment_status: "UNPAID" }),
  orderPayload({ id: "o-mid", order_number: "F-2", customer_name: "Mid Order", delivery_date: "2026-08-20", fulfillment: "PICKUP", payment_status: "PAID" }),
  orderPayload({ id: "o-late", order_number: "F-3", customer_name: "Late Order", delivery_date: "2026-08-30", fulfillment: "DELIVERY", payment_status: "PARTIAL" })
];

async function openOrders(page) {
  await mockBackend(page);
  await page.route("**/.netlify/functions/orders**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: ORDERS }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="ordersPage"]').click();
  await expect(page.locator("#ordTableBody")).toContainText("Early Order", { timeout: 10_000 });
}

function tileNames(page) {
  return page.locator(".ord-tile-customer").allTextContents();
}

test("the date range button shows real state, not a hardcoded fake date", async ({ page }) => {
  await openOrders(page);
  await expect(page.locator("#ordDateRangeLabel")).toHaveText("All dates");
  await expect(page.locator("#ordDateRangeLabel")).not.toContainText("May");
});

test("applying a date range filters orders to that window", async ({ page }) => {
  await openOrders(page);
  await page.locator("#ordDateRange").click();
  await expect(page.locator("#ordDatePanel")).toBeVisible();
  await page.locator("#ordDateFrom").fill("2026-08-15");
  await page.locator("#ordDateTo").fill("2026-08-25");
  await page.locator("#ordDateApply").click();

  await expect(page.locator("#ordDatePanel")).toBeHidden();
  const names = await tileNames(page);
  expect(names).toEqual(["Mid Order"]);
  await expect(page.locator("#ordDateRange")).toHaveClass(/has-value/);

  // Clear puts every order back and drops the active-filter styling.
  await page.locator("#ordDateRange").click();
  await page.locator("#ordDateClear").click();
  const clearedNames = await tileNames(page);
  expect(clearedNames.sort()).toEqual(["Early Order", "Late Order", "Mid Order"]);
  await expect(page.locator("#ordDateRange")).not.toHaveClass(/has-value/);
});

test("the filter popover (the 'hamburger looking' button) actually filters by fulfillment and payment status", async ({ page }) => {
  await openOrders(page);
  await page.locator("#ordFilterBtn").click();
  await expect(page.locator("#ordFilterPanel")).toBeVisible();
  await page.locator("#ordFilterFulfillment").selectOption("Delivery");
  await page.locator("#ordFilterApply").click();

  let names = (await tileNames(page)).sort();
  expect(names).toEqual(["Early Order", "Late Order"]);
  await expect(page.locator("#ordFilterBtn")).toHaveClass(/has-value/);

  await page.locator("#ordFilterBtn").click();
  await page.locator("#ordFilterPayment").selectOption("PARTIAL");
  await page.locator("#ordFilterApply").click();

  names = await tileNames(page);
  expect(names).toEqual(["Late Order"]);
});

test("opening one popover closes the other", async ({ page }) => {
  await openOrders(page);
  await page.locator("#ordDateRange").click();
  await expect(page.locator("#ordDatePanel")).toBeVisible();
  await page.locator("#ordFilterBtn").click();
  await expect(page.locator("#ordFilterPanel")).toBeVisible();
  await expect(page.locator("#ordDatePanel")).toBeHidden();
});

test("clicking outside a popover closes it", async ({ page }) => {
  await openOrders(page);
  await page.locator("#ordDateRange").click();
  await expect(page.locator("#ordDatePanel")).toBeVisible();
  await page.locator("h1", { hasText: "Orders" }).click();
  await expect(page.locator("#ordDatePanel")).toBeHidden();
});

test.use({ timezoneId: "America/New_York" });
test("an order's delivery date displays the real day, not one day early, in a negative-UTC-offset timezone", async ({ page }) => {
  await openOrders(page);
  // Early Order's delivery_date is 2026-08-10 — formatDate() must show
  // "Aug 10", not "Aug 9" from a UTC-midnight misparse.
  const tile = page.locator(".ord-tile", { hasText: "Early Order" });
  await expect(tile.locator(".ord-tile-meta span").first()).toHaveText("Aug 10");
});
