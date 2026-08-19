import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("marketplace_wholesale_orders lifecycle migration adds the columns checkout.js and the webhook already write to", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260819180000_marketplace_wholesale_orders_lifecycle.sql"),
    "utf8"
  );
  for (const column of [
    "listing_id uuid references public.marketplace_listings\\(id\\)",
    "metadata jsonb not null default '\\{\\}'::jsonb",
    "paid_at timestamptz",
    "fulfilled_at timestamptz",
    "received_at timestamptz",
    "inventory_synced_at timestamptz",
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`, "i"), `missing column: ${column}`);
  }
});

test("marketplace-checkout.js inserts a status the table's check constraint actually allows, and sets buyer_user_id for the buyer-read RLS policy", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-checkout.js"), "utf8");
  // The table's check constraint is ('pending','processing','paid','fulfilled','completed','cancelled') —
  // "pending_payment" was never a valid value and silently failed every insert.
  assert.doesNotMatch(src, /status:\s*"pending_payment"/);
  assert.match(src, /status:\s*"pending"/);
  assert.match(src, /buyer_user_id:\s*user\.id/);
  // unit now round-trips onto the order line item so a receipted order can
  // be added back into inventory with the right unit, not a guessed default.
  assert.match(src, /unit:\s*listing\.unit\s*\|\|\s*"each"/);
});

test("marketplace-catalog.js exposes buyer order history and a guarded, ownership-checked receive-into-inventory action", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  assert.match(src, /resource === "my-orders"/);
  assert.match(src, /action === "receive_order"/);
  assert.match(src, /matchRecipeToInventory/);
  // Ownership: an order only becomes visible/receivable to the user who
  // actually placed it.
  assert.match(src, /order\.buyer_user_id !== user\.id/);
  // Guarded against receiving an unpaid order and against double-syncing
  // the same order into inventory twice.
  assert.match(src, /RECEIVABLE_ORDER_STATUSES\.includes\(order\.status\)/);
  assert.match(src, /order\.inventory_synced_at/);
  assert.match(src, /inventory_synced_at:\s*now/);
});

test("RECEIVABLE_ORDER_STATUSES only includes states that mean the seller was actually paid", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketplace-catalog.js"), "utf8");
  const match = src.match(/const RECEIVABLE_ORDER_STATUSES = (\[[^\]]*\]);/);
  assert.ok(match, "RECEIVABLE_ORDER_STATUSES constant not found");
  const statuses = JSON.parse(match[1].replace(/'/g, '"'));
  assert.deepEqual(statuses, ["paid", "fulfilled", "completed"]);
  assert.ok(!statuses.includes("pending"), "an unpaid order must never be receivable into inventory");
});

test("buyer marketplace UI has a My Orders tab wired to real data and a receive-into-inventory control", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /id="marketplaceTabOrders"/);
  assert.match(html, /id="marketplaceOrdersPanel"/);
  assert.match(html, /id="marketplaceOrdersList"/);

  const js = fs.readFileSync(path.join(root, "public/marketplace-experience.js"), "utf8");
  assert.match(js, /resource=my-orders/);
  assert.match(js, /action:\s*'receive_order'/);
  assert.match(js, /data-market-receive-order/);
  // Only orders the backend marked receivable get the action rendered —
  // the UI doesn't invent a button for an order that can't actually be received.
  assert.match(js, /order\.can_receive/);
});
