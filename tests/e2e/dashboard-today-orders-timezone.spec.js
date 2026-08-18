import { test, expect } from "@playwright/test";
import { mockBackend } from "./fixtures.mjs";

/**
 * Stability audit finding — two places independently computed "today" and
 * both got it wrong for negative-UTC-offset timezones (every US timezone,
 * this app's whole market), and both render into the same
 * #atelierTodayOrders panel:
 *
 * 1. localDate() (florisyn-atelier-dashboard.js) fed a plain "YYYY-MM-DD"
 *    delivery_date (how a Postgres `date` column serializes) through
 *    `new Date(value)`, which the spec parses as UTC midnight, then read
 *    local calendar fields back off it — one calendar day early.
 * 2. renderDashboardTodayOrders() (app.js) — which runs *after* #1 and
 *    overwrites its output — computed "today" via
 *    `new Date().toISOString().slice(0,10)`, which is always the UTC
 *    calendar date, not the browser's local one.
 *
 * Either bug alone makes an order due exactly today silently fall out of
 * "Today's Orders" on its actual delivery date. Orders created in advance
 * for a future delivery date — the normal florist workflow — have no
 * same-day created_at to fall back on, so this wasn't a rare edge case; it
 * hit every future-dated order on delivery day. This test drives the real
 * dashboard load path (not a direct render() call) so it exercises both
 * implementations, including whichever one runs last and wins the DOM.
 */
test.use({ timezoneId: "America/New_York" });

// Pinned to 11:30 PM Eastern (America/New_York, UTC-4 in August) — which is
// already 3:30 AM the *next* calendar day in UTC. Any comparison that goes
// through UTC instead of the browser's local timezone lands on the wrong
// day at this instant. Using the real wall-clock "now" (as an earlier draft
// of this test did) only fails a few hours a day, right around local
// midnight — flaky-looking rather than a reliable regression guard. Pinning
// the clock makes the mismatch unconditional and repeatable.
const FIXED_INSTANT = "2026-08-21T03:30:00.000Z"; // 2026-08-20 11:30 PM America/New_York
const LOCAL_TODAY = "2026-08-20";

test("an order due today still shows in Today's Orders in a negative-UTC-offset timezone", async ({ page }) => {
  await page.clock.setFixedTime(new Date(FIXED_INSTANT));
  await mockBackend(page);

  await page.route("**/.netlify/functions/orders**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    const todayPlainDate = LOCAL_TODAY;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "order-today-1",
            order_number: "F-9001",
            customer_name: "Jamie Rivera",
            recipient_name: "Jamie Rivera",
            total: 89,
            status: "DESIGNING",
            // A bare date string, exactly as the orders API returns a
            // Postgres `date` column — no time-of-day, no "Z".
            delivery_date: todayPlainDate,
            created_at: "2026-08-01T09:00:00.000Z", // created well in advance
          },
        ],
      }),
    });
  });

  // Not the shared withFakeSession() helper: its expiresAt is real
  // Date.now()+1h at fixture-import time, which the frozen browser clock
  // above (a few days ahead of actual "now") would already read as
  // expired, bouncing the test to the login screen before the dashboard
  // ever renders. Anchor expiresAt to the same frozen instant instead.
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

  const panel = page.locator("#atelierTodayOrders");
  await expect(panel).toContainText("F-9001", { timeout: 10_000 });
  await expect(panel).not.toContainText("No orders");
});
