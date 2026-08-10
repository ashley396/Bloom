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

export async function generateRecipeWithCloudflare(runGenerate, input) {
  const result = await runGenerate({
    mode: "generate",
    persona: "Lily",
    task:
      "From a florist's community arrangement post, estimate a professional stem-count recipe other florists can copy. Use realistic wholesale-style stem counts. Never include customer or order data.",
    input,
    schema: RECIPE_AI_SCHEMA,
  });
  return sanitizeRecipeDraft(result?.result || result);
}
