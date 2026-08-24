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

function offsetMinutesAt(tz, utcInstant) {
  // The instant's wall-clock time AS SEEN in tz, re-interpreted as if it
  // were itself a UTC instant, minus the real UTC instant, gives that
  // zone's real offset (in minutes) AT THIS SPECIFIC INSTANT — DST-aware,
  // because the offset is read off the actual date being converted, never
  // assumed fixed.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })
    .formatToParts(utcInstant)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asIfUtc - utcInstant.getTime()) / 60000;
}

/**
 * Launch-blocker fix (Blocker 3, real durable scheduler): converts a
 * florist-entered "wall clock" date/time (e.g. from an HTML
 * `datetime-local` picker — "2026-11-01T08:00", no zone) into the correct
 * UTC instant for that SHOP's real IANA timezone, DST-aware. Section 27's
 * explicit requirement: "Do not hardcode Eastern Time. Handle DST through
 * timezone-aware conversion." No timezone library is available in this
 * project — this uses the standard round-trip-through-Intl technique
 * (format a guessed instant back in the target zone, measure the real
 * offset at that instant, correct once) rather than a fixed UTC-offset
 * table, which is exactly what would get a DST transition wrong.
 *
 * Returns an ISO 8601 UTC string, or null for unparseable input — never
 * throws, so a malformed scheduling request degrades to a clear 400 at
 * the caller rather than crashing the handler.
 */
export function shopLocalDateTimeToUtcIso(timezone, localDateTimeStr) {
  const tz = safeTimeZone(timezone);
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(localDateTimeStr || "").trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const wallClock = { y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: s ? +s : 0 };
  // Guess: what UTC instant has this exact wall-clock reading? (correct
  // only when tz's offset happens to be 0 — refined below either way.)
  const naiveGuess = Date.UTC(wallClock.y, wallClock.mo - 1, wallClock.d, wallClock.h, wallClock.mi, wallClock.s);
  const offset1 = offsetMinutesAt(tz, new Date(naiveGuess));
  let utcMillis = naiveGuess - offset1 * 60000;
  // One refinement pass: re-measure the offset AT THE CORRECTED instant —
  // this is what catches the case where the naive guess landed on the
  // wrong side of a DST transition from the real instant.
  const offset2 = offsetMinutesAt(tz, new Date(utcMillis));
  if (offset2 !== offset1) {
    utcMillis = naiveGuess - offset2 * 60000;
  }
  return new Date(utcMillis).toISOString();
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
