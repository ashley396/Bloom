import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * The Florist Network wire split — this is NOT a Teleflora-style
 * marketplace where the platform takes ~20-30%. The sending shop already
 * collected the customer's payment in-store and keeps a negotiated
 * commission out of that; only the fulfilling shop's share is ever
 * charged/transferred through Florisyn. Verifies the UI actually shows
 * and uses that split instead of the old "100% to partner" copy.
 */
async function mockNetwork(page, { profile, outboxItems = [], sendWireResponse } = {}) {
  await mockBackend(page);
  await page.route("**/.netlify/functions/florist-network**", async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action") || route.request().postDataJSON()?.action;
    if (route.request().method() === "GET" && action === "partners") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ shop_id: "shop-a", display_name: "Petal & Vine", city: "Nashville", state: "TN", can_receive_payments: true }],
        }),
      });
      return;
    }
    if (route.request().method() === "GET" && action === "profile") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profile: profile ?? { display_name: "My Shop", accepts_incoming_wires: true, wire_fee_percent: 25 } }),
      });
      return;
    }
    if (route.request().method() === "GET" && action === "inbox") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], view: "fulfilling" }) });
      return;
    }
    if (route.request().method() === "GET" && action === "outbox") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: outboxItems, view: "sending" }) });
      return;
    }
    if (route.request().method() === "POST" && action === "send-wire") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(
          sendWireResponse ?? {
            item: { id: "wire-new" },
            settlement: { sending_shop_percent: 20, sending_shop_amount: 20, fulfilling_shop_amount: 80, florisyn_platform_fee: 0 },
          }
        ),
      });
      return;
    }
    if (route.request().method() === "POST" && action === "save-profile") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profile: { ...(profile ?? {}), ...route.request().postDataJSON() } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="floristNetworkPage"]').click();
  await expect(page.locator("#floristNetworkRoot .fn-layout")).toBeVisible();
}

test("wire form defaults your commission % to your saved network profile rate, not a hardcoded value", async ({ page }) => {
  await mockNetwork(page, { profile: { display_name: "My Shop", accepts_incoming_wires: true, wire_fee_percent: 35 } });
  await expect(page.locator('#wireForm input[name="sending_shop_percent"]')).toHaveValue("35");
  await expect(page.locator("#fnWireFeePercent")).toHaveValue("35");
});

test("saving the network profile sends your edited commission percent, not a hardcoded 20", async ({ page }) => {
  let savedBody = null;
  await mockNetwork(page, { profile: { display_name: "My Shop", accepts_incoming_wires: true, wire_fee_percent: 20 } });
  await page.route("**/.netlify/functions/florist-network**", async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.action === "save-profile") {
      savedBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: savedBody }) });
      return;
    }
    await route.fallback();
  });
  await page.locator("#fnWireFeePercent").fill("40");
  await page.locator("#fnActivateProfile").click();
  await expect(page.locator("#toast")).toContainText("saved");
  expect(savedBody?.wire_fee_percent).toBe(40);
});

test("sending a wire confirms the real split before payment — your commission stays out of the Stripe charge", async ({ page }) => {
  await mockNetwork(page, {
    sendWireResponse: {
      item: { id: "wire-new" },
      settlement: { sending_shop_percent: 20, sending_shop_amount: 20, fulfilling_shop_amount: 80, florisyn_platform_fee: 0 },
    },
  });

  let confirmMessage = null;
  page.on("dialog", async (dialog) => {
    confirmMessage = dialog.message();
    await dialog.dismiss();
  });

  await page.locator('#wireForm select[name="fulfilling_shop_id"]').selectOption("shop-a");
  await page.locator('#wireForm input[name="recipient_name"]').fill("Jamie Rivera");
  await page.locator('#wireForm input[name="delivery_address"]').fill("123 Main St");
  await page.locator('#wireForm input[name="delivery_date"]').fill("2026-09-01");
  await page.locator('#wireForm input[name="wire_amount"]').fill("100");
  await page.locator('#wireForm input[name="sending_shop_percent"]').fill("20");
  await page.locator('#wireForm textarea[name="product_description"]').fill("Pastel garden arrangement");
  await page.locator('#wireForm button[type="submit"]').click();

  await expect(page.locator("#toast")).toContainText("Wire order sent");
  expect(confirmMessage).toMatch(/keep your 20% commission \(\$20\.00\)/);
  expect(confirmMessage).toMatch(/\$80\.00/);
  expect(confirmMessage).not.toMatch(/100% goes to them/);
});

test("a sent wire's card shows the negotiated split, not the old 100%-to-partner copy", async ({ page }) => {
  const wire = {
    id: "wire-1",
    wire_number: "FN-XYZ-789",
    recipient_name: "Sam Lee",
    status: "sent",
    status_label: "Awaiting partner",
    delivery_date: "2026-09-05",
    delivery_address: "88 Oak Ave",
    product_description: "Bright mixed bouquet",
    wire_amount: 100,
    sending_shop_percent: 30,
    metadata: { sending_shop_amount: 30, fulfilling_shop_amount: 70 },
    payment_status: "unpaid",
    payment_label: "unpaid",
  };
  await mockNetwork(page, { outboxItems: [wire] });

  const card = page.locator(".wire-card", { hasText: "Sam Lee" });
  await expect(card).toContainText("Your cut: $30.00 (30%)");
  await expect(card).toContainText("Partner gets $70.00");
  await expect(card).not.toContainText("100% to partner");
});
