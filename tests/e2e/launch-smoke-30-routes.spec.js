import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Launch-repair Area 8: the final click-through smoke test across the
 * launch-repair spec's named ~30 routes, at its exact three viewports
 * (1440x900 desktop, 1024x768 narrow desktop, 375x812 mobile) — numbers
 * distinct from the 390/820 pair mobile-tablet-nav-sweep.spec.js already
 * covers and the unspecified default width authenticated-tabs.spec.js
 * uses. Two things actually catch a real regression here: an uncaught
 * script error, and the page scrolling sideways (this app's convention is
 * overflow-x:auto on individual wide containers, never the page itself —
 * see mobile-tablet-nav-sweep.spec.js's own note). A route landing
 * anywhere other than the page it asked for is the "accidental redirect"
 * the spec calls out by name.
 */

const VIEWPORTS = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "narrow-desktop-1024x768", width: 1024, height: 768 },
  { name: "mobile-375x812", width: 375, height: 812 },
];

// Every authenticated route from the spec's named list, with the sidebar
// page id FlorisynRouter resolves it to (verified against the
// data-route attributes in public/index.html).
const AUTH_ROUTES = [
  { path: "/dashboard", page: "dashboardPage" },
  { path: "/pos", page: "posPage" },
  { path: "/orders", page: "ordersPage" },
  { path: "/inventory", page: "inventoryPage" },
  { path: "/products", page: "productsPage" },
  { path: "/bouquets", page: "bouquetsPage" },
  { path: "/customers", page: "customersPage" },
  { path: "/deliveries", page: "deliveriesPage" },
  { path: "/payment-centre", page: "paymentsPage" },
  { path: "/lily-ai-studio", page: "aiStudioPage" },
  { path: "/analytics", page: "analyticsPage" },
  { path: "/reports", page: "reportsPage" },
  { path: "/expenses", page: "expensesPage" },
  { path: "/invoices", page: "invoicesPage" },
  { path: "/photo-studio", page: "bloomshotPage" },
  { path: "/website-studio", page: "websitePage" },
  { path: "/floral-library", page: "libraryPage" },
  { path: "/community", page: "communityPage" },
  { path: "/florist-network", page: "floristNetworkPage" },
  { path: "/marketing", page: "marketingPage" },
  { path: "/marketing/email-campaigns", page: "emailCampaignsPage" },
  { path: "/weddings", page: "weddingsPage" },
  { path: "/holiday-command", page: "holidayPage" },
  { path: "/staff", page: "staffPage" },
  { path: "/wholesale", page: "marketplacePage" },
  { path: "/stores", page: "storesPage" },
  { path: "/business-os", page: "ecosystemPage" },
  { path: "/pos-settings", page: "posSettingsPage" },
  { path: "/settings", page: "settingsPage" },
];

// Public routes, unauthenticated.
const PUBLIC_ROUTES = ["/", "/signup", "/verify-email", "/login"];

async function scrollWidthOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

for (const viewport of VIEWPORTS) {
  test.describe(`Launch smoke: public routes at ${viewport.name}`, () => {
    for (const path of PUBLIC_ROUTES) {
      test(`${path}: loads without a script error or horizontal overflow`, async ({ page }) => {
        const pageErrors = [];
        page.on("pageerror", (err) => pageErrors.push(err.message));

        await page.setViewportSize(viewport);
        await page.goto(path);
        await page.waitForLoadState("networkidle");

        const overflow = await scrollWidthOverflow(page);
        expect(overflow, `${path} must not scroll horizontally at ${viewport.name}`).toBeLessThanOrEqual(2);
        expect(pageErrors, `${path} must not throw an uncaught script error`).toEqual([]);
      });
    }
  });

  test.describe(`Launch smoke: authenticated routes at ${viewport.name}`, () => {
    for (const { path, page: pageId } of AUTH_ROUTES) {
      test(`${path} (${pageId}): loads without a script error, no overflow, lands on the right page`, async ({ page }) => {
        const pageErrors = [];
        page.on("pageerror", (err) => pageErrors.push(err.message));

        await mockBackend(page);
        await withFakeSession(page);
        await page.setViewportSize(viewport);
        await page.goto(path);
        await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(300);

        // No accidental redirect: the page this route asked for is the
        // one actually showing (active, not display:none via CSS).
        const section = page.locator(`#${pageId}`);
        await expect(section).toHaveClass(/active/);

        const overflow = await scrollWidthOverflow(page);
        expect(overflow, `${path} must not scroll horizontally at ${viewport.name}`).toBeLessThanOrEqual(2);
        expect(pageErrors, `${path} must not throw an uncaught script error`).toEqual([]);

        // The app shell itself (header + sidebar) never collapses, on any
        // route or viewport — this is the exact DOM node Area 3's
        // onboarding-banner regression used to render above.
        await expect(page.locator("#app > .shell > .florisyn-lux-main > header")).toBeVisible();
      });
    }
  });
}
