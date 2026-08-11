import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();

function loadPhotoStudio() {
  const source = fs.readFileSync(path.join(root, "public/photo-studio.js"), "utf8");
  const sandbox = { module: { exports: {} }, globalThis: {} };
  vm.runInNewContext(source, sandbox);
  return sandbox.module.exports;
}

const studio = loadPhotoStudio();

/** Build a synthetic ImageData-shaped object. painter(x, y) returns [r,g,b] or [r,g,b,a]. */
function makeImage(width, height, painter) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = painter(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { width, height, data };
}

const alphaAt = (result, width, x, y) => result.data[(y * width + x) * 4 + 3];

test("removes a flat background to alpha around the subject (not just outside the rectangle)", () => {
  // 60x60 white studio background with a 20..39 red subject block.
  const img = makeImage(60, 60, (x, y) => (x >= 20 && x < 40 && y >= 20 && y < 40 ? [190, 30, 60] : [248, 246, 244]));
  const result = studio.removeBackgroundFromImageData(img);
  assert.equal(result.ok, true);
  assert.equal(result.width, 60, "width preserved");
  assert.equal(result.height, 60, "height preserved");
  // Background corners and edges become transparent…
  assert.equal(alphaAt(result, 60, 1, 1), 0);
  assert.equal(alphaAt(result, 60, 58, 58), 0);
  assert.equal(alphaAt(result, 60, 30, 5), 0, "background above the subject must be removed, not only outside the image");
  // …while the subject stays opaque.
  assert.equal(alphaAt(result, 60, 30, 30), 255);
  assert.ok(result.removedRatio > 0.5 && result.removedRatio < 0.95, `removedRatio sane, got ${result.removedRatio}`);
});

test("keeps interior background-coloured regions (white petals) — flood is edge-connected only", () => {
  // Red frame with a white hole in the middle: the hole must NOT be removed.
  const img = makeImage(50, 50, (x, y) => {
    const inFrame = x >= 10 && x < 40 && y >= 10 && y < 40;
    const inHole = x >= 20 && x < 30 && y >= 20 && y < 30;
    if (inFrame && !inHole) return [180, 40, 70];
    if (inHole) return [248, 246, 244];
    return [248, 246, 244];
  });
  const result = studio.removeBackgroundFromImageData(img);
  assert.equal(result.ok, true);
  assert.equal(alphaAt(result, 50, 25, 25), 255, "interior white region must stay opaque");
  assert.equal(alphaAt(result, 50, 2, 2), 0, "outer background removed");
});

test("preserves soft natural shadows with partial alpha instead of hard removal", () => {
  // White background, red subject, medium-gray shadow strip beside it.
  const img = makeImage(60, 60, (x, y) => {
    if (x >= 20 && x < 36 && y >= 20 && y < 40) return [190, 30, 60];
    if (x >= 36 && x < 42 && y >= 30 && y < 44) return [206, 204, 202]; // soft shadow
    return [248, 246, 244];
  });
  const result = studio.removeBackgroundFromImageData(img);
  assert.equal(result.ok, true);
  const shadowAlpha = alphaAt(result, 60, 38, 36);
  assert.ok(shadowAlpha > 0 && shadowAlpha < 255, `shadow should be feathered, got alpha=${shadowAlpha}`);
});

test("refuses busy backgrounds instead of pretending removal worked", () => {
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % 256; };
  const img = makeImage(48, 48, () => [rand(), rand(), rand()]);
  const result = studio.removeBackgroundFromImageData(img);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "complex-background");
});

test("refuses when no subject remains (blank photo)", () => {
  const img = makeImage(40, 40, () => [250, 249, 248]);
  const result = studio.removeBackgroundFromImageData(img);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "subject-not-found");
});

test("passes through images that already carry transparency", () => {
  const img = makeImage(40, 40, (x, y) => (x < 20 ? [180, 40, 70, 255] : [0, 0, 0, 0]));
  const result = studio.removeBackgroundFromImageData(img);
  assert.equal(result.ok, true);
  assert.equal(result.alreadyTransparent, true);
});

test("exposes the exact user-facing failure message", () => {
  assert.equal(studio.FAILURE_MESSAGE, "Background could not be fully removed. Try a cleaner product photo.");
});

test("app wiring: background layer first, cut-out subject on top, dimensions logic intact", () => {
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const draw = appJs.slice(appJs.indexOf("function drawBloomShot"), appJs.indexOf("function setShotPreset"));
  assert.match(draw, /shotPresetBackground/, "preset backgrounds drawn on the canvas");
  assert.match(draw, /createLinearGradient/, "luxury/warm studio gradients supported");
  const fillIdx = draw.indexOf("fillRect(0,0,w,h)");
  const subjectIdx = draw.indexOf("const subject=(shotUseCutout&&shotCutout)?shotCutout:shotImage");
  const drawImageIdx = draw.indexOf("ctx.drawImage(subject");
  assert.ok(fillIdx >= 0 && subjectIdx > fillIdx && drawImageIdx > subjectIdx, "background must be painted before the cut-out subject is composited");
  assert.match(draw, /scale=Math\.min\(w\/iw,h\/ih\)/, "aspect-ratio preserving scale unchanged");
});

test("app wiring: upload triggers cut-out and failure shows the safe message without faking success", () => {
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(appJs, /prepareShotCutout\(\)\};img\.src=reader\.result/, "upload handler must start background removal");
  const prep = appJs.slice(appJs.indexOf("function prepareShotCutout"), appJs.indexOf('$("#bloomshotFile")'));
  assert.match(prep, /FAILURE_MESSAGE/, "uses the module's failure message");
  assert.match(prep, /Background could not be fully removed\. Try a cleaner product photo\./, "safe fallback message present");
  assert.match(prep, /shotCutout=null;shotUseCutout=false/, "failure must fall back to the original photo, never a fake cut-out");
  assert.match(prep, /try\{/, "removal errors must be caught so the studio never breaks");
});

test("photo studio module is loaded by the shell", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /photo-studio\.js\?v=ps1/);
  const psIdx = html.indexOf("photo-studio.js");
  const appIdx = html.indexOf("app.js?v=");
  assert.ok(psIdx >= 0 && psIdx < appIdx, "photo-studio.js must load before app.js");
});
