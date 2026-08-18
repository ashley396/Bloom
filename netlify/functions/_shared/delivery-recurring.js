/** Create delivery for recurring subscription orders. */

import { shopDateStr } from "./shop-time.js";

export async function createRecurringDelivery(client, { shopId, orderId, subscription, customerId, timezone }) {
  const { data: existing } = await client.from("deliveries").select("id").eq("shop_id", shopId).eq("order_id", orderId).maybeSingle();
  if (existing?.id) return { ok: true, delivery_id: existing.id, duplicate: true };

  let customer = null;
  if (customerId) {
    const { data } = await client.from("customers").select("name,phone,address").eq("id", customerId).eq("shop_id", shopId).maybeSingle();
    customer = data;
  }

  const meta = subscription?.metadata || {};
  const address = meta.delivery_address || customer?.address;
  const recipient = meta.recipient_name || subscription?.customer_name || customer?.name;
  const phone = meta.recipient_phone || customer?.phone;
  const instructions = meta.delivery_instructions || customer?.delivery_notes;
  // No scheduled date on the subscription itself — default to the shop's
  // own today, not the server's UTC day (this is a real Stripe-charged
  // recurring order; an evening run in any US timezone must not schedule
  // its delivery a day off).
  const deliveryDate = subscription?.next_delivery_date || shopDateStr(timezone);

  if (!address || !recipient) {
    await client
      .from("orders")
      .update({ metadata: { delivery_attention_required: true } })
      .eq("id", orderId)
      .catch(() => {});
    return { ok: false, reason: "missing_delivery_details" };
  }

  const payload = {
    shop_id: shopId,
    order_id: orderId,
    status: "PENDING",
    address,
    recipient_name: recipient,
    recipient_phone: phone,
    notes: instructions,
    delivery_date: deliveryDate
  };

  const { data, error } = await client.from("deliveries").insert(payload).select("id").single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, delivery_id: data?.id };
}
