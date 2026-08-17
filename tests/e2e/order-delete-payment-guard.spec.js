import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Regression test for a real support report: "the delete button doesn't
 * remove the order in Orders." The Orders page's actual live table
 * (florisyn-luxury-orders.js, #ordTableBody) had a "Delete" button that,
 * deliberately, only ever soft-cancelled the order (status → CANCELLED)
 * to protect financial records — a reasonable rule, but the order then
 * sat right there in the "All Orders" tab with no explanation, which
 * reads exactly like "the button doesn't work." Now it tries a real
 * delete first (succeeds and truly removes the row when there's no
 * payment history), and only falls back to cancelling — with an
 * unmissable explanation — when payment history blocks the delete.
 */
function orderPayload(overrides = {}) {
  return {
    id: "order-1",
    order_number: "F-1001",
    customer_name: "Jamie Rivera",
    status: "NEW",
    payment_status: "UNPAID",
    total: 95,
    amount_paid: 0,
    balance_due: 95,
    delivery_date: "2026-08-20",
    items: [],
    ...overrides,
  };
}

async function openOrdersRow(page, order) {
  await mockBackend(page);
  await page.route("**/.netlify/functions/orders**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [order] }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="ordersPage"]').click();
  const row = page.locator(`[data-cancel-order="${order.id}"]`);
  await expect(row).toBeVisible();
  return row;
}

test("deleting an order with no payment history truly removes it", async ({ page }) => {
  const order = orderPayload();
  let deleteCalled = false;

  await mockBackend(page);
  await page.route("**/.netlify/functions/orders**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: deleteCalled ? [] : [order] }),
      });
      return;
    }
    if (route.request().method() === "DELETE") {
      deleteCalled = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="ordersPage"]').click();

  const deleteBtn = page.locator(`[data-cancel-order="${order.id}"]`);
  await expect(deleteBtn).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await deleteBtn.click();

  expect(deleteCalled).toBe(true);
  await expect(page.locator(`[data-cancel-order="${order.id}"]`)).toHaveCount(0);
});

test("deleting an order with payment history explains why and cancels it instead of failing silently", async ({ page }) => {
  const order = orderPayload({ payment_status: "PARTIAL", amount_paid: 20, balance_due: 75 });

  await mockBackend(page);
  await page.route("**/.netlify/functions/orders**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [order] }) });
      return;
    }
    if (route.request().method() === "DELETE") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "This order has payment history. Refund or adjust payments before deleting the order." }),
      });
      return;
    }
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { ...order, status: "CANCELLED" } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="ordersPage"]').click();

  const deleteBtn = page.locator(`[data-cancel-order="${order.id}"]`);
  await expect(deleteBtn).toBeVisible();

  // click() blocks while a dialog is open, so don't await it up front —
  // race it alongside reacting to each dialog as it appears.
  const clickPromise = deleteBtn.click();
  const confirmDialog = await page.waitForEvent("dialog"); // the "Delete order F-1001?" confirm()
  expect(confirmDialog.type()).toBe("confirm");
  await confirmDialog.accept();
  const alertDialog = await page.waitForEvent("dialog"); // the explanatory alert(), after the failed delete + fallback cancel
  expect(alertDialog.type()).toBe("alert");
  expect(alertDialog.message()).toMatch(/payment history/i);
  expect(alertDialog.message()).toMatch(/cancel/i);
  await alertDialog.accept();
  await clickPromise;
});
