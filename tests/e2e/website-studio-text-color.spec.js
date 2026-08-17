import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Website Studio X's "Text color" control (public/index.html, name="text_color")
 * must actually recolor the live preview's headings/body copy — not just sit
 * there as an inert swatch. Regression coverage for a real bug found while
 * building this: a global `h1,h2,h3{color:#44363d}` rule (public/styles.css)
 * directly matches every heading in the preview, and a DIRECT match always
 * beats an INHERITED color regardless of specificity — so simply setting
 * `color` on the preview's container had zero visible effect. The hero
 * headline must stay white for contrast over its photo/gradient background
 * regardless of the chosen text color.
 */
test("changing Website Studio's text color recolors preview headings/body but keeps the hero white", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await page.locator("#websitePage #wsTab-brand").click();

  const textColorInput = page.locator('#websiteForm input[name="text_color"]');
  await expect(textColorInput).toBeVisible();

  await textColorInput.evaluate((el) => {
    el.value = "#146c3f";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const heroHeading = page.locator("#websitePreview .hero-copy h2");
  const featuredHeading = page.locator("#websitePreview .preview-featured h3");
  const aboutParagraph = page.locator("#websitePreview .preview-story p:not(.eyebrow)");

  await expect(featuredHeading).toHaveCSS("color", "rgb(20, 108, 63)");
  await expect(aboutParagraph).toHaveCSS("color", "rgb(20, 108, 63)");
  await expect(heroHeading).toHaveCSS("color", "rgb(255, 255, 255)");
});
