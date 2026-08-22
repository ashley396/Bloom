import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/**
 * Functional-completion pass #2: "duplicate holiday cards" turned out to be
 * a real bug, not a rendering issue — none of these create-record forms
 * guarded against a fast double-click (or a slow connection prompting a
 * second click) firing the async submit handler twice, each time creating
 * a real, separate database row. A dedicated Playwright test
 * (marketing-modules-stabilization.spec.js) proves the fix behaviorally for
 * the Holiday Command Center form that was explicitly reported; these are
 * source-text guards confirming the same fix landed on every sibling form
 * built the same way (Weddings, Email Campaigns, and the three Marketing
 * Command Center create forms) rather than only the one that got reported.
 */
const FORMS = [
  { file: "public/holiday-command-ui.js", formId: "holidayPeakForm" },
  { file: "public/weddings-ui.js", formId: "weddingForm" },
  { file: "public/email-campaigns-ui.js", formId: "emailCampaignForm" },
  { file: "public/marketing-campaigns-ui.js", formId: "marketingCampaignForm" },
  { file: "public/marketing-campaigns-ui.js", formId: "marketingPromotionForm" },
];

for (const { file, formId } of FORMS) {
  test(`${formId} (${file}) guards against double-submit`, () => {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    const start = src.indexOf(`el.querySelector("#${formId}")?.addEventListener("submit"`);
    assert.ok(start > -1, `could not find the ${formId} submit handler`);
    const end = src.indexOf("\n    });", start) + "\n    });".length;
    const handler = src.slice(start, end);
    assert.match(handler, /if \(form\.dataset\.submitting === "1"\) return;/, "must bail out on a second, concurrent submit");
    assert.match(handler, /form\.dataset\.submitting = "1"/, "must mark itself in-flight before the async call");
    assert.match(handler, /submitBtn\.disabled = true/, "must visibly disable the submit button while saving");
  });
}

test("marketingLilyForm is guarded a different, equally real way — an immediate synchronous re-render replaces the form before the async Lily job starts", () => {
  const src = fs.readFileSync(path.join(root, "public/marketing-campaigns-ui.js"), "utf8");
  const start = src.indexOf('el.querySelector("#marketingLilyForm")?.addEventListener("submit"');
  const end = src.indexOf("\n    });", start) + "\n    });".length;
  const handler = src.slice(start, end);
  assert.match(handler, /if \(form\.dataset\.submitting === "1"\) return;/);
  assert.match(handler, /state\.lilyDrafting = true;\s*\n\s*state\.lilyError = null;\s*\n\s*render\(\);/, "render() must run synchronously before the Lily job starts, replacing the form so a second click has nothing left to submit");
});
