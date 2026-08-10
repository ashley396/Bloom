import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  sanitizeRecipeDraft,
  recipeToProductItems,
  publicRecipeSummary,
  RECIPE_AI_SCHEMA,
  buildLocalRecipeDraftFromPost,
  generateRecipeWithCloudflare,
} from "../netlify/functions/_shared/florist-community-recipes.js";

test("sanitizeRecipeDraft requires title and stem lines", () => {
  assert.equal(sanitizeRecipeDraft(null), null);
  assert.equal(sanitizeRecipeDraft({ name: "Only title" }), null);
  const ok = sanitizeRecipeDraft({
    name: "Soft Blush Garden",
    category: "Everyday",
    suggested_retail: 89,
    recipe: [{ name: "Garden rose", qty: 6, kind: "flower" }],
    instructions: ["Condition roses overnight."],
  });
  assert.equal(ok.name, "Soft Blush Garden");
  assert.equal(ok.recipe.length, 1);
  assert.equal(ok.recipe[0].qty, 6);
});

test("recipeToProductItems maps stems for shop import", () => {
  const draft = sanitizeRecipeDraft({
    name: "Test",
    recipe: [{ name: "Rose", qty: 3 }],
  });
  const items = recipeToProductItems(draft);
  assert.deepEqual(items, [{ ingredient_name: "Rose", quantity: 3, unit: "stem", unit_cost: 0 }]);
});

test("publicRecipeSummary omits internal fields", () => {
  const row = {
    id: "r1",
    post_id: "p1",
    title: "Garden Bowl",
    description: "Soft tones",
    category: "Everyday",
    recipe: [{ name: "Rose", qty: 5 }],
    instructions: ["Build in bowl."],
    suggested_retail: 75,
    image_path: "shop/user/x.jpg",
    import_count: 2,
    author_user_id: "u1",
    created_at: "2026-08-10T00:00:00Z",
  };
  const summary = publicRecipeSummary(row, { imageUrl: "https://signed.example/x" });
  assert.equal(summary.title, "Garden Bowl");
  assert.equal(summary.image_url, "https://signed.example/x");
  assert.equal("image_path" in summary, false);
});

test("RECIPE_AI_SCHEMA documents Lily output shape", () => {
  assert.ok(RECIPE_AI_SCHEMA.name);
  assert.ok(Array.isArray(RECIPE_AI_SCHEMA.recipe));
});

test("buildLocalRecipeDraftFromPost creates editable starter recipe", () => {
  const draft = buildLocalRecipeDraftFromPost({
    caption: "Modern Floral",
    category: "Arrangement Share",
    body: "Bright garden mix",
  });
  assert.equal(draft.name, "Modern Floral");
  assert.ok(draft.recipe.length >= 3);
});

test("generateRecipeWithCloudflare falls back when cloud AI fails", async () => {
  const out = await generateRecipeWithCloudflare(
    async () => {
      throw new Error("Cloud AI offline");
    },
    { caption: "Test" }
  );
  assert.equal(out.draft, null);
  assert.equal(out.source, "unavailable");
});

test("florist-community handler wires Lily recipe actions", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(src, /generate_recipe/);
  assert.match(src, /buildLocalRecipeDraftFromPost/);
  assert.match(src, /local_fallback/);
  assert.match(src, /save_recipe_draft/);
  assert.match(src, /publish_recipe/);
  assert.match(src, /import_recipe_to_shop/);
  assert.match(src, /florist_community_recipes/);
  assert.match(src, /generateRecipeWithCloudflare/);
  assert.match(src, /action === "recipes"/);
});

test("community UI exposes Lily recipe controls", () => {
  const ui = fs.readFileSync(path.join(process.cwd(), "public/community-ui.js"), "utf8");
  assert.match(ui, /Build recipe with Lily/);
  assert.match(ui, /recipeUi/);
  assert.match(ui, /community-post-image-wrap/);
  assert.match(ui, /generate_recipe/);
  assert.match(ui, /publish_recipe/);
  assert.match(ui, /import_recipe_to_shop/);
});

test("community post images use contain layout", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "public/community.css"), "utf8");
  assert.match(css, /community-post-image-wrap/);
  assert.match(css, /object-fit: contain/);
});

test("avatar migration includes community recipes tables", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260810230000_florist_community_profile_avatar.sql"),
    "utf8"
  );
  assert.match(sql, /florist_community_recipes/);
  assert.match(sql, /recipe_draft/);
  assert.match(sql, /recipe_status/);
});
