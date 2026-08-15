import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const shellJs = fs.readFileSync(path.join(root, "public/website-studio-shell.js"), "utf8");
const shellCss = fs.readFileSync(path.join(root, "public/website-studio-v2.css"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

test("shell script is registered in index.html after the five panel scripts, and exposes BloomWebsiteStudioShell", () => {
  assert.match(html, /website-editor-ui\.js" defer><\/script><script src="\/website-studio-shell\.js" defer>/);
  assert.match(shellJs, /window\.BloomWebsiteStudioShell\s*=\s*\{\s*load,\s*reorganize\s*\}/);
});

test("loadWebsite() calls the shell last, after all five original panel loaders", () => {
  const start = appJs.indexOf("async function loadWebsite(");
  const body = appJs.slice(start, appJs.indexOf("\n", start) + 1);
  const order = [
    "BloomLilyWebsiteWizard",
    "BloomInstantWebsite",
    "BloomThemeGallery",
    "BloomWebsiteStudioV2",
    "BloomWebsiteEditor",
    "BloomWebsiteStudioShell"
  ].map((name) => body.indexOf(name));
  assert.ok(order.every((i) => i >= 0), "all five original loaders plus the shell must still be called");
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], "shell must load after every original panel, not before");
  }
});

test("shell does not rewrite any of the five original panels — it only reorganizes them by class name", () => {
  // Regression guard: this file must never define its own mount*/wizard/editor
  // logic that duplicates the five existing modules. It should only move
  // existing DOM nodes found by selector.
  assert.doesNotMatch(shellJs, /insertAdjacentHTML/, "shell must not inject its own copies of panel markup");
  assert.match(shellJs, /appendChild\(node\)/, "shell must move existing nodes, not clone them");
  const placementBlock = shellJs.slice(shellJs.indexOf("const PLACEMENT"), shellJs.indexOf("};", shellJs.indexOf("const PLACEMENT")));
  [".lily-wizard-shell", ".instant-wizard-shell", ".website-studio-v2", ".website-editor-shell", ".theme-gallery-shell"].forEach((sel) => {
    assert.ok(placementBlock.includes(sel), `PLACEMENT must account for ${sel}`);
  });
});

test("tab bar is accessible: role=tablist/tab/tabpanel, aria-selected reflects state, arrow-key navigation wired", () => {
  assert.match(shellJs, /role="tablist"/);
  assert.match(shellJs, /role="tab"/);
  assert.match(shellJs, /role="tabpanel"/);
  assert.match(shellJs, /aria-selected/);
  assert.match(shellJs, /ArrowLeft.*ArrowRight|ArrowRight.*ArrowLeft/s);
});

test("default tab is chosen from real project state (editor if any page has sections, else start) — never hardcoded", () => {
  const fn = shellJs.slice(shellJs.indexOf("async function pickDefaultTab"), shellJs.indexOf("async function load("));
  assert.match(fn, /get_project/);
  assert.match(fn, /hasContent.*sections.*length\s*>\s*0/s);
  assert.match(fn, /hasContent \? "editor" : "start"/);
  // Network/API failure must not crash the page — falls back to "start".
  assert.match(fn, /catch\s*\{[\s\S]*selectTab\(shell,\s*"start"\)/);
});

test("hidden panels are actually hidden via the native hidden attribute, and CSS backs it up", () => {
  assert.match(shellJs, /panel\.hidden\s*=\s*!active/);
  assert.match(shellCss, /\.ws-shell-panel\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
});

test("re-running load() (page revisited) is idempotent — does not duplicate the shell or re-pick the tab away from the user's choice", () => {
  assert.match(shellJs, /if \(root\.querySelector\("\.ws-shell"\)\) return root\.querySelector\("\.ws-shell"\)/);
  assert.match(shellJs, /if \(!shell\.dataset\.tabPicked\)/, "must only auto-pick a default tab once per mount, not override user's manual tab clicks on every reload");
});
