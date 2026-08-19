import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Community Step 69 — the reverse of the existing Photo Studio → Community
 * "Post to Community feed" checkbox (public/app.js's #shotPost handler):
 * "Edit in Photo Studio" pulls a real photo from your own Community post
 * back into the actual Photo Studio canvas, not just a navigate+toast.
 */
const PROFILE = { display_name: "Ashley", shop_display_name: "Lilies in Bloom", city: "", region: "", bio: "" };
// A real 1x1 PNG data URL, tiny enough to round-trip through fetch()/blob().
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function makePost(overrides = {}) {
  return {
    id: "post-mine",
    author_user_id: "me",
    category: "Arrangement Share",
    caption: "Sunday market bouquet",
    body: "",
    image_url: TINY_PNG,
    is_mine: true,
    like_count: 0,
    comment_count: 0,
    liked: false,
    author_followed: false,
    author: { user_id: "me", display_name: "Ashley", shop_display_name: "Lilies in Bloom", city: "" },
    share_permission: "inspiration_only",
    allow_photo_use: false,
    ...overrides,
  };
}

test("Edit in Photo Studio loads the real post photo into the canvas and navigates there", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/.netlify/functions/florist-community**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      const url = new URL(req.url());
      if (url.searchParams.get("action") === "notifications") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], unread_count: 0 }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, guidelines: [], items: [makePost()] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="communityPage"]').click();
  await expect(page.locator("#communityRoot .community-shell")).toBeVisible();

  const editBtn = page.locator('[data-id="post-mine"].community-edit-in-studio');
  await expect(editBtn).toBeVisible();
  await editBtn.click();

  await expect(page.locator("#bloomshotPage")).toHaveClass(/active/, { timeout: 10_000 });
  await expect(page.locator("#bloomshotEmpty")).toBeHidden();
  await expect(page.locator("#shotCaption")).toHaveValue("Sunday market bouquet");
});

test("Edit in Photo Studio never shows on another florist's post", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/.netlify/functions/florist-community**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      const url = new URL(req.url());
      if (url.searchParams.get("action") === "notifications") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], unread_count: 0 }) });
      }
      const other = makePost({ id: "post-theirs", is_mine: false, author_user_id: "other-user", author: { user_id: "other-user", display_name: "Jamie", shop_display_name: "Petal & Vine", city: "" } });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, guidelines: [], items: [other] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="communityPage"]').click();
  await expect(page.locator("#communityRoot .community-shell")).toBeVisible();

  await expect(page.locator(".community-edit-in-studio")).toHaveCount(0);
});
