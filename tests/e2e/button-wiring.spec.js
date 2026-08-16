import { test, expect } from "@playwright/test";

/**
 * florisyn-router.js's onNavClick only wires up navigation for elements
 * that satisfy two conditions (see public/florisyn-router.js): the
 * element itself must match `button, a, [role="button"],
 * .atelier-inventory-alert, .atelier-panel-more, .atelier-view-all`, AND
 * it must sit inside one of a fixed list of shell containers. Anything
 * else carrying a `data-page`/`data-route` attribute — a bare `<div>` or
 * `<span>`, or one sitting outside those containers — is inert: it looks
 * clickable but does nothing. That exact bug class already happened once
 * in this app (dashboard calendar chips had to be rebuilt as real
 * <button> elements to become clickable) — this test catches it
 * mechanically instead of relying on someone noticing by hand.
 *
 * This runs against the live DOM (after the app has actually booted with
 * a simulated session) rather than grepping index.html's source, so it
 * also covers markup injected by any page's own JS at load time.
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
  await page.route("**/.netlify/functions/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

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

// Mirrors the exact allow-list in florisyn-router.js's onNavClick.
const CLICKABLE_SELECTOR = "button, a, [role='button'], .atelier-inventory-alert, .atelier-panel-more, .atelier-view-all";
const SHELL_SELECTOR =
  "#atelierSidebarDrawer, .florisyn-lux-nav, .mobile-nav, .atelier-mobile-nav, .assistant-mini-dock, .florisyn-lux-header, .atelier-premium-card, .atelier-panel-head, .atelier-inventory-alert, .atelier-empty, .content, .atelier-dash-overview";

function findInertNavTriggers() {
  const offenders = [];
  document.querySelectorAll("[data-page], [data-route]").forEach((el) => {
    if (el.closest("dialog")) return; // dialogs use data-page/data-route differently (form context)
    if (el.hasAttribute("data-open")) return;
    if (el.matches("option, select, input, textarea, label")) return;

    const inShell = el.closest(SHELL_SELECTOR);
    const clickable = el.matches(CLICKABLE_SELECTOR);
    if (!inShell || !clickable) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: el.className || null,
        dataPage: el.getAttribute("data-page"),
        dataRoute: el.getAttribute("data-route"),
        reason: !inShell ? "outside any shell container the router listens on" : "not a clickable element type",
      });
    }
  });
  return offenders;
}

test.describe("Florisyn button wiring integrity (simulated session)", () => {
  for (const id of NAV_TABS) {
    test(`no inert data-page/data-route triggers on "${id}"`, async ({ page }) => {
      await mockBackend(page);
      await page.addInitScript((session) => {
        localStorage.setItem("bloom_session", JSON.stringify(session));
      }, FAKE_SESSION);

      await page.goto("/");
      await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

      const navButton = page.locator(`nav.florisyn-lux-nav button[data-page="${id}"]`);
      await navButton.click();
      await expect(page.locator(`#${id}`)).toHaveClass(/active/, { timeout: 5_000 });

      const offenders = await page.evaluate(findInertNavTriggers);
      expect(
        offenders,
        `inert navigation trigger(s) on "${id}": ${JSON.stringify(offenders, null, 2)}`,
      ).toHaveLength(0);
    });
  }
});
