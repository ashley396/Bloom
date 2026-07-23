import { json, methodNotAllowed, parseBody } from "./_shared/http.js";
import { requireUser, handleError } from "./_shared/supabase.js";

export async function handler(event) {
  try {
    const { supabase, user } = await requireUser(event);
    if (event.httpMethod === "GET") {
      const { data, error } = await supabase.from("customers").select("*").eq("user_id", user.id).order("name");
      if (error) throw error;
      return json(200, { customers: data || [] });
    }
    if (event.httpMethod === "POST") {
      const body = parseBody(event);
      if (!body.name?.trim()) return json(400, { error: "Customer name is required" });
      const { data, error } = await supabase.from("customers").insert({
        user_id: user.id, name: body.name.trim(), phone: body.phone || null,
        email: body.email || null, address: body.address || null, notes: body.notes || null
      }).select().single();
      if (error) throw error;
      return json(201, { customer: data });
    }
    return methodNotAllowed();
  } catch (error) { return handleError(error); }
}
