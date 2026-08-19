import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Arrangement Share permissions — the creator's explicit ceiling on how
 * far a design may travel. Before this, no permission field existed at
 * all: any post could be saved to another florist's library or imported
 * as a shop product with zero say from the creator, directly contradicting
 * "never assume commercial permission." These tests cover the UI side —
 * composer visibility/submission and per-post gating — with the server
 * (netlify/functions/florist-community.js) as the real enforcement,
 * covered separately in tests/florist-community-recipes.test.js and
 * tests/florist-community-beta.test.js.
 */
const PROFILE = { display_name: "Rose", shop_display_name: "Rose & Co", city: "Austin", region: "TX", bio: "" };

function makePost(overrides = {}) {
  return {
    id: "post-1",
    author_user_id: "other-user",
    category: "Arrangement Share",
    caption: "Blush garden compote",
    body: "Garden roses, ranunculus, and eucalyptus.",
    image_url: "/assets/atelier-bouquet-hero.jpg",
    is_mine: false,
    like_count: 0,
    comment_count: 0,
    liked: false,
    author: { display_name: "Jamie", shop_display_name: "Petal & Vine", city: "Dallas" },
    share_permission: "inspiration_only",
    allow_photo_use: false,
    ...overrides,
  };
}

async function mockCommunity(page, { items = [] } = {}) {
  await mockBackend(page);
  await page.route("**/.netlify/functions/florist-community**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, guidelines: [], items }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="communityPage"]').click();
  await expect(page.locator("#communityRoot .community-shell")).toBeVisible();
}

test("composer's sharing permission section only shows for Arrangement Share, and hides again if the category changes back", async ({ page }) => {
  await mockCommunity(page);

  const permissionBlock = page.locator("#communitySharePermission");
  await expect(permissionBlock).toBeHidden();

  await page.locator("#communityComposerCategory").selectOption("Arrangement Share");
  await expect(permissionBlock).toBeVisible();

  await page.locator("#communityComposerCategory").selectOption("Design Help");
  await expect(permissionBlock).toBeHidden();
});

test("posting an Arrangement Share sends the chosen permission and photo-use choice", async ({ page }) => {
  let sentPayload = null;
  await mockBackend(page);
  await page.route("**/.netlify/functions/florist-community**", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: PROFILE, guidelines: [], items: [] }) });
    }
    const body = route.request().postDataJSON();
    if (body?.action === "create_post") {
      sentPayload = body;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ item: makePost({ ...body, id: "new-post" }) }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await withFakeSession(page);
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible({ timeout: 10_000 });
  await page.locator('nav.florisyn-lux-nav button[data-page="communityPage"]').click();

  await page.locator("#communityComposerCategory").selectOption("Arrangement Share");
  await page.locator('#communityComposer input[name="caption"]').fill("Blush garden compote");
  await page.locator('#communityComposer select[name="share_permission"]').selectOption("allow_shop_use");
  await page.locator('#communityComposer input[name="allow_photo_use"]').check();
  await page.locator("#communityComposer button[type=submit]").click();

  await expect.poll(() => sentPayload?.share_permission).toBe("allow_shop_use");
  expect(sentPayload.allow_photo_use).toBe(true);
});

test("a post marked inspiration-only shows that badge and no save-to-library button; a permitted post shows both", async ({ page }) => {
  const restricted = makePost({ id: "post-restricted", share_permission: "inspiration_only" });
  const permitted = makePost({ id: "post-permitted", share_permission: "save_to_library", allow_photo_use: true });
  await mockCommunity(page, { items: [restricted, permitted] });

  const restrictedCard = page.locator('[data-post-id="post-restricted"]');
  await expect(restrictedCard.locator(".community-permission-badge")).toHaveText("Inspiration only");
  await expect(restrictedCard.locator(".community-save-to-library")).toHaveCount(0);

  const permittedCard = page.locator('[data-post-id="post-permitted"]');
  await expect(permittedCard.locator(".community-permission-badge")).toHaveText("Save to library");
  await expect(permittedCard.locator(".community-save-to-library")).toBeVisible();
});

test("own posts always show 'Add to my library' regardless of the stored permission tier", async ({ page }) => {
  const ownRestricted = makePost({ id: "post-own", is_mine: true, author_user_id: "me", share_permission: "inspiration_only" });
  await mockCommunity(page, { items: [ownRestricted] });

  const card = page.locator('[data-post-id="post-own"]');
  await expect(card.locator(".community-save-to-library")).toBeVisible();
});

test("a published recipe on an inspiration-only post explains why it can't be added to another shop, instead of showing a button that would fail", async ({ page }) => {
  const post = makePost({
    id: "post-with-recipe",
    share_permission: "inspiration_only",
    published_recipe: {
      id: "recipe-1",
      title: "Blush Garden Compote",
      recipe: [{ name: "Garden rose", qty: 5 }],
      suggested_retail: 85,
    },
  });
  await mockCommunity(page, { items: [post] });

  const card = page.locator('[data-post-id="post-with-recipe"]');
  await expect(card.locator(".community-import-recipe")).toHaveCount(0);
  await expect(card.locator(".community-permission-note")).toContainText("hasn't allowed it to be added to another shop");
});
