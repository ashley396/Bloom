/** Build florist network wire payload from an existing POS order. */

export function buildWirePayloadFromOrder(order = {}, options = {}) {
  const fulfillment = String(order.fulfillment || "DELIVERY").toUpperCase();
  const deliveryAddress =
    fulfillment === "DELIVERY"
      ? String(order.delivery_address || "").trim()
      : String(options.shopAddress || "Pickup at sending shop").trim();

  const productDescription =
    String(order.arrangement_description || "").trim() ||
    String(order.preferred_flowers || "").trim() ||
    "Florist arrangement per attached order";

  const wireAmount = Math.max(
    0,
    Number(options.wireAmount ?? order.subtotal ?? order.total ?? 0)
  );

  return {
    source_order_id: order.id || null,
    recipient_name: String(order.recipient_name || order.customer_name || "").trim(),
    recipient_phone: String(order.recipient_phone || order.customer_phone || "").trim() || null,
    delivery_address: deliveryAddress,
    delivery_date: String(order.delivery_date || "").slice(0, 10),
    delivery_time_window: String(order.delivery_window || "").trim() || null,
    card_message: String(order.card_message || "").trim() || null,
    arrangement_notes: String(order.notes || "").trim() || null,
    product_description: productDescription,
    wire_amount: wireAmount > 0 ? wireAmount : 75,
    customer_total: Math.max(0, Number(order.total || 0)) || null,
  };
}
