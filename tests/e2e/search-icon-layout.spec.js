import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * A generic `body.bloom-rc2 label { flex-direction: column }` rule
 * (meant for stacked "Label text above input" form fields) was the only
 * declaration setting flex-direction on every <label> that instead wraps
 * a leading icon + input as a row — the global header search, POS
 * product search, POS discount code, and Orders search. Each icon
 * rendered stacked above its input instead of beside it. Verifies the
 * icon sits to the left of the input, vertically centered, on all four.
 */
async function assertIconLeftOfInput(page, labelSelector, inputSelector) {
  const iconBox = await page.locator(`${labelSelector} svg, ${labelSelector} .atelier-search-icon`).first().boundingBox();
  const inputBox = await page.locator(inputSelector).boundingBox();
  expect(iconBox).toBeTruthy();
  expect(inputBox).toBeTruthy();
  expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(inputBox.x + 1);
  const iconCenterY = iconBox.y + iconBox.height / 2;
  const inputCenterY = inputBox.y + inputBox.height / 2;
  expect(Math.abs(iconCenterY - inputCenterY)).toBeLessThan(4);
}

test("global header search icon sits beside its input, not stacked above it", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await assertIconLeftOfInput(page, ".atelier-global-search", "#atelierGlobalSearch");
});

test("POS product search icon sits beside its input", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => window.showPage?.("posPage"));
  await page.waitForTimeout(400);
  await assertIconLeftOfInput(page, ".pos-lux-search", "#posProductSearch");
});

test("POS discount code icon sits beside its input", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => window.showPage?.("posPage"));
  await page.waitForTimeout(400);
  await assertIconLeftOfInput(page, ".pos-lux-code", "#posLuxDiscountCode");
});

test("Orders search icon sits beside its input", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => window.showPage?.("ordersPage"));
  await page.waitForTimeout(400);
  await assertIconLeftOfInput(page, ".ord-search", ".ord-search input");
});
