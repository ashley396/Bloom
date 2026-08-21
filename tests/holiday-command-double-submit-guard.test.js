import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Florisyn launch recovery batch — hand-ported from main PR #157 (functional
 * -completion pass #2), scoped narrowly to the one reported defect: the
 * "duplicate Prom/holiday" cards bug. Holiday Command's "Add peak" form had
 * no guard against a fast double-click (or a slow connection prompting a
 * second click) firing the async submit handler twice — each firing created
 * a real, separate holiday_peaks database row. The other four sibling forms
 * PR #157 also hardened (Weddings, Email Campaigns, Marketing Command
 * Center) are out of scope for this batch — this was the specific,
 * reproducible defect observed, not a general double-submit sweep.
 */

const root = process.cwd();

test("holidayPeakForm guards against double-submit", () => {
  const src = fs.readFileSync(path.join(root, "public/holiday-command-ui.js"), "utf8");
  const start = src.indexOf('el.querySelector("#holidayPeakForm")?.addEventListener("submit"');
  assert.ok(start > -1, "could not find the holidayPeakForm submit handler");
  const end = src.indexOf("\n    });", start) + "\n    });".length;
  const handler = src.slice(start, end);
  assert.match(handler, /if \(form\.dataset\.submitting === "1"\) return;/, "must bail out on a second, concurrent submit");
  assert.match(handler, /form\.dataset\.submitting = "1"/, "must mark itself in-flight before the async call");
  assert.match(handler, /submitBtn\.disabled = true/, "must visibly disable the submit button while saving");
  assert.match(handler, /form\.dataset\.submitting = "";/, "must clear the in-flight flag in a finally block so a real failure doesn't permanently lock the form");
});
