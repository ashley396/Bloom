/**
 * Shop-timezone-aware "calendar day" helpers.
 *
 * A server has no inherent concept of "the florist's local day" — this
 * Netlify Function runs on UTC. Computing "today" via
 * `new Date().toISOString().slice(0, 10)` (the pattern this replaces)
 * silently uses the server's UTC calendar day for every shop, which is
 * the wrong day for several hours every evening in any negative-UTC-
 * offset timezone — i.e. every US shop. shops.timezone is captured as a
 * real IANA zone at onboarding (see complete-onboarding.js /
 * public/onboarding.html's Time zone select) specifically so day
 * boundaries — Today's Sales, Orders Due Today, inventory freshness —
 * can be computed in the florist's own day instead of the server's.
 */

const FALLBACK_TZ = "America/New_York";

function safeTimeZone(tz) {
  const value = String(tz || "").trim();
  if (!value) return FALLBACK_TZ;
  try {
    // Intl throws RangeError for an unknown/invalid IANA zone identifier —
    // fail closed to the fallback rather than letting a bad stored value
    // crash the whole dashboard request.
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return value;
  } catch {
    return FALLBACK_TZ;
  }
}

/** "YYYY-MM-DD" for `instant` (default: now) as seen in the shop's timezone. */
export function shopDateStr(timezone, instant = new Date()) {
  const tz = safeTimeZone(timezone);
  // en-CA formats dates as YYYY-MM-DD — exactly the shape every other
  // date-string comparison in this codebase already uses.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** "YYYY-MM-DD" for N calendar days before the shop's current local day. */
export function shopDateStrDaysAgo(timezone, daysAgo) {
  const todayStr = shopDateStr(timezone);
  const [y, m, d] = todayStr.split("-").map(Number);
  // Anchor at UTC noon so subtracting whole days never gets shifted by a
  // DST transition landing in between — this is calendar-date arithmetic
  // on a Y-M-D triple, not a real instant in time.
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  anchor.setUTCDate(anchor.getUTCDate() - Number(daysAgo || 0));
  return anchor.toISOString().slice(0, 10);
}

/** Short weekday label ("Mon") for a "YYYY-MM-DD" calendar date. */
export function weekdayLabel(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  // The numeric Date(y, monthIndex, day) constructor is a pure calendar
  // date with no timezone string to misparse — every getter/formatter
  // reads it back consistently regardless of server timezone.
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("en-US", { weekday: "short" });
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function format12Hour(hhmm) {
  const [h, m] = String(hhmm || "").slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Formats public.shop_hours rows ({weekday, is_closed, opens_at, closes_at})
 * into a readable one-line summary, e.g. "Mon–Fri 9:00 AM–5:00 PM, Sat
 * 10:00 AM–2:00 PM, Sun Closed". Used to seed the Website Studio "Hours"
 * section with the shop's real hours instead of a generic placeholder —
 * see instant-website.js's loadShopProfile().
 */
export function formatShopHoursSummary(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const byWeekday = new Map(rows.map((r) => [Number(r.weekday), r]));
  return WEEKDAY_SHORT.map((label, weekday) => {
    const row = byWeekday.get(weekday);
    if (!row) return null;
    if (row.is_closed) return `${label} Closed`;
    const open = format12Hour(row.opens_at);
    const close = format12Hour(row.closes_at);
    return open && close ? `${label} ${open}–${close}` : null;
  })
    .filter(Boolean)
    .join(", ");
}
