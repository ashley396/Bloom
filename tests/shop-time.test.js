import test from "node:test";
import assert from "node:assert/strict";
import { shopDateStr, shopDateStrDaysAgo, weekdayLabel, shopLocalDateTimeToUtcIso } from "../netlify/functions/_shared/shop-time.js";

test("shopDateStr reads the shop's local calendar day, not the server's UTC day", () => {
  // 11:30 PM Eastern on Aug 20 is already 3:30 AM UTC on Aug 21.
  const instant = new Date("2026-08-21T03:30:00.000Z");
  assert.equal(shopDateStr("America/New_York", instant), "2026-08-20");
  // The same instant, read in UTC, really is the 21st.
  assert.equal(shopDateStr("UTC", instant), "2026-08-21");
});

test("shopDateStr falls back to America/New_York for a missing or invalid timezone", () => {
  const instant = new Date("2026-08-21T03:30:00.000Z");
  assert.equal(shopDateStr(undefined, instant), "2026-08-20");
  assert.equal(shopDateStr("", instant), "2026-08-20");
  assert.equal(shopDateStr("Not/A_Real_Zone", instant), "2026-08-20");
});

test("shopDateStr handles west-coast and non-US zones correctly", () => {
  const instant = new Date("2026-08-21T03:30:00.000Z"); // 8:30 PM Pacific on the 20th
  assert.equal(shopDateStr("America/Los_Angeles", instant), "2026-08-20");
  assert.equal(shopDateStr("Europe/London", instant), "2026-08-21"); // 4:30 AM BST on the 21st
});

test("shopDateStrDaysAgo walks back whole calendar days, including across a month boundary", () => {
  const original = global.Date;
  class FixedDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super("2026-09-02T03:30:00.000Z"); // 11:30 PM Eastern on Sept 1
    }
  }
  global.Date = FixedDate;
  try {
    assert.equal(shopDateStrDaysAgo("America/New_York", 0), "2026-09-01");
    assert.equal(shopDateStrDaysAgo("America/New_York", 1), "2026-08-31");
    assert.equal(shopDateStrDaysAgo("America/New_York", 2), "2026-08-30");
  } finally {
    global.Date = original;
  }
});

test("weekdayLabel returns the correct short weekday for a plain Y-M-D date", () => {
  assert.equal(weekdayLabel("2026-08-20"), "Thu");
  assert.equal(weekdayLabel("2026-08-16"), "Sun");
  assert.equal(weekdayLabel("2026-12-25"), "Fri");
});

// ── shopLocalDateTimeToUtcIso (Launch-blocker fix, Blocker 3/4: the
// Schedule UI must convert a florist's local wall-clock pick into the
// correct UTC instant for THEIR shop's real timezone — never a hardcoded
// offset, and correct across a DST transition.) ─────────────────────────

test("shopLocalDateTimeToUtcIso: standard-time (winter, EST, UTC-5) conversion for America/New_York", () => {
  assert.equal(shopLocalDateTimeToUtcIso("America/New_York", "2026-01-15T08:00"), "2026-01-15T13:00:00.000Z");
});

test("shopLocalDateTimeToUtcIso: daylight-time (summer, EDT, UTC-4) conversion for America/New_York — a full hour different from winter, same wall-clock time", () => {
  assert.equal(shopLocalDateTimeToUtcIso("America/New_York", "2026-07-15T08:00"), "2026-07-15T12:00:00.000Z");
});

test("shopLocalDateTimeToUtcIso: correctly straddles the real 2026 US spring-forward DST transition (America/New_York, March 8 2:00 AM -> 3:00 AM)", () => {
  // Before the jump: still EST (UTC-5).
  assert.equal(shopLocalDateTimeToUtcIso("America/New_York", "2026-03-08T01:00"), "2026-03-08T06:00:00.000Z");
  // After the jump (same calendar day): already EDT (UTC-4) — a
  // hardcoded fixed offset would get this wrong for one of these two.
  assert.equal(shopLocalDateTimeToUtcIso("America/New_York", "2026-03-08T08:00"), "2026-03-08T12:00:00.000Z");
});

test("shopLocalDateTimeToUtcIso: correctly straddles the real 2026 US fall-back DST transition (America/New_York, November 1)", () => {
  // Well before the fall-back hour: still EDT (UTC-4).
  assert.equal(shopLocalDateTimeToUtcIso("America/New_York", "2026-11-01T00:30"), "2026-11-01T04:30:00.000Z");
  // Well after: back to EST (UTC-5).
  assert.equal(shopLocalDateTimeToUtcIso("America/New_York", "2026-11-01T08:00"), "2026-11-01T13:00:00.000Z");
});

test("shopLocalDateTimeToUtcIso: a different real shop timezone (America/Los_Angeles, PST UTC-8) is genuinely used, not defaulted to Eastern", () => {
  assert.equal(shopLocalDateTimeToUtcIso("America/Los_Angeles", "2026-01-15T08:00"), "2026-01-15T16:00:00.000Z");
});

test("shopLocalDateTimeToUtcIso: UTC shop timezone needs no offset at all", () => {
  assert.equal(shopLocalDateTimeToUtcIso("UTC", "2026-06-01T12:00"), "2026-06-01T12:00:00.000Z");
});

test("shopLocalDateTimeToUtcIso: unparseable input returns null rather than throwing", () => {
  assert.equal(shopLocalDateTimeToUtcIso("America/New_York", "not a date"), null);
  assert.equal(shopLocalDateTimeToUtcIso("America/New_York", ""), null);
  assert.equal(shopLocalDateTimeToUtcIso("America/New_York", undefined), null);
});

test("shopLocalDateTimeToUtcIso: an invalid/unknown timezone falls back to America/New_York rather than crashing", () => {
  assert.equal(shopLocalDateTimeToUtcIso("Not/AZone", "2026-01-15T08:00"), "2026-01-15T13:00:00.000Z");
});
