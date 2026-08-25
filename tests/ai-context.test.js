import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * Lily Step 72: ai-context.js narrows real business context (products,
 * customers, recipes, staff) into what Lily sees on every chat turn —
 * previously just shop/inventory/orders/deliveries, so Lily couldn't
 * answer "what's my Rose Garden bouquet made of" or "who's on staff
 * today" with real data.
 *
 * These are source-level checks (not a live-Supabase behavior test —
 * ai-context.js is thin glue with no pure function to unit test
 * independently, same as settings.js). What they guard against is the
 * regression class this repo has actually hit: a handler selecting a
 * column that either doesn't exist (the text_color/settings.js bug) or
 * that leaks more than the caller needs (PII in an AI prompt payload).
 */

const src = fs.readFileSync(new URL("../netlify/functions/ai-context.js", import.meta.url), "utf8");

test("ai-context now includes products, customers, recipes, and staff sections", () => {
  assert.match(src, /products:\s*products\s*\|\|\s*\[\]/);
  assert.match(src, /customers:\s*customers\s*\|\|\s*\[\]/);
  assert.match(src, /recipes[,\s]/);
  assert.match(src, /staff:\s*staff\s*\|\|\s*\[\]/);
});

test("customer context never selects PII — name/vip/is_business only, same discipline as audience-segments.js", () => {
  const match = src.match(/client\.from\("customers"\)\.select\("([^"]+)"\)/);
  assert.ok(match, "customers query must exist");
  const fields = match[1].split(",");
  for (const forbidden of ["phone", "email", "address", "notes", "contact_preferences", "favorite_flowers", "favorite_colors"]) {
    assert.ok(!fields.includes(forbidden), `customers context leaked ${forbidden}`);
  }
  assert.ok(fields.includes("name"));
});

test("staff context never selects pay/tax/contact/PIN — public front-page fields only", () => {
  const match = src.match(/client\.from\("staff"\)\.select\("([^"]+)"\)/);
  assert.ok(match, "staff query must exist");
  const fields = match[1].split(",");
  for (const forbidden of ["email", "phone", "hourly_rate", "pin_hash", "federal_tax_rate", "state_tax_rate", "local_tax_rate", "other_deduction_rate", "fixed_deduction", "hire_date"]) {
    assert.ok(!fields.includes(forbidden), `staff context leaked private field ${forbidden}`);
  }
  assert.ok(fields.includes("name"));
});

test("product context skips long-form copy fields (description/gallery/SEO) it doesn't need", () => {
  const match = src.match(/client\.from\("products"\)\.select\("([^"]+)"\)/);
  assert.ok(match, "products query must exist");
  const fields = match[1].split(",");
  for (const heavy of ["description", "gallery", "seo_title", "seo_description"]) {
    assert.ok(!fields.includes(heavy), `products context pulled unnecessary field ${heavy}`);
  }
  assert.ok(fields.includes("name") && fields.includes("price"));
});

test("recipes join product_recipes to the real product name, not just a bare product_id", () => {
  assert.match(src, /client\.from\("product_recipes"\)\.select\("[^"]*products\(name\)[^"]*"\)/);
  assert.match(src, /product_name:\s*r\.products\?\.name/);
});

test("every new query is shop-scoped, same as the existing shop/inventory/orders/deliveries queries", () => {
  const newTables = ["products", "customers", "product_recipes", "staff"];
  const starts = [...src.matchAll(/client\.from\("([a-z_]+)"\)/g)].map((m) => ({ table: m[1], index: m.index }));
  for (const table of newTables) {
    const found = starts.find((s) => s.table === table);
    assert.ok(found, `no query found for ${table}`);
    const next = starts.find((s) => s.index > found.index);
    const clause = src.slice(found.index, next ? next.index : found.index + 300);
    assert.match(clause, /\.eq\("shop_id",shopId\)/, `${table} query must be shop-scoped`);
  }
});

test("frontend fallback (when the network call itself fails) stays in sync with the real context shape", () => {
  const appJs = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const start = appJs.indexOf("async function loadAiContext(");
  const line = appJs.slice(start, appJs.indexOf("\n", start));
  assert.match(line, /products/);
  assert.match(line, /customers/);
  assert.match(line, /staff/);
});

test("ai-context now includes ai_profile (ai_shop_profiles) — the shop's onboarding voice/notes, previously written and never read anywhere", () => {
  assert.match(src, /client\.from\("ai_shop_profiles"\)/);
  const match = src.match(/client\.from\("ai_shop_profiles"\)\.select\("([^"]+)"\)/);
  assert.ok(match, "ai_shop_profiles query must exist");
  const fields = match[1].split(",");
  for (const expected of ["lily_enabled", "rose_enabled", "shop_tone", "delivery_notes", "marketing_notes"]) {
    assert.ok(fields.includes(expected), `ai_shop_profiles context is missing ${expected}`);
  }
  // memory/pricing_notes/lily_voice/rose_voice were never captured by the
  // onboarding form (see public/onboarding.html) — no reason to fetch them yet.
  for (const notYetUsed of ["memory", "pricing_notes", "lily_voice", "rose_voice"]) {
    assert.ok(!fields.includes(notYetUsed));
  }
  assert.match(src, /ai_profile:\s*aiProfile\s*\|\|\s*null/);
});

// Phase 17 ("test as a florist" — the real end-to-end shape a single chat
// turn actually returns): workload (Phase 6), audience_segments (Phase 7),
// and financials (Phase 8) all reach the SAME context object a real chat
// turn receives, and both date-sensitive ones ("today" for overdue orders,
// "today" for today's sales) resolve from the exact same shop.timezone —
// never two silently different ideas of "today" for the same shop in the
// same response.

test("workload, audience_segments, and financials all reach the same context object a real chat turn receives", () => {
  assert.match(src, /workload,/);
  assert.match(src, /audience_segments:\s*audienceSummary,/);
  assert.match(src, /financials:\s*financialSnapshot/);
});

test("workload and financials both resolve 'today' from the SAME real shop.timezone — never two different clocks for one shop", () => {
  assert.match(src, /buildOrderWorkloadSummary\(openOrders\|\|\[\],\{todayStr:shopDateStr\(shop\?\.timezone\)\}\)/);
  assert.match(src, /timezone:shop\?\.timezone/, "buildFinancialSnapshot must be handed the same shop.timezone, not a second/independent value");
});

test("the financial snapshot only computes 'today' after shop.timezone is actually known (post-Promise.all), never a stale/default value baked in at query time", () => {
  const promiseAllStart = src.indexOf("await Promise.all([");
  const promiseAllEnd = src.indexOf("]);", promiseAllStart);
  const promiseAllBlock = src.slice(promiseAllStart, promiseAllEnd);
  // loadFinancialRows (the query half) runs inside Promise.all — the
  // timezone-aware bucketing (buildFinancialSnapshot) must NOT.
  assert.match(promiseAllBlock, /loadFinancialRows\(client,shopId\)/);
  assert.doesNotMatch(promiseAllBlock, /buildFinancialSnapshot/);
  const afterPromiseAll = src.slice(promiseAllEnd);
  assert.match(afterPromiseAll, /buildFinancialSnapshot\(/);
});
