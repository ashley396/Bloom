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

/** Build a pre-cut mask ImageData (alpha already applied) for gate-only tests. */
function makeMask(width, height, isOpaque) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = 190; data[i + 1] = 40; data[i + 2] = 70;
      data[i + 3] = isOpaque(x, y) ? 255 : 0;
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
  // White background, red subject, and a soft gradient shadow fading out beside
  // it (real shadows ramp gradually — the flood walks down the gradient).
  const img = makeImage(60, 60, (x, y) => {
    if (x >= 20 && x < 36 && y >= 20 && y < 40) return [190, 30, 60];
    if (x >= 36 && x < 46 && y >= 30 && y < 44) {
      const v = 208 + (x - 36) * 4; // 208 → 244 ramp
      return [v, v - 2, v - 4];
    }
    return [248, 246, 244];
  });
  const result = studio.removeBackgroundFromImageData(img);
  assert.equal(result.ok, true);
  const shadowAlpha = alphaAt(result, 60, 36, 36); // darkest shadow edge
  assert.ok(shadowAlpha > 0 && shadowAlpha < 255, `shadow should be feathered, got alpha=${shadowAlpha}`);
});

test("cleans up tiny disconnected leftovers while keeping the main subject", () => {
  // Main red subject plus a distant 2x2 dark speck (like a price sign remnant).
  const img = makeImage(80, 80, (x, y) => {
    if (x >= 20 && x < 50 && y >= 20 && y < 60) return [190, 30, 60];
    if (x >= 70 && x < 72 && y >= 70 && y < 72) return [40, 30, 25];
    return [248, 246, 244];
  });
  const result = studio.removeBackgroundFromImageData(img);
  assert.equal(result.ok, true);
  assert.equal(alphaAt(result, 80, 30, 30), 255, "main subject kept");
  assert.equal(alphaAt(result, 80, 71, 71), 0, "tiny disconnected leftover removed");
});

test("refuses busy backgrounds instead of pretending removal worked", () => {
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 16) & 0xff; };
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

test("passes through images that already carry transparency when the mask is clean", () => {
  const img = makeImage(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 8 && y < 32 ? [180, 40, 70, 255] : [0, 0, 0, 0]));
  const result = studio.removeBackgroundFromImageData(img);
  assert.equal(result.ok, true);
  assert.equal(result.alreadyTransparent, true);
});

test("exposes the exact user-facing failure message and fallback label", () => {
  assert.equal(studio.FAILURE_MESSAGE, "Background could not be fully removed. Try a cleaner product photo.");
  assert.equal(
    studio.FALLBACK_LABEL,
    "Background removal was not applied. Brightness, contrast, and color tools still work on the original photo."
  );
});

test("quality gate: poor mask with side checker strips must fail", () => {
  // Clean solid subject plus messy opaque leftovers in the right edge strip —
  // the classic "checker / leftover strip" failure mode from rough cutouts.
  const mask = makeMask(120, 100, (x, y) => {
    const inSubject = x >= 40 && x < 80 && y >= 25 && y < 75;
    const rightStripJunk = x >= 114 && x <= 118 && y >= 10 && y < 90 && (y % 3 !== 0);
    return inSubject || rightStripJunk;
  });
  const gate = studio.assessMaskQuality(mask);
  assert.equal(gate.ok, false, "side strip artifacts must fail the quality gate");
  assert.equal(gate.reason, "side-strip-artifacts");

  // Already-transparent rough mask with left/right checker strips must be refused
  // by removeBackgroundFromImageData (never shown as approved output).
  const rough = makeMask(120, 100, (x, y) => {
    if (x >= 40 && x < 80 && y >= 25 && y < 75) return true;
    if (x >= 114 && (y % 4 !== 1)) return true; // broken right strip
    if (x <= 5 && (x + y) % 2 === 0) return true; // checker left strip
    return false;
  });
  const refused = studio.removeBackgroundFromImageData(rough);
  assert.equal(refused.ok, false, "rough transparent mask must not be approved");
  assert.match(String(refused.reason), /side-strip|leftover|subject-damage|excessive/);
});

test("quality gate: subject damage over threshold must fail", () => {
  // Solid bouquet silhouette with a heavily eaten lower vase (swiss-cheese holes).
  const damaged = makeMask(100, 120, (x, y) => {
    const inBouquet = x >= 25 && x < 75 && y >= 15 && y < 55;
    // Vase zone with large punched holes (subject damage).
    const inVaseShell = x >= 35 && x < 65 && y >= 55 && y < 100;
    const hole =
      (x >= 40 && x < 60 && y >= 60 && y < 78) ||
      (x >= 42 && x < 58 && y >= 82 && y < 95) ||
      (x >= 38 && x < 48 && y >= 70 && y < 88);
    return (inBouquet || inVaseShell) && !hole;
  });
  const gate = studio.assessMaskQuality(damaged);
  assert.equal(gate.ok, false, "eaten subject must fail");
  assert.ok(
    gate.reason === "subject-damage" || gate.reason === "excessive-subject-holes",
    `expected subject-damage/excessive-subject-holes, got ${gate.reason}`
  );
  assert.ok(
    gate.metrics.coreHoleRatio > studio.QUALITY_THRESHOLDS.maxCoreHoleRatio ||
      gate.metrics.enclosedHoleRatio > studio.QUALITY_THRESHOLDS.maxEnclosedHoleRatio ||
      gate.metrics.fragLowerRatio > studio.QUALITY_THRESHOLDS.maxFragLowerRatio
  );
});

