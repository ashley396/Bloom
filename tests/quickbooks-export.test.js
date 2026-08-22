import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

/**
 * Switching Barrier Register, Wave 8: the "bookkeeper veto" barrier.
 * Minimum viable path per the audit — a real Date/Description/Amount CSV
 * shaped for QuickBooks Online's own generic bank/register CSV import,
 * achievable with no Intuit developer app or OAuth credentials. A full
 * QuickBooks Online API sync is explicitly deferred (this environment has
 * no real Intuit credentials to build and verify OAuth against) rather
 * than faked.
 *
 * quickBooksCsvDate/buildQuickBooksCsvRows are plain top-level function
 * declarations with no DOM/closure dependency, so they're extracted and
 * evaluated directly here for real behavioral coverage, not just
 * source-text shape matching.
 */
function loadPureFunctions() {
  const start = appJs.indexOf("function quickBooksCsvDate(");
  const afterStart = appJs.indexOf("function buildQuickBooksCsvRows(", start);
  const end = appJs.indexOf("\nasync function exportQuickBooksCsv(", afterStart);
  assert.ok(start > -1 && afterStart > start && end > afterStart, "could not locate the QuickBooks export helpers in app.js");
  const src = appJs.slice(start, end);
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  new Function("sandbox", `${src}\nsandbox.quickBooksCsvDate = quickBooksCsvDate;\nsandbox.buildQuickBooksCsvRows = buildQuickBooksCsvRows;`)(sandbox);
  return sandbox;
}

test("quickBooksCsvDate converts ISO dates to QuickBooks Online's expected MM/DD/YYYY", () => {
  const { quickBooksCsvDate } = loadPureFunctions();
  assert.equal(quickBooksCsvDate("2026-08-21"), "08/21/2026");
  assert.equal(quickBooksCsvDate("2026-01-05"), "01/05/2026");
  // A malformed/missing date must not throw or silently produce "NaN/NaN" — pass it through as-is.
  assert.equal(quickBooksCsvDate(""), "");
  assert.equal(quickBooksCsvDate(null), "");
  assert.equal(quickBooksCsvDate("not-a-date"), "not-a-date");
});

test("buildQuickBooksCsvRows sums real paid-order revenue per day and lists every real expense — never fabricates a transaction", () => {
  const { buildQuickBooksCsvRows } = loadPureFunctions();
  const orders = [
    { created_at: "2026-08-20T14:00:00Z", amount_paid: 65 },
    { created_at: "2026-08-20T09:00:00Z", amount_paid: 40 },
    { created_at: "2026-08-21T10:00:00Z", amount_paid: 120.5 },
    { created_at: "2026-08-21T10:00:00Z", amount_paid: 0 }, // unpaid order — must not appear
    { created_at: "2026-08-22T10:00:00Z" }, // amount_paid missing entirely
  ];
  const expenses = [
    { expense_date: "2026-08-21", category: "Flowers", vendor: "Mayesh", amount: 210 },
    { expense_date: "2026-08-19", category: "Supplies", amount: 18.25 }, // no vendor
    { expense_date: "2026-08-20", amount: 0 }, // zero-amount — must not appear
  ];

  const rows = buildQuickBooksCsvRows(orders, expenses);
  assert.deepEqual(rows[0], ["Date", "Description", "Amount"]);

  // Two real sale-days, summed and sorted, each as a single positive row.
  assert.deepEqual(rows[1], ["08/20/2026", "Florisyn sales — 2026-08-20", "105.00"]);
  assert.deepEqual(rows[2], ["08/21/2026", "Florisyn sales — 2026-08-21", "120.50"]);

  // Expenses follow, sorted by date, as their own real negative-amount rows.
  assert.deepEqual(rows[3], ["08/19/2026", "Supplies", "-18.25"]);
  assert.deepEqual(rows[4], ["08/21/2026", "Flowers — Mayesh", "-210.00"]);

  assert.equal(rows.length, 5, "unpaid orders and zero-amount expenses must not produce fabricated rows");
});

test("buildQuickBooksCsvRows on a shop with no real paid sales or expenses returns only the header — an honest empty export, not fake rows", () => {
  const { buildQuickBooksCsvRows } = loadPureFunctions();
  assert.deepEqual(buildQuickBooksCsvRows([], []), [["Date", "Description", "Amount"]]);
  assert.deepEqual(buildQuickBooksCsvRows(undefined, undefined), [["Date", "Description", "Amount"]]);
});

test("Reports page has a real 'Export for QuickBooks' entry point, wired to the real orders/expenses API", () => {
  const start = html.indexOf('id="reportsPage"');
  const end = html.indexOf("<section id=", start + 10);
  const pageHtml = html.slice(start, end);
  assert.match(pageHtml, /id="exportQuickBooksCsv"/);
  assert.match(pageHtml, />Export for QuickBooks</);

  assert.match(appJs, /\$\("#exportQuickBooksCsv"\)\?\.addEventListener\("click",exportQuickBooksCsv\)/);
  assert.match(appJs, /async function exportQuickBooksCsv\(\)\{/);
  const fnStart = appJs.indexOf("async function exportQuickBooksCsv(");
  const fnEnd = appJs.indexOf("\nfunction ", fnStart + 20) === -1 ? appJs.length : appJs.indexOf("\n}", fnStart);
  const fnBody = appJs.slice(fnStart, fnEnd + 2);
  assert.match(fnBody, /api\("orders"\)/, "must pull real orders, not a cached/possibly-empty array");
  assert.match(fnBody, /api\("expenses"\)/, "must pull real expenses, not a cached/possibly-empty array");
  assert.match(fnBody, /buildQuickBooksCsvRows\(/);
  assert.match(fnBody, /No paid sales or expenses yet to export/, "must say so honestly instead of downloading an empty file");
});
