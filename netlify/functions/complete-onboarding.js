import { authenticatedUser, fail, json } from "./_shared/saas.js";

function clean(body) {
  const required = ["shopName", "phone", "addressLine1", "city", "state", "postalCode"];
  for (const key of required) {
    if (!String(body[key] || "").trim()) {
      const error = new Error(`Please complete ${key}`);
      error.statusCode = 400;
      throw error;
    }
  }
  const taxRate = Number(body.taxRate || 0);
  const deliveryFee = Number(body.deliveryFee || 0);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw Object.assign(new Error("Tax rate must be between 0 and 100"), { statusCode: 400 });
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0) throw Object.assign(new Error("Delivery fee cannot be negative"), { statusCode: 400 });
  return { taxRate, deliveryFee };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = JSON.parse(event.body || "{}");
    const { taxRate, deliveryFee } = clean(body);
    const { client, user } = await authenticatedUser(event);
    const { data: shopId, error } = await client.rpc("complete_florist_onboarding", {
      p_shop_name: body.shopName.trim(),
      p_full_name: body.fullName || user.user_metadata?.full_name || "",
      p_phone: body.phone,
      p_email: body.email || user.email,
      p_website: body.website || null,
      p_address_line_1: body.addressLine1,
      p_address_line_2: body.addressLine2 || null,
      p_city: body.city,
      p_state: body.state,
      p_postal_code: body.postalCode,
      p_timezone: body.timezone || "America/New_York",
      p_tax_rate: taxRate,
      p_delivery_fee: deliveryFee,
      p_receipt_header: body.receiptHeader || body.shopName.trim(),
      p_shop_tone: body.shopTone || "warm, capable, florist-friendly",
      p_delivery_notes: body.deliveryNotes || null,
      p_marketing_notes: body.marketingNotes || null
    });
    if (error) throw error;

    return json(200, { ok: true, shopId });
  } catch (error) {
    return fail(error);
  }
}
