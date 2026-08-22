import { test, expect } from "@playwright/test";
import { withFakeSession, mockBackend, withFakeAdminSession, mockAdminBackend } from "./fixtures.mjs";

/**
 * Confirmed regression: the "Welcome to Florisyn" setup-checklist banner
 * (mountOnboardingBanner in launch-polish.js) used to be prepended straight
 * onto the app root (#app for florists, #adminApp for admin) — the very
 * element that also wraps the sidebar and header, not just the current
 * page's content — so on every route (not just the dashboard the checklist
 * implies) the banner, its "Run a test order on the register" checklist
 * item, and its checkboxes rendered *above* the entire application shell
 * instead of below the header, inside the content column. #adminApp even
 * already shipped a purpose-built host for this (#adminOnboardingHost,
 * with its own dedicated CSS) that the code never actually used. Fixed by
 * mounting into `#app .content` / `#adminOnboardingHost` instead — a real
 * DOM-ownership fix, not a CSS hide.
 */

const FLORIST_ROUTES = ["dashboardPage", "settingsPage", "inventoryPage", "libraryPage"];

test.describe("onboarding checklist banner stays inside the app shell", () => {
  for (const pageId of FLORIST_ROUTES) {
    test(`${pageId}: banner renders below the header, inside .content — not above the shell`, async ({ page }) => {
      await mockBackend(page);
      await withFakeSession(page);
      await page.goto("/");
      await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
      await page.evaluate((id) => window.showPage && window.showPage(id), pageId);
      await page.waitForTimeout(300);

      const banner = page.locator(".bloom-onboarding-banner");
      await expect(banner).toBeVisible();

      // Real DOM ownership, not just visual position — the banner must be
      // a descendant of .content (inside the shell), never a direct child
      // of #app (which also contains the sidebar and header).
      const parentInfo = await banner.evaluate((el) => ({
        parentIsContent: el.parentElement.classList.contains("content"),
        parentIsAppRoot: el.parentElement.id === "app",
      }));
      expect(parentInfo.parentIsContent).toBe(true);
      expect(parentInfo.parentIsAppRoot).toBe(false);

      const headerBox = await page.locator("#app > .shell > .florisyn-lux-main > header").boundingBox();
      const bannerBox = await banner.boundingBox();
      expect(bannerBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 2);

      // The sidebar must never be covered by the banner either.
      const sidebarBox = await page.locator("#atelierSidebarDrawer").boundingBox();
      if (sidebarBox) {
        expect(bannerBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 2);
      }
    });
  }

  test("the checklist's real content (including the 'Run a test order' item) is present and functional", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });

    const banner = page.locator(".bloom-onboarding-banner");
    await expect(banner).toContainText("Setup checklist");
    // Only the first 4 remaining steps render at once — assert on one that
    // is guaranteed to still be in the initial remaining set.
    await expect(banner.locator("label", { hasText: /Confirm shop name and branding/i })).toBeVisible();
    const checkbox = banner.locator('input[type="checkbox"]').first();
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
  });

  test("admin: banner mounts into the dedicated #adminOnboardingHost, never #adminApp directly", async ({ page }) => {
    await mockAdminBackend(page);
    await withFakeAdminSession(page);
    await page.goto("/admin.html");
    await page.waitForSelector("#adminApp:not([hidden])", { timeout: 10_000 });
    await page.waitForTimeout(300);

    const banner = page.locator("#adminApp .bloom-onboarding-banner");
    await expect(banner).toBeVisible();
    const parentId = await banner.evaluate((el) => el.parentElement.id);
    expect(parentId).toBe("adminOnboardingHost");

    // Never overlapping the admin sidebar.
    const asideBox = await page.locator("#adminApp aside").boundingBox();
    const bannerBox = await banner.boundingBox();
    expect(bannerBox.x).toBeGreaterThanOrEqual(asideBox.x + asideBox.width - 2);
  });
});
