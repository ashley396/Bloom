/**
 * Florist Community shared recipes — Lily draft, publish, and shop import.
 */

export const RECIPE_AI_SCHEMA = {
  name: "arrangement title",
  description: "2 short paragraphs for florists",
  category: "Everyday|Wedding|Sympathy|Plants|Gifts|Other",
  suggested_retail: "number USD",
  container: "vase type",
  mechanics: "foam, tape, etc.",
  recipe: [{ name: "flower or foliage", qty: "stem count number", kind: "flower|foliage|supply" }],
  instructions: ["step strings"],
};

export function sanitizeRecipeDraft(raw) {
  if (!raw || typeof raw !== "object") return null;
  const recipe = Array.isArray(raw.recipe)
    ? raw.recipe
        .slice(0, 24)
        .map((row) => ({
          name: String(row?.name || "").trim().slice(0, 120),
          qty: Math.max(0, Number(row?.qty ?? row?.quantity ?? 0) || 0),
          kind: String(row?.kind || "flower").slice(0, 24),
        }))
        .filter((row) => row.name && row.qty > 0)
    : [];
  const instructions = Array.isArray(raw.instructions)
    ? raw.instructions.map((s) => String(s || "").trim().slice(0, 500)).filter(Boolean).slice(0, 12)
    : [];
  const name = String(raw.name || raw.title || "").trim().slice(0, 120);
  if (!name || !recipe.length) return null;
  return {
    name,
    description: String(raw.description || "").trim().slice(0, 2000) || null,
    category: String(raw.category || "Everyday").trim().slice(0, 80) || "Everyday",
    suggested_retail: Math.max(0, Number(raw.suggested_retail ?? raw.suggested_price ?? 0) || 0),
    container: String(raw.container || "").trim().slice(0, 200) || null,
    mechanics: String(raw.mechanics || "").trim().slice(0, 200) || null,
    recipe,
    instructions,
  };
}

export function recipeToProductItems(draft) {
  return (draft?.recipe || []).map((row) => ({
    ingredient_name: row.name,
    quantity: row.qty,
    unit: "stem",
    unit_cost: 0,
  }));
}

export function publicRecipeSummary(row, { imageUrl = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    post_id: row.post_id,
    title: row.title,
    description: row.description || null,
    category: row.category || null,
    recipe: row.recipe || [],
    instructions: row.instructions || [],
    suggested_retail: Number(row.suggested_retail || 0),
    image_url: imageUrl,
    import_count: Number(row.import_count || 0),
    author_user_id: row.author_user_id,
    created_at: row.created_at,
  };
}

export function buildLocalRecipeDraftFromPost(post = {}) {
  const caption = String(post.caption || "Community arrangement").trim().slice(0, 120);
  const category =
    String(post.category || "").trim() === "Arrangement Share"
      ? "Everyday"
      : String(post.category || "Everyday").trim().slice(0, 80) || "Everyday";
  return {
    name: caption || "Florist arrangement",
    description:
      String(post.body || "").trim().slice(0, 2000) ||
      "Starter stem-count recipe from your Community post. Adjust counts to match your design.",
    category,
    suggested_retail: 79,
    container: "Clear glass vase",
    mechanics: "Clean water, fresh cut stems",
    recipe: [
      { name: "Seasonal focal flower", qty: 5, kind: "flower" },
      { name: "Accent bloom", qty: 4, kind: "flower" },
      { name: "Filler flower", qty: 3, kind: "flower" },
      { name: "Greenery", qty: 4, kind: "foliage" },
    ],
    instructions: [
      "Prep stems and build shape with greenery first.",
      "Add focal flowers, then accents. Top off water and check proportions before sharing.",
    ],
  };
}

export async function generateRecipeWithCloudflare(runGenerate, input, { onCloudError } = {}) {
  try {
    const result = await runGenerate({
      mode: "generate",
      persona: "Lily",
      task:
        "From a florist's community arrangement post, estimate a professional stem-count recipe other florists can copy. Use realistic wholesale-style stem counts. Never include customer or order data.",
      input,
      schema: RECIPE_AI_SCHEMA,
    });
    const draft = sanitizeRecipeDraft(result?.result || result);
    if (draft) return { draft, source: "cloudflare" };
  } catch (error) {
    if (typeof onCloudError === "function") onCloudError(error);
  }
  return { draft: null, source: "unavailable" };
}
