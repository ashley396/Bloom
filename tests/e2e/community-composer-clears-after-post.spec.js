import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * After successfully publishing a Community post, the composer form kept
 * showing the just-submitted caption instead of clearing — misleading a
 * florist into thinking the post hadn't gone through (or inviting an
 * accidental duplicate submission). Root cause: render()'s state.loading
 * branch calls captureComposerDraft() unconditionally, which re-reads the
 * composer's still-live (not yet re-rendered) DOM input and overwrites
 * whatever resetComposerDraft() had just set — the opposite of what the
 * submit handler's load({ keepComposer: false }) call intended.
 */
const PROFILE = { display_name: "Rose", shop_display_name: "Rose & Co", city: "Austin", region: "TX", bio: "" };

test("Community composer clears its caption after a successful post, not left showing stale text", async ({ page }) => {
  let posts = [];
  let nextId = 1;

  await mockBackend(page);
  await page.route("**/.netlify/functions/florist-community**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, guidelines: [], items: posts }) });
    }
    const body = req.postDataJSON() || {};
    if (body.action === "create_post") {
      const post = {
        id: `post-${nextId++}`,
        author_user_id: "me",
        category: body.category,
        caption: body.caption,
        body: body.body || "",
        image_url: null,
        is_mine: true,
        like_count: 0,
        comment_count: 0,
        liked: false,
        author: PROFILE,
        can_build_recipe: false,
        recipe_status: "none",
      };
      posts = [post, ...posts];
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ item: post }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="communityPage"]').click();
  await expect(page.locator("#communityRoot .community-shell")).toBeVisible();

  const captionInput = page.locator('#communityComposer input[name="caption"]');
  await captionInput.fill("Blush garden compote for a spring wedding");
  await page.locator("#communityComposer button[type=submit]").click();

  await expect(page.locator(".community-post")).toHaveCount(1);
  await expect(page.locator('#communityComposer input[name="caption"]')).toHaveValue("");
});
