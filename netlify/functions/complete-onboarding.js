import { authenticatedUser, fail, json, slugify } from "./_shared/saas.js";

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

    const { data: existingProfile } = await client
      .from("profiles").select("default_shop_id").eq("id", user.id).maybeSingle();

    let shopId = existingProfile?.default_shop_id;

    if (!shopId) {
      const base = slugify(body.shopName) || "flower-shop";
      const slug = `${base}-${user.id.slice(0, 6)}`;
      const { data: shop, error: shopError } = await client.from("shops").insert({
        name: body.shopName.trim(),
        slug,
        owner_user_id: user.id,
        email: body.email || user.email,
        phone: body.phone,
        website: body.website || null,
        address_line_1: body.addressLine1,
        address_line_2: body.addressLine2 || null,
        city: body.city,
        state: body.state,
        postal_code: body.postalCode,
        timezone: body.timezone || "America/New_York",
        tax_rate: taxRate,
        default_delivery_fee: deliveryFee,
        receipt_header: body.receiptHeader || body.shopName.trim(),
        onboarding_complete: true
      }).select("id").single();
      if (shopError) throw shopError;
      shopId = shop.id;

      const results = await Promise.all([
        client.from("shop_members").insert({ shop_id: shopId, user_id: user.id, role: "owner", status: "active" }),
        client.from("shop_subscriptions").insert({ shop_id: shopId, plan_code: "trial", status: "trialing" }),
        client.from("ai_shop_profiles").insert({
          shop_id: shopId,
          shop_tone: body.shopTone || "warm, capable, florist-friendly",
          delivery_notes: body.deliveryNotes || null,
          marketing_notes: body.marketingNotes || null
        }),
        client.from("profiles").upsert({
          id: user.id,
          full_name: body.fullName || user.user_metadata?.full_name || "",
          default_shop_id: shopId
        }),
        client.from("shop_hours").insert(
          Array.from({ length: 7 }, (_, weekday) => ({
            shop_id: shopId,
            weekday,
            is_closed: weekday === 0,
            opens_at: weekday === 0 ? null : "09:00",
            closes_at: weekday === 0 ? null : "17:00"
          }))
        ),
        client.from("audit_events").insert({
          shop_id: shopId,
          actor_user_id: user.id,
          event_type: "shop.onboarding_completed",
          entity_type: "shop",
          entity_id: shopId
        })
      ]);
      for (const result of results) if (result.error) throw result.error;
    } else {
      const { error } = await client.from("shops").update({
        name: body.shopName.trim(),
        email: body.email || user.email,
        phone: body.phone,
        website: body.website || null,
        address_line_1: body.addressLine1,
        address_line_2: body.addressLine2 || null,
        city: body.city,
        state: body.state,
        postal_code: body.postalCode,
        timezone: body.timezone || "America/New_York",
        tax_rate: taxRate,
        default_delivery_fee: deliveryFee,
        receipt_header: body.receiptHeader || body.shopName.trim(),
        onboarding_complete: true
      }).eq("id", shopId);
      if (error) throw error;
    }

    return json(200, { ok: true, shopId });
  } catch (error) {
    return fail(error);
  }
}
