import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const settingsFn = fs.readFileSync(path.join(root, "netlify/functions/settings.js"), "utf8");

function pageHtml() {
  const start = html.indexOf('id="posSettingsPage"');
  const end = html.indexOf('id="bloomshotPage"', start + 1);
  return html.slice(start, end);
}

test("Checkout defaults are real editable inputs, not static display text", () => {
  const section = pageHtml();
  // Previously <strong id="posSettingsTax">6%</strong> etc. — read-only,
  // and the copy explicitly told the owner to go edit them elsewhere.
  assert.doesNotMatch(section, /id="posSettingsTax">/, "old read-only tax span must be gone");
  assert.doesNotMatch(section, /id="posSettingsDelivery">/, "old read-only delivery span must be gone");
  assert.doesNotMatch(section, /Update them in Settings/, "copy must no longer send the owner elsewhere to edit these");

  assert.match(section, /id="posSettingsTaxInput"[^>]*type="number"/);
  assert.match(section, /id="posSettingsDeliveryInput"[^>]*type="number"/);
  assert.match(section, /id="posSettingsRegisterName"/);
  assert.match(section, /id="posSettingsRegisterId"/);
  assert.match(section, /id="posSettingsSaveBtn"/);
});

test("register_name and register_id are real, saveable shop settings fields", () => {
  const fieldsLine = settingsFn.match(/const fields=\[[^\]]*\]/)?.[0] || "";
  assert.match(fieldsLine, /"register_name"/);
  assert.match(fieldsLine, /"register_id"/);
  // Not excluded from PATCH like website_published is.
  assert.doesNotMatch(settingsFn, /writableFields=fields\.filter\(\(field\)=>field!=="register_name"/);
});

test("save button loads current values on page entry and PATCHes all four fields together", () => {
  assert.match(appJs, /posSettingsPage:loadPosSettingsPage/, "must be wired into the page-load dispatch table, not dead code");

  const loadStart = appJs.indexOf("function loadPosSettingsPage(");
  const loadBody = appJs.slice(loadStart, appJs.indexOf("\n}", loadStart));
  assert.match(loadBody, /posSettingsTaxInput.*value=Number\(shopSettings\?\.tax_rate/);
  assert.match(loadBody, /posSettingsDeliveryInput.*value=Number\(shopSettings\?\.default_delivery_fee/);
  assert.match(loadBody, /posSettingsRegisterName.*value=shopSettings\?\.register_name/);
  assert.match(loadBody, /posSettingsRegisterId.*value=shopSettings\?\.register_id/);

  const saveStart = appJs.indexOf('$("#posSettingsSaveBtn")?.addEventListener("click"');
  assert.ok(saveStart >= 0, "save handler must exist");
  const saveBody = appJs.slice(saveStart, appJs.indexOf("\n});", saveStart));
  assert.match(saveBody, /api\("settings",\{method:"PATCH"/);
  assert.match(saveBody, /tax_rate:Number/);
  assert.match(saveBody, /default_delivery_fee:Number/);
  assert.match(saveBody, /register_name:/);
  assert.match(saveBody, /register_id:/);
  // Refreshes the in-memory shopSettings from the real server response
  // rather than just trusting the form, so other pages reading
  // shopSettings (order builder tax/delivery defaults, receipts) see the
  // saved values immediately.
  assert.match(saveBody, /shopSettings=\(await api\(/);
});

test("editable order-builder defaults actually read these same fields (not cosmetic)", () => {
  // Confirms tax_rate/default_delivery_fee saved here really do feed a
  // real order — not just displayed on this one page.
  assert.match(appJs, /f\.elements\.tax_rate\.value=Number\(shopSettings\?\.tax_rate/);
  assert.match(appJs, /shopSettings\?\.default_delivery_fee/);
});

test("Quick links wrap on narrow phones instead of overflowing off the right edge", () => {
  // .actions is shared across many dialog footers app-wide (display:flex,
  // no wrap, justify-content:flex-end) — fixed scoped to this page's
  // quick-links row specifically, not on .actions itself.
  assert.match(html, /class="actions pos-settings-quicklinks"/);
  const start = css.indexOf("#posSettingsPage .pos-settings-quicklinks{flex-wrap:wrap");
  assert.ok(start >= 0, "scoped wrap rule must exist");
  assert.doesNotMatch(css, /^\.actions\{[^}]*flex-wrap:\s*wrap/m, "the shared .actions class itself must stay untouched");
});
