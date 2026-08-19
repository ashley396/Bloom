import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// bloom-rc2-design-system.css has a broad `body.bloom-rc2 button` rule
// (min-width: 44px) that out-specifies a lone `.marketing-tab`/
// `.community-tab` class selector (element+class beats class alone).
// Without protection, flexbox shrinks every tab in a too-narrow row down
// toward that 44px floor — nowhere near enough for words like
// "Campaigns" or "Promotions" — wrapping labels onto squeezed,
// overlapping lines and clipping the last tab off the phone screen
// entirely. This is the same failure mode website-studio-v2.css's
// .ws-shell-tabs already guards against; .marketing-tabs and
// .community-tabs need the identical guard: let the row scroll instead
// of letting its buttons shrink below their content width.

function css(file) {
  // Strip /* ... */ comments first — the explanatory comment on the fix
  // itself quotes a `{ ... }` snippet, which would otherwise fool a
  // brace-scoped regex into thinking the rule block ended early.
  return fs.readFileSync(path.join(root, "public", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

test("marketing tabs scroll instead of shrinking below readable width", () => {
  const sql = css("marketing-campaigns.css");
  assert.match(sql, /\.marketing-tabs\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(sql, /\.marketing-tab\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(sql, /\.marketing-tab\s*\{[^}]*flex-shrink:\s*0/);
});

test("community tabs scroll instead of shrinking below readable width", () => {
  const css_ = css("community.css");
  assert.match(css_, /\.community-tabs\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css_, /\.community-tab\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(css_, /\.community-tab\s*\{[^}]*flex-shrink:\s*0/);
});
