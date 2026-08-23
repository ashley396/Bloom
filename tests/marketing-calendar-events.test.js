import test from "node:test";
import assert from "node:assert/strict";
import { buildCalendarEvents, groupCalendarEventsByMonth, buildContentCalendarEvents } from "../lib/marketing/calendar-events.js";

test("a single-day item produces one event, a date-range item produces a start and end event", () => {
  const events = buildCalendarEvents({
    campaigns: [
      { id: "c1", name: "Mother's Day", status: "active", starts_on: "2027-05-01", ends_on: "2027-05-09" },
      { id: "c2", name: "Flash Sale", status: "active", starts_on: "2027-06-01", ends_on: "2027-06-01" },
    ],
  });
  assert.equal(events.length, 3);
  const flash = events.filter((e) => e.label === "Flash Sale");
  assert.equal(flash.length, 1);
  assert.equal(flash[0].edge, "single");
  const mothers = events.filter((e) => e.label === "Mother's Day");
  assert.equal(mothers.length, 2);
  assert.deepEqual(mothers.map((e) => e.edge).sort(), ["end", "start"]);
});

test("items with no dates at all contribute nothing", () => {
  const events = buildCalendarEvents({
    campaigns: [{ id: "c1", name: "Draft idea", status: "draft", starts_on: null, ends_on: null }],
  });
  assert.deepEqual(events, []);
});

test("events from campaigns, promotions, and holiday peaks are combined and sorted by date", () => {
  const events = buildCalendarEvents({
    campaigns: [{ id: "c1", name: "Later Campaign", status: "draft", starts_on: "2027-03-01", ends_on: null }],
    promotions: [{ id: "p1", name: "Early Promo", status: "active", starts_on: "2027-01-01", ends_on: "2027-01-01" }],
    holidayPeaks: [{ id: "h1", name: "Valentine's", status: "planning", starts_on: "2027-02-01", ends_on: "2027-02-14" }],
  });
  assert.deepEqual(
    events.map((e) => e.date),
    ["2027-01-01", "2027-02-01", "2027-02-14", "2027-03-01"]
  );
  assert.deepEqual(events.map((e) => e.type), ["promotion", "holiday", "holiday", "campaign"]);
});

test("groupCalendarEventsByMonth buckets events by YYYY-MM in encounter order", () => {
  const events = buildCalendarEvents({
    campaigns: [
      { id: "c1", name: "A", status: "active", starts_on: "2027-05-01", ends_on: "2027-05-01" },
      { id: "c2", name: "B", status: "active", starts_on: "2027-05-20", ends_on: "2027-05-20" },
      { id: "c3", name: "C", status: "active", starts_on: "2027-06-01", ends_on: "2027-06-01" },
    ],
  });
  const grouped = groupCalendarEventsByMonth(events);
  assert.deepEqual(
    grouped.map((g) => g.month),
    ["2027-05", "2027-06"]
  );
  assert.equal(grouped[0].items.length, 2);
  assert.equal(grouped[1].items.length, 1);
});

test("buildContentCalendarEvents: a content item's date is the EARLIEST of its platform variants' scheduled_at", () => {
  const events = buildContentCalendarEvents({
    contentItems: [{ id: "item1", title: "Reel — Wedding Season", status: "idea" }],
    variants: [
      { content_item_id: "item1", platform: "instagram", scheduled_at: "2027-09-10T12:00:00Z" },
      { content_item_id: "item1", platform: "facebook", scheduled_at: "2027-09-08T12:00:00Z" }
    ]
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].date, "2027-09-08");
  assert.equal(events[0].type, "content");
  assert.equal(events[0].label, "Reel — Wedding Season");
  assert.equal(events[0].sublabel, "idea");
});

test("buildContentCalendarEvents: a content item with no variants yet contributes nothing — never guesses a date", () => {
  const events = buildContentCalendarEvents({
    contentItems: [{ id: "item1", title: "Unscheduled idea", status: "idea" }],
    variants: []
  });
  assert.deepEqual(events, []);
});

test("buildContentCalendarEvents: multiple content items sort chronologically alongside each other", () => {
  const events = buildContentCalendarEvents({
    contentItems: [
      { id: "a", title: "Later", status: "approved" },
      { id: "b", title: "Earlier", status: "approved" }
    ],
    variants: [
      { content_item_id: "a", platform: "facebook", scheduled_at: "2027-09-20T12:00:00Z" },
      { content_item_id: "b", platform: "facebook", scheduled_at: "2027-09-05T12:00:00Z" }
    ]
  });
  assert.deepEqual(events.map((e) => e.label), ["Earlier", "Later"]);
});
