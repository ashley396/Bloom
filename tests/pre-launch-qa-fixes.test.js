import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Florisyn pre-launch QA and polish pass. Source-text guards for the real
 * fixes made from the QA sweep's findings — matching the convention used
 * elsewhere in this suite (double-submit-guards.test.js etc.) for
 * non-module frontend files without a bundler.
 */

const root = process.cwd();

test("Business OS 'Apply'/'Add to Tasks' action items are actually persisted (not just a DOM row that vanishes on refresh)", () => {
  const src = fs.readFileSync(path.join(root, "public/florisyn-luxury-business-os.js"), "utf8");
  assert.match(src, /function loadActionItems\(\)/, "must have a real load function");
  assert.match(src, /function saveActionItems\(items\)/, "must have a real save function");
  assert.match(src, /localStorage\.setItem\(actionItemsKey\(\)/, "must actually write to storage");
  const addFn = src.slice(src.indexOf("function addActionItem"), src.indexOf("function boot"));
  assert.match(addFn, /saveActionItems\(items\)/, "addActionItem must persist, not just render a DOM row");
  assert.match(src, /renderActionItems\(\)/, "boot must restore persisted items so they survive a refresh");
});

test("website media library delete requires confirmation, like every sibling delete action", () => {
  const src = fs.readFileSync(path.join(root, "public/website-media-library.js"), "utf8");
  const start = src.indexOf('const delBtn = e.target.closest("[data-delete-media]");');
  assert.ok(start > -1);
  const block = src.slice(start, start + 400);
  assert.match(block, /if \(!confirm\(/, "an irreversible backend delete must confirm first");
});

test("saved POS quote delete requires confirmation", () => {
  const src = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const start = src.indexOf('[data-delete-quote]');
  assert.ok(start > -1);
  const block = src.slice(Math.max(0, start - 20), start + 200);
  assert.match(block, /confirm\(/);
});

test("per-tile 'Save tile' button actually persists the edit (matches its label)", () => {
  const src = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const start = src.indexOf('$("#tileEditForm")?.addEventListener("submit"');
  assert.ok(start > -1);
  const end = src.indexOf("});", start) + 3;
  const block = src.slice(start, end);
  assert.match(block, /savePosTiles\(\)/, "the per-tile save must not rely on the separate outer 'Save tiles' button being clicked afterward");
});

test("the visible mobile notification bell has a real (even if minimal) click handler, not silent no-op", () => {
  const src = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(src, /\$\("#atelierMobileNotify"\)\?\.addEventListener\("click"/);
});

test("login.js shows a friendly message for a genuine network failure, not the raw browser error string", () => {
  const src = fs.readFileSync(path.join(root, "public/login.js"), "utf8");
  assert.match(src, /err\.isApiError\s*=\s*true/, "a real HTTP response error must be tagged so it's distinguishable from a raw fetch failure");
  assert.match(src, /if\s*\(!error\.isApiError\)/, "must branch on the untagged (raw network failure) case before falling through to detail||fallback");
});

test("signup.js's api() helper never lets a raw fetch() rejection surface verbatim", () => {
  const src = fs.readFileSync(path.join(root, "public/signup.js"), "utf8");
  const start = src.indexOf("async function api(");
  const end = src.indexOf("\n}", start);
  const block = src.slice(start, end);
  assert.match(block, /try\s*{[\s\S]*fetch\(/, "the fetch() call itself must be inside a try");
  assert.match(block, /catch\s*{[\s\S]*throw new Error\(/, "a rejected fetch must be converted to a friendly Error, not left to propagate raw");
});

test("signup passes the real confirmationEmailSent signal through to /verify-email instead of discarding it", () => {
  const signupSrc = fs.readFileSync(path.join(root, "public/signup.js"), "utf8");
  assert.match(signupSrc, /d\.confirmationEmailSent/);
  assert.match(signupSrc, /sent=\$\{sentParam\}/);
  const verifySrc = fs.readFileSync(path.join(root, "public/verify-email.js"), "utf8");
  assert.match(verifySrc, /params\.get\("sent"\)\s*===\s*"0"/, "verify-email must actually branch on the honest-failure signal, not show a static message unconditionally");
});

test("handle_new_user no longer discards the shop info the florist already typed at signup", () => {
  const migrationDir = path.join(root, "supabase/migrations");
  const files = fs.readdirSync(migrationDir).filter((f) => f.startsWith("2026082103"));
  assert.ok(files.length === 1, "expected exactly one new migration for this fix");
  const sql = fs.readFileSync(path.join(migrationDir, files[0]), "utf8");
  for (const column of ["phone", "address_line_1", "city", "state", "postal_code"]) {
    assert.match(sql, new RegExp(column), `handle_new_user must now populate shops.${column} from signup metadata`);
  }
  for (const metaKey of ["business_phone", "business_address", "business_city", "business_state", "business_zip"]) {
    assert.match(sql, new RegExp(`raw_user_meta_data->>'${metaKey}'`), `must read ${metaKey} out of the metadata auth-signup.js already sends`);
  }
});

test("POS cart price column is never fully hidden at the mobile/tablet breakpoint — it wraps instead of vanishing", () => {
  const css = fs.readFileSync(path.join(root, "public/florisyn-luxury-pos.css"), "utf8");
  const start = css.indexOf("@media (max-width: 820px)");
  const closeIdx = css.indexOf("\n}", start); // first unindented "}" closes the media block
  const block = css.slice(start, closeIdx + 2);
  assert.doesNotMatch(block, /\.pos-lux-unit\s*\{[^}]*display:\s*none/, "unit price must never be display:none at this breakpoint");
  assert.match(block, /grid-area:\s*price/, "must place the price cell via grid-area rather than dropping it");
});
