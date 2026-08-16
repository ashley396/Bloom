import { test, expect } from "@playwright/test";
import { mockAdminBackend, withFakeAdminSession } from "./fixtures.mjs";

/**
 * The Platform Owner console (public/admin.html) — a separate app from
 * the florist SPA, never covered by this suite until now. Same method as
 * authenticated-tabs.spec.js: simulate a logged-in session, mock every
 * backend call, click every nav button, and fail on an uncaught script
 * error. See fixtures.mjs for why MFA is skipped via mfaSkipAllowed
 * rather than faked through the real Supabase Auth SDK.
 */

// All 17 nav buttons in <aside><nav>, read directly from public/admin.html.
const ADMIN_VIEWS = [
  "overview",
  "betaToolkit",
  "users",
  "marketplaceAdmin",
  "support",
  "subscriptions",
  "announcements",
  "featureFlags",
  "analytics",
  "paymentHub",
  "systemHealth",
  "shops",
  "editor",
  "auditLog",
  "floralLibraryAdmin",
  "uiDesignMode",
  "audit",
];

test.describe("Florisyn admin console tabs (simulated session)", () => {
  test("every Command Center nav button is present", async ({ page }) => {
    await mockAdminBackend(page);
    await withFakeAdminSession(page);
    await page.goto("/admin");
    await expect(page.locator("#adminApp")).toBeVisible({ timeout: 10_000 });

    const missing = [];
    for (const view of ADMIN_VIEWS) {
      const count = await page.locator(`aside nav button[data-view="${view}"]`).count();
      if (count === 0) missing.push(view);
    }
    expect(missing, `admin nav buttons missing: ${missing.join(", ")}`).toHaveLength(0);
  });

  for (const view of ADMIN_VIEWS) {
    test(`view "${view}" activates without an uncaught script error`, async ({ page }) => {
      await mockAdminBackend(page);
      await withFakeAdminSession(page);

      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error));

      await page.goto("/admin");
      await expect(page.locator("#adminApp")).toBeVisible({ timeout: 10_000 });

      const navButton = page.locator(`aside nav button[data-view="${view}"]`);
      await expect(navButton).toBeVisible();
      await navButton.click();

      await expect(page.locator(`#${view}View`)).toHaveClass(/active/, { timeout: 5_000 });

      expect(
        pageErrors,
        `uncaught script error activating "${view}": ${pageErrors.map((e) => e.message).join("; ")}`,
      ).toHaveLength(0);
    });
  }
});
