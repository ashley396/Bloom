import { createClient } from "@supabase/supabase-js";

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return response(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) return response(503, { error: "Supabase is not configured in Netlify." });

    const authorization = event.headers.authorization || event.headers.Authorization || "";
    if (!authorization.startsWith("Bearer ")) return response(401, { error: "Please sign in again." });

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const body = JSON.parse(event.body || "{}");
    const { data, error } = await supabase.rpc("complete_florist_onboarding", {
      p_shop_name: body.shopName,
      p_full_name: body.fullName || null,
      p_phone: body.phone || null,
      p_email: body.email || null,
      p_website: body.website || null,
      p_address_line_1: body.addressLine1 || null,
      p_address_line_2: body.addressLine2 || null,
      p_city: body.city || null,
      p_state: body.state || null,
      p_postal_code: body.postalCode || null,
      p_timezone: body.timezone || "America/New_York",
      p_tax_rate: Number(body.taxRate || 0),
      p_delivery_fee: Number(body.deliveryFee || 0),
      p_receipt_header: body.receiptHeader || null,
      p_shop_tone: body.shopTone || "warm, capable, florist-friendly",
      p_delivery_notes: body.deliveryNotes || null,
      p_marketing_notes: body.marketingNotes || null
    });

    if (error) throw error;
    return response(200, { ok: true, shopId: data });
  } catch (error) {
    console.error(error);
    return response(400, { error: error.message || "Unable to complete onboarding." });
  }
}
