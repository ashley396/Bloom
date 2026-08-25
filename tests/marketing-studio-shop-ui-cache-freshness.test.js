import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Live beta defect (Aug 25 2026, second occurrence): Ashley re-tested "Ask
 * Lily to change something" after commit b6f358c deployed the real revision
 * composer, and got the OLD pre-fix behavior back — no composer, the bare
 * "Tell me specifically what to keep... so Lily can save it as your style"
 * toast. The committed/deployed source at b6f358c is correct (see
 * tests/e2e/marketing-studio-shop-revision.spec.js, and the stale-script
 * spec below proves this old behavior can ONLY come from the pre-fix client
 * bytes, never from b6f358c's actual client code) — so the deployed CODE
 * was not the bug. What b6f358c was missing is what every other
 * actively-revised script in netlify.toml/index.html already has: a
 * guarantee that a browser which already fetched this exact URL once can't
 * keep silently reusing that copy forever. marketing-studio-shop-ui.js was
 * added in the florist-facing Marketing Studio pass with NEITHER a
 * netlify.toml Cache-Control override NOR a `?v=` cache-busting query
 * string on its <script> tag — unlike app.js, admin.js, floral-media.js,
 * floral-library-ui.js, floral-library-collection.js, and every other file
 * that gets revised in place. That combination is exactly what lets a
 * browser that visited the page once (Ashley did, for her earlier
 * successful Generate test) keep running whatever copy it fetched that
 * first time, across any number of later deploys, without ever knowing a
 * new one exists.
 *
 * This is a config-shape regression, not an application-logic one — it
 * genuinely can't be caught by a fresh-navigation Playwright test (a fresh
 * browser context has no prior cached copy to go stale), the same way the
 * storage RLS bug wasn't visible to reading generate_content's own code.
 * This test instead proves the actual config gap directly: it fails
 * against b6f358c (neither protection exists for this file) and passes
 * once both are added — matching, file-for-file, the protection every
 * sibling script in this list already has.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("netlify.toml forces revalidation on every request for marketing-studio-shop-ui.js", () => {
  const toml = read("netlify.toml");
  // A block anywhere of the shape:
  //   [[headers]]
  //     for = "/marketing-studio-shop-ui.js"
  //       [headers.values]
  //       Cache-Control = "public, max-age=0, must-revalidate"
  const blockRe =
    /\[\[headers\]\]\s*\n\s*for = "\/marketing-studio-shop-ui\.js"\s*\n\s*\[headers\.values\]\s*\n\s*Cache-Control = "public, max-age=0, must-revalidate"/;
  assert.match(
    toml,
    blockRe,
    "marketing-studio-shop-ui.js needs the same forced-revalidation Cache-Control override every other actively-revised script (app.js, admin.js, floral-media.js, ...) already has — its absence is exactly what let a florist's browser keep running pre-fix JS after b6f358c deployed the real fix."
  );
});

test("index.html's script tag for marketing-studio-shop-ui.js carries a cache-busting version query string", () => {
  const html = read("public/index.html");
  const tagMatch = html.match(/<script src="\/marketing-studio-shop-ui\.js(\?[^"]*)?" defer><\/script>/);
  assert.ok(tagMatch, "expected to find the marketing-studio-shop-ui.js <script> tag in index.html");
  assert.ok(
    tagMatch[1] && /^\?v=/.test(tagMatch[1]),
    "the <script> tag must carry a `?v=` cache-busting query string, like every other actively-revised script (app.js?v=..., floral-library-ui.js?v=..., photo-studio.js?v=...) — a byte-identical URL across every deploy is exactly what let a browser silently keep reusing an already-fetched, pre-fix copy indefinitely."
  );
});
