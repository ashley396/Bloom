import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Photo Studio's file upload input (#bloomshotFile) is styled as a large,
 * fully-clickable dropzone (.bloomshot-upload input has
 * position:absolute;inset:0;opacity:0 covering the whole card) but the
 * wrapping element was a plain <div>, not a <label for="bloomshotFile">.
 * Sighted mouse users could still click anywhere on the zone, but a
 * screen reader landing on the input announced only an unlabeled file
 * control — no indication it was for uploading an arrangement photo.
 * Fixed by making the wrapper a real <label>, which is also inherently
 * keyboard-accessible (the input keeps native Tab/Enter/Space behavior).
 */
test("Photo Studio's upload control has a real accessible label", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="bloomshotPage"]').click();

  const input = page.locator("#bloomshotFile");
  await expect(input).toBeVisible();

  const accessibleName = await input.evaluate((el) => {
    // Mirrors how assistive tech resolves a form control's name: an
    // explicit <label for>, then aria-label/aria-labelledby.
    const label = document.querySelector(`label[for="${el.id}"]`);
    return label ? label.textContent.trim() : el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || "";
  });
  expect(accessibleName.length).toBeGreaterThan(0);
  expect(accessibleName).toContain("arrangement photo");
});
