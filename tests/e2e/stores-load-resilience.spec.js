import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Regression test for a real crash found while investigating a stray
 * "Cannot read properties of undefined (reading 'map')" toast that
 * appeared to be a Website Studio bug but wasn't — it was loadStores()
 * in app.js destructuring `items` from the stores API response with no
 * default. Every other loader in this file defensively falls back to []
 * (`.items || []`) specifically so a thin/empty response degrades to an
 * empty state instead of throwing (see fixtures.mjs's mockBackend doc
 * comment) — loadStores was the one loader that skipped that guard.
 * A 200 response whose body is empty or fails to parse (a real
 * possibility on a flaky connection: app.js's api() helper swallows
 * JSON-parse failures and returns {} rather than throwing) reproduces
 * this exactly. Fixed by adding the same `= []` default every other
 * loader already uses.
 */
test("loadStores degrades gracefully when the stores API returns no items field", async ({ page }) => {
  const errs = [];
  page.on("pageerror", (e) => errs.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  // Simulate a 200 response with no `items` field — what a truncated/
  // unparseable body degrades to inside app.js's api() helper.
  await page.route("**/.netlify/functions/stores", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

  // No uncaught error, and no raw JS error message leaked into the toast.
  await page.waitForTimeout(500);
  const toastText = await page.locator("#toast").textContent();
  expect(toastText || "").not.toContain("reading 'map'");
  expect(toastText || "").not.toContain("undefined");
  expect(errs).toEqual([]);
});
