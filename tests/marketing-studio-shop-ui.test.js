import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// Florist-facing Marketing Studio panel (Phase 1C of the "Florist-Facing
// Marketing Studio + Lily Connected Intelligence" pass). Structural,
// source-text assertions — the same convention double-submit-guards.test.js
// and platform-admin-authorization-boundary.test.js already use for
// public/*.js UI modules in this repo (no jsdom harness exists here).

const uiSrc = fs.readFileSync(path.join(root, "public/marketing-studio-shop-ui.js"), "utf8");

test("marketing-studio-shop-ui.js talks ONLY to the florist entry point, never the super_admin-only endpoint", () => {
  assert.match(uiSrc, /marketing-studio-shop\?action=/, "must call marketing-studio-shop.js");
  assert.doesNotMatch(uiSrc, /["'`]marketing-studio["'`]|\/marketing-studio\?/, "must never call the super_admin-only marketing-studio.js endpoint directly");
  assert.doesNotMatch(uiSrc, /bloom_admin_session/, "must use the real florist session (window.api), never the admin console's separate session store");
});

test("marketing-studio-shop-ui.js never sends a client-chosen shop_id", () => {
  assert.doesNotMatch(uiSrc, /shop_id/, "the session's own shop is resolved server-side (Phase 1A) — this file must never construct or forward a shop_id itself");
});

test("every action this panel calls is in the real florist allowlist (no drift, no typos opening a wider door)", () => {
  const shopEntrySrc = fs.readFileSync(path.join(root, "netlify/functions/marketing-studio-shop.js"), "utf8");
  const allowlistMatch = shopEntrySrc.match(/FLORIST_ALLOWED_ACTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(allowlistMatch, "could not find FLORIST_ALLOWED_ACTIONS in marketing-studio-shop.js");
  const allowlist = new Set([...allowlistMatch[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
  assert.ok(allowlist.size > 0);

  const calledActions = new Set([...uiSrc.matchAll(/studioApi\("([a-z_]+)"/g)].map((m) => m[1]));
  assert.ok(calledActions.size >= 8, "expected this panel to exercise most of the florist action surface");
  for (const action of calledActions) {
    assert.ok(allowlist.has(action), `studioApi("${action}") is not in marketing-studio-shop.js's FLORIST_ALLOWED_ACTIONS — this panel must never call an action a florist isn't allowlisted for`);
  }
});

test("the create-post form guards against double-submit", () => {
  const start = uiSrc.indexOf('el.querySelector("#msCreateItemForm")?.addEventListener("submit"');
  assert.ok(start > -1, "could not find the msCreateItemForm submit handler");
  const end = uiSrc.indexOf("\n    });", start) + "\n    });".length;
  const handler = uiSrc.slice(start, end);
  assert.match(handler, /if \(form\.dataset\.submitting === "1"\) return;/, "must bail out on a second, concurrent submit");
  assert.match(handler, /form\.dataset\.submitting = "1"/, "must mark itself in-flight before the async call");
  assert.match(handler, /submitBtn\.disabled = true/, "must visibly disable the submit button while saving");
});

test("consequential review actions (approve/reject/revert) require explicit confirmation, never fire on a bare click", () => {
  assert.match(uiSrc, /act === "approve"[\s\S]{0,40}confirm\(/, "approve must be confirmed");
  assert.match(uiSrc, /act === "reject"[\s\S]{0,40}confirm\(/, "reject must be confirmed");
  assert.match(uiSrc, /act === "revert"[\s\S]{0,40}confirm\(/, "revert must be confirmed");
});

test("index.html wires a real, initially-hidden Marketing Studio nav entry (no dead menu item for unauthorized shops)", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /data-route="\/marketing-studio" data-page="marketingStudioPage" hidden/, "the nav button must start hidden — visibility is decided by a real per-shop access check, not shown by default");
  assert.match(html, /<section id="marketingStudioPage" class="page" hidden>[\s\S]{0,400}<div id="marketingStudioRoot"><\/div><\/section>/, "the page section + mount root must exist");
  assert.match(html, /marketing-studio-shop-ui\.js/, "the new panel script must be included");
});

test("florisyn-router.js maps /marketing-studio to marketingStudioPage in both directions", () => {
  const routerSrc = fs.readFileSync(path.join(root, "public/florisyn-router.js"), "utf8");
  assert.match(routerSrc, /"\/marketing-studio":\s*\{\s*page:\s*"marketingStudioPage"\s*\}/);
  assert.match(routerSrc, /marketingStudioPage:\s*"\/marketing-studio"/);
});

// Phase 14 ("Explainability"): the backend already computes and persists
// grounded_in_inventory/brand_traits_used/visual_traits_used on every
// generated asset — this panel must actually show them to the florist
// reviewing a draft, not just fetch and discard them.

test("itemPreviewHtml renders a real 'Grounded in' note from the asset's own grounded_in_inventory/brand+visual traits_used, never invented", () => {
  assert.match(uiSrc, /function groundingHtml\(c\)/, "a dedicated grounding-note builder must exist");
  const start = uiSrc.indexOf("function groundingHtml(c)");
  const end = uiSrc.indexOf("\n  function itemPreviewHtml", start);
  const fnBody = uiSrc.slice(start, end);
  assert.match(fnBody, /c\.grounded_in_inventory/, "must read the real inventory sources the backend persisted");
  assert.match(fnBody, /c\.brand_traits_used/, "must read the real brand-voice traits the backend persisted");
  assert.match(fnBody, /c\.visual_traits_used/, "must read the real visual-style traits the backend persisted");
  assert.match(fnBody, /if \(!parts\.length\) return "";/, "an item grounded in nothing must render no note at all — never a fabricated one");

  assert.match(uiSrc, /\$\{groundingHtml\(c\)\}/, "itemPreviewHtml must actually call groundingHtml and render its result");
});

test("app.js gates Marketing Studio visibility with a REAL per-shop authenticated check, never the public global growth-flags fetch", () => {
  const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(appSrc, /async function refreshMarketingStudioAccess\(\)\{/, "a dedicated access-check function must exist");
  const fnStart = appSrc.indexOf("async function refreshMarketingStudioAccess(){");
  const fnBody = appSrc.slice(fnStart, fnStart + 300);
  assert.match(fnBody, /marketing-studio-shop\?action=status/, "must call the real florist-facing status action");
  assert.doesNotMatch(fnBody, /production-health/, "must NOT reuse the public/unauthenticated growth-flags endpoint — Marketing Studio access is shop-scoped and requires a real session");
  assert.match(appSrc, /marketingStudioPage:loadMarketingStudioPage/, "must be wired into the page loader dispatch");
  assert.match(appSrc, /if\(id==="marketingStudioPage"&&!marketingStudioEnabled\)/, "showPage must gate direct navigation the same way every other beta nav item does");
});
