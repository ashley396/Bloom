import { test, expect } from "@playwright/test";
import { mockBackend, withFakeSession } from "./fixtures.mjs";

/**
 * Community/Lily Steps 66 & 75 — floral intelligence surfaced on the
 * published recipe card: real confidence labels on uncertain stems, a
 * computed Design DNA line, curated substitute hints, and precomputed
 * scaled sizes — all real data from publicRecipeSummary
 * (netlify/functions/_shared/florist-community-recipes.js), never
 * client-fabricated. See lib/floral-library/recipe-intelligence.js.
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
    share_permission: "allow_shop_use",
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

test("a published recipe shows real Design DNA, a confidence badge on an estimated stem, and a curated substitute hint", async ({ page }) => {
  const post = makePost({
    id: "post-dna",
    published_recipe: {
      id: "recipe-dna",
      title: "Blush Garden Compote",
      suggested_retail: 85,
      recipe: [
        { name: "Peony", qty: 4, kind: "flower", confidence: "confirmed", substitutes: ["Garden rose", "Ranunculus"] },
        { name: "Ranunculus", qty: 3, kind: "flower", confidence: "estimated", substitutes: ["Garden rose", "Peony"] },
        { name: "Israeli ruscus", qty: 3, kind: "foliage", confidence: "confirmed", substitutes: [] },
      ],
      design_dna: { stemCount: 10, flowerStems: 7, foliageStems: 3, supplyStems: 0, focalToFoliageRatio: 70, dominantKind: "flower", styleTags: ["romantic"] },
      scaled_variants: {
        smaller: [
          { name: "Peony", qty: 3, kind: "flower" },
          { name: "Ranunculus", qty: 2, kind: "flower" },
          { name: "Israeli ruscus", qty: 2, kind: "foliage" },
        ],
        larger: [
          { name: "Peony", qty: 6, kind: "flower" },
          { name: "Ranunculus", qty: 5, kind: "flower" },
          { name: "Israeli ruscus", qty: 5, kind: "foliage" },
        ],
      },
    },
  });
  await mockCommunity(page, { items: [post] });

  const card = page.locator('[data-post-id="post-dna"]');
  await expect(card.locator(".community-recipe-dna")).toContainText("Romantic");
  await expect(card.locator(".community-recipe-dna")).toContainText("70% focal / 30% foliage");

  const stems = card.locator(".community-recipe-stems li");
  await expect(stems.filter({ hasText: /^3 × Ranunculus/ })).toContainText("~estimated");
  await expect(stems.filter({ hasText: /^4 × Peony/ })).not.toContainText("~estimated");
  await expect(stems.filter({ hasText: /^4 × Peony/ })).toContainText("or substitute: Garden rose, Ranunculus");

  // Standard size shown by default.
  await expect(stems.filter({ hasText: "4 × Peony" })).toHaveCount(1);

  await card.locator('[data-recipe-size="larger"]').click();
  await expect(card.locator(".community-recipe-stems li").filter({ hasText: "6 × Peony" })).toHaveCount(1);
  await expect(card.locator('[data-recipe-size="larger"]')).toHaveClass(/active/);

  await card.locator('[data-recipe-size="smaller"]').click();
  await expect(card.locator(".community-recipe-stems li").filter({ hasText: "3 × Peony" })).toHaveCount(1);
});

test("a recipe with no design DNA or scaled variants (legacy data) renders without the new controls, not an error", async ({ page }) => {
  const post = makePost({
    id: "post-legacy",
    published_recipe: {
      id: "recipe-legacy",
      title: "Legacy Recipe",
      recipe: [{ name: "Rose", qty: 5 }],
      suggested_retail: 60,
    },
  });
  await mockCommunity(page, { items: [post] });

  const card = page.locator('[data-post-id="post-legacy"]');
  await expect(card.locator(".community-recipe-stems")).toContainText("5 × Rose");
  await expect(card.locator(".community-recipe-dna")).toHaveCount(0);
  await expect(card.locator(".community-recipe-sizes")).toHaveCount(0);
});