test("quality gate: clean simple background must pass", () => {
  const img = makeImage(80, 80, (x, y) => {
    const inSubject = ((x - 40) ** 2) / (14 ** 2) + ((y - 40) ** 2) / (22 ** 2) < 1;
    return inSubject ? [200, 45, 70] : [250, 248, 246];
  });
  const result = studio.removeBackgroundFromImageData(img);
  assert.equal(result.ok, true, "clean studio oval must pass segmentation + quality gate");
  assert.equal(alphaAt(result, 80, 2, 2), 0);
  assert.equal(alphaAt(result, 80, 40, 40), 255);
  assert.ok(result.metrics, "metrics attached on success");
  assert.ok(result.metrics.stripeColRatio <= studio.QUALITY_THRESHOLDS.maxStripeColRatio);
  assert.ok(result.metrics.coreHoleRatio <= studio.QUALITY_THRESHOLDS.maxCoreHoleRatio);
});

test("quality gate: successful output must not keep a rectangular photo seam", () => {
  // Nearly full-frame opaque plate (only a 1px border cleared) = rectangular seam.
  const seam = makeMask(60, 60, (x, y) => x > 0 && x < 59 && y > 0 && y < 59);
  const gate = studio.assessMaskQuality(seam);
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "rectangular-seam");

  // A real successful cut-out has transparent background around the subject —
  // corners and mid-edge background samples must be clear (no rectangular plate).
  const clean = makeImage(70, 70, (x, y) => (x >= 22 && x < 48 && y >= 18 && y < 52 ? [190, 30, 60] : [248, 246, 244]));
  const result = studio.removeBackgroundFromImageData(clean);
  assert.equal(result.ok, true);
  assert.equal(alphaAt(result, 70, 1, 1), 0, "corner transparent");
  assert.equal(alphaAt(result, 70, 35, 2), 0, "top mid background transparent — no rectangular seam");
  assert.equal(alphaAt(result, 70, 2, 35), 0, "left mid background transparent — no rectangular seam");
  assert.equal(alphaAt(result, 70, 35, 35), 255, "subject intact");
});

test("failed removal keeps original semantics and exposes the safe message constants", () => {
  // Busy noise must fail before any cut-out is approved.
  let seed = 7;
  const rand = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return (seed >>> 16) & 0xff; };
  const busy = makeImage(40, 40, () => [rand(), rand(), rand()]);
  const result = studio.removeBackgroundFromImageData(busy);
  assert.equal(result.ok, false);
  assert.equal(studio.FAILURE_MESSAGE, "Background could not be fully removed. Try a cleaner product photo.");
  assert.match(studio.FALLBACK_LABEL, /Background removal was not applied/);
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
  assert.match(prep, /FALLBACK_LABEL/, "labels that background removal was not applied");
  assert.match(prep, /Background could not be fully removed\. Try a cleaner product photo\./, "safe fallback message present");
  assert.match(prep, /Background removal was not applied/, "clear fallback label present");
  assert.match(prep, /shotCutout=null;shotUseCutout=false/, "failure must fall back to the original photo, never a fake cut-out");
  assert.match(prep, /try\{/, "removal errors must be caught so the studio never breaks");
});

test("photo studio module is loaded by the shell", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /photo-studio\.js\?v=ps2/);
  const psIdx = html.indexOf("photo-studio.js");
  const appIdx = html.indexOf("app.js?v=");
  assert.ok(psIdx >= 0 && psIdx < appIdx, "photo-studio.js must load before app.js");
});

test("quality thresholds are exported for launch review", () => {
  const t = studio.QUALITY_THRESHOLDS;
  assert.equal(t.maxEnclosedHoleRatio, 0.04);
  assert.equal(t.maxCoreHoleRatio, 0.16);
  assert.equal(t.maxFragLowerRatio, 0.38);
  assert.equal(t.maxStripeColRatio, 0.2);
  assert.equal(t.maxNearIslandRatio, 0.025);
  assert.equal(t.maxEdgeOpaqueRatio, 0.08);
  assert.equal(t.messySideOpaqueMin, 0.05);
  assert.equal(t.messySideOpaqueMax, 0.7);
  assert.equal(t.rectangularSeamCoverage, 0.93);
  assert.equal(t.rectangularSeamFill, 0.7);
});
