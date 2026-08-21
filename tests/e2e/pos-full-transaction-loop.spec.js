import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Launch-repair Area 4: the POS transaction loop end to end. Double-submit
 * protection already has its own test (pos-checkout-no-double-submit.spec.js);
 * this covers the rest of the launch-repair spec's list — add product,
 * named customer, delivery fulfillment + occasion, delivery fee, tax,
 * cash payment to completion, and hold/recall/clear — walking the real UI
 * rather than pre-seeding the cart, so a broken tile/button/handler would
 * actually fail this test.
 *
 * Confirmed regression found while building this coverage: the register's
 * customer picker (#posCustomerSelect — the exact control checkoutPosCart()
 * reads customer_name from) lived inside a permanently `hidden` legacy
 * block. The visible "By Customer" tab only called .focus() on that hidden
 * element, which opens nothing — so a florist had no way to attach a real
 * customer to a POS sale; every sale was silently forced to "Walk-in
 * Customer" no matter what was picked. Separately, the picker was never
 * populated with real customers unless the florist had already visited the
 * Customers tab first (loadCustomers() only ran from there). Fixed by
 * moving the select into the visible customer card (public/index.html),
 * giving it real styling (florisyn-luxury-pos.css), having the POS page
 * load customers itself (public/app.js), and having the tab button open
 * the now-visible select via showPicker() (florisyn-luxury-pos.js).
 */

async function openPos(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="posPage"]').click();
  await expect(page.locator("#productPadGrid .quick-sale-pad").first()).toBeVisible();
}

