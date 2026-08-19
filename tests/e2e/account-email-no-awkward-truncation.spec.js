import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * The header's account email pill (#accountEmail) was capped at a
 * cramped 140px with an ellipsis, cutting most real addresses off mid
 * domain (e.g. "smoke-test@example.i…") and offering no way to see the
 * rest. Verifies it now has more room on desktop, and always carries the
 * full address in a title tooltip regardless of how much gets clipped.
 */
test("account email has breathing room and a full-address tooltip", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);

  const email = page.locator("#accountEmail");
  await expect(email).toHaveAttribute("title", "smoke-test@example.invalid");

  const maxWidth = await email.evaluate((el) => parseFloat(getComputedStyle(el).maxWidth));
  expect(maxWidth).toBeGreaterThan(140);
});
