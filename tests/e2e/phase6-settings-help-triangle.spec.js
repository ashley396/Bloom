import { test, expect } from "@playwright/test";
import { withFakeSession, mockBackend } from "./fixtures.mjs";

/**
 * Billion-dollar design pass, Phase 6 (Settings/polish) audit fix.
 *
 * Confirmed bug: Settings' own collapsible sections (e.g. "Advanced:
 * connection & local AI bridge") draw their disclosure triangle via a
 * broad, page-wide rule — #settingsPage details>summary::before{content:
 * "▸"} in styles.css. .bloom-page-help is itself a <details> that lives
 * inside #settingsPage, so that broad selector also matched its
 * <summary> and injected a second, stray plum triangle at the Help bar's
 * far-left edge, disconnected from the Help bar's own chevron indicator.
 */
test("Settings page: the compact Help bar has no stray disclosure triangle", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
  await page.evaluate(() => window.showPage && window.showPage("settingsPage"));
  await page.waitForTimeout(400);

  const summary = page.locator("#settingsPage .bloom-page-help summary");
  await expect(summary).toBeVisible();

  const beforeContent = await summary.evaluate((el) => getComputedStyle(el, "::before").content);
  expect(beforeContent, "the Help bar's summary must not have Settings' own disclosure triangle injected via ::before").not.toBe('"▸"');

  // Settings' own, legitimate disclosure triangles (e.g. the AI Advanced
  // section) must be completely unaffected by the fix.
  const advancedSummary = page.locator("#settingsPage details.ai-advanced-details summary");
  if (await advancedSummary.count()) {
    const advancedBefore = await advancedSummary.first().evaluate((el) => getComputedStyle(el, "::before").content);
    expect(advancedBefore, "Settings' own collapsible sections must keep their triangle").toBe('"▸"');
  }
});
