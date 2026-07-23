import { json, methodNotAllowed, parseBody } from "./_shared/http.js";
import { requireUser, handleError } from "./_shared/supabase.js";

function orderNumber() {
  const stamp = new Date().toISOString().slice(2,10).replaceAll("-", "");
  return `BLM-${stamp}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function handler(event) {
  try {
    const { supabase, user } = await requireUser(event);
    if (event.httpMethod === "GET") {
      const { data, error } = await supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      if (error) throw error;
      return json(200, { orders: data || [] });
    }
    if (event.httpMethod === "POST") {
      const body = parseBody(event);
      if (!body.customer_name?.trim()) return json(400, { error: "Customer name is required" });
      const { data, error } = await supabase.from("orders").insert({
        user_id: user.id, order_number: orderNumber(), customer_name: body.customer_name.trim(),
        occasion: body.occasion || null, fulfillment: body.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
        delivery_address: body.delivery_address || null, delivery_date: body.delivery_date || null,
        status: "NEW", total: Number(body.total || 0), notes: body.notes || null
      }).select().single();
      if (error) throw error;
      return json(201, { order: data });
    }
    if (event.httpMethod === "PATCH") {
      const body = parseBody(event);
      const allowed = ["NEW","DESIGNING","READY","OUT_FOR_DELIVERY","COMPLETED","CANCELLED"];
      if (!body.id || !allowed.includes(body.status)) return json(400, { error: "Valid order ID and status are required" });
      const { data, error } = await supabase.from("orders").update({ status: body.status })
        .eq("id", body.id).eq("user_id", user.id).select().single();
      if (error) throw error;
      return json(200, { order: data });
    }
    return methodNotAllowed();
  } catch (error) { return handleError(error); }
}
