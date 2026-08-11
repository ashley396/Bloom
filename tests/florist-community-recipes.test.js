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
  inferFlowersFromPostText,
  recipeStemsFromVisionText,
  isGenericIngredientName,
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

test("sanitizeRecipeDraft rejects generic placeholder stems", () => {
  assert.equal(
    sanitizeRecipeDraft({
      name: "Generic",
      recipe: [{ name: "Seasonal focal flower", qty: 5, kind: "flower" }],
    }),
    null
  );
  assert.equal(isGenericIngredientName("Accent bloom"), true);
  assert.equal(isGenericIngredientName("Freedom rose"), false);
});

test("inferFlowersFromPostText reads caption flower names", () => {
  const stems = inferFlowersFromPostText("Blush Freedom roses with eucalyptus", "");
  assert.ok(stems.some((row) => /rose/i.test(row.name)));
  assert.ok(stems.some((row) => /eucalyptus/i.test(row.name)));
});

test("buildLocalRecipeDraftFromPost creates editable starter recipe", () => {
  const draft = buildLocalRecipeDraftFromPost({
    caption: "Modern Floral",
    category: "Arrangement Share",
    body: "Bright garden mix",
  });
  assert.equal(draft.name, "Modern Floral");
  assert.ok(draft.recipe.length >= 3);
  assert.ok(
    !draft.recipe.some((row) => isGenericIngredientName(row.name)),
    "local fallback should use real wholesale names"
  );
});

test("buildLocalRecipeDraftFromPost prefers caption flower names", () => {
  const draft = buildLocalRecipeDraftFromPost({
    caption: "Sunflower porch jar",
    body: "Yellow mums and leatherleaf",
  });
  assert.ok(draft.recipe.some((row) => /sunflower|mum|leatherleaf/i.test(row.name)));
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

test("generateRecipeWithCloudflare uses vision parse when cloud AI fails", async () => {
  const out = await generateRecipeWithCloudflare(
    async () => {
      throw new Error("Cloud AI offline");
    },
    { caption: "Modern day", post_id: "p1" },
    { visionText: "hydrangea, Freedom rose, snapdragon, eucalyptus" }
  );
  assert.equal(out.source, "local_vision_fallback");
  assert.ok(out.draft.recipe.some((row) => /hydrangea|rose|snapdragon/i.test(row.name)));
  assert.equal(
    out.draft.recipe.some((row) => /oriental lily|lily grass|leather fern/i.test(row.name)),
    false
  );
});

test("recipeStemsFromVisionText parses unknown wholesale names", () => {
  const stems = recipeStemsFromVisionText("delphinium, possibly stock, Israeli ruscus");
  assert.ok(stems.some((row) => /delphinium|stock|ruscus/i.test(row.name)));
});

test("buildLocalRecipeDraftFromPost skips style presets when photo had no vision read", () => {
  const draft = buildLocalRecipeDraftFromPost(
    { caption: "Modern day", body: "", image_path: "shop/u/x.jpg" },
    { hadPhoto: true }
  );
  assert.equal(draft.recipe.length, 0);
  assert.match(draft.description, /could not read/i);
});

test("florist-community handler wires Lily recipe actions", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/florist-community.js"), "utf8");
  assert.match(src, /generate_recipe/);
  assert.match(src, /buildLocalRecipeDraftFromPost/);
  assert.match(src, /local_fallback/);
  assert.match(src, /communityStorageClient/);
  assert.match(src, /rebuilt_published/);
  assert.match(src, /save_recipe_draft/);
  assert.match(src, /publish_recipe/);
  assert.match(src, /import_recipe_to_shop/);
  assert.match(src, /florist_community_recipes/);
  assert.match(src, /generateRecipeWithCloudflare/);
  assert.match(src, /action === "recipes"/);
});

test("community UI hints florists to name flowers for Lily", () => {
  const ui = fs.readFileSync(path.join(process.cwd(), "public/community-ui.js"), "utf8");
  assert.match(ui, /Build recipe with Lily/);
  assert.match(ui, /Retry with Lily/);
  assert.match(ui, /name the flowers in your caption/i);
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
