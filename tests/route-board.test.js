import test from "node:test";
import assert from "node:assert/strict";
import { optimizeRouteStops, routeBoardSummary } from "../lib/delivery/route-board.js";

// lib/delivery/route-board.js had only 73% coverage and drives the actual
// order drivers see on the delivery route board — a bad sort here sends a
// driver across town twice instead of once.

test("optimizeRouteStops: orders pending stops by date, then window, then driver, then address", () => {
  const stops = [
    { id: "b", delivery_date: "2026-05-10", delivery_window: "PM", driver: "Sam" },
    { id: "a", delivery_date: "2026-05-10", delivery_window: "AM", driver: "Sam" },
    { id: "c", delivery_date: "2026-05-09", delivery_window: "PM", driver: "Sam" },
  ];
  const ordered = optimizeRouteStops(stops);
  assert.deepEqual(ordered.map((s) => s.id), ["c", "a", "b"]);
});

test("optimizeRouteStops: assigns a sequential 1-based route_order to every pending stop", () => {
  const stops = [
    { id: "x", delivery_date: "2026-05-10" },
    { id: "y", delivery_date: "2026-05-11" },
  ];
  const ordered = optimizeRouteStops(stops);
  assert.deepEqual(ordered.map((s) => s.route_order), [1, 2]);
});

test("optimizeRouteStops: DELIVERED stops are pushed to the end, after every pending stop, in original relative order", () => {
  const stops = [
    { id: "done-1", status: "DELIVERED", delivery_date: "2026-05-01" },
    { id: "pending", status: "PENDING", delivery_date: "2026-05-10" },
    { id: "done-2", status: "DELIVERED", delivery_date: "2026-05-02" },
  ];
  const ordered = optimizeRouteStops(stops);
  assert.deepEqual(ordered.map((s) => s.id), ["pending", "done-1", "done-2"]);
  assert.deepEqual(ordered.map((s) => s.route_order), [1, 2, 3]);
});

test("optimizeRouteStops: an empty list returns an empty list, not a crash", () => {
  assert.deepEqual(optimizeRouteStops([]), []);
  assert.deepEqual(optimizeRouteStops(), []);
});

test("optimizeRouteStops: does not mutate the original stop objects — returns new objects with route_order added", () => {
  const original = { id: "a", delivery_date: "2026-05-10" };
  const [ordered] = optimizeRouteStops([original]);
  assert.equal(original.route_order, undefined, "the source object must be left untouched");
  assert.equal(ordered.route_order, 1);
});

test("routeBoardSummary: totals real round-trip miles across all stops, rounded to one decimal", () => {
  const summary = routeBoardSummary([
    { round_trip_miles: 3.24 },
    { round_trip_miles: 5.111 },
  ]);
  assert.equal(summary.miles, 8.4);
  assert.equal(summary.stop_count, 2);
});

test("routeBoardSummary: lists each real driver exactly once, ignoring blanks", () => {
  const summary = routeBoardSummary([
    { driver: "Sam" },
    { driver: "Sam" },
    { driver: "Jordan" },
    { driver: "" },
    { driver: null },
  ]);
  assert.deepEqual(summary.drivers, ["Sam", "Jordan"]);
});

test("routeBoardSummary: an empty board summarizes to real zeros, not undefined/NaN", () => {
  const summary = routeBoardSummary([]);
  assert.deepEqual(summary, { stop_count: 0, miles: 0, drivers: [] });
});

test("routeBoardSummary: a stop with no round_trip_miles set contributes zero, not NaN, to the total", () => {
  const summary = routeBoardSummary([{ round_trip_miles: 5 }, {}]);
  assert.equal(summary.miles, 5);
});
