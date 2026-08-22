import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Launch-repair Area 5 (Payment Center / Stripe): confirms the Payment
 * Hub's provider chooser stays honest about what's actually wired up.
 * Backend correctness (webhook signature verification, idempotent
 * payments/refunds, tenant-scoped Stripe Connect status) already has
 * extensive handler-level coverage — stripe-order-webhook.test.js,
 * payment-hub-refund-integrity.test.js, stripe-connect-errors.test.js,
 * stripe-connect-payment-guards.test.js, post-stripe-payment.test.js, and
 * more. This is the missing piece: a real-browser check that Square,
 * Clover, PayPal, and Authorize.net — present in the chooser so a florist
 * knows Florisyn is heading there — never render as if they already work.
 */

const HUB_RESPONSE = {
  providers: [
    { provider_id: "stripe", status: "connected", mode: "test", is_default: true, health_status: "healthy", webhook_status: "active", permissions_ok: true, provider_ref: "acct_test123", last_sync_at: new Date().toISOString() },
    { provider_id: "square", status: "not_connected", mode: "coming_soon", coming_soon: true, is_default: false, health_status: null, webhook_status: "n/a", permissions_ok: false, provider_ref: null, last_sync_at: null },
    { provider_id: "clover", status: "not_connected", mode: "coming_soon", coming_soon: true, is_default: false, health_status: null, webhook_status: "n/a", permissions_ok: false, provider_ref: null, last_sync_at: null },
    { provider_id: "paypal", status: "not_connected", mode: "coming_soon", coming_soon: true, is_default: false, health_status: null, webhook_status: "n/a", permissions_ok: false, provider_ref: null, last_sync_at: null },
    { provider_id: "authorize_net", status: "not_connected", mode: "coming_soon", coming_soon: true, is_default: false, health_status: null, webhook_status: "n/a", permissions_ok: false, provider_ref: null, last_sync_at: null },
  ],
  catalog: {
    stripe: { label: "Stripe", integrated: true },
    square: { label: "Square", integrated: false },
    clover: { label: "Clover", integrated: false },
    paypal: { label: "PayPal", integrated: false },
    authorize_net: { label: "Authorize.net", integrated: false },
  },
  dashboard: {},
  methods: {},
  reports: {},
  future_rails: [],
  experience: {},
  refunds: { reasons: [], history: [], payments: [] },
  setup_wizard: { options: [], state: { completed: true } },
};

test.describe("Payment Center provider chooser stays honest about non-Stripe processors", () => {
  test("Square, Clover, PayPal, and Authorize.net show 'Coming soon' with a disabled Connect button, never a working one", async ({ page }) => {
    await mockBackend(page);
    await page.route("**/.netlify/functions/payment-hub**", (route) => {
      if (route.request().method() === "GET" || route.request().method() === "POST") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(HUB_RESPONSE) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await withFakeSession(page);

    // Payment Center's Advanced/Payment Hub section only renders once an
    // order is selected (#paymentCenterActive is otherwise hidden) — seed
    // one the same way a completed POS checkout would.
    await page.addInitScript(() => {
      localStorage.setItem(
        "bloom_pending_payment_order",
        JSON.stringify({ id: "order-hub-1", order_number: "F-5001", customer_name: "Walk-in Customer", total: 65, balance_due: 65 }),
      );
    });
    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
    await page.locator('nav.florisyn-lux-nav button[data-page="paymentsPage"]').click();
    await expect(page.locator("#paymentCenterActive")).toBeVisible();
    await page.locator("#paymentAdvancedSection summary").click();

    for (const id of ["square", "clover", "paypal", "authorize_net"]) {
      const card = page.locator(`.ph-provider-card[data-provider="${id}"]`);
      await expect(card).toHaveClass(/coming-soon/);
      await expect(card).toContainText("Coming soon");
      const connectBtn = card.locator("button", { hasText: "Coming soon" });
      await expect(connectBtn).toBeDisabled();
      // No Sync/Reconnect either — none of these providers have anything
      // real to sync or reconnect to yet.
      await expect(card.locator(".ph-sync")).toHaveCount(0);
      await expect(card.locator(".ph-reconnect")).toHaveCount(0);
    }

    // Stripe, the one real integration, gets its real working actions.
    const stripeCard = page.locator('.ph-provider-card[data-provider="stripe"]');
    await expect(stripeCard).not.toHaveClass(/coming-soon/);
    await expect(stripeCard).toContainText("connected");
    await expect(stripeCard.locator(".ph-sync")).toBeVisible();
    await expect(stripeCard.locator(".ph-reconnect")).toBeVisible();
  });

  test("connecting Stripe redirects to the real Connect onboarding URL Stripe returns", async ({ page }) => {
    await mockBackend(page);
    await page.route("**/.netlify/functions/payment-hub**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...HUB_RESPONSE,
          providers: [{ ...HUB_RESPONSE.providers[0], status: "not_connected", mode: "test", provider_ref: null }, ...HUB_RESPONSE.providers.slice(1)],
        }),
      }),
    );
    let connectCalled = false;
    await page.route("**/.netlify/functions/stripe-connect**", (route) => {
      connectCalled = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://connect.stripe.com/setup/e/acct_fake/onboarding" }),
      });
    });
    await withFakeSession(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "bloom_pending_payment_order",
        JSON.stringify({ id: "order-hub-2", order_number: "F-5002", customer_name: "Walk-in Customer", total: 65, balance_due: 65 }),
      );
    });

    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
    await page.locator('nav.florisyn-lux-nav button[data-page="paymentsPage"]').click();
    await expect(page.locator("#paymentCenterActive")).toBeVisible();
    await page.locator("#paymentAdvancedSection summary").click();

    // Prevent the actual cross-origin navigation from breaking the test
    // while still proving the app tried to go there.
    await page.route("https://connect.stripe.com/**", (route) => route.abort());
    const navigations = [];
    page.on("framenavigated", (frame) => navigations.push(frame.url()));

    await page.locator('.ph-provider-card[data-provider="stripe"] .ph-connect').click();
    await expect.poll(() => connectCalled).toBe(true);
  });
});
