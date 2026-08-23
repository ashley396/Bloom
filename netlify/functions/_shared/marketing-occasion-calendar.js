/**
 * Real, deterministic florist occasion calendar — Section 30 of the
 * Marketing Studio build directive.
 *
 * Every date here is computed from actual calendar math (fixed
 * month/day, "Nth weekday of month" federal-holiday-style rules, the
 * standard Gregorian Easter algorithm, or the official "last full
 * Mon-Fri workweek" rule for Administrative Professionals Day) — nothing
 * is looked up from a hard-coded per-year table, and nothing is
 * fabricated. An occasion whose real-world date isn't a clean calendar
 * rule (wedding season, prom, homecoming, sympathy) is modeled as a
 * MONTH RANGE instead of forcing a fake single date onto it.
 *
 * This file is pure date math — zero database access, zero shop data —
 * so it's fully unit-testable against known real dates.
 */

const WEEKDAY = Object.freeze({ SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 });

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toIso(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** UTC day-of-week for a given calendar date (0=Sunday..6=Saturday). Uses
 * UTC throughout (never local time) so this never drifts by a day
 * depending on the server's timezone. */
function utcWeekday(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The Nth occurrence of a weekday in a month (n=1 for 1st, 2 for 2nd, ...).
 * E.g. nthWeekdayOfMonth(2026, 5, WEEKDAY.SUN, 2) = Mother's Day 2026. */
export function nthWeekdayOfMonth(year, month, weekday, n) {
  const firstOfMonthWeekday = utcWeekday(year, month, 1);
  const firstMatch = 1 + ((weekday - firstOfMonthWeekday + 7) % 7);
  const day = firstMatch + (n - 1) * 7;
  if (day > daysInMonth(year, month)) return null;
  return toIso(year, month, day);
}

/**
 * Administrative Professionals Day — official rule: the Wednesday of the
 * last full (Monday-Friday) workweek in April. Not simply "the last
 * Wednesday of April" — in years where April ends mid-week, the true
 * last FULL workweek is the one before that. Matches the real observed
 * dates (e.g. 2024-04-24, 2025-04-23).
 */
export function administrativeProfessionalsDay(year) {
  const lastDay = daysInMonth(year, 4);
  // Walk back from month-end to the most recent Friday.
  let friday = lastDay;
  while (utcWeekday(year, 4, friday) !== WEEKDAY.FRI) friday -= 1;
  let monday = friday - 4;
  // If that week's Monday spilled into March (only possible for a very
  // short/edge month arrangement), step back one more full week.
  if (monday < 1) {
    friday -= 7;
    monday = friday - 4;
  }
  return toIso(year, 4, friday - 2); // Wednesday of that Mon-Fri week
}

/**
 * Easter Sunday (Western/Gregorian) via the standard Anonymous Gregorian
 * algorithm (Meeus/Jones/Butcher). Verified against known real dates:
 * 2024-03-31, 2025-04-20, 2026-04-05, 2027-03-28.
 */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(year, month, day);
}

/**
 * @typedef {Object} OccasionDef
 * @property {string} key
 * @property {string} label
 * @property {'fixed_date'|'nth_weekday'|'computed'|'month_range'} type
 * @property {string} [category] - grouping hint for content-mix weighting
 */
export const FLORIST_OCCASIONS = Object.freeze([
  { key: "new_years_day", label: "New Year's Day", type: "fixed_date", month: 1, day: 1, category: "gifting" },
  { key: "valentines_day", label: "Valentine's Day", type: "fixed_date", month: 2, day: 14, category: "gifting" },
  { key: "easter", label: "Easter", type: "computed", resolver: "easter", category: "gifting" },
  {
    key: "administrative_professionals_day",
    label: "Administrative Professionals Day",
    type: "computed",
    resolver: "admin_professionals_day",
    category: "gifting"
  },
  { key: "nurses_week", label: "National Nurses Week", type: "fixed_range", month: 5, startDay: 6, endDay: 12, category: "gifting" },
  { key: "mothers_day", label: "Mother's Day", type: "nth_weekday", month: 5, weekday: WEEKDAY.SUN, n: 2, category: "gifting" },
  { key: "prom_season", label: "Prom Season", type: "month_range", startMonth: 4, endMonth: 5, category: "wedding_event" },
  { key: "graduation_season", label: "Graduation Season", type: "month_range", startMonth: 5, endMonth: 6, category: "gifting" },
  { key: "fathers_day", label: "Father's Day", type: "nth_weekday", month: 6, weekday: WEEKDAY.SUN, n: 3, category: "gifting" },
  { key: "wedding_season", label: "Wedding Season", type: "month_range", startMonth: 5, endMonth: 10, category: "wedding_event" },
  { key: "homecoming_season", label: "Homecoming Season", type: "month_range", startMonth: 9, endMonth: 10, category: "gifting" },
  { key: "halloween", label: "Halloween", type: "fixed_date", month: 10, day: 31, category: "seasonal" },
  { key: "thanksgiving", label: "Thanksgiving", type: "nth_weekday", month: 11, weekday: WEEKDAY.THU, n: 4, category: "seasonal" },
  { key: "christmas", label: "Christmas", type: "fixed_date", month: 12, day: 25, category: "seasonal" }
]);

/** Resolves one occasion to its real date(s) for a given year, or null if
 * this occasion type has no single computable date (month_range occasions
 * return {startMonth, endMonth} instead — see isOccasionActiveInMonth()). */
export function resolveOccasionDate(occasion, year) {
  if (occasion.type === "fixed_date") return toIso(year, occasion.month, occasion.day);
  if (occasion.type === "fixed_range") return { start: toIso(year, occasion.month, occasion.startDay), end: toIso(year, occasion.month, occasion.endDay) };
  if (occasion.type === "nth_weekday") return nthWeekdayOfMonth(year, occasion.month, occasion.weekday, occasion.n);
  if (occasion.type === "computed") {
    if (occasion.resolver === "easter") return easterSunday(year);
    if (occasion.resolver === "admin_professionals_day") return administrativeProfessionalsDay(year);
    return null;
  }
  return null; // month_range — see isOccasionActiveInMonth()
}

function monthRangeIncludes(occasion, month) {
  if (occasion.startMonth <= occasion.endMonth) return month >= occasion.startMonth && month <= occasion.endMonth;
  // Wraps around the year boundary (none currently defined, but kept correct).
  return month >= occasion.startMonth || month <= occasion.endMonth;
}

/** True if this occasion has any real presence in the given calendar
 * month (a specific date/range falling in-month, or a month_range
 * occasion that spans it). */
export function isOccasionActiveInMonth(occasion, year, month) {
  if (occasion.type === "month_range") return monthRangeIncludes(occasion, month);
  const resolved = resolveOccasionDate(occasion, year);
  if (!resolved) return false;
  if (typeof resolved === "string") return Number(resolved.slice(5, 7)) === month;
  return Number(resolved.start.slice(5, 7)) === month || Number(resolved.end.slice(5, 7)) === month;
}

/** Every occasion with real presence in the given month, each annotated
 * with its resolved date/range (or null for a pure month_range with no
 * single date to anchor to). */
export function occasionsInMonth(year, month) {
  return FLORIST_OCCASIONS.filter((o) => isOccasionActiveInMonth(o, year, month)).map((o) => ({
    key: o.key,
    label: o.label,
    category: o.category,
    type: o.type,
    resolved: o.type === "month_range" ? null : resolveOccasionDate(o, year)
  }));
}
