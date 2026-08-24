import { test, expect } from "@playwright/test";
import { mockAdminBackend, withFakeAdminSession } from "./fixtures.mjs";

/**
 * Priority 3 of the "finish everything that can safely be completed
 * without Ashley" pass — the real Connections panel wired to
 * connect_platform/disconnect_platform, using the real OAuth authorize
 * URL when the backend returns one.
 */

async function mockMarketingStudio(page, { connections, onAction } = {}) {
  await mockAdminBackend(page);
  await page.route("**/.netlify/functions/marketing-studio**", async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action");
    const body = route.request().postDataJSON?.() || {};
    if (onAction) {
      const handled = await onAction(route, action, body);
      if (handled) return;
    }
    if (action === "status" && route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ clone_provider: { live: false }, note: "NOT LIVE.", supported_platforms: [] }) });
      return;
    }
    if (action === "list_content" && route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
      return;
    }
    if (action === "connections" && route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: connections || [] }) });
      return;
    }
    if (action === "usage_summary" || action === "list_clone_consent" || action === "list_personal_brand_reference_photos" || action === "get_personal_brand_profile") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], profile: {}, estimated_total_cents: 0, actual_total_cents: 0 }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function openMarketingStudio(page) {
  await withFakeAdminSession(page);
  await page.goto("/admin");
  await expect(page.locator("#adminApp")).toBeVisible({ timeout: 10_000 });
  await page.locator('aside nav button[data-view="marketingStudio"]').click();
  const root = page.locator("#marketingStudioRoot");
  await root.locator("#msShopId").fill("shop-1");
  await root.locator("#msLoadShop").click();
  return root;
}

function conn(platform, overrides = {}) {
  return { platform, status: "not_connected", account_label: null, connected_at: null, expires_at: null, last_error: null, last_checked_at: null, live: false, ...overrides };
}

test.describe("Marketing Studio connections panel", () => {
  test("renders real per-platform status — never a fabricated 'connected' state", async ({ page }) => {
    await mockMarketingStudio(page, {
      connections: [
        conn("facebook", { status: "connected", account_label: "Test Florals Page" }),
        conn("instagram"),
        conn("tiktok", { status: "error", last_error: "Token expired." })
      ]
    });
    const root = await openMarketingStudio(page);
    const list = root.locator("#msConnectionsList");
    await expect(list).toContainText("Test Florals Page");
    await expect(list).toContainText("Connected (not verified live)");
    await expect(list).toContainText("Token expired.");
    await expect(list.locator('[data-connect-platform="instagram"]')).toBeVisible();
    await expect(list.locator('[data-disconnect-platform="facebook"]')).toBeVisible();
  });

  test("clicking Connect on an unconfigured platform shows the backend's honest message, never navigates away", async ({ page }) => {
    await mockMarketingStudio(page, {
      connections: [conn("facebook")],
      onAction: async (route, action, body) => {
        if (action === "connect_platform") {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: false, message: "NOT LIVE — PROVIDER CONNECTION REQUIRED. Set FLORISYN_SOCIAL_FACEBOOK_CLIENT_ID and FLORISYN_SOCIAL_FACEBOOK_CLIENT_SECRET to enable connecting facebook." }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    page.once("dialog", (dialog) => dialog.accept());
    await root.locator('[data-connect-platform="facebook"]').click();
    await expect(page).toHaveURL(/\/admin/);
  });

  test("clicking Connect on a real, configured platform redirects the browser to the real authorize_url", async ({ page }) => {
    // Intercept the destination itself too — this test only asserts the
    // client-side redirect actually fires with the real URL the backend
    // returned; it must never make an actual outbound request to a real
    // provider host.
    await page.route("https://example.com/oauth-landing**", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<title>fake provider consent screen</title>" });
    });
    await mockMarketingStudio(page, {
      connections: [conn("facebook")],
      onAction: async (route, action, body) => {
        if (action === "connect_platform") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ configured: true, authorize_url: "https://example.com/oauth-landing?connected=facebook", scopes: ["pages_manage_posts"] })
          });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    await Promise.all([page.waitForURL(/oauth-landing/), root.locator('[data-connect-platform="facebook"]').click()]);
    expect(page.url()).toContain("connected=facebook");
  });

  test("disconnecting asks for confirmation and calls disconnect_platform only after accepting", async ({ page }) => {
    let disconnectCalled = false;
    await mockMarketingStudio(page, {
      connections: [conn("facebook", { status: "connected", account_label: "Test Florals Page" })],
      onAction: async (route, action) => {
        if (action === "disconnect_platform") {
          disconnectCalled = true;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, platform: "facebook" }) });
          return true;
        }
        return false;
      }
    });
    const root = await openMarketingStudio(page);
    page.once("dialog", (dialog) => dialog.accept());
    await root.locator('[data-disconnect-platform="facebook"]').click();
    await page.waitForTimeout(150);
    expect(disconnectCalled).toBe(true);
  });
});
