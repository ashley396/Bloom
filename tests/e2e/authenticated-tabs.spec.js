import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Clicks through every sidebar tab with a simulated logged-in session and
 * mocked Netlify Function responses (no real Supabase/Stripe exists in
 * this sandbox). This answers a narrower, honest question than "does
 * every feature work correctly with real data": does every tab render
 * without throwing an uncaught JS error, given the session is valid?
 *
 * A caught error that surfaces as a toast/error-state (this app wraps
 * every page-load call in try/catch — see loadPage() in app.js) is not a
 * crash and is reported separately, not failed here. An *uncaught*
 * exception (page.on('pageerror')) is what would actually break the tab
 * for a real florist, so that's the hard failure condition.
 */

// The 30 primary sidebar items, read directly from
// nav.florisyn-lux-nav in public/index.html — reachable with one click
// from the sidebar itself.
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
  "marketingStudioPage",
  "weddingsPage",
  "holidayPage",
  "staffPage",
  "marketplacePage",
  "storesPage",
  "ecosystemPage",
  "posSettingsPage",
  "settingsPage",
];

// Two more pages exist but are deliberately not top-level sidebar items —
// they're reached via a button inside another page, matching the
// "SELLER DASHBOARD" / "SUBSCRIPTION" sub-items in the sidebar spec. Each
// entry names the page that actually hosts its entry-point button
// (verified against public/index.html directly — Marketplace's "Sell"
// panel has "Open seller dashboard", and Settings' billing panel has
// "Open Subscription Center"; Stores and Business OS were both a
// reasonable-looking but wrong first guess). wholesaleSellerPage's button
// additionally sits inside a "Sell" sub-tab of Marketplace that isn't
// active by default (public/marketplace-experience.js toggles it via
// #marketplaceTabSell), hence the optional preClick.
const SECONDARY_TABS = [
  { id: "wholesaleSellerPage", fromTab: "marketplacePage", preClick: "#marketplaceTabSell" },
  // Settings reorganization (UX cleanup Part C): "Open Subscription Center"
  // now lives inside the Billing tab, not the default Shop tab.
  { id: "subscriptionPage", fromTab: "settingsPage", preClick: '#settingsPage [data-settings-tab="billing"]' },
  // Marketing navigation cleanup: Email Campaigns no longer has its own
  // standalone sidebar entry — reached via Marketing's own Overview tab.
  { id: "emailCampaignsPage", fromTab: "marketingPage", entrySelector: '[data-marketing-goto="emailCampaignsPage"]' },
];

test.describe("Florisyn authenticated sidebar tabs (simulated session)", () => {
  test("every primary sidebar tab is present in the nav", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

    const missing = [];
    for (const id of NAV_TABS) {
      const count = await page.locator(`nav.florisyn-lux-nav button[data-page="${id}"]`).count();
      if (count === 0) missing.push(id);
    }
    expect(missing, `sidebar tabs missing from the nav: ${missing.join(", ")}`).toHaveLength(0);
  });

  for (const id of NAV_TABS) {
    test(`tab "${id}" activates without an uncaught script error`, async ({ page }) => {
      await mockBackend(page);
      await withFakeSession(page);

      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error));

      await page.goto("/");
      await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

      const navButton = page.locator(`nav.florisyn-lux-nav button[data-page="${id}"]`);
      await expect(navButton).toBeVisible();
      await navButton.click();

      // Page-level content sections use .page.active (see syncPageVisibility
      // in app.js); give any async load() a moment to settle.
      await expect(page.locator(`#${id}`)).toHaveClass(/active/, { timeout: 5_000 });

      expect(
        pageErrors,
        `uncaught script error activating "${id}": ${pageErrors.map((e) => e.message).join("; ")}`,
      ).toHaveLength(0);
    });
  }

  for (const { id, fromTab, preClick, entrySelector } of SECONDARY_TABS) {
    test(`secondary page "${id}" (reached from "${fromTab}") activates without an uncaught script error`, async ({
      page,
    }) => {
      await mockBackend(page);
      await withFakeSession(page);

      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error));

      await page.goto("/");
      await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

      await page.locator(`nav.florisyn-lux-nav button[data-page="${fromTab}"]`).click();
      await expect(page.locator(`#${fromTab}`)).toHaveClass(/active/, { timeout: 5_000 });

      if (preClick) {
        await page.locator(preClick).click();
      }

      const entryButton = page.locator(entrySelector || `#${fromTab} [data-page="${id}"]`).first();
      await expect(entryButton).toBeVisible({ timeout: 5_000 });
      await entryButton.click();
      await expect(page.locator(`#${id}`)).toHaveClass(/active/, { timeout: 5_000 });

      expect(
        pageErrors,
        `uncaught script error activating "${id}": ${pageErrors.map((e) => e.message).join("; ")}`,
      ).toHaveLength(0);
    });
  }
});
