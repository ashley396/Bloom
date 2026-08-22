import { test, expect } from "@playwright/test";
import { withFakeSession, mockBackend } from "./fixtures.mjs";

/**
 * Billion-dollar design pass, Phase 3 (daily operations, round 2) audit fixes.
 */

test.describe("Rose (Business OS) tab row never lets buttons collide on narrow screens", () => {
  // Confirmed bug: .bos-tabs sets overflow-x:auto specifically so this row
  // scrolls instead of squeezing on narrow screens, but flex items default
  // to flex-shrink:1 — so at 375px, where "Chat with Rose" + "Business
  // Insights" + "Action Items" + their 22px gaps don't fit, the browser
  // shrank each button's box below its own text's needed width before ever
  // engaging the scroll. white-space:nowrap kept the text from wrapping, so
  // it overflowed its own shrunk box instead — "Business Insights" and
  // "Action Items" visually ran into each other.
  test("mobile: tabs keep flex-shrink:0 so none is squeezed below its own text", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.evaluate(() => window.showPage && window.showPage("ecosystemPage"));
    await page.waitForTimeout(400);

    const tabs = page.locator("#ecosystemPage .bos-tabs button");
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i++) {
      const tab = tabs.nth(i);
      const { flexShrink, scrollWidth, clientWidth } = await tab.evaluate((el) => ({
        flexShrink: getComputedStyle(el).flexShrink,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      // The fix itself: buttons must not shrink below their natural width.
      expect(flexShrink, `tab ${i} must have flex-shrink:0`).toBe("0");
      // If a button's box were squeezed smaller than its nowrap text needs
      // (the bug), the text would overflow the box — scrollWidth would
      // exceed clientWidth. With the fix, the box always matches the text.
      expect(scrollWidth, `tab ${i}'s text must not overflow its own box`).toBeLessThanOrEqual(clientWidth + 1);
    }

    // The row itself must be allowed to overflow (scroll) rather than
    // compress its children — confirms overflow-x:auto is doing its job.
    const rowOverflow = await page.locator("#ecosystemPage .bos-tabs").evaluate((el) => getComputedStyle(el).overflowX);
    expect(rowOverflow).toBe("auto");
  });

  test("desktop: tab row stays a single unscrolled line, unchanged by the mobile fix", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.evaluate(() => window.showPage && window.showPage("ecosystemPage"));
    await page.waitForTimeout(400);

    const row = page.locator("#ecosystemPage .bos-tabs");
    const scrollWidth = await row.evaluate((el) => el.scrollWidth);
    const clientWidth = await row.evaluate((el) => el.clientWidth);
    expect(scrollWidth, "at desktop widths all tabs must fit without scrolling").toBeLessThanOrEqual(clientWidth + 1);
  });
});

test.describe("Every app page has its own compact Help bar copy, not the generic fallback", () => {
  // Confirmed bug: helpCopyForPage() had no entry for 18 of the app's 31
  // pages, so navigating to any of them silently showed the generic
  // "Florisyn / Use Lily for quick actions or open Help for guides." copy
  // instead of anything describing the page you're actually on.
  const CASES = [
    { id: "paymentsPage", title: "Payment Center" },
    { id: "invoicesPage", title: "Invoices" },
    { id: "expensesPage", title: "Expenses" },
    { id: "analyticsPage", title: "Analytics" },
    { id: "ecosystemPage", title: "Rose" },
    { id: "bouquetsPage", title: "Bouquets" },
    { id: "libraryPage", title: "Floral Library" },
    { id: "bloomshotPage", title: "Photo Studio" },
    { id: "weddingsPage", title: "Wedding Workflows" },
    { id: "holidayPage", title: "Holiday Command Center" },
    { id: "communityPage", title: "Florist Community" },
    { id: "floristNetworkPage", title: "Florist Network" },
    { id: "marketingPage", title: "Marketing" },
    { id: "emailCampaignsPage", title: "Email Campaigns" },
    { id: "posSettingsPage", title: "POS Settings" },
    { id: "storesPage", title: "Your flower shops" },
    { id: "subscriptionPage", title: "Subscription" },
  ];

  for (const { id, title } of CASES) {
    test(`${id}: Help bar shows "${title}", not the generic Florisyn fallback`, async ({ page }) => {
      await mockBackend(page);
      await withFakeSession(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
      await page.evaluate((pid) => window.showPage && window.showPage(pid), id);
      await page.waitForTimeout(400);

      const help = page.locator(`#${id} .bloom-page-help`);
      await expect(help).toBeVisible();
      await expect(help.locator(".bloom-page-help-label")).toContainText(title);
    });
  }
});
