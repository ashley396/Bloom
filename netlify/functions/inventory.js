import { json, methodNotAllowed, parseBody } from "./_shared/http.js";
import { requireUser, handleError } from "./_shared/supabase.js";

export async function handler(event) {
  try {
    const { supabase, user } = await requireUser(event);
    if (event.httpMethod === "GET") {
      const { data, error } = await supabase.from("inventory").select("*").eq("user_id", user.id).order("name");
      if (error) throw error;
      return json(200, { inventory: data || [] });
    }
    if (event.httpMethod === "POST") {
      const body = parseBody(event);
      if (!body.name?.trim()) return json(400, { error: "Item name is required" });
      const { data, error } = await supabase.from("inventory").insert({
        user_id: user.id, name: body.name.trim(), category: body.category || "Flowers",
        quantity: Number(body.quantity || 0), low_stock_level: Number(body.low_stock_level || 5),
        unit: body.unit || "stems", cost: Number(body.cost || 0), price: Number(body.price || 0)
      }).select().single();
      if (error) throw error;
      return json(201, { item: data });
    }
    return methodNotAllowed();
  } catch (error) { return handleError(error); }
}
