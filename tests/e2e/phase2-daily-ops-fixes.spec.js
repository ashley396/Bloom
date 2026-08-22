import { test, expect } from "@playwright/test";
import { withFakeSession, mockBackend } from "./fixtures.mjs";

/**
 * Billion-dollar design pass, Phase 2 (daily operations) audit fixes.
 */

test.describe("POS mobile register topbar contains its wrapped content", () => {
  // Confirmed bug: at <=820px, two bare-element "header{...}" rules from
  // polish-v20.2.css (mobile-only, height:auto) and polish-v20.4.css
  // (unconditional, height:72px!important) both match the register's own
  // <header class="pos-lux-topbar"> — a second, unrelated <header> those
  // rules were never written for. The register name/date and the "By
  // Product/By Customer" toggle don't fit on one line at 375px, so
  // polish-v20.2.css's header{flex-wrap:wrap!important} wraps them to a
  // second line — but polish-v20.4.css's unconditional 72px height (same
  // specificity, loaded later) won regardless of viewport, so that second
  // line rendered outside the topbar's own box and visually overlapped the
  // icon rail immediately below it (the rail's rose-pink "Lookup" button
  // was what showed through, behind the toggle pill's left edge).
  for (const [name, viewport] of Object.entries({
    mobile: { width: 375, height: 812 },
    "tablet-narrow": { width: 500, height: 900 },
  })) {
    test(`${name}: the wrapped register topbar never overlaps the icon rail below it`, async ({ page }) => {
      await mockBackend(page);
      await withFakeSession(page);
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
      await page.evaluate(() => window.showPage && window.showPage("posPage"));
      await page.waitForTimeout(400);

      const topbar = page.locator(".pos-lux-topbar");
      const rail = page.locator(".pos-lux-rail");
      await expect(topbar).toBeVisible();
      await expect(rail).toBeVisible();

      const topbarBox = await topbar.boundingBox();
      const railBox = await rail.boundingBox();

      // The topbar's own box must fully contain both of its wrapped rows —
      // i.e. the rail must start at or after the topbar's bottom edge.
      expect(railBox.y, "the icon rail must not start above the topbar's bottom edge").toBeGreaterThanOrEqual(topbarBox.y + topbarBox.height - 1);

      // Every child actually rendered inside the topbar must also fit
      // within its box (nothing spilling out the bottom).
      const register = page.locator(".pos-lux-register");
      const mode = page.locator(".pos-lux-mode");
      const registerBox = await register.boundingBox();
      const modeBox = await mode.boundingBox();
      expect(registerBox.y + registerBox.height, "the register name/label must fit inside the topbar").toBeLessThanOrEqual(topbarBox.y + topbarBox.height + 1);
      expect(modeBox.y + modeBox.height, "the By Product/By Customer toggle must fit inside the topbar, even wrapped to its own row").toBeLessThanOrEqual(topbarBox.y + topbarBox.height + 1);
    });
  }

  test("desktop: the topbar stays a single compact row, unchanged by the mobile fix", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.evaluate(() => window.showPage && window.showPage("posPage"));
    await page.waitForTimeout(400);

    const topbar = page.locator(".pos-lux-topbar");
    const box = await topbar.boundingBox();
    expect(box.height, "at desktop widths the register topbar must stay a single row, not grow").toBeLessThan(90);
  });
});

test.describe("Dashboard's Help bar describes the Dashboard, not POS", () => {
  test("the compact Help bar shows Dashboard copy, not the register's", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.evaluate(() => window.showPage && window.showPage("dashboardPage"));
    await page.waitForTimeout(300);

    const help = page.locator("#dashboardPage .bloom-page-help");
    await expect(help).toBeVisible();
    await expect(help.locator(".bloom-page-help-label")).toContainText("Dashboard");
    await expect(help.locator(".bloom-page-help-label")).not.toContainText(/point of sale/i);

    await help.locator("summary").click();
    const body = help.locator(".bloom-page-help-panel p");
    await expect(body).not.toContainText(/register|ring up orders/i);
  });
});
