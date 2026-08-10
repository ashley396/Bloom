import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { clampText } from "./_shared/validation.js";

function missingTable(error) {
  const msg = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || msg.includes("does not exist");
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    const { client, shopId, user } = await currentUser(event);
    const body = bodyOf(event);

    if (event.httpMethod === "GET") {
      const { data, error } = await client
        .from("pos_quotes")
        .select("*")
        .eq("shop_id", shopId)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) {
        if (missingTable(error)) {
          return json(503, { error: "Apply competitive_parity_v2 migration for server quotes." });
        }
        throw error;
      }
      return json(200, { items: data || [] });
    }

    if (event.httpMethod === "POST" && body.action === "save") {
      const name = clampText(body.name, 120);
      if (!name) return json(400, { error: "Quote name is required." });
      const cart = Array.isArray(body.cart) ? body.cart : [];
      const total = Math.max(0, Number(body.total || 0));
      const record = {
        shop_id: shopId,
        name,
        customer_id: body.customer_id || null,
        note: body.note || null,
        cart,
        total,
        created_by: user?.id || null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client.from("pos_quotes").insert(record).select().single();
      if (error) {
        if (missingTable(error)) {
          return json(503, { error: "Apply competitive_parity_v2 migration for server quotes." });
        }
        throw error;
      }
      return json(201, { item: data });
    }

    if (event.httpMethod === "DELETE" || (event.httpMethod === "POST" && body.action === "delete")) {
      if (!body.id) return json(400, { error: "Missing quote id." });
      const { error } = await client
        .from("pos_quotes")
        .delete()
        .eq("id", body.id)
        .eq("shop_id", shopId);
      if (error) throw error;
      return json(200, { ok: true });
    }

    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}
