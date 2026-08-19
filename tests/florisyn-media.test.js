import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

// public/floral-media.js is a browser (classic) script, so we evaluate it in a
// sandbox that mimics `window` and read the exported pure helpers off it.
const mediaPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/floral-media.js"
);
const source = readFileSync(mediaPath, "utf8");

function loadMedia() {
  const sandbox = { window: {}, module: { exports: {} } }; // no `document` → DOM init is skipped
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "floral-media.js" });
  return sandbox.window.FlorisynMedia;
}

const M = loadMedia();

test("module exposes the expected API", () => {
  assert.equal(typeof M, "object");
  for (const fn of ["isSafeImageUrl", "normalizeImageUrl", "pickImage", "mediaImg", "handleImgError", "init"]) {
    assert.equal(typeof M[fn], "function", `${fn} should be a function`);
  }
  assert.match(M.DEFAULT_FALLBACK, /florisyn-arrangement-signature-blush\.jpg$/);
});

test("isSafeImageUrl accepts trusted sources", () => {
  assert.equal(M.isSafeImageUrl("https://images.pexels.com/photos/1.jpg"), true);
  assert.equal(M.isSafeImageUrl("http://cdn.example.com/a.png"), true);
  assert.equal(M.isSafeImageUrl("/assets/floral-library/garden-harmony.jpg"), true);
  assert.equal(M.isSafeImageUrl("data:image/png;base64,AAAA"), true);
});

test("isSafeImageUrl rejects unsafe or malformed sources", () => {
  assert.equal(M.isSafeImageUrl("javascript:alert(1)"), false);
  assert.equal(M.isSafeImageUrl("vbscript:msgbox(1)"), false);
  assert.equal(M.isSafeImageUrl("//evil.example.com/x.jpg"), false, "protocol-relative rejected");
  assert.equal(M.isSafeImageUrl("file:///etc/passwd"), false);
  assert.equal(M.isSafeImageUrl(""), false);
  assert.equal(M.isSafeImageUrl("   "), false);
  assert.equal(M.isSafeImageUrl(null), false);
  assert.equal(M.isSafeImageUrl(undefined), false);
  assert.equal(M.isSafeImageUrl(42), false);
});

test("normalizeImageUrl trims valid URLs and blanks invalid ones", () => {
  assert.equal(M.normalizeImageUrl("  https://x.test/a.jpg  "), "https://x.test/a.jpg");
  assert.equal(M.normalizeImageUrl("javascript:x"), "");
});

test("pickImage falls back through url → fallback → default", () => {
  assert.equal(M.pickImage("https://x.test/a.jpg", "/b.jpg"), "https://x.test/a.jpg");
  assert.equal(M.pickImage("", "/b.jpg"), "/b.jpg");
  assert.equal(M.pickImage("javascript:x", "also-bad"), M.DEFAULT_FALLBACK);
  assert.equal(M.pickImage(undefined, undefined), M.DEFAULT_FALLBACK);
});

test("mediaImg builds a resilient, escaped <img> tag", () => {
  const html = M.mediaImg({ url: "https://x.test/rose.jpg", alt: "Red roses", width: 480, height: 360 });
  assert.match(html, /^<img /);
  assert.match(html, /src="https:\/\/x\.test\/rose\.jpg"/);
  assert.match(html, /alt="Red roses"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /decoding="async"/);
  assert.match(html, /width="480"/);
  assert.match(html, /height="360"/);
  assert.match(html, /data-fx-media/);
  assert.match(html, /data-fx-fallback="\/assets\/floral-library\/florisyn-arrangement-signature-blush\.jpg"/);
});

test("mediaImg uses the default fallback as src when the url is missing/unsafe", () => {
  const html = M.mediaImg({ url: "javascript:alert(1)", alt: "x" });
  assert.match(html, new RegExp(`src="${M.DEFAULT_FALLBACK.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`));
});

test("mediaImg escapes attribute-breaking / XSS characters in alt", () => {
  const html = M.mediaImg({ url: "/a.jpg", alt: '"><script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
});

test("handleImgError swaps to fallback once and guards against loops", () => {
  const attrs = { "data-fx-fallback": "/fallback.jpg" };
  const classes = new Set(["fx-media-loading"]);
  const img = {
    tagName: "IMG",
    src: "https://broken.example/x.jpg",
    getAttribute: (k) => (k === "src" ? img.src : attrs[k] ?? null),
    setAttribute: (k, v) => { attrs[k] = v; },
    hasAttribute: (k) => k in attrs,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }
  };
  M.handleImgError(img);
  assert.equal(img.src, "/fallback.jpg");
  assert.equal(attrs["data-fx-failed"], "1");
  assert.equal(classes.has("fx-media-broken"), true);
  assert.equal(classes.has("fx-media-loading"), false);

  // Second call must be a no-op (prevents infinite error→swap loops).
  img.src = "still-broken";
  M.handleImgError(img);
  assert.equal(img.src, "still-broken");
});
