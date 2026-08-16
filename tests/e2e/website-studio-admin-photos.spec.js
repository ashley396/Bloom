import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Regression test for the admin photo manager's florist-facing half:
 * real hero photos an admin uploads (context=website_hero) must actually
 * show up in the Website Studio hero picker, including a brand-new
 * category the static picker never had a chip for.
 */
test("admin-uploaded hero photos appear in the Website Studio picker, including a brand-new category", async ({ page }) => {
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));

  // mockBackend() registers a generic **/.netlify/functions/** catch-all —
  // Playwright matches routes in reverse registration order, so this
  // specific override must be registered AFTER mockBackend(), not before,
  // or the catch-all shadows it.
  await mockBackend(page);
  await page.route("**/.netlify/functions/admin-photo-manager**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") === "public_list" && url.searchParams.get("context") === "website_hero") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            { id: "admin-row-1", category: "Seasonal Picks", name: "Autumn Admin Upload", url: "/assets/website-studio/hero/signature-vase-lineup.jpg" },
          ],
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await page.locator("#websitePage #wsTab-brand").click();
  await page.waitForTimeout(700);

  // A brand-new category chip was created for content the static picker
  // never anticipated.
  const newChip = page.locator('[data-gallery-filter="Seasonal Picks"]');
  await expect(newChip).toBeVisible();

  // The photo itself is present and correctly attributed to that category.
  const newPhoto = page.locator('[data-category="Seasonal Picks"][data-admin-uploaded="true"]');
  await expect(newPhoto).toBeVisible();
  await expect(newPhoto.locator("span")).toHaveText("Autumn Admin Upload");

  // Clicking the new chip filters correctly — the new photo stays visible,
  // an existing static-category photo (Signature) hides.
  await newChip.click();
  await expect(newPhoto).toBeVisible();
  await expect(page.locator('[data-category="signature"]').first()).toBeHidden();

  // Clicking the photo selects it as the hero image, same as any static one.
  await page.locator('[data-gallery-filter="all"]').click();
  await newPhoto.click();
  await expect(page.locator("#heroImageUrl")).toHaveValue("/assets/website-studio/hero/signature-vase-lineup.jpg");

  expect(consoleErrors).toEqual([]);
});

test("Website Studio picker still works with no admin-uploaded photos at all", async ({ page }) => {
  await page.route("**/.netlify/functions/admin-photo-manager**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) })
  );
  await mockBackend(page);
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await page.locator("#websitePage #wsTab-brand").click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-category="signature"]').first()).toBeVisible();
});
