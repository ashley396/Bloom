import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { WEEKDAY_NAMES, withDefaults, validateHours, defaultRow } from "../netlify/functions/shop-hours.js";
import { formatShopHoursSummary } from "../netlify/functions/_shared/shop-time.js";

const root = process.cwd();

/**
 * Third dormant-infrastructure finding from the ai_shop_profiles sweep:
 * shop_hours is seeded with default weekday rows at onboarding and has
 * real RLS policies (any shop member can read, owner/manager can write),
 * but no application code ever queried it — no Settings UI to view or
 * edit real store hours, and the Website Studio "Hours" section defaulted
 * to a hardcoded "Mon–Sat 9–6" string instead of the shop's real data.
 * This is the real feature build, not a one-line wiring fix.
 */

test("withDefaults fills in every weekday, even ones missing a DB row entirely", () => {
  const hours = withDefaults("shop_1", [{ weekday: 2, is_closed: false, opens_at: "10:00:00", closes_at: "18:00:00" }]);
  assert.equal(hours.length, 7);
  assert.deepEqual(
    hours.map((h) => h.weekday),
    [0, 1, 2, 3, 4, 5, 6]
  );
  assert.deepEqual(
    hours.map((h) => h.label),
    WEEKDAY_NAMES
  );
  // Tuesday came from the real row (opens_at truncated from HH:MM:SS to HH:MM).
  assert.equal(hours[2].opens_at, "10:00");
  assert.equal(hours[2].closes_at, "18:00");
  // Every other weekday falls back to defaultRow's open default, not null/undefined.
  assert.equal(hours[0].is_closed, false);
  assert.equal(hours[0].opens_at, "09:00");
});

test("withDefaults reports is_closed days with null times, not stale leftover times", () => {
  const hours = withDefaults("shop_1", [{ weekday: 0, is_closed: true, opens_at: null, closes_at: null }]);
  assert.equal(hours[0].is_closed, true);
  assert.equal(hours[0].opens_at, null);
  assert.equal(hours[0].closes_at, null);
});

test("validateHours rejects a weekday outside 0-6", () => {
  assert.match(validateHours([{ weekday: 7, is_closed: false, opens_at: "09:00", closes_at: "17:00" }]), /between 0 and 6/);
  assert.match(validateHours([{ weekday: -1, is_closed: false, opens_at: "09:00", closes_at: "17:00" }]), /between 0 and 6/);
});

test("validateHours rejects a duplicate weekday in the same request", () => {
  const rows = [0, 0].map((weekday) => ({ weekday, is_closed: true }));
  assert.match(validateHours(rows), /more than once/);
});

test("validateHours requires real HH:MM open/close times when the day isn't closed", () => {
  assert.match(validateHours([{ weekday: 1, is_closed: false, opens_at: "", closes_at: "17:00" }]), /opens_at must be an HH:MM time/);
  assert.match(validateHours([{ weekday: 1, is_closed: false, opens_at: "9am", closes_at: "17:00" }]), /opens_at must be an HH:MM time/);
});

test("validateHours rejects a closing time that isn't after the opening time", () => {
  assert.match(validateHours([{ weekday: 1, is_closed: false, opens_at: "17:00", closes_at: "09:00" }]), /closing time must be after opening time/);
});

test("validateHours skips the time checks entirely for a closed day", () => {
  assert.equal(validateHours([{ weekday: 1, is_closed: true, opens_at: null, closes_at: null }]), null);
});

test("validateHours accepts a real full week", () => {
  const week = WEEKDAY_NAMES.map((_, weekday) => ({ weekday, is_closed: weekday === 0, opens_at: "09:00", closes_at: "17:00" }));
  assert.equal(validateHours(week), null);
});

test("defaultRow is a real open day, not a closed placeholder — a brand-new shop shows real defaults, not empty", () => {
  const row = defaultRow("shop_1", 3);
  assert.equal(row.is_closed, false);
  assert.equal(row.opens_at, "09:00");
});

test("formatShopHoursSummary groups by real day labels in weekday order, not insertion order", () => {
  const rows = [
    { weekday: 6, is_closed: false, opens_at: "10:00", closes_at: "14:00" },
    { weekday: 0, is_closed: true },
    { weekday: 1, is_closed: false, opens_at: "09:00", closes_at: "17:00" }
  ];
  const summary = formatShopHoursSummary(rows);
  assert.equal(summary, "Sun Closed, Mon 9:00 AM–5:00 PM, Sat 10:00 AM–2:00 PM");
});

test("formatShopHoursSummary returns empty string for no rows, so callers can fall back cleanly", () => {
  assert.equal(formatShopHoursSummary([]), "");
  assert.equal(formatShopHoursSummary(undefined), "");
});

test("instant-website.js seeds the Hours section from real shop_hours instead of a hardcoded string", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/instant-website.js"), "utf8");
  assert.match(src, /formatShopHoursSummary/);
  assert.match(src, /from\("shop_hours"\)/);
  // The bloom-instant-website.js fallback stays as a true last-resort —
  // this doesn't remove it, just makes sure the real path runs first.
  const bundled = fs.readFileSync(path.join(root, "netlify/functions/_shared/bloom-instant-website.js"), "utf8");
  assert.match(bundled, /shop\.hours \|\| "Mon–Sat 9–6"/);
});

test("Settings page has a real store-hours editor, seven days, not a stub", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const start = html.indexOf('id="shopHoursPanel"');
  assert.notEqual(start, -1, "shopHoursPanel section must exist");
  const section = html.slice(start, html.indexOf("</section>", start));
  for (let weekday = 0; weekday < 7; weekday++) {
    assert.match(section, new RegExp(`id="hoursClosed${weekday}"`));
    assert.match(section, new RegExp(`id="hoursOpen${weekday}"`));
    assert.match(section, new RegExp(`id="hoursClose${weekday}"`));
  }
  assert.match(section, /id="saveShopHours"/);
});

test("app.js wires the save button to a real PUT call, and loads hours when Settings opens", () => {
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(appJs, /async function saveShopHours\(\)/);
  assert.match(appJs, /api\("shop-hours",\{method:"PUT"/);
  assert.match(appJs, /async function loadSettings\(\)\{[\s\S]*?loadShopHours\(\)\}/);
  assert.match(appJs, /\$\("#saveShopHours"\)\?\.addEventListener\("click",saveShopHours\)/);
});
