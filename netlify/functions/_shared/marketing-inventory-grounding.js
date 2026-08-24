/**
 * Inventory-grounded marketing content (Priority 2 of the "as far as
 * technically possible" pass). Lily's compound-request orchestrator uses
 * this so "flowers I actually have" means the shop's REAL `inventory`
 * rows, never an invented or generic flower list.
 *
 * Deliberately narrow and honest about what this data actually supports:
 *   - `inventory.quantity`/`low_stock_level` are real, current counts.
 *   - `inventory.created_at` is the row's creation time, NOT a tracked
 *     receive/expiration date — Florisyn does not have real perishability
 *     tracking today. "Longest in stock" below is an EXPLICITLY LABELED
 *     approximation built from that one honest signal, never presented as
 *     true aging/expiration data.
 *   - An item with zero real inventory rows returns an empty, honestly
 *     labeled result — never a fabricated flower list.
 */

const DEFAULT_LIMIT = 12;

/**
 * Loads the shop's real, currently-in-stock inventory, oldest-added-and-
 * still-present first (the closest honest proxy this schema supports for
 * "move this soon" — see the module doc's confidence caveat). Never
 * throws — a query failure degrades to an empty, flagged result so a
 * content-generation step can fail closed rather than crash.
 */
export async function loadGroundedInventory(client, shopId, { limit = DEFAULT_LIMIT, category = null } = {}) {
  try {
    let query = client
      .from("inventory")
      .select("id,name,category,quantity,low_stock_level,unit,price,created_at")
      .eq("shop_id", shopId)
      .is("deleted_at", null)
      .gt("quantity", 0)
      .order("created_at", { ascending: true })
      .limit(Math.min(50, Math.max(1, Number(limit) || DEFAULT_LIMIT)));
    if (category) query = query.eq("category", category);
    const { data, error } = await query;
    if (error) return { ok: false, error: error.message, items: [] };
    const items = (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      quantity: Number(row.quantity) || 0,
      unit: row.unit || "stems",
      lowStock: Number(row.quantity) <= Number(row.low_stock_level || 0),
      approxDaysInStock: Math.max(0, Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86400000))
    }));
    return { ok: true, items, confidence: "approximate", note: "approxDaysInStock is time-since-row-created, not a tracked receive/expiration date — an honest proxy, not real perishability tracking." };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), items: [] };
  }
}

/**
 * Real shop products (named arrangements, not raw stem inventory) with
 * their own photos — useful when a request names a product category
 * ("wedding bouquet") rather than raw flowers. Same fail-honest contract.
 */
export async function loadGroundedProducts(client, shopId, { limit = DEFAULT_LIMIT, searchText = null } = {}) {
  try {
    let query = client
      .from("products")
      .select("id,name,category,description,image_url,price,tags")
      .eq("shop_id", shopId)
      .eq("active", true)
      .is("deleted_at", null)
      .limit(Math.min(50, Math.max(1, Number(limit) || DEFAULT_LIMIT)));
    if (searchText) query = query.ilike("name", `%${searchText}%`);
    const { data, error } = await query;
    if (error) return { ok: false, error: error.message, items: [] };
    return { ok: true, items: data || [] };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), items: [] };
  }
}

/**
 * Builds the text block a generation prompt consumes, plus a structured
 * `sources` list the generated content item stores as
 * `grounded_in_inventory` — so Ashley can see exactly what real inventory
 * informed the content (Section: "provide source/reference information").
 * Returns null summary text when there's genuinely nothing to ground on —
 * callers must treat that as "cannot ground this request", never silently
 * proceed with an ungrounded generic prompt while claiming it was grounded.
 */
export function buildInventoryGroundingBrief(items = []) {
  if (!items.length) {
    return { summaryText: null, sources: [], grounded: false };
  }
  const lines = items
    .slice(0, 8)
    .map((i) => `${i.name} (${i.quantity} ${i.unit} in stock${i.lowStock ? ", running low" : ""})`);
  const summaryText = `Real current inventory to ground this in (do not mention flowers not on this list): ${lines.join("; ")}.`;
  const sources = items.slice(0, 8).map((i) => ({ inventory_id: i.id, name: i.name, quantity: i.quantity, unit: i.unit }));
  return { summaryText, sources, grounded: true };
}
