import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260804185015_p0_10_atomic_order_create.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

test("P0-10 creates one transactional authenticated order RPC", () => {
  assert.match(sql, /create or replace function public\.create_order_atomic\(\s*p_shop_id uuid,\s*p_order jsonb\s*\)/i);
  assert.match(sql, /language plpgsql\s+security definer\s+set search_path = pg_catalog, public/i);
  assert.match(sql, /where sm\.shop_id = p_shop_id[\s\S]*?sm\.user_id = v_actor[\s\S]*?sm\.status = 'active'/i);
  assert.match(sql, /grant execute on function public\.create_order_atomic\(uuid, jsonb\)\s+to authenticated, service_role;/i);
  assert.match(sql, /revoke insert on table public\.orders from authenticated;/i);
});

test("P0-10 reconciles every legacy-only column before the RPC uses it", () => {
  assert.match(sql, /alter table public\.orders[\s\S]*?add column if not exists metadata jsonb/i);
  for (const field of [
    "user_id", "tax_rate", "balance_due", "delivery_miles", "drive_minutes",
    "location_type", "estimated_cost", "metadata"
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${field}\\b`, "i"));
  }
  for (const field of ["address", "round_trip_miles", "drive_minutes", "delivery_date", "delivery_window"]) {
    assert.match(sql, new RegExp(`add column if not exists ${field}\\b`, "i"));
  }
});

test("P0-10 rejects every payment-ledger input and derives unpaid state", () => {
  for (const field of ["amount_paid", "balance_due", "payment_status", "payment_method", "paid_at"]) {
    assert.match(sql, new RegExp(field, "i"));
  }
  assert.match(sql, /p_order \?\| array\[[^\]]*'amount_paid'[^\]]*'paid_at'/i);
  assert.match(sql, /'NEW', v_subtotal, v_tax, v_delivery_fee, v_total[\s\S]*?0, v_total, 'UNPAID', null/i);
});

test("P0-10 includes required order side effects in the database transaction", () => {
  assert.match(sql, /insert into public\.orders/i);
  assert.match(sql, /insert into public\.order_status_history/i);
  assert.match(sql, /insert into public\.audit_events/i);
  assert.match(sql, /insert into public\.deliveries/i);
});

test("P0-10 inventory deductions lock rows and cannot go below zero", () => {
  const locks = sql.match(/for update;/gi) || [];
  assert.ok(locks.length >= 2, "inventory lookup paths must lock the selected row");
  assert.match(sql, /if v_available \+ 0\.0001 < v_needed then[\s\S]*?continue;/i);
  assert.match(sql, /set quantity = quantity - v_needed/i);
  assert.doesNotMatch(sql, /set quantity = greatest\(0/i);
});

test("P0-10 protects financial fields on direct table writes", () => {
  assert.match(sql, /create trigger bloom_orders_financial_integrity\s+before insert or update on public\.orders/i);
  assert.match(sql, /new\.amount_paid := 0;/i);
  assert.match(sql, /new\.amount_paid := old\.amount_paid;/i);
  assert.match(sql, /Order total cannot be less than payments already recorded/i);
  assert.match(sql, /revoke all privileges on function public\.bloom_enforce_order_financial_integrity\(\)[\s\S]*?from public, anon, authenticated, service_role;/i);
});

test("recurring billing uses the atomic order RPC before direct inserts are revoked", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "netlify/functions/_shared/recurring-billing-execute.js"),
    "utf8",
  );
  assert.match(source, /client\.rpc\("create_order_atomic"/);
  assert.doesNotMatch(source, /from\("orders"\)\.insert\(/);
});
