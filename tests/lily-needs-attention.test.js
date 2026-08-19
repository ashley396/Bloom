import test from "node:test";
import assert from "node:assert/strict";
import { buildNeedsAttentionItems, needsAttentionSummaryText } from "../lib/assistants/needs-attention.js";

test("a healthy shop with no real signals gets an empty list, not a fabricated suggestion", () => {
  const items = buildNeedsAttentionItems({ ordersDueToday: 0, deliveries: 0, lowStock: 0, unpaidTotal: 0 });
  assert.deepEqual(items, []);
  assert.equal(needsAttentionSummaryText(items), "You're all caught up — nothing needs attention right now.");
});

test("handles completely empty/missing input the same as all-zero", () => {
  assert.deepEqual(buildNeedsAttentionItems({}), []);
  assert.deepEqual(buildNeedsAttentionItems(), []);
});

test("each real signal becomes its own item with a real deep-link target", () => {
  const items = buildNeedsAttentionItems({ ordersDueToday: 3, deliveries: 1, lowStock: 5, unpaidTotal: 240.5 });
  assert.equal(items.length, 4);
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId["orders-due"].label, "3 orders due today");
  assert.equal(byId["orders-due"].page, "ordersPage");
  assert.equal(byId["active-deliveries"].label, "1 active delivery");
  assert.equal(byId["active-deliveries"].page, "deliveriesPage");
  assert.equal(byId["low-stock"].label, "5 low-stock items");
  assert.equal(byId["low-stock"].page, "inventoryPage");
  assert.equal(byId["unpaid-balance"].label, "$240.50 outstanding");
  assert.equal(byId["unpaid-balance"].page, "invoicesPage");
});

test("singular/plural wording is correct at exactly 1", () => {
  const items = buildNeedsAttentionItems({ ordersDueToday: 1, lowStock: 1 });
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId["orders-due"].label, "1 order due today");
  assert.equal(byId["low-stock"].label, "1 low-stock item");
});

test("a tiny outstanding balance still counts — no silent rounding to zero", () => {
  const items = buildNeedsAttentionItems({ unpaidTotal: 0.5 });
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "$0.50 outstanding");
});

test("summary text names every item when there's more than one, and uses a period for exactly one", () => {
  assert.equal(needsAttentionSummaryText([{ label: "2 orders due today" }]), "2 orders due today.");
  assert.equal(
    needsAttentionSummaryText([{ label: "2 orders due today" }, { label: "1 low-stock item" }]),
    "2 things need a look: 2 orders due today, 1 low-stock item."
  );
});

test("negative or non-numeric input never produces a negative/NaN item — treated as no signal", () => {
  assert.deepEqual(buildNeedsAttentionItems({ ordersDueToday: -2, lowStock: "not-a-number", unpaidTotal: NaN }), []);
});
