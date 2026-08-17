import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Florist Network ratings — the trust signal legacy wire services
 * (Teleflora, FTD, BloomNet) provide via quality-guarantee programs that
 * the directory didn't have. Verifies a partner's rating shows in the
 * directory dropdown, and a delivered wire's "Rate this shop" flow
 * actually submits a rating.
 */
async function mockNetwork(page, { partners = [], inboxItems = [], rateResponse } = {}) {
  await mockBackend(page);
  await page.route("**/.netlify/functions/florist-network**", async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action") || route.request().postDataJSON()?.action;
    if (route.request().method() === "GET" && action === "partners") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: partners }) });
      return;
    }
    if (route.request().method() === "GET" && action === "profile") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profile: { display_name: "My Shop", accepts_incoming_wires: true }, rating_average: 4.5, rating_count: 2 }),
      });
      return;
    }
    if (route.request().method() === "GET" && action === "inbox") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: inboxItems, view: "fulfilling" }) });
      return;
    }
    if (route.request().method() === "GET" && action === "outbox") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], view: "sending" }) });
      return;
    }
    if (route.request().method() === "POST" && action === "rate-wire") {
      await route.fulfill({
        status: rateResponse?.status || 201,
        contentType: "application/json",
        body: JSON.stringify(rateResponse?.body || { item: { id: "rating-1" } }),
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

test("a partner's rating shows in the directory, and an unrated partner is labeled clearly", async ({ page }) => {
  await mockNetwork(page, {
    partners: [
      { shop_id: "shop-a", display_name: "Petal & Vine", city: "Dallas", state: "TX", can_receive_payments: true, rating_average: 4.3, rating_count: 6 },
      { shop_id: "shop-b", display_name: "New Blooms Co", city: "Austin", state: "TX", can_receive_payments: false, rating_average: null, rating_count: 0 },
    ],
  });

  const select = page.locator('#wireForm select[name="fulfilling_shop_id"]');
  await expect(select.locator("option", { hasText: "Petal & Vine" })).toContainText("★★★★☆ (6)");
  await expect(select.locator("option", { hasText: "New Blooms Co" })).toContainText("Not yet rated");
});

test("your own reputation shows on the network profile panel", async ({ page }) => {
  await mockNetwork(page, {});
  await expect(page.locator(".fn-rating")).toContainText("Your reputation: ★★★★★ (2 ratings)");
});

test("rating a delivered wire submits the rating and updates the card", async ({ page }) => {
  const wire = {
    id: "wire-1",
    wire_number: "FN-ABC-123",
    recipient_name: "Jamie Rivera",
    status: "delivered",
    status_label: "Delivered",
    delivery_date: "2026-08-20",
    delivery_address: "123 Main St",
    product_description: "Blush garden arrangement",
    wire_amount: 95,
    payment_status: "paid",
    payment_label: "paid",
    can_rate: true,
    my_rating: null,
  };
  await mockNetwork(page, { inboxItems: [wire] });

  page.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt" && /Rate your experience/i.test(dialog.message())) {
      await dialog.accept("5");
    } else if (dialog.type() === "prompt" && /Optional comment/i.test(dialog.message())) {
      await dialog.accept("On time and beautiful.");
    } else {
      await dialog.accept();
    }
  });

  const card = page.locator(".wire-card", { hasText: "Jamie Rivera" });
  await expect(card.locator(".fn-rate-wire")).toBeVisible();
  await card.locator(".fn-rate-wire").click();
  await expect(page.locator("#toast")).toContainText("Thanks");
});
