import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Stability audit gap: authenticated-tabs.spec.js already proves every
 * sidebar tab activates cleanly at desktop width, but nothing exercised
 * the app at mobile/tablet widths before this. Below 980px the sidebar
 * becomes the #atelierSidebarDrawer overlay (see florisyn-luxury-dashboard.css)
 * opened via #atelierMenuToggle — a completely different DOM path than the
 * always-visible desktop <nav> the other suite drives. Same breakpoint
 * governs both a phone and a tablet width (max-width: 980px is one rule,
 * not two), so one sweep covers both with the same interaction pattern.
 *
 * Two checks per tab, matching what actually breaks a page for a real
 * florist on a phone: an uncaught script error, or the page body
 * scrolling sideways (content wider than the viewport — the layout bug
 * this app's CSS conventions are supposed to prevent via overflow-x:auto
 * on individual wide containers, never on the page itself).
 */

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
];

// Same 29 primary sidebar items as authenticated-tabs.spec.js.
const NAV_TABS = [
  "dashboardPage",
  "posPage",
  "ordersPage",
  "inventoryPage",
  "productsPage",
  "bouquetsPage",
  "customersPage",
  "deliveriesPage",
  "paymentsPage",
  "aiStudioPage",
  "analyticsPage",
  "reportsPage",
  "expensesPage",
  "invoicesPage",
  "bloomshotPage",
  "websitePage",
  "libraryPage",
  "communityPage",
  "floristNetworkPage",
  "marketingPage",
  "weddingsPage",
  "holidayPage",
  "staffPage",
  "marketplacePage",
  "storesPage",
  "ecosystemPage",
  "posSettingsPage",
  "settingsPage",
];

async function scrollWidthOverflow(page) {
  return page.evaluate(() => {
    // A couple of px of rounding slop from scrollbars/borders is normal;
    // only flag real overflow.
    return document.documentElement.scrollWidth - window.innerWidth;
  });
}

// The nav sweep above only proves each page *renders*; the long forms in
// this app live behind <dialog> modals (see the global data-open/.close
// wiring in app.js), a completely separate surface a phone-width bug can
// hide in — a modal wider than the viewport, or one whose Cancel/Save
// buttons render below the fold with no way to scroll to them. One
// representative dialog per major data-entry page, at the tightest
// (mobile) width only — a real gap the nav-only sweep doesn't cover.
const DIALOGS = [
  { fromTab: "customersPage", openSelector: '[data-open="customerDialog"]', dialogId: "customerDialog" },
  { fromTab: "productsPage", openSelector: '[data-open="productDialog"]', dialogId: "productDialog" },
  { fromTab: "inventoryPage", openSelector: '[data-open="inventoryDialog"]', dialogId: "inventoryDialog" },
  { fromTab: "expensesPage", openSelector: '[data-open="expenseDialog"]', dialogId: "expenseDialog" },
  { fromTab: "ordersPage", openSelector: "#ordNewOrderBtn", dialogId: "orderDialog" },
];

test.describe("Florisyn data-entry dialogs at mobile width (390px)", () => {
  for (const { fromTab, openSelector, dialogId } of DIALOGS) {
    test(`"${dialogId}" opens usably and closes via Cancel on a phone`, async ({ page }) => {
      await mockBackend(page);
      await withFakeSession(page);
      await page.setViewportSize({ width: 390, height: 844 });

      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error));

      await page.goto("/");
      await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

      await page.locator("#atelierMenuToggle").click();
      await page.locator(`#atelierSidebarDrawer button[data-page="${fromTab}"]`).click();
      await expect(page.locator(`#${fromTab}`)).toHaveClass(/active/, { timeout: 5_000 });

      await page.locator(openSelector).first().click();
      const dialog = page.locator(`#${dialogId}`);
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      const overflow = await scrollWidthOverflow(page);
      expect(overflow, `"${dialogId}" causes horizontal page scroll on a phone (overflow: ${overflow}px)`).toBeLessThanOrEqual(4);

      // The dialog's own box must fit within the viewport width — a modal
      // that's wider than the screen is unusable even if the page body
      // itself doesn't scroll (dialogs aren't always in normal flow).
      const box = await dialog.boundingBox();
      expect(box?.width ?? 0, `"${dialogId}" is wider than the 390px viewport (${box?.width}px)`).toBeLessThanOrEqual(390);

      const closeBtn = dialog.locator(".close").first();
      await expect(closeBtn).toBeVisible();
      await closeBtn.click();
      await expect(dialog).toBeHidden();

      expect(
        pageErrors,
        `uncaught script error around "${dialogId}" on a phone: ${pageErrors.map((e) => e.message).join("; ")}`,
      ).toHaveLength(0);
    });
  }
});

for (const viewport of VIEWPORTS) {
  test.describe(`Florisyn sidebar tabs at ${viewport.name} width (${viewport.width}px)`, () => {
    test(`hamburger menu opens the drawer with every tab reachable (${viewport.name})`, async ({ page }) => {
      await mockBackend(page);
      await withFakeSession(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

      const menuToggle = page.locator("#atelierMenuToggle");
      await expect(menuToggle).toBeVisible();

      const overflow = await scrollWidthOverflow(page);
      expect(overflow, `page body scrolls horizontally at ${viewport.width}px before the drawer even opens (overflow: ${overflow}px)`).toBeLessThanOrEqual(4);

      await menuToggle.click();
      await expect(page.locator("body")).toHaveClass(/atelier-drawer-open/);

      const missing = [];
      for (const id of NAV_TABS) {
        const count = await page.locator(`#atelierSidebarDrawer button[data-page="${id}"]`).count();
        if (count === 0) missing.push(id);
      }
      expect(missing, `sidebar tabs missing from the mobile drawer: ${missing.join(", ")}`).toHaveLength(0);
    });

    for (const id of NAV_TABS) {
      test(`tab "${id}" activates via the drawer without an uncaught error or horizontal overflow (${viewport.name})`, async ({ page }) => {
        await mockBackend(page);
        await withFakeSession(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });

        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error));

        await page.goto("/");
        await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

        await page.locator("#atelierMenuToggle").click();
        await expect(page.locator("body")).toHaveClass(/atelier-drawer-open/);

        const navButton = page.locator(`#atelierSidebarDrawer button[data-page="${id}"]`);
        await expect(navButton).toBeVisible();
        await navButton.click();

        // Opening a tab from the drawer closes the drawer (see wireChrome's
        // delegated click handler in florisyn-atelier-dashboard.js).
        await expect(page.locator("body")).not.toHaveClass(/atelier-drawer-open/);
        await expect(page.locator(`#${id}`)).toHaveClass(/active/, { timeout: 5_000 });

        // Give any async load() a moment to paint before measuring overflow.
        await page.waitForTimeout(150);
        const overflow = await scrollWidthOverflow(page);

        expect(
          pageErrors,
          `uncaught script error activating "${id}" at ${viewport.width}px: ${pageErrors.map((e) => e.message).join("; ")}`,
        ).toHaveLength(0);
        expect(
          overflow,
          `"${id}" scrolls horizontally at ${viewport.width}px (overflow: ${overflow}px) — some element is wider than the viewport instead of scrolling in its own container`,
        ).toBeLessThanOrEqual(4);
      });
    }
  });
}
