/** Soft inventory reservation for recurring orders — no negative qty. */

export function planInventoryReservation(items = [], requirements = []) {
  const shortages = [];
  const reservations = [];
  const byId = new Map(items.map((i) => [i.id, { ...i }]));

  for (const req of requirements) {
    const row = byId.get(req.inventory_id) || items.find((i) => i.name === req.name);
    if (!row) {
      shortages.push({ name: req.name, needed: req.qty, reason: "not_found" });
      continue;
    }
    const available = Number(row.quantity || 0) - Number(row.reserved_qty || row.metadata?.reserved_qty || 0);
    const need = Number(req.qty || 1);
    if (available < need) {
      shortages.push({ inventory_id: row.id, name: row.name, needed: need, available });
      continue;
    }
    reservations.push({ inventory_id: row.id, name: row.name, qty: need, new_reserved: need });
  }

  return { ok: shortages.length === 0, reservations, shortages };
}

export async function reserveInventoryForOrder(client, { shopId, orderId, subscription }) {
  let items = [];
  try {
    const { data, error } = await client.from("inventory").select("id,name,quantity,metadata").eq("shop_id", shopId).is("deleted_at", null);
    if (error) throw error;
    items = data || [];
  } catch {
    return { ok: true, skipped: true, note: "inventory_unavailable" };
  }

  const recipe = subscription?.metadata?.inventory_recipe || subscription?.metadata?.recipe || [];
  const requirements = Array.isArray(recipe) && recipe.length
    ? recipe
    : [{ name: "Design stems", qty: 1 }];

  const plan = planInventoryReservation(items, requirements);
  if (!plan.ok) {
    await client
      .from("orders")
      .update({
        metadata: {
          inventory_attention_required: true,
          inventory_shortages: plan.shortages
        }
      })
      .eq("id", orderId)
      .catch(() => {});
    return { ok: false, shortages: plan.shortages };
  }

  for (const r of plan.reservations) {
    const item = items.find((i) => i.id === r.inventory_id);
    if (!item) continue;
    const reserved = Number(item.metadata?.reserved_qty || 0) + r.qty;
    await client
      .from("inventory")
      .update({ metadata: { ...(item.metadata || {}), reserved_qty: reserved, reserved_for_order: orderId } })
      .eq("id", item.id)
      .eq("shop_id", shopId)
      .catch(() => {});
  }

  return { ok: true, reservations: plan.reservations };
}
