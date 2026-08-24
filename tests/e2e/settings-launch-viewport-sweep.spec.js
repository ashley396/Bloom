import { test, expect } from "@playwright/test";
import { withFakeSession, mockBackend } from "./fixtures.mjs";

/**
 * Launch-repair Area 2: confirms PR #169's Settings + assistant panel
 * repair holds at the exact viewports the launch-repair spec calls for —
 * 1440 desktop, 1024 narrow desktop, 768 tablet, 375 mobile. PR #169's own
 * regression suite (settings-and-assistant-panel-repair.spec.js) tested
 * 820 and 390 instead of 768/375; both pairs land inside the same
 * `max-width: 980px` responsive breakpoint (see that spec's own note), so
 * this isn't expected to surface a *new* bug, but the spec asks for these
 * specific numbers verified, not merely "some tablet/mobile width" — so
 * this file checks them directly rather than assuming coverage transfers.
 */

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  "narrow-desktop": { width: 1024, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

async function scrollWidthOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function openSettings(page, viewport, { tab } = {}) {
  await mockBackend(page);
  await withFakeSession(page);
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
  await page.evaluate(() => window.showPage && window.showPage("settingsPage"));
  await page.waitForTimeout(300);
  // Priority 13 fix: Settings is now tabbed (Shop/Branding/AI &
  // Assistants/Billing/Data & Migration/Florisyn); Daisy's panel lives
  // under "Florisyn", hidden until that tab is clicked — see the sibling
  // spec's matching note for the full explanation.
  if (tab) {
    await page.click(`#settingsPage [data-settings-tab="${tab}"]`);
    await page.waitForTimeout(100);
  }
}

test.describe("Settings page at the launch-repair spec's exact viewports", () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`${name} (${viewport.width}x${viewport.height}): no horizontal overflow, shell intact, cards not clipped`, async ({ page }) => {
      await openSettings(page, viewport);

      const overflow = await scrollWidthOverflow(page);
      expect(overflow, "settings page must not scroll horizontally").toBeLessThanOrEqual(1);

      // The app shell's own header must still render at every one of
      // these widths — this is exactly the DOM node the onboarding-banner
      // regression (Area 3) used to render above; confirm the shell
      // itself never collapses/disappears at these breakpoints.
      const header = page.locator("#app > .shell > .florisyn-lux-main > header");
      await expect(header).toBeVisible();
      const headerBox = await header.boundingBox();
      expect(headerBox.width).toBeGreaterThan(0);

      // Every visible settings card stays within the viewport — none
      // clipped off the right edge by a fixed/overflowing width.
      const cardRights = await page.locator("#settingsPage .settings-grid > *").evaluateAll((els) =>
        els
          .filter((el) => el.offsetParent !== null)
          .map((el) => Math.round(el.getBoundingClientRect().right)),
      );
      for (const right of cardRights) {
        expect(right, "a settings card must not extend past the viewport's right edge").toBeLessThanOrEqual(
          viewport.width + 1,
        );
      }
    });
  }

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`${name} (${viewport.width}x${viewport.height}): Daisy's checkboxes still render beside their labels, not stacked`, async ({ page }) => {
      await openSettings(page, viewport, { tab: "florisyn" });

      const hideDaisyLabel = page.locator("#daisySettingsPanel label.check", { hasText: "Hide Daisy" });
      await expect(hideDaisyLabel).toBeVisible();
      const flexDirection = await hideDaisyLabel.evaluate((el) => getComputedStyle(el).flexDirection);
      expect(flexDirection).toBe("row");

      const checkbox = hideDaisyLabel.locator('input[type="checkbox"]');
      const checkboxBox = await checkbox.boundingBox();
      const labelBox = await hideDaisyLabel.boundingBox();
      // The checkbox must sit within the label's own box (beside the
      // text), never floating outside it above/below.
      expect(checkboxBox.y).toBeGreaterThanOrEqual(labelBox.y - 2);
      expect(checkboxBox.y + checkboxBox.height).toBeLessThanOrEqual(labelBox.y + labelBox.height + 2);
    });
  }
});

test.describe("Assistant panel at the launch-repair spec's exact viewports", () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`${name} (${viewport.width}x${viewport.height}): panel stays bounded, no horizontal page overflow`, async ({ page }) => {
      await mockBackend(page);
      await withFakeSession(page);
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
      await page.click("#lilyFab");

      const box = await page.locator("#lilyPanel").boundingBox();
      expect(box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.height).toBeLessThanOrEqual(viewport.height);
      expect(box.width).toBeLessThanOrEqual(viewport.width - 16);

      const overflow = await scrollWidthOverflow(page);
      expect(overflow, "opening the assistant panel must not cause page-level horizontal overflow").toBeLessThanOrEqual(1);
    });
  }

  test("375 mobile: the panel head row still does not wrap its buttons onto the persona nav below it", async ({ page }) => {
    await mockBackend(page);
    await withFakeSession(page);
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/");
    await page.waitForSelector("#app:not([hidden])", { timeout: 10_000 });
    await page.click("#lilyFab");

    const head = page.locator("#lilyPanel .lily-panel-head");
    const flexWrap = await head.evaluate((el) => getComputedStyle(el).flexWrap);
    expect(flexWrap).toBe("nowrap");

    const headBox = await head.boundingBox();
    const personasBox = await page.locator("#lilyPersonas").boundingBox();
    // A few px of tolerance for getBoundingClientRect's own sub-pixel
    // rounding noise (observed up to ~0.3px under parallel-worker CPU
    // contention — the identical class of flake PR #169's own version of
    // this assertion hit at 390 width) — a real wrap would overlap by
    // many pixels, not a fraction of one.
    expect(personasBox.y).toBeGreaterThanOrEqual(headBox.y + headBox.height - 4);
  });
});
