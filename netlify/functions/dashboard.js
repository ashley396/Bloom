import { json, methodNotAllowed } from "./_shared/http.js";
import { requireUser, handleError } from "./_shared/supabase.js";

export async function handler(event) {
  if (event.httpMethod !== "GET") return methodNotAllowed();
  try {
    const { supabase, user } = await requireUser(event);
    const today = new Date().toISOString().slice(0, 10);
    const [ordersResult, inventoryResult] = await Promise.all([
      supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("inventory").select("*").eq("user_id", user.id).order("name")
    ]);
    if (ordersResult.error) throw ordersResult.error;
    if (inventoryResult.error) throw inventoryResult.error;
    const orders = ordersResult.data || [];
    const inventory = inventoryResult.data || [];
    const todayOrders = orders.filter((o) => o.created_at?.slice(0,10) === today);
    const deliveries = orders.filter((o) => o.fulfillment === "DELIVERY" && !["COMPLETED","CANCELLED"].includes(o.status));
    const lowStock = inventory.filter((i) => Number(i.quantity) <= Number(i.low_stock_level));
    return json(200, {
      ordersToday: todayOrders.length,
      deliveries: deliveries.length,
      salesToday: todayOrders.filter((o) => o.status !== "CANCELLED").reduce((sum,o) => sum + Number(o.total || 0), 0),
      lowStock: lowStock.length,
      queue: orders.filter((o) => !["COMPLETED","CANCELLED"].includes(o.status)).slice(0,10)
    });
  } catch (error) { return handleError(error); }
}
