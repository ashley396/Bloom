import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/company/compare/index.html"), "utf8");

/**
 * The original /company/compare/ page named two real competitors
 * (Floranext, Hana Florist POS) plus "legacy wire networks", but made
 * Florisyn win every single row with zero citations, dates, or
 * acknowledged competitor strengths — a direct violation of the SEO/GEO
 * brief's Section 9 rules ("never claim Florisyn wins every category",
 * "cite sources", "date comparisons", "acknowledge competitor strengths",
 * "never invent limitations"). This locks in the rewrite.
 */

test("the comparison table cites real, dated sources", () => {
  assert.match(html, /Checked August 2026/);
  assert.match(html, /floranext\.com\/pricing/);
  assert.match(html, /hanafloristpos\.com/);
});

test("at least one row is marked as a genuine competitor strength, not a Florisyn win", () => {
  const strengthCells = html.match(/class="strength">/g) || [];
  assert.ok(strengthCells.length >= 2, "expected multiple cells marked as a real competitor strength");
});

test("the page explicitly discloses where Florisyn does not win, not just where it does", () => {
  assert.match(html, /<h2>Where Florisyn doesn't win<\/h2>/);
  assert.match(html, /newer, smaller order network/);
});

test("unverifiable competitor claims are labeled as such, not stated as fact", () => {
  const unclearCells = html.match(/class="unclear">Not publicly confirmed/g) || [];
  assert.ok(unclearCells.length >= 2, "expected multiple claims explicitly marked as unconfirmed rather than guessed");
});

test("the page states its own methodology and limitations", () => {
  assert.match(html, /How this page was built/);
  assert.match(html, /Pricing and features change — verify current details directly with each vendor/);
});

test("wire-service fee claims are sourced ranges, not an invented flat number", () => {
  assert.match(html, /\$200–\$1,000\+\/mo membership plus a 20–27% commission/);
  assert.match(html, /industry-reported ranges, not each network's official published rate card/);
});
