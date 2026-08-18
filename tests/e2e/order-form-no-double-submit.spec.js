import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Stability audit finding: bindForm() (public/app.js) attached its async
 * submit handler with no re-entry guard and never disabled the submit
 * button while the save was in flight. A florist double-clicking "Create
 * order" during a busy rush — a completely plausible real-world action —
 * could fire the handler twice before the first POST resolved, creating
 * two orders from one click sequence. bindForm() now disables the submit
 * button and ignores re-entrant submit events until the first save
 * settles. This applies to every form that goes through bindForm
 * (orders, products, deliveries, marketplace listings, stores) but is
 * exercised here against the order builder, the highest-value case.
 */
test("double-clicking Create order only submits once, not twice", async ({ page }) => {
  let postCount = 0;

  await mockBackend(page);
  await page.route("**/.netlify/functions/orders**", async (route) => {
    if (route.request().method() === "POST") {
      postCount += 1;
      // Hold the response open briefly so a second, overlapping click
      // (if the bug were present) would have a real window to land in.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ item: { id: "order-new", order_number: "F-2001" } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });

  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

  await page.locator('[data-open="orderDialog"]').first().click();
  const dialog = page.locator("#orderDialog");
  await expect(dialog).toBeVisible();

  // Satisfy validateOrderFormPayload's "add at least one item" rule without
  // picking a product from the (empty-mocked) product list.
  await dialog.locator('input[name="subtotal"]').fill("50");

  const submitBtn = dialog.locator("#orderFormSubmit");
  await expect(submitBtn).toBeEnabled();

  // Fire two clicks back-to-back in the same synchronous browser tick — the
  // real shape of a double-click/double-tap, and the only way to actually
  // land a second click before the first submit handler's synchronous
  // "disable the button" guard takes effect. Playwright's own .click()
  // waits for actionability (would just block on "not enabled" for the
  // second click instead of exercising the race), so drive the native
  // button.click() method directly from the page.
  await page.evaluate(() => {
    const btn = document.querySelector("#orderDialog #orderFormSubmit");
    btn.click();
    btn.click();
  });
  // Give any (buggy) second in-flight submit a chance to have already fired.
  await page.waitForTimeout(500);

  expect(postCount).toBe(1);
});
