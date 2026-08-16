import { test, expect } from "@playwright/test";

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

const FAKE_SESSION = {
  accessToken: "fake-access-token-for-smoke-test",
  refreshToken: "fake-refresh-token-for-smoke-test",
  user: { id: "smoke-test-user", email: "smoke-test@example.invalid" },
  expiresAt: Date.now() + 60 * 60 * 1000,
};

async function mockBackend(page) {
  await page.route(/fonts\.googleapis\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  await page.route(/fonts\.gstatic\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "font/woff2", body: Buffer.alloc(0) }),
  );
  await page.route(/images\.pexels\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) }),
  );
  // A generic, empty-but-valid JSON body for every Netlify Function call.
  // The load functions in app.js are defensively coded (`.items || []`,
  // optional chaining throughout) specifically so a thin/missing response
  // degrades to an empty state instead of throwing — this exercises that
  // same contract.
  await page.route("**/.netlify/functions/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

async function withFakeSession(page) {
  await page.addInitScript((session) => {
    localStorage.setItem("bloom_session", JSON.stringify(session));
  }, FAKE_SESSION);
}

// The 28 primary sidebar items, read directly from
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
  "emailCampaignsPage",
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
// they're reached via a button inside another page (Stores → "Open seller
// dashboard", Business OS → "Open Subscription Center"), matching the
// "SELLER DASHBOARD" / "SUBSCRIPTION" sub-items in the sidebar spec. Each
// entry names the page that hosts its entry-point button.
const SECONDARY_TABS = [
  { id: "wholesaleSellerPage", fromTab: "storesPage" },
  { id: "subscriptionPage", fromTab: "ecosystemPage" },
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

  for (const { id, fromTab } of SECONDARY_TABS) {
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

      const entryButton = page.locator(`#${fromTab} [data-page="${id}"]`).first();
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
