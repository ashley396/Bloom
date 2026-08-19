/** Recipe → inventory deduction helpers (pure + async runner). */

export const FULFILL_DEDUCT_STATUSES = new Set([
  "READY",
  "PICKUP_READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "COMPLETED",
]);

export function shouldDeductOnStatus(status) {
  return FULFILL_DEDUCT_STATUSES.has(String(status || "").toUpperCase());
}

function normalizeIngredient(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

export async function applyRecipeDeductions(client, { shopId, productId, quantity = 1 }) {
  if (!shopId || !productId) {
    return { adjustments: [], warnings: ["No product linked to this order."] };
  }

  const { data: recipeRows, error: recipeError } = await client
    .from("product_recipes")
    .select("id,ingredient_name,quantity,unit,inventory_id")
    .eq("shop_id", shopId)
    .eq("product_id", productId)
    .order("id");
  if (recipeError) throw recipeError;

  const adjustments = [];
  const warnings = [];
  const multiplier = Math.max(1, Number(quantity || 1));

  for (const recipe of recipeRows || []) {
    const needed = Math.max(0, Number(recipe.quantity || 0) * multiplier);
    if (needed <= 0) continue;

    let stock = null;
    if (recipe.inventory_id) {
      const { data, error } = await client
        .from("inventory")
        .select("id,name,quantity,unit")
        .eq("id", recipe.inventory_id)
        .eq("shop_id", shopId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      stock = data;
    } else {
      const wanted = normalizeIngredient(recipe.ingredient_name);
      const { data, error } = await client
        .from("inventory")
        .select("id,name,color,quantity,unit")
        .eq("shop_id", shopId)
        .is("deleted_at", null);
      if (error) throw error;
      stock =
        (data || []).find((row) => {
          const combined = normalizeIngredient(`${row.color || ""} ${row.name || ""}`);
          const nameOnly = normalizeIngredient(row.name);
          return combined === wanted || nameOnly === wanted;
        }) || null;
    }

    if (!stock) {
      warnings.push(`${recipe.ingredient_name || "Ingredient"}: not found in inventory`);
      continue;
    }

    const available = Math.max(0, Number(stock.quantity || 0));
    if (available + 0.0001 < needed) {
      warnings.push(
        `${stock.name}: recipe needed ${needed}, but only ${available} was available`
      );
      continue;
    }

    const { data: updated, error: updateError } = await client
      .from("inventory")
      .update({ quantity: available - needed })
      .eq("id", stock.id)
      .eq("shop_id", shopId)
      .select("id,name,quantity,unit")
      .single();
    if (updateError) throw updateError;

    adjustments.push({
      id: updated.id,
      name: updated.name,
      used: needed,
      before: available,
      after: Number(updated.quantity || 0),
      unit: updated.unit,
    });
  }

  return { adjustments, warnings };
}
