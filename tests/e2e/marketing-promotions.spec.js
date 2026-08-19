import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Marketing Step 87: promotions as a definition/activation-safety layer,
 * not a competing checkout discount engine. Exercises the real UI: define
 * a promotion as a draft, see the required safety preview (products
 * affected, discount, dates) before it can go live, activate it, then end
 * it — and confirms a promotion scoped to specific products never claims
 * to be storewide.
 */

function routePromotions(page, state) {
  return page.route("**/.netlify/functions/marketing-promotions", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: state.items }) });
    }
    const body = JSON.parse(req.postData() || "{}");
    if (body.action === "create") {
      const item = {
        id: `promo-${state.items.length + 1}`,
        name: body.name,
        promo_type: body.promo_type,
        value: Number(body.value || 0),
        status: "draft",
        starts_on: body.starts_on || null,
        ends_on: body.ends_on || null,
        description: body.description || null,
        product_ids: body.product_ids || [],
      };
      state.items.unshift(item);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ item }) });
    }
    if (body.action === "activate") {
      const item = state.items.find((p) => p.id === body.id);
      if (item) item.status = "active";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item }) });
    }
    if (body.action === "end") {
      const item = state.items.find((p) => p.id === body.id);
      if (item) item.status = "ended";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item }) });
    }
    if (body.action === "delete") {
      state.items = state.items.filter((p) => p.id !== body.id);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function openPromotionsTab(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="marketingPage"]').click();
  await page.locator('[data-marketing-tab="promotions"]').click();
}

test("defining a promotion scoped to one product shows exactly that product — never storewide — in the activation preview", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  await withFakeSession(page);
  const state = { items: [] };
  await routePromotions(page, state);
  await page.route("**/.netlify/functions/marketing-campaigns**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }),
  );
  await page.route("**/.netlify/functions/products", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{ id: "prod-1", name: "Rose Garden Bouquet", category: "Everyday", price: 65 }] }),
    }),
  );

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="productsPage"]').click();
  await expect(page.locator("#productsList")).toContainText("Rose Garden Bouquet");

  await page.locator('nav.florisyn-lux-nav button[data-page="marketingPage"]').click();
  await page.locator('[data-marketing-tab="promotions"]').click();

  await page.locator('#marketingPromotionForm input[name="name"]').fill("Rose Garden 15% off");
  await page.locator('#marketingPromotionForm select[name="promo_type"]').selectOption("percentage_off");
  await page.locator('#marketingPromotionForm input[name="value"]').fill("15");
  await page.locator('#marketingPromotionForm input[name="promo_product_ids"][value="prod-1"]').check();
  await page.locator("#marketingPromotionForm button[type=submit]").click();

  const card = page.locator('[data-promotion-id="promo-1"]');
  await expect(card).toBeVisible();
  await expect(card.locator(".eyebrow")).toHaveText("DRAFT");
  await expect(card).toContainText("15% off");

  let confirmMessage = "";
  page.on("dialog", async (dialog) => {
    confirmMessage = dialog.message();
    await dialog.accept();
  });

  await card.locator('[data-promotion-act="activate"]').click();
  await expect.poll(() => confirmMessage).not.toBe("");
  expect(confirmMessage).toContain("Rose Garden Bouquet");
  expect(confirmMessage).not.toContain("storewide");
  expect(confirmMessage).toContain("15% off");

  await expect(card.locator(".eyebrow")).toHaveText("ACTIVE");
  await expect(card.locator('[data-promotion-act="end"]')).toBeVisible();
  await expect(card.locator('[data-promotion-act="activate"]')).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test("a promotion with no products selected is honestly previewed as storewide, and ending it removes further actions", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  const state = { items: [] };
  await routePromotions(page, state);
  await page.route("**/.netlify/functions/marketing-campaigns**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }),
  );

  await openPromotionsTab(page);
  await page.locator('#marketingPromotionForm input[name="name"]').fill("Free delivery weekend");
  await page.locator('#marketingPromotionForm select[name="promo_type"]').selectOption("free_delivery");
  await page.locator("#marketingPromotionForm button[type=submit]").click();

  const card = page.locator('[data-promotion-id="promo-1"]');
  await expect(card).toBeVisible();

  let confirmMessage = "";
  page.on("dialog", async (dialog) => {
    confirmMessage = dialog.message();
    await dialog.accept();
  });
  await card.locator('[data-promotion-act="activate"]').click();
  await expect.poll(() => confirmMessage).not.toBe("");
  expect(confirmMessage).toContain("storewide");

  await expect(card.locator(".eyebrow")).toHaveText("ACTIVE");
  await card.locator('[data-promotion-act="end"]').click();
  await expect(card.locator(".eyebrow")).toHaveText("ENDED");
  await expect(card.locator("[data-promotion-act]")).toHaveCount(0);
});