test.describe("POS end-to-end transaction loop", () => {
  test("the customer picker is visible and reachable, not trapped in a hidden legacy block", async ({ page }) => {
    await mockBackend(page);
    await page.route("**/.netlify/functions/customers**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [{ id: "cust-1", name: "Jordan Lee" }] }),
      }),
    );
    await withFakeSession(page);
    await openPos(page);

    const select = page.locator("#posCustomerSelect");
    await expect(select).toBeVisible();
    await expect(select.locator("option", { hasText: "Jordan Lee" })).toHaveCount(1);

    await select.selectOption({ label: "Jordan Lee" });
    await expect(page.locator("#posLuxCustomerName")).toHaveText("Jordan Lee");
    await expect(page.locator("#posLuxLoyaltyNote")).toHaveText("Customer attached to this sale.");
  });
  test("add product -> named customer -> delivery + occasion -> correct totals -> order created -> cash payment completes -> cart clears", async ({ page }) => {
    let createdOrderBody = null;
    let paymentBody = null;

    await mockBackend(page);
    await page.route("**/.netlify/functions/customers**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [{ id: "cust-1", name: "Jordan Lee", email: "jordan@example.invalid" }] }),
      }),
    );
    await page.route("**/.netlify/functions/orders**", async (route) => {
      if (route.request().method() === "POST") {
        createdOrderBody = JSON.parse(route.request().postData() || "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            item: {
              id: "order-full-loop-1",
              order_number: "F-4001",
              ...createdOrderBody,
              balance_due: createdOrderBody.total_preview,
              total: createdOrderBody.total_preview,
            },
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
    });
    await page.route("**/.netlify/functions/payments**", async (route) => {
      if (route.request().method() === "POST") {
        paymentBody = JSON.parse(route.request().postData() || "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ order: { id: "order-full-loop-1", balance_due: 0 }, payment: { id: "pay-1" } }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
    });

    await withFakeSession(page);
    await openPos(page);

    // 1. Add a product from the tile grid — a real UI interaction, not a
    // pre-seeded cart — then set its price (tiles start at $0.00 and are
    // meant to be priced at the register).
    await page.locator("#productPadGrid .quick-sale-pad").first().click();
    const priceInput = page.locator('[data-cart-price="0"]');
    await expect(priceInput).toBeVisible();
    await priceInput.fill("65");
    await priceInput.dispatchEvent("change");

    // 2. Named customer, not walk-in.
    await page.locator("#posCustomerSelect").selectOption({ label: "Jordan Lee" });

    // 3. Delivery fulfillment + occasion + delivery fee.
    await page.locator('#posFulfill [data-fulfill="DELIVERY"]').click();
    await page.fill("#posRecipientName", "Sam Lee");
    await page.fill("#posDeliveryAddress", "42 Garden Ave");
    await page.fill("#posOccasion", "Anniversary");
    await page.fill("#posDeliveryFee", "10");
    await page.dispatchEvent("#posDeliveryFee", "input");

    // 4. Totals: subtotal 65 + fee 10, tax at the default 6% shop rate
    // applies to (subtotal - discount) only, per cartTotals()'s own math.
    const expectedTax = Math.round(65 * 6) / 100;
    const expectedTotal = Math.round((65 + 10 + expectedTax) * 100) / 100;
    await expect(page.locator("#cartTotal")).toHaveText(new RegExp(expectedTotal.toFixed(2).replace(".", "\\.")));

    // 5. Checkout creates the real order with everything entered above.
    await page.locator("#posChargeCardBtn").click();
    await expect.poll(() => createdOrderBody).not.toBeNull();
    expect(createdOrderBody.customer_name).toBe("Jordan Lee");
    expect(createdOrderBody.fulfillment).toBe("DELIVERY");
    expect(createdOrderBody.recipient_name).toBe("Sam Lee");
    expect(createdOrderBody.delivery_address).toBe("42 Garden Ave");
    expect(createdOrderBody.occasion).toBe("Anniversary");
    expect(createdOrderBody.delivery_fee).toBe(10);
    expect(createdOrderBody.subtotal).toBe(65);
    expect(createdOrderBody.tax).toBeCloseTo(expectedTax, 2);
    expect(createdOrderBody.total_preview).toBeCloseTo(expectedTotal, 2);

    // 6. The cart clears immediately after the order posts — no risk of
    // re-submitting the same items into a second order.
    const cartAfterCheckout = await page.evaluate(() => JSON.parse(localStorage.getItem("bloom_pos_cart") || "[]"));
    expect(cartAfterCheckout).toEqual([]);

    // 7. Payment Center opens for the new order; complete it with cash.
    await expect(page).toHaveURL(/\/payment-centre$/);
    await expect(page.locator("#paymentCenterActive")).toBeVisible();
    await page.locator('[data-payment-mode="cash"]').click();
    await expect(page.locator("#paymentFlowCash")).toBeVisible();
    await page.fill("#cashReceived", "100");
    await page.locator("#completeCashPayment").click();

    await expect.poll(() => paymentBody).not.toBeNull();
    expect(paymentBody.order_id).toBe("order-full-loop-1");
    expect(paymentBody.method).toBe("Cash");
    await expect(page.locator("#paymentSuccessPanel")).toBeVisible();
  });

  test("hold order as a quote, recall it, and clear the cart", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await openPos(page);

    // Add an item, then hold it (saves as a quote on this device — the
    // launch-repair spec's "hold/recall" for a register with no live
    // parked-ticket backend of its own).
    await page.locator("#productPadGrid .quick-sale-pad").first().click();
    await page.locator('[data-cart-price="0"]').fill("40");
    await page.dispatchEvent('[data-cart-price="0"]', "change");

    page.once("dialog", (dialog) => dialog.accept("Held ticket"));
    await page.locator("#posHoldOrderBtn").click();
    await expect(page.locator("#savedQuoteCount")).toHaveText("1");

    // Clearing the cart actually empties it (confirm() dialog first).
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#clearCartBtn").click();
    await expect(page.locator("#queue")).not.toContainText("$40.00");
    const clearedCart = await page.evaluate(() => JSON.parse(localStorage.getItem("bloom_pos_cart") || "[]"));
    expect(clearedCart).toEqual([]);

    // Recall brings the held ticket straight back into the active cart.
    await page.locator("#posRecallBtn").click();
    await expect(page.locator("#savedQuotesDialog")).toBeVisible();
    await page.locator('[data-load-quote]').first().click();
    await expect(page.locator("#cartTotal")).not.toHaveText("$0.00");
    const recalledCart = await page.evaluate(() => JSON.parse(localStorage.getItem("bloom_pos_cart") || "[]"));
    expect(recalledCart.length).toBe(1);
    expect(recalledCart[0].price).toBe(40);
  });
});
