import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";

function orderNumber() {
  return `BLM-${Date.now().toString().slice(-8)}`;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;

  try {
    const { client, shopId, user } = await currentUser(event);

    if (event.httpMethod === "GET") {
      const { data, error } = await client
        .from("orders")
        .select("*")
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return json(200, { items: data || [] });
    }

    if (event.httpMethod === "POST") {
      const body = bodyOf(event);

      if (!body.customer_name) {
        return json(400, { error: "Customer name is required" });
      }

      const flowers = Number(body.subtotal || 0);
      const labor = Number(body.labor_charge || 0);
      const addons = Number(body.addon_total || 0);
      const discount = Number(body.discount || 0);
      const subtotal = Math.max(0, flowers + labor + addons - discount);
      const tax = Number(body.tax || 0);
      const deliveryFee = Number(body.delivery_fee || 0);

      const payload = {
        user_id: user.id,
        shop_id: shopId,
        order_number: orderNumber(),
        customer_name: body.customer_name.trim(),
        occasion: body.occasion || null,
        fulfillment:
          body.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
        delivery_address: body.delivery_address || null,
        delivery_date: body.delivery_date || null,
        status: "NEW",
        subtotal,
        tax,
        delivery_fee: deliveryFee,
        total: subtotal + tax + deliveryFee,
        notes: body.notes || null,
        tax_rate: Number(body.tax_rate || 0),
        amount_paid: Number(body.amount_paid || 0),
        balance_due: Math.max(0, subtotal + tax + deliveryFee - Number(body.amount_paid || 0)),
        payment_status: body.payment_status || (Number(body.amount_paid || 0) > 0 ? "PARTIAL" : "UNPAID"),
        payment_method: body.payment_method || null,
        customer_type: body.customer_type || "PERSONAL",
        recipient_name: body.recipient_name || null,
        recipient_phone: body.recipient_phone || null,
        delivery_window: body.delivery_window || null,
        delivery_instructions: body.delivery_instructions || null,
        delivery_miles: Number(body.delivery_miles || 0),
        drive_minutes: Number(body.drive_minutes || 0),
        order_source: body.order_source || null,
        card_message: body.card_message || null,
        arrangement_description: body.arrangement_description || null,
      };

      const { data, error } = await client
        .from("orders")
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      return json(201, { item: data });
    }

    if (event.httpMethod === "PATCH") {
      const body = bodyOf(event);
      const payload = {};
      if(body.action === "MARK_PAID"){
        payload.payment_status="PAID";
        payload.payment_method=body.payment_method||"Other";
        payload.balance_due=0;
      }else if(body.action === "MARK_UNPAID"){
        payload.payment_status="UNPAID";
        payload.amount_paid=0;
      }else{
        for(const field of ["status","payment_status","payment_method","amount_paid","balance_due","delivery_miles","drive_minutes"]){
          if(field in body)payload[field]=body[field];
        }
      }
      const { data, error } = await client.from("orders").update(payload).eq("id",body.id).eq("shop_id",shopId).select().single();
      if (error) throw error;
      return json(200, { item: data });
    }

    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}