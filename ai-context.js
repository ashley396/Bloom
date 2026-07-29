import { json, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "GET") return methodNotAllowed();

  try {
    const { client, shopId } = await currentUser(event);
    const [{ data: shop }, { data: inventory }, { data: orders }, { data: deliveries }] = await Promise.all([
      client.from("shops")
        .select("name,address,phone,tagline")
        .eq("id", shopId)
        .maybeSingle(),
      client.from("inventory_items")
        .select("name,color,variety,quantity,unit,low_stock_level,cost,price,arrival_date,vase_life_days")
        .eq("shop_id", shopId)
        .order("updated_at", { ascending: false })
        .limit(30),
      client.from("orders")
        .select("order_number,customer_name,total,payment_status,delivery_date,status,estimated_cost")
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false })
        .limit(15),
      client.from("deliveries")
        .select("status,recipient_name,address,scheduled_date")
        .eq("shop_id", shopId)
        .order("scheduled_date", { ascending: true })
        .limit(15)
    ]);

    return json(200, {
      context: {
        shop: shop || {},
        inventory: inventory || [],
        recent_orders: orders || [],
        deliveries: deliveries || []
      }
    });
  } catch (error) {
    return fail(error);
  }
}
