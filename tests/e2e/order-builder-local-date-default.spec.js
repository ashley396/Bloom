import { test, expect } from "@playwright/test";
import { mockBackend } from "./fixtures.mjs";

/**
 * Money/date audit finding: prepareOrderBuilder() defaulted a new order's
 * delivery date via `new Date().toISOString().slice(0, 10)` — UTC "today",
 * not local "today". Pinned here to 11:30 PM Eastern (already the next
 * calendar day in UTC) so a florist opening "+ New Order" in the evening,
 * in any US timezone, no longer gets tomorrow's date silently pre-filled
 * as today's.
 */
test.use({ timezoneId: "America/New_York" });
const FIXED_INSTANT = "2026-08-21T03:30:00.000Z"; // 2026-08-20 11:30 PM America/New_York
const LOCAL_TODAY = "2026-08-20";

test("a new order defaults its delivery date to the real local day, not the UTC day", async ({ page }) => {
  await page.clock.setFixedTime(new Date(FIXED_INSTANT));
  await mockBackend(page);
  await page.route("**/.netlify/functions/orders**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) })
  );

  await page.addInitScript((session) => {
    localStorage.setItem("bloom_session", JSON.stringify(session));
    localStorage.setItem("bloom_first_run_rc2_done", "1");
  }, {
    accessToken: "fake-access-token-for-smoke-test",
    refreshToken: "fake-refresh-token-for-smoke-test",
    user: { id: "smoke-test-user", email: "smoke-test@example.invalid" },
    expiresAt: new Date(FIXED_INSTANT).getTime() + 60 * 60 * 1000,
  });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

  await page.locator('[data-open="orderDialog"]').first().click();
  const dialog = page.locator("#orderDialog");
  await expect(dialog).toBeVisible();

  await expect(dialog.locator('input[name="delivery_date"]')).toHaveValue(LOCAL_TODAY);
});
