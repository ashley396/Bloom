import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { retentionMetrics } from "../netlify/functions/dashboard.js";

/**
 * Functional-completion pass #2: the dashboard's "Customer Happiness" KPI
 * was a fabricated percentage synthesized purely from raw customer *count*
 * (92 + up to 7.5, capped near 99.7%) — it had nothing to do with whether
 * customers actually returned. Its delta was an unconditional, hardcoded
 * "+0.8% vs last month" always styled green. The Orders/Deliveries deltas
 * were compared against synthetic baselines derived from today's own
 * numbers, not any real history. These tests lock in the real replacements:
 * a genuine repeat-customer rate (backend) and real up/down toggling based
 * on the actual sign of a real comparison (frontend).
 */

const root = process.cwd();

test("retentionMetrics: no orders at all reports null rate, not a fake number", () => {
  const m = retentionMetrics([]);
  assert.equal(m.customersWithOrders, 0);
  assert.equal(m.repeatCustomers, 0);
  assert.equal(m.retentionRate, null);
});

test("retentionMetrics: every customer ordering exactly once is 0% repeat, not inflated", () => {
  const orders = [
    { customer_id: "c1" },
    { customer_id: "c2" },
    { customer_id: "c3" },
  ];
  const m = retentionMetrics(orders);
  assert.equal(m.customersWithOrders, 3);
  assert.equal(m.repeatCustomers, 0);
  assert.equal(m.retentionRate, 0);
});

test("retentionMetrics: counts real repeat customers and computes an honest percentage", () => {
  const orders = [
    { customer_id: "c1" }, { customer_id: "c1" }, // repeat
    { customer_id: "c2" }, { customer_id: "c2" }, { customer_id: "c2" }, // repeat
    { customer_id: "c3" }, // one-time
    { customer_id: "c4" }, // one-time
  ];
  const m = retentionMetrics(orders);
  assert.equal(m.customersWithOrders, 4);
  assert.equal(m.repeatCustomers, 2);
  assert.equal(m.retentionRate, 50); // 2 of 4 = 50.0%
});

test("retentionMetrics: orders without a customer_id (walk-in/guest) never count toward the rate", () => {
  const orders = [{ customer_id: null }, {}, { customer_id: "c1" }];
  const m = retentionMetrics(orders);
  assert.equal(m.customersWithOrders, 1);
  assert.equal(m.retentionRate, 0);
});

// --- Frontend: extract the real pure functions out of the IIFE by source
// text and execute them for real, same convention used elsewhere in this
// suite for non-module frontend files (no bundler available).
function loadDashboardFns() {
  const src = fs.readFileSync(path.join(root, "public/florisyn-atelier-dashboard.js"), "utf8");
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start > -1, `could not find function ${name}`);
    // Balance braces to find the real end of the function body.
    let i = src.indexOf("{", start);
    let depth = 0, end = -1;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    return src.slice(start, end);
  };
  const body = `${grab("retentionLabel")}\n${grab("deltaLabel")}\n${grab("applyDelta")}\nreturn {retentionLabel, deltaLabel, applyDelta};`;
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

test("retentionLabel: null/undefined renders '—', a real rate renders as a percentage", () => {
  const { retentionLabel } = loadDashboardFns();
  assert.equal(retentionLabel(null), "—");
  assert.equal(retentionLabel(undefined), "—");
  assert.equal(retentionLabel(50), "50.0%");
  assert.equal(retentionLabel(33.3), "33.3%");
  assert.equal(retentionLabel(0), "0.0%");
});

test("applyDelta: a real declining metric gets the 'down' class, never the hardcoded 'up'", () => {
  const { applyDelta } = loadDashboardFns();
  const el = { textContent: "", _classes: new Set(["up"]) };
  el.classList = { remove: (...names) => names.forEach((n) => el._classes.delete(n)), add: (n) => el._classes.add(n) };
  applyDelta(el, 5, 10, true); // current (5) < baseline (10): real decline
  assert.ok(el._classes.has("down"), "declining real data must get the down class");
  assert.ok(!el._classes.has("up"), "must not keep the stale hardcoded up class");
  assert.match(el.textContent, /^-/);
});

test("applyDelta: a real increase gets the 'up' class with a real percentage", () => {
  const { applyDelta } = loadDashboardFns();
  const el = { textContent: "", _classes: new Set() };
  el.classList = { remove: (...names) => names.forEach((n) => el._classes.delete(n)), add: (n) => el._classes.add(n) };
  applyDelta(el, 20, 10, true, "vs yesterday");
  assert.ok(el._classes.has("up"));
  assert.match(el.textContent, /\+100\.0% vs yesterday/);
});

test("applyDelta: equal current and baseline gets neither up nor down", () => {
  const { applyDelta } = loadDashboardFns();
  const el = { textContent: "", _classes: new Set() };
  el.classList = { remove: (...names) => names.forEach((n) => el._classes.delete(n)), add: (n) => el._classes.add(n) };
  applyDelta(el, 4, 4, true);
  assert.ok(!el._classes.has("up"));
  assert.ok(!el._classes.has("down"));
});
