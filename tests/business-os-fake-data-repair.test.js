import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { computeWasteRisk, buildLilyBusinessCoach } from "../netlify/functions/_shared/business-ecosystem.js";
import { buildHub } from "../netlify/functions/business-ecosystem.js";

/**
 * Business OS beta-blocker repair. The visible "Rose" advisor page showed
 * hardcoded, unconditional fabricated statistics (a 23% wedding-booking
 * claim, a 15% price-increase recommendation, a 40% competitor-engagement
 * claim, a stockout alert not tied to real inventory) styled and
 * timestamped exactly like real AI analysis, while a real, shop-scoped
 * data pipeline for the same page already existed and worked. Also: Rose's
 * chat silently substituted canned generic advice when the real AI call
 * failed, and business-ecosystem.js's lily_coach action fed the coach
 * hardcoded waste_risk/margin_health inputs regardless of the shop's real
 * state.
 */

const root = process.cwd();

// ---- computeWasteRisk: real freshness-tracking signal, never a guess ----

test("computeWasteRisk returns null (no fabricated interpretation) when no stocked item has freshness tracking set", () => {
  assert.equal(computeWasteRisk([]), null);
  assert.equal(computeWasteRisk([{ quantity: 10, low_stock_level: 2 }]), null, "quantity without use_by is not a real freshness signal");
  assert.equal(computeWasteRisk([{ quantity: 0, use_by: "2020-01-01" }]), null, "an item with 0 in stock isn't real waste risk regardless of its use_by date");
});

test("computeWasteRisk reports High only when a real share of tracked, in-stock items are already at/past their use-by date", () => {
  // Fixed, far-past/far-future dates — deliberately not computed relative
  // to "now" so this test can't go flaky depending on the shop-timezone
  // "today" boundary the function itself now correctly respects (it was
  // exactly that UTC-vs-local-day mismatch this repo's own
  // no-utc-date-for-local-today.test.js guards against).
  const wellInThePast = "2020-01-01";
  const wellInTheFuture = "2099-01-01";

  // 2 of 5 tracked items already past use_by (40%) => High
  const highRisk = [
    { quantity: 5, use_by: wellInThePast },
    { quantity: 3, use_by: wellInThePast },
    { quantity: 4, use_by: wellInTheFuture },
    { quantity: 2, use_by: wellInTheFuture },
    { quantity: 6, use_by: wellInTheFuture }
  ];
  assert.equal(computeWasteRisk(highRisk), "High");

  // 1 of 10 tracked items at risk (10%) => Low, not fabricated as High
  const lowRisk = [{ quantity: 5, use_by: wellInThePast }, ...Array.from({ length: 9 }, () => ({ quantity: 5, use_by: wellInTheFuture }))];
  assert.equal(computeWasteRisk(lowRisk), "Low");
});

// ---- buildLilyBusinessCoach: never fabricates an interpretation from null inputs ----

test("lily business coach never surfaces a waste/margin suggestion from null (unavailable) real data", () => {
  const s = buildLilyBusinessCoach({ low_stock_count: 0, subscription_count: 10, unpaid_total: 0, waste_risk: null, margin_health: null });
  assert.ok(!s.some((x) => x.id === "waste"), "no waste suggestion without a real High signal");
  assert.ok(!s.some((x) => x.id === "margin"), "no margin suggestion without a real margin_health number");
});

test("lily business coach does surface waste/margin suggestions when given real qualifying data", () => {
  const s = buildLilyBusinessCoach({ low_stock_count: 0, subscription_count: 10, unpaid_total: 0, waste_risk: "High", margin_health: 40 });
  assert.ok(s.some((x) => x.id === "waste"));
  assert.ok(s.some((x) => x.id === "margin"));
});

// ---- business-ecosystem.js lily_coach action: real inputs, not hardcoded ----

test("business-ecosystem.js no longer hardcodes waste_risk/margin_health into the coach call", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/business-ecosystem.js"), "utf8");
  const fn = src.slice(src.indexOf('if (action === "lily_coach")'), src.indexOf('if (action === "flower_subscription_create")'));
  assert.doesNotMatch(fn, /waste_risk:\s*"Medium"/);
  assert.doesNotMatch(fn, /margin_health:\s*70\b/);
  assert.match(fn, /computeWasteRisk\(/, "must use the real freshness-based computation");
  assert.match(fn, /computeWasteRisk\(invRows,\s*shopRow\.data\?\.timezone\)/, "must compute 'today' in the shop's own timezone, not the server's UTC day");
  assert.match(fn, /revenue\s*>\s*0\s*\?\s*hub\.finance_center\.profit_and_loss\.margin\s*:\s*null/, "margin_health must be null (not a fabricated 0) when the shop has no real revenue yet");
  assert.match(fn, /use_by/, "must select the real freshness column from inventory");
});

