import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail, requireRoles } from "./_shared/supabase.js";

// weekday follows JS Date.getDay() convention (0=Sunday .. 6=Saturday), the
// same convention shop-time.js's weekdayLabel() already uses elsewhere in
// this codebase — see dashboard.js/marketplace-catalog.js.
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function defaultRow(shopId, weekday) {
  return { shop_id: shopId, weekday, is_closed: false, opens_at: "09:00", closes_at: "17:00" };
}

/** Fills in any weekday missing from the DB (e.g. a shop created before
 * this table existed, or a row lost some other way) with a sensible open
 * default, so the editor always shows all 7 days instead of silently
 * skipping ones with no row. */
export function withDefaults(shopId, rows) {
  const byWeekday = new Map(rows.map((r) => [r.weekday, r]));
  return WEEKDAY_NAMES.map((name, weekday) => {
    const row = byWeekday.get(weekday) || defaultRow(shopId, weekday);
    return {
      weekday,
      label: name,
      is_closed: Boolean(row.is_closed),
      opens_at: row.opens_at ? String(row.opens_at).slice(0, 5) : null,
      closes_at: row.closes_at ? String(row.closes_at).slice(0, 5) : null
    };
  });
}

export function validateHours(input) {
  if (!Array.isArray(input) || !input.length) return "hours must be a non-empty array.";
  const seen = new Set();
  for (const row of input) {
    const weekday = Number(row?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return `Each entry needs a weekday between 0 and 6 (got ${row?.weekday}).`;
    }
    if (seen.has(weekday)) return `weekday ${weekday} was sent more than once.`;
    seen.add(weekday);
    const isClosed = Boolean(row?.is_closed);
    if (!isClosed) {
      if (!TIME_RE.test(row?.opens_at || "")) return `${WEEKDAY_NAMES[weekday]}: opens_at must be an HH:MM time.`;
      if (!TIME_RE.test(row?.closes_at || "")) return `${WEEKDAY_NAMES[weekday]}: closes_at must be an HH:MM time.`;
      if (row.opens_at >= row.closes_at) return `${WEEKDAY_NAMES[weekday]}: closing time must be after opening time.`;
    }
  }
  return null;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    const ctx = await currentUser(event);
    const { client, shopId } = ctx;

    if (event.httpMethod === "GET") {
      const { data, error } = await client.from("shop_hours").select("weekday,is_closed,opens_at,closes_at").eq("shop_id", shopId);
      if (error) throw error;
      return json(200, { hours: withDefaults(shopId, data || []) });
    }

    if (event.httpMethod === "PUT" || event.httpMethod === "PATCH") {
      requireRoles(ctx, ["owner", "manager"]);
      const body = bodyOf(event);
      const problem = validateHours(body.hours);
      if (problem) return json(400, { error: problem });

      const rows = body.hours.map((row) => ({
        shop_id: shopId,
        weekday: Number(row.weekday),
        is_closed: Boolean(row.is_closed),
        opens_at: row.is_closed ? null : row.opens_at,
        closes_at: row.is_closed ? null : row.closes_at
      }));
      const { data, error } = await client.from("shop_hours").upsert(rows, { onConflict: "shop_id,weekday" }).select("weekday,is_closed,opens_at,closes_at");
      if (error) throw error;
      return json(200, { hours: withDefaults(shopId, data || []) });
    }

    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}
