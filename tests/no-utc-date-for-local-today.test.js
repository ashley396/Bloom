import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Guardrail for a real, repeated bug class found during the money/date
 * audit: `new Date().toISOString().slice(0, 10)` reads as *UTC* "today",
 * not local "today". In any negative-UTC-offset timezone (every US
 * timezone — this app's whole market), that's tomorrow's date for the
 * last several hours of every local day. Found live in five places —
 * defaulting a new order's delivery date, a POS checkout's delivery date,
 * an expense's date, a guided-order date field, and a "shown today"
 * dedup key — all silently one day wrong in the evening. Fixed by using
 * local Date getters instead everywhere it appeared.
 *
 * This scans the actual public/ source (stripping comments first, so this
 * doc comment and the fix comments left at each call site don't trip it)
 * for the exact anti-pattern reappearing anywhere.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

test("no live code uses new Date().toISOString().slice(0, 10) for a 'today' value", () => {
  const dir = path.join(process.cwd(), "public");
  const offenders = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;
    const full = path.join(dir, file);
    const code = stripComments(fs.readFileSync(full, "utf8"));
    if (/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/.test(code)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `use local Date getters (getFullYear/getMonth/getDate) instead of toISOString() for a 'today' value in: ${offenders.join(", ")}`);
});
