import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * The Community page's static page heading already says "FLORIST SOCIAL
 * Beta / Florist Community / Profile photos and arrangement posts…".
 * community-ui.js's render() used to inject a SECOND, near-identical
 * "FLORIST SOCIAL Beta" eyebrow + "Your florist feed" heading + a
 * near-duplicate description directly below it — two stacked titles
 * saying almost the same thing. Verifies only the one real heading shows.
 */
test("Community page shows exactly one page title, not a duplicate", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/.netlify/functions/florist-community**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: { display_name: "Rose", shop_display_name: "Rose & Co", city: "", region: "", bio: "" },
          guidelines: ["Be kind."],
          items: [],
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="communityPage"]').click();
  await expect(page.locator("#communityRoot .community-shell")).toBeVisible();

  await expect(page.locator("#communityPage .heading h1")).toHaveText("Florist Community");
  await expect(page.locator(".community-hero")).toHaveCount(0);
  await expect(page.locator("#communityRoot h2", { hasText: "Your florist feed" })).toHaveCount(0);
});
