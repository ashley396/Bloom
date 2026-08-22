import { test, expect } from "@playwright/test";
import { withFakeSession, mockBackend } from "./fixtures.mjs";

/**
 * Billion-dollar design pass: the per-page "HELP" bar (injectPageHelp in
 * launch-polish.js) used to render as an always-open title+body+actions
 * block on every navigation — on image-forward pages (Floral Library,
 * Website Studio, Lily AI Studio) that was enough real estate to push the
 * page's own content down. Rebuilt as a native <details> that renders as
 * one compact row by default (matching the collapsed-by-default pattern
 * already used for the assistant voice panels in Settings) and reveals
 * Ask Lily / Learn more — unchanged — on click. POS still opts out
 * entirely; that regression coverage lives in
 * onboarding-banner-shell-position.spec.js's sibling file for the
 * checklist banner, not here.
 */

const IMAGE_FORWARD_ROUTES = ["libraryPage", "aiStudioPage"];
const OTHER_ROUTES = ["dashboardPage", "ordersPage", "customersPage", "inventoryPage", "settingsPage"];

// websitePage is deliberately excluded here: injectPageHelp's anchor logic
// (`page.querySelector(".heading") || page.firstElementChild`) finds a
// `.heading` that lives inside Website Studio's own hidden "Brand" tab
// panel (#wsPanel-brand, display:none until that tab is selected) and
// inserts the whole bar there — a pre-existing, unrelated mis-anchor bug
// that predates this pass (confirmed present on the beta baseline before
// any of these changes) and made the help bar invisible on this page
// under both the old always-open markup and the new compact one. Left
// unfixed per "do not make unrelated changes"; flagged separately.

test.describe("per-page Help bar is compact and collapsed by default", () => {
  for (const pageId of [...IMAGE_FORWARD_ROUTES, ...OTHER_ROUTES]) {
    test(`${pageId}: renders as a single collapsed row, not an open title+body block`, async ({ page }) => {
      await mockBackend(page);
      await withFakeSession(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
      await page.evaluate((id) => window.showPage && window.showPage(id), pageId);
      await page.waitForTimeout(300);

      const help = page.locator(`#${pageId} .bloom-page-help`);
      await expect(help).toBeVisible();

      const isDetails = await help.evaluate((el) => el.tagName === "DETAILS");
      expect(isDetails, "the help bar must be a native <details> element for built-in keyboard/a11y support").toBe(true);

      const isOpen = await help.evaluate((el) => el.open);
      expect(isOpen, "the help bar must be collapsed by default, not pre-expanded").toBe(false);

      const box = await help.boundingBox();
      expect(box.height, "collapsed, the help bar must stay a single compact row").toBeLessThan(60);

      // The body copy and action buttons must not be visible while collapsed.
      await expect(page.locator(`#${pageId} .bloom-page-help-panel`)).toBeHidden();
    });
  }

  test("clicking the summary expands the panel and Ask Lily / Learn more still work", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.evaluate(() => window.showPage && window.showPage("ordersPage"));
    await page.waitForTimeout(300);

    const help = page.locator("#ordersPage .bloom-page-help");
    await help.locator("summary").click();

    await expect(help).toHaveJSProperty("open", true);
    const panel = page.locator("#ordersPage .bloom-page-help-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator("[data-page-help-lily]")).toBeVisible();
    await expect(panel.locator(".bloom-page-help-actions a")).toBeVisible();

    // Collapsing again hides the panel without losing the actions from the DOM.
    await help.locator("summary").click();
    await expect(help).toHaveJSProperty("open", false);
    await expect(panel).toBeHidden();
  });

  test("POS has no Help bar at all, collapsed or otherwise", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.evaluate(() => window.showPage && window.showPage("posPage"));
    await page.waitForTimeout(300);

    await expect(page.locator("#posPage .bloom-page-help")).toHaveCount(0);
  });

  for (const [name, viewport] of Object.entries({
    "narrow-desktop": { width: 1024, height: 800 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 375, height: 812 },
  })) {
    test(`floral library: help bar stays a compact collapsed row at ${name}`, async ({ page }) => {
      await mockBackend(page);
      await withFakeSession(page);
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
      await page.evaluate(() => window.showPage && window.showPage("libraryPage"));
      await page.waitForTimeout(300);

      const help = page.locator("#libraryPage .bloom-page-help");
      await expect(help).toBeVisible();
      const box = await help.boundingBox();
      expect(box.height, `collapsed help bar must stay compact at ${name}`).toBeLessThan(60);
      await expect(page.locator("#libraryPage .bloom-page-help-panel")).toBeHidden();
    });
  }

  test("Floral Library's own gallery content sits above the fold at 1440x900 with the collapsed help bar in place", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.evaluate(() => window.showPage && window.showPage("libraryPage"));
    await page.waitForTimeout(300);

    const heading = page.locator("#libraryPage .heading").first();
    await expect(heading).toBeVisible();
    const headingBox = await heading.boundingBox();
    expect(headingBox.y, "the page heading must render above the fold").toBeLessThan(900);
  });
});
