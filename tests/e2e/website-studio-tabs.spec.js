import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Regression test for the "jumbled mess" Website Studio bug: an older,
 * fully-functional builder ("Website Studio X" — brand info, hero photo
 * picker, save/preview) was never folded into the Aug 15 tab consolidation
 * and rendered unconditionally underneath the tabs, stacked on top of
 * whichever of the five modern panels was active. This asserts the whole
 * page is now properly tabbed: exactly one panel visible at a time, and
 * every panel — including the legacy builder — is reachable through a tab.
 */
test("Website Studio renders one tab panel at a time, with the legacy builder contained in its own tab", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await expect(page.locator("#websitePage")).toHaveClass(/active/, { timeout: 5_000 });

  const tabs = page.locator("#websitePage .ws-shell-tab");
  await expect(tabs).toHaveCount(4);

  const tabIds = ["start", "brand", "editor", "look"];
  for (const tabId of tabIds) {
    await page.locator(`#websitePage #wsTab-${tabId}`).click();

    // Exactly one panel is visible at a time.
    const visiblePanels = page.locator("#websitePage .ws-shell-panel:not([hidden])");
    await expect(visiblePanels).toHaveCount(1);
    await expect(page.locator(`#websitePage #wsPanel-${tabId}`)).not.toHaveAttribute("hidden", "");

    // The legacy "Website Studio X" builder only shows up on its own tab,
    // never stacked underneath the others.
    const legacyVisible = await page.locator("#websitePage .legacy-website-editor-shell").isVisible();
    expect(legacyVisible).toBe(tabId === "brand");
  }

  // The legacy builder's real controls (save, photo picker) are present
  // and reachable once its tab is selected.
  await page.locator("#websitePage #wsTab-brand").click();
  await expect(page.locator("#websiteForm")).toBeVisible();
  await expect(page.locator("#saveWebsite")).toBeVisible();
  await expect(page.locator(".image-picker.photo-gallery button[data-hero-image]").first()).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
