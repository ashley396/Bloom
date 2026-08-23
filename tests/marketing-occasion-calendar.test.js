import test from "node:test";
import assert from "node:assert/strict";
import {
  nthWeekdayOfMonth,
  administrativeProfessionalsDay,
  easterSunday,
  resolveOccasionDate,
  isOccasionActiveInMonth,
  occasionsInMonth,
  FLORIST_OCCASIONS
} from "../netlify/functions/_shared/marketing-occasion-calendar.js";

test("easterSunday matches known real Easter dates", () => {
  assert.equal(easterSunday(2024), "2024-03-31");
  assert.equal(easterSunday(2025), "2025-04-20");
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
});

test("administrativeProfessionalsDay matches known real observed dates", () => {
  assert.equal(administrativeProfessionalsDay(2024), "2024-04-24");
  assert.equal(administrativeProfessionalsDay(2025), "2025-04-23");
});

test("administrativeProfessionalsDay is always a Wednesday whose Mon-Fri week is entirely inside April", () => {
  for (const year of [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030]) {
    const iso = administrativeProfessionalsDay(year);
    const [y, m, d] = iso.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    assert.equal(weekday, 3, `${iso} must be a Wednesday`);
    assert.equal(m, 4, `${iso} must be in April`);
    const monday = d - 2;
    const friday = d + 2;
    assert.ok(monday >= 1, `Monday of the week (day ${monday}) must still be in April for ${year}`);
    assert.ok(friday <= 30, `Friday of the week (day ${friday}) must still be in April for ${year}`);
  }
});

test("nthWeekdayOfMonth: Mother's Day (2nd Sunday of May) and Father's Day (3rd Sunday of June) match known real dates", () => {
  assert.equal(nthWeekdayOfMonth(2026, 5, 0, 2), "2026-05-10");
  assert.equal(nthWeekdayOfMonth(2026, 6, 0, 3), "2026-06-21");
});

test("nthWeekdayOfMonth: Thanksgiving (4th Thursday of November) matches a known real date", () => {
  assert.equal(nthWeekdayOfMonth(2026, 11, 4, 4), "2026-11-26");
});

test("nthWeekdayOfMonth returns null rather than a wrong date when the Nth occurrence doesn't exist in the month", () => {
  // May has at most 5 Sundays in any year — a 6th never exists.
  assert.equal(nthWeekdayOfMonth(2026, 5, 0, 6), null);
});

test("resolveOccasionDate: fixed_date occasions never shift year to year", () => {
  const valentines = FLORIST_OCCASIONS.find((o) => o.key === "valentines_day");
  assert.equal(resolveOccasionDate(valentines, 2026), "2026-02-14");
  assert.equal(resolveOccasionDate(valentines, 2030), "2030-02-14");
});

test("resolveOccasionDate: fixed_range occasions (Nurses Week) resolve to a real start/end", () => {
  const nursesWeek = FLORIST_OCCASIONS.find((o) => o.key === "nurses_week");
  const resolved = resolveOccasionDate(nursesWeek, 2026);
  assert.deepEqual(resolved, { start: "2026-05-06", end: "2026-05-12" });
});

test("resolveOccasionDate: a month_range occasion (no single date) resolves to null — it must not fabricate one", () => {
  const weddingSeason = FLORIST_OCCASIONS.find((o) => o.key === "wedding_season");
  assert.equal(resolveOccasionDate(weddingSeason, 2026), null);
});

test("isOccasionActiveInMonth: a month_range occasion is active for every month inside its span, inactive outside it", () => {
  const weddingSeason = FLORIST_OCCASIONS.find((o) => o.key === "wedding_season"); // May-Oct
  assert.equal(isOccasionActiveInMonth(weddingSeason, 2026, 5), true);
  assert.equal(isOccasionActiveInMonth(weddingSeason, 2026, 10), true);
  assert.equal(isOccasionActiveInMonth(weddingSeason, 2026, 4), false);
  assert.equal(isOccasionActiveInMonth(weddingSeason, 2026, 11), false);
});

test("occasionsInMonth: September 2026 surfaces wedding season and homecoming season, not Christmas", () => {
  const items = occasionsInMonth(2026, 9);
  const keys = items.map((i) => i.key);
  assert.ok(keys.includes("wedding_season"));
  assert.ok(keys.includes("homecoming_season"));
  assert.ok(!keys.includes("christmas"));
});

test("occasionsInMonth: May 2026 surfaces Mother's Day with its real resolved date", () => {
  const items = occasionsInMonth(2026, 5);
  const mothersDay = items.find((i) => i.key === "mothers_day");
  assert.ok(mothersDay);
  assert.equal(mothersDay.resolved, "2026-05-10");
});

test("every FLORIST_OCCASIONS entry has a unique key", () => {
  const keys = FLORIST_OCCASIONS.map((o) => o.key);
  assert.equal(new Set(keys).size, keys.length);
});
