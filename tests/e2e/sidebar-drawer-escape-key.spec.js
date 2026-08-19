import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Coverage gap found during the accessibility audit pass, not a bug: the
 * mobile nav drawer (#atelierSidebarDrawer) is a custom overlay, not a
 * native <dialog>, so a first read suggested it might be missing the
 * browser's free Escape-to-close. It isn't — public/core/florisyn-platform.js
 * already wires a real wireEscapeClose() that closes the drawer on Escape
 * (missed on the first pass because it lives under public/core/, outside
 * the public/*.js glob that pass searched). It just had zero e2e coverage,
 * so a future regression there would go unnoticed. This closes that gap
 * rather than re-fixing something that already works.
 */
test("pressing Escape closes the mobile nav drawer and returns focus to the toggle", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });

  const menuToggle = page.locator("#atelierMenuToggle");
  await menuToggle.click();
  await page.waitForTimeout(400);

  const drawer = page.locator("#atelierSidebarDrawer");
  await expect(drawer).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/atelier-drawer-open/);

  // Dispatch the keydown directly rather than page.keyboard.press(): a real
  // OS-level Escape can also trigger unrelated native browser chrome (e.g.
  // dismissing a password-manager suggestion), which this sandboxed
  // Chromium build surfaces as its own DOM side effects — noise this
  // assertion doesn't want. Targeting the app's own listener directly
  // keeps the test isolated to the behavior actually being verified.
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  await expect(page.locator("body")).not.toHaveClass(/atelier-drawer-open/);
  await expect(page.locator("#atelierSidebarBackdrop")).toBeHidden();
  await expect(menuToggle).toBeFocused();
});
