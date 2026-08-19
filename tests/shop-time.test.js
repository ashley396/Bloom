import test from "node:test";
import assert from "node:assert/strict";
import { shopDateStr, shopDateStrDaysAgo, weekdayLabel } from "../netlify/functions/_shared/shop-time.js";

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
