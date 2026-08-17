import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Florist Community's two requested improvements:
 * 1. A Facebook-style Feed / My Profile tab split, instead of everything
 *    (profile form + composer + every post) on one long scroll.
 * 2. A one-click "Add to my library" action on any post's photo, saving
 *    it as a draft product in the viewer's own Floral Library/Products —
 *    no need to wait on Lily's recipe-building flow first.
 */
const PROFILE = { display_name: "Rose", shop_display_name: "Rose & Co", city: "Austin", region: "TX", bio: "" };
const OTHER_POST = {
  id: "post-1",
  author_user_id: "other-user",
  category: "Arrangement Share",
  caption: "Blush garden compote",
  body: "Garden roses, ranunculus, and eucalyptus in a low compote.",
  image_url: "/assets/atelier-bouquet-hero.jpg",
  is_mine: false,
  like_count: 2,
  comment_count: 0,
  liked: false,
  author: { display_name: "Jamie", shop_display_name: "Petal & Vine", city: "Dallas" },
};
const MY_POST = { ...OTHER_POST, id: "post-2", author_user_id: "me", is_mine: true, caption: "My own post" };

async function mockCommunity(page, { items = [OTHER_POST], saveResponse } = {}) {
  await mockBackend(page);
  await page.route("**/.netlify/functions/florist-community**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profile: PROFILE, guidelines: ["Be kind."], items }),
      });
      return;
    }
    const body = route.request().postDataJSON();
    if (body?.action === "save_post_to_library") {
      await route.fulfill({
        status: saveResponse?.status || 201,
        contentType: "application/json",
        body: JSON.stringify(
          saveResponse?.body || {
            ok: true,
            product_id: "prod-new",
            product_name: OTHER_POST.caption,
            message: `${OTHER_POST.caption} was saved to your Floral Library — price and publish it any time in Products.`,
          },
        ),
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
}

test("Feed and My Profile are separate tabs, not one long scroll", async ({ page }) => {
  await mockCommunity(page, { items: [OTHER_POST, MY_POST] });

  // Feed tab (default): shows the composer and every post, not a profile form.
  await expect(page.locator(".community-tab", { hasText: "Feed" })).toHaveClass(/active/);
  await expect(page.locator("#communityComposer")).toBeVisible();
  await expect(page.locator("#communityProfileForm")).toHaveCount(0);
  await expect(page.locator(".community-post")).toHaveCount(2);

  // My Profile tab: shows the profile form and only your own posts.
  await page.locator(".community-tab", { hasText: "My Profile" }).click();
  await expect(page.locator("#communityProfileForm")).toBeVisible();
  await expect(page.locator("#communityComposer")).toHaveCount(0);
  await expect(page.locator(".community-post")).toHaveCount(1);
  await expect(page.locator(".community-post")).toContainText("My own post");
});

test('"Add to my library" saves another florist\'s post photo to Products', async ({ page }) => {
  await mockCommunity(page);

  const card = page.locator(`[data-post-id="${OTHER_POST.id}"]`);
  await expect(card).toBeVisible();
  const saveBtn = card.locator(".community-save-to-library");
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();

  await expect(saveBtn).toHaveText("✓ Added");
  await expect(saveBtn).toBeDisabled();
});
