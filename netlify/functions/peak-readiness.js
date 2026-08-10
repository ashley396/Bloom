import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import {
  MOTHERS_DAY_CHECKLIST,
  autoDetectReadiness,
  scoreReadiness
} from "../../lib/ops/mothers-day-ready.js";

function missingTable(error) {
  const msg = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || msg.includes("does not exist");
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    const { client, shopId } = await currentUser(event);

    if (event.httpMethod === "GET") {
      const [
        settingsRes,
        productsRes,
        inventoryRes,
        staffRes,
        holidayRes,
        networkRes,
        manualRes
      ] = await Promise.all([
        client.from("shops").select("default_delivery_fee, tax_rate").eq("id", shopId).maybeSingle(),
        client.from("products").select("id, name, category").eq("shop_id", shopId).is("deleted_at", null).limit(200),
        client.from("inventory").select("id").eq("shop_id", shopId).is("deleted_at", null).limit(200),
        client.from("staff").select("id").eq("shop_id", shopId).limit(50),
        client.from("holiday_peaks").select("id, name").eq("shop_id", shopId).ilike("name", "%mother%").limit(1),
        client.from("florist_network_profiles").select("shop_id").eq("is_active", true).neq("shop_id", shopId).limit(1),
        client.from("shop_peak_readiness").select("checklist_id, completed").eq("shop_id", shopId)
      ]);

      const products = productsRes.data || [];
      const mothersDayProducts = products.filter((p) =>
        /mother|mom|md/i.test(`${p.name} ${p.category}`)
      ).length;

      const auto = autoDetectReadiness({
        delivery_fee_set: Number(settingsRes.data?.default_delivery_fee || 0) > 0,
        website_has_holiday: false,
        mothers_day_products: mothersDayProducts,
        inventory_items: (inventoryRes.data || []).length,
        staff_count: (staffRes.data || []).length,
        website_cutoff_text: false,
        payments_enabled: true,
        email_draft: false,
        holiday_peak: (holidayRes.data || []).length > 0,
        network_partner: (networkRes.data || []).length > 0
      });

      const manualMap = Object.fromEntries(
        (manualRes.data || []).map((r) => [r.checklist_id, r.completed])
      );
      const completed = [
        ...new Set([
          ...auto,
          ...MOTHERS_DAY_CHECKLIST.filter((i) => manualMap[i.id]).map((i) => i.id)
        ])
      ];
      const score = scoreReadiness(completed);

      return json(200, {
        checklist: MOTHERS_DAY_CHECKLIST.map((item) => ({
          ...item,
          completed: completed.includes(item.id),
          auto: auto.includes(item.id)
        })),
        score,
        peak: "mothers_day"
      });
    }

    if (event.httpMethod === "POST") {
      const body = bodyOf(event);
      const checklist_id = String(body.checklist_id || "").trim();
      const completed = Boolean(body.completed);
      if (!checklist_id) return json(400, { error: "checklist_id required." });
      const { error } = await client.from("shop_peak_readiness").upsert({
        shop_id: shopId,
        checklist_id,
        completed,
        completed_at: completed ? new Date().toISOString() : null
      });
      if (error) throw error;
      return json(200, { ok: true });
    }

    return methodNotAllowed();
  } catch (error) {
    if (missingTable(error)) {
      return json(200, {
        checklist: MOTHERS_DAY_CHECKLIST.map((item) => ({ ...item, completed: false, auto: false })),
        score: scoreReadiness([]),
        note: "Apply florist_network_growth_v1 migration to persist checklist progress."
      });
    }
    return fail(error);
  }
}
