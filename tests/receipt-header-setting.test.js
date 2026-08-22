import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const settingsFn = fs.readFileSync(path.join(root, "netlify/functions/settings.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const onboardingHtml = fs.readFileSync(path.join(root, "public/onboarding.html"), "utf8");

/**
 * Dormant-infrastructure fix, same shape as ai_shop_profiles: onboarding
 * step 3 ("Store defaults") asks every florist for a "Receipt heading"
 * (public/onboarding.html), and complete-florist-onboarding.js /
 * complete-onboarding.js write it into shops.receipt_header for real. But
 * settings.js's fields list never selected it — so GET /settings never
 * returned it to the client — and the printed receipt template hardcoded
 * a generic "Thank you for supporting a local flower shop." line instead
 * of ever reading it. A florist's real onboarding answer never reached
 * a receipt, regardless of what they typed.
 */

test("onboarding actually asks for a receipt heading (the promise this fix keeps)", () => {
  assert.match(onboardingHtml, /Receipt heading/);
  assert.match(onboardingHtml, /name="receiptHeader"/);
});

test("settings.js now selects/persists receipt_header like every other real shop setting", () => {
  const fieldsLine = settingsFn.match(/const fields=\[[^\]]*\]/)?.[0] || "";
  assert.match(fieldsLine, /"receipt_header"/);
  // Not excluded from PATCH like website_published is.
  assert.doesNotMatch(settingsFn, /writableFields=fields\.filter\(\(field\)=>field!=="receipt_header"/);
});

test("the printed receipt uses the shop's real receipt_header when the florist set one", () => {
  const fnStart = appJs.indexOf("async function openReceiptWithPayments(");
  const fnBody = appJs.slice(fnStart, appJs.indexOf("$(\"#receiptDialog\").showModal()", fnStart));
  assert.match(fnBody, /shopSettings\?\.receipt_header/);
});

test("a shop that never set a receipt heading still gets the original generic thank-you line (no regression)", () => {
  const fnStart = appJs.indexOf("async function openReceiptWithPayments(");
  const fnBody = appJs.slice(fnStart, appJs.indexOf("$(\"#receiptDialog\").showModal()", fnStart));
  assert.match(fnBody, /Thank you for supporting a local flower shop\./);
});

test("the receipt_header value is HTML-escaped like every other user-supplied string on the receipt", () => {
  const fnStart = appJs.indexOf("async function openReceiptWithPayments(");
  const fnBody = appJs.slice(fnStart, appJs.indexOf("$(\"#receiptDialog\").showModal()", fnStart));
  assert.match(fnBody, /esc\(shopSettings\.receipt_header\)/);
});
