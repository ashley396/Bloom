import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync(path.join(process.cwd(), "public/admin.html"), "utf8");
const ui = fs.readFileSync(path.join(process.cwd(), "public/admin-command-center-ui.js"), "utf8");

test("admin.html has a mount point for Bud's Fix Queue inside the Support view", () => {
  assert.match(html, /<section id="supportView"[^>]*>[\s\S]*?<div id="budQueueRoot"/);
});

test("loadBudQueue calls the real bud-queue-list backend action, not a placeholder", () => {
  assert.match(ui, /function loadBudQueue/);
  assert.match(ui, /action:\s*'bud-queue-list'/);
});

test("Bud's Fix Queue is loaded whenever the Support tab loads, not left to load itself", () => {
  const start = ui.indexOf("async function loadSupport(");
  const end = ui.indexOf("const BUD_STATUSES");
  assert.ok(start > -1 && end > start, "expected to find loadSupport() followed by the Bud queue helpers");
  const supportFnSource = ui.slice(start, end);
  assert.match(supportFnSource, /loadBudQueue\(\)/);
});

test("the status dropdown and Save button in Bud's Fix Queue are both wired to real handlers, not just rendered", () => {
  assert.match(ui, /data-bud-status-select="\$\{it\.id\}"/);
  assert.match(ui, /data-bud-save="\$\{it\.id\}"/);
  assert.match(ui, /\[data-bud-save\]'\)\.forEach\(\(b\) => b\.onclick = async \(\) => \{/);
  assert.match(ui, /action:\s*'bud-queue-update'/);
});