test("lily_coach's margin_health is null for a shop with no real revenue (buildHub integration)", async () => {
  function fakeClient(fixtures) {
    function makeQuery(table) {
      const result = fixtures[table] || { data: [], error: null };
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: () => Promise.resolve(result),
        then: (resolve) => resolve(result)
      };
      return query;
    }
    return { from: (table) => makeQuery(table) };
  }
  const client = fakeClient({
    bloom_customer_subscriptions: { data: [], error: null },
    bloom_loyalty_accounts: { data: [], error: null },
    bloom_membership_plans: { data: [], error: null },
    bloom_vendor_profiles: { data: [], error: null },
    bloom_purchase_orders: { data: [], error: null },
    bloom_delivery_details: { data: [], error: null },
    orders: { data: [], error: null },
    expenses: { data: [], error: null },
    marketplace_wholesale_orders: { data: [], error: null }
  });
  const hub = await buildHub(client, "shop-1");
  assert.equal(hub.finance_center.profit_and_loss.revenue, 0);
  // Mirrors the exact guard used in the lily_coach action.
  const revenue = Number(hub.finance_center?.profit_and_loss?.revenue || 0);
  const margin_health = revenue > 0 ? hub.finance_center.profit_and_loss.margin : null;
  assert.equal(margin_health, null, "a shop with zero real revenue must get null, not a fabricated 0%-margin reading");
});

// ---- No cross-shop data exposure introduced ----

test("lily_coach's new buildHub() call is scoped by the same shop-scoped client/shopId as every other real query in this file", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/business-ecosystem.js"), "utf8");
  const fn = src.slice(src.indexOf('if (action === "lily_coach")'), src.indexOf('if (action === "flower_subscription_create")'));
  assert.match(fn, /buildHub\(client,\s*shopId\)/, "must reuse the request's own RLS-scoped client and resolved shopId, not a service-role client or a caller-supplied id");
});

// ---- Business OS frontend: fabricated content removed, real backend reused ----

const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const pageHtml = html.slice(html.indexOf('id="ecosystemPage"'), html.indexOf('id="communityPage"'));
const js = fs.readFileSync(path.join(root, "public/florisyn-luxury-business-os.js"), "utf8");

test("no fabricated booking/pricing/competitor/stockout statistic remains on the Business OS page", () => {
  assert.doesNotMatch(pageHtml, /23%/);
  assert.doesNotMatch(pageHtml, /15%/);
  assert.doesNotMatch(pageHtml, /40%/);
  assert.doesNotMatch(pageHtml, /stockout/i);
});

test("Business OS reuses the existing real business-ecosystem backend rather than a new/rebuilt one", () => {
  assert.match(js, /"business-ecosystem"/);
  assert.match(js, /"lily_coach"/);
});

test("Rose's chat honestly reports AI unavailability instead of substituting canned advice presented as analysis", () => {
  assert.doesNotMatch(js, /TOPIC_REPLIES/);
  assert.doesNotMatch(js, /function replyFor/);
  assert.match(js, /ROSE_UNAVAILABLE/);
});

test("existing Business OS functionality remains operational: chat, tabs, and per-shop action-item persistence are all still present", () => {
  assert.match(js, /async function askRose/);
  assert.match(js, /function setTab/);
  assert.match(js, /function actionItemsKey/);
  assert.match(js, /localStorage\.setItem\(actionItemsKey\(\)/);
  assert.match(js, /function wireActions/);
  assert.match(js, /function boot/);
  assert.match(pageHtml, /id="bosChatForm"/);
  assert.match(pageHtml, /data-bos-tab="insights"/);
  assert.match(pageHtml, /data-bos-tab="actions"/);
});

test("insight cards act on the real fetched suggestion, not a static apply/create-post claim of an executed action", () => {
  assert.doesNotMatch(js, /data-bos-action="apply"/, "no button may claim to have applied a business change Rose never actually executed");
  assert.doesNotMatch(js, /Rose applied:/i);
  assert.match(js, /data-bos-action="ask"/);
  assert.match(js, /data-bos-suggestion-id/);
  assert.match(js, /findSuggestion/);
});
