import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Real bug: theme-gallery-ui.js fired api("launch_modes") with no
 * .catch() — the one unguarded promise among every api() call in the
 * Website Builder's five panels (all the others catch their own failure
 * and show it inline). Any transient failure of that one call became an
 * unhandled promise rejection, which app.js's global
 * window.addEventListener("unhandledrejection", ...) turns into a toast
 * — an unrelated-looking "Error" popping up the moment a florist opens
 * Website Builder, matching a real report of "it says an Error
 * occurred" with no further detail to go on. Fixed by giving it the same
 * inline-status .catch() every sibling call already has.
 */
test("a failed launch_modes request shows a friendly inline message, not the global raw-error toast", async ({ page }) => {
  await mockBackend(page);
  await withFakeSession(page);

  await page.route("**/.netlify/functions/instant-website*", async (route) => {
    let action = "";
    try {
      action = JSON.parse(route.request().postData() || "{}").action;
    } catch {
      /* ignore */
    }
    if (action === "launch_modes") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Website templates could not be loaded." }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="websitePage"]').click();
  await expect(page.locator("#websitePage")).toHaveClass(/active/, { timeout: 5_000 });

  // The failure resolves inline in the theme gallery's own status line...
  await expect(page.locator("#themeGalleryStatus")).toHaveText(/could not be loaded/i, { timeout: 5_000 });

  // ...not as the unrelated global toast an unhandled rejection would fire.
  await expect(page.locator("#toast")).toBeHidden();
});
