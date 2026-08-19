import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Stability audit finding, POS half: checkoutPosCart() (public/app.js) is
 * wired to a plain delegated click handler, not a <form> submit — so it
 * needed its own re-entry guard, separate from bindForm's fix for the
 * dialog-based forms. A POS device gets tapped fast, and a double-tap on
 * "Charge" before the first order POST resolves must not create two orders
 * from one sale.
 */
test("double-clicking the POS checkout button only creates one order", async ({ page }) => {
  let postCount = 0;

  await mockBackend(page);
  await page.route("**/.netlify/functions/orders**", async (route) => {
    if (route.request().method() === "POST") {
      postCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ item: { id: "order-pos-1", order_number: "F-3001" } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });

  await withFakeSession(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "bloom_pos_cart",
      JSON.stringify([{ name: "Dozen Roses", price: 65, quantity: 1 }]),
    );
  });
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="posPage"]').click();

  const checkoutBtn = page.locator("#posChargeCardBtn");
  await expect(checkoutBtn).toBeVisible();
  await expect(checkoutBtn).toBeEnabled();

  await page.evaluate(() => {
    const btn = document.querySelector("#posChargeCardBtn");
    btn.click();
    btn.click();
  });
  await page.waitForTimeout(500);

  expect(postCount).toBe(1);
});
