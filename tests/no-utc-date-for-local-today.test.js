import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Guardrail for a real, repeated bug class found during the money/date
 * audit: `new Date().toISOString().slice(0, 10)` reads as *UTC* "today",
 * not local "today". In any negative-UTC-offset timezone (every US
 * timezone — this app's whole market), that's tomorrow's date for the
 * last several hours of every local day. Found live in the frontend
 * (defaulting a new order's delivery date, a POS checkout's delivery
 * date, an expense's date, a guided-order date field, a "shown today"
 * dedup key) and again independently in the backend (dashboard.js's
 * Today's Sales/Orders Due Today/weekly chart, inventory.js's arrival
 * date default, expenses.js's expense date default) — all silently one
 * day wrong in the evening. Fixed with local Date getters in public/*.js
 * and with shop-time.js's shop-timezone-aware helpers in
 * netlify/functions (the server has no "local" timezone of its own —
 * shops.timezone, captured at onboarding, is what makes "today" mean
 * the florist's day instead of the server's UTC day).
 *
 * This scans the actual source (stripping comments first, so this doc
 * comment and the fix comments left at each call site don't trip it) for
 * the exact anti-pattern reappearing anywhere.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const PATTERN = /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/;

function scan(dir) {
  const offenders = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;
    const full = path.join(dir, file);
    const code = stripComments(fs.readFileSync(full, "utf8"));
    if (PATTERN.test(code)) offenders.push(file);
  }
  return offenders;
}

test("no public/ frontend code uses new Date().toISOString().slice(0, 10) for a 'today' value", () => {
  const offenders = scan(path.join(process.cwd(), "public"));
  assert.deepEqual(offenders, [], `use local Date getters (getFullYear/getMonth/getDate) instead of toISOString() for a 'today' value in: ${offenders.join(", ")}`);
});

// The backend has no per-shop allowlist exemption the way a couple of
// files below do — a Netlify Function can always look up shops.timezone
// and use shop-time.js. Files here are legitimately platform-wide (a
// single cross-shop daily counter/report with no one shop's timezone to
// prefer) or are exported but never called from anywhere in the app
// (verified via grep — dead code, not a live day-boundary bug). Adding a
// new file here requires the same justification, not just silencing the
// test.
//
// Correction: delivery-recurring.js and recurring-billing-execute.js were
// listed here as "no live caller" too, on a grep that only checked direct
// imports from netlify/functions/*.js. They're both reachable —
// payment-hub.js's "recurring_billing_process" action calls
// executeRecurringSubscriptionRun(), which calls both — real, Stripe-
// charging code. Fixed for real and removed from this list; a plain grep
// isn't sufficient proof of "dead code" for anything exported from a
// _shared/ module, only for files with zero importers anywhere.
const BACKEND_ALLOWED = {
  "admin-command-center.js": "platform-wide admin aggregates (AI usage quota, payment-ops report) — no single shop's timezone applies",
  "payment-operations-admin.js": "Bloom SaaS platform-wide subscription metrics across all shops — same reasoning",
  "bloom-guided-order.js": "buildOrderBodyFromGuided() is exported but has no live caller anywhere in netlify/functions or public/",
  "bloom-storefront-core.js": "webOrderPayloadFromCart() is exported but has no live caller — storefront-public.js builds its order row independently"
};

test("no netlify/functions backend code uses new Date().toISOString().slice(0, 10) for a 'today' value, outside the documented allowlist", () => {
  const dirs = [
    path.join(process.cwd(), "netlify/functions"),
    path.join(process.cwd(), "netlify/functions/_shared")
  ];
  const offenders = dirs.flatMap(scan).filter((file) => !BACKEND_ALLOWED[file]);
  assert.deepEqual(offenders, [], `use shopDateStr()/shopDateStrDaysAgo() from _shared/shop-time.js instead of toISOString() for a shop's 'today' in: ${offenders.join(", ")}`);
});
