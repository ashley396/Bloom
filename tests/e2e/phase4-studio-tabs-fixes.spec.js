import { test, expect } from "@playwright/test";
import { withFakeSession, mockBackend } from "./fixtures.mjs";

/**
 * Billion-dollar design pass, Phase 4 (Floral Library / Photo Studio /
 * Website Studio / Lily AI Studio / Weddings / Holiday Command) audit fixes.
 *
 * Both fixes here are the same collision bug already fixed once for
 * .bos-tabs in Phase 3, found again on two more tab rows that share the
 * "overflow-x:auto row + flex items default to flex-shrink:1" pattern.
 */

const TAB_ROWS = [
  {
    page: "websitePage",
    row: "#websitePage .ws-shell-tabs",
    tabs: "#websitePage .ws-shell-tab",
    label: "Website Studio's own tab shell (Get started / Brand & photos / Editor / Templates)",
  },
  {
    page: "aiStudioPage",
    row: "#aiStudioPage .lux-ai-tabs",
    tabs: "#aiStudioPage .lux-ai-tabs button",
    label: "Lily AI Studio's tab row (Lily AI Studio / Ask Lily / Website Studio / Learn More)",
  },
];

for (const { page: pageId, row, tabs, label } of TAB_ROWS) {
  test.describe(`${label}: tabs never collide on narrow screens`, () => {
    test("mobile: every tab stays single-line at its own text's width, row scrolls instead", async ({ page }) => {
      await mockBackend(page);
      await withFakeSession(page);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/");
      await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
      await page.evaluate((id) => window.showPage && window.showPage(id), pageId);
      await page.waitForTimeout(400);

      const tabEls = page.locator(tabs);
      const count = await tabEls.count();
      expect(count).toBeGreaterThanOrEqual(2);

      for (let i = 0; i < count; i++) {
        const tab = tabEls.nth(i);
        const { whiteSpace, flexShrink, scrollWidth, clientWidth } = await tab.evaluate((el) => ({
          whiteSpace: getComputedStyle(el).whiteSpace,
          flexShrink: getComputedStyle(el).flexShrink,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        }));
        expect(whiteSpace, `tab ${i} must stay nowrap, not fall back to a broad button rule's white-space:normal`).toBe("nowrap");
        expect(flexShrink, `tab ${i} must have flex-shrink:0`).toBe("0");
        expect(scrollWidth, `tab ${i}'s text must not overflow its own box`).toBeLessThanOrEqual(clientWidth + 1);
      }

      const rowOverflow = await page.locator(row).evaluate((el) => getComputedStyle(el).overflowX);
      expect(rowOverflow).toBe("auto");
    });

    test("desktop: tab row stays a single unscrolled line, unchanged by the mobile fix", async ({ page }) => {
      await mockBackend(page);
      await withFakeSession(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
      await page.evaluate((id) => window.showPage && window.showPage(id), pageId);
      await page.waitForTimeout(400);

      const rowLoc = page.locator(row);
      const scrollWidth = await rowLoc.evaluate((el) => el.scrollWidth);
      const clientWidth = await rowLoc.evaluate((el) => el.clientWidth);
      expect(scrollWidth, "at desktop widths all tabs must fit without scrolling").toBeLessThanOrEqual(clientWidth + 1);
    });
  });
}
