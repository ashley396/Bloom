import { json, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { buildProductionReport } from "../../lib/ops/production-report.js";

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "GET") return methodNotAllowed();
  try {
    const { client, shopId } = await currentUser(event);
    const qs = event.queryStringParameters || {};
    const days = Math.min(90, Math.max(1, Number(qs.days || 7)));

    const { data, error } = await client
      .from("orders")
      .select("id,status,designer,created_at,updated_at,total")
      .eq("shop_id", shopId)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    const report = buildProductionReport(data || [], { days });
    return json(200, { report });
  } catch (error) {
    return fail(error);
  }
}
