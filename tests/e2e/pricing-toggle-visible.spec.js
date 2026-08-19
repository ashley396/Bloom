import { test, expect } from "@playwright/test";

/**
 * pricing.css's active-toggle rule (.pricing-toggle button.is-active)
 * painted the selected billing-interval pill using var(--sage) with no
 * fallback. --sage is only defined in public-site.css's :root — and
 * signup.html (unlike the company/pricing page) never loads that
 * stylesheet, so the variable resolved to nothing there. The result:
 * the default-selected "Monthly" button got white text (color: #fff is
 * hardcoded) on a transparent background, making it invisible against
 * the page. Verifies the active pill always renders with a real,
 * readable background regardless of which page includes pricing.css.
 */
test("signup page's billing toggle active pill is visible, not white-on-transparent", async ({ page }) => {
  await page.goto("/signup");
  const monthly = page.locator('[data-billing-interval="monthly"]');
  await expect(monthly).toBeVisible();
  await expect(monthly).toHaveAttribute("aria-pressed", "true");

  const bg = await monthly.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(bg).not.toBe("transparent");
});

test("company pricing page's billing toggle active pill is visible", async ({ page }) => {
  await page.goto("/company/pricing/");
  const monthly = page.locator('[data-billing-interval="monthly"]');
  await expect(monthly).toBeVisible();
  const bg = await monthly.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
});
