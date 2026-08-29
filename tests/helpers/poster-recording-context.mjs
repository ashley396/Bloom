/**
 * The one recording canvas the poster's geometry is checked against — shared
 * by tests/flyer-poster.test.js and scripts/poster-sweep.mjs rather than
 * copied into each. A second copy is how a harness quietly stops matching the
 * one that found the bug: the sweep that first caught a flourish running off
 * the sheet could not see text bounds at all, because it was a different
 * context from the one the tests used.
 *
 * What it is NOT: a font engine. Character widths are a flat 0.52em and
 * Parisienne is nothing like that, so every result here is a GEOMETRY check
 * against synthetic metrics — evidence that a layout rule holds, never proof
 * of how a rendered poster looks. Real type is checked in a browser.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * Loads the poster layer the way a browser does — renderer first, poster
 * second, into one sandbox, since the poster borrows the renderer's own pure
 * helpers rather than carrying a second copy of them.
 */
export function loadPoster(root = process.cwd()) {
  const sandbox = { module: { exports: {} }, globalThis: {}, document: undefined };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/flyer-renderer.js"), "utf8"), sandbox);
  sandbox.module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/flyer-poster.js"), "utf8"), sandbox);
  return { poster: sandbox.module.exports, renderer: sandbox.FlorisynFlyerRenderer };
}

export function recordingContext(width, height) {
  const texts = [], fills = [];
  // Every point any path passes through, and every cubic curve drawn. A
  // context that records only fillText cannot see a decoration: the sparkle
  // flourish ran clean off the right edge of the sheet and nothing could see
  // it. drawHeart is the only thing in the poster that uses bezierCurveTo,
  // which is what makes hearts countable.
  const points = [], beziers = [], gradients = [], strokes = [];
  const at = (x, y) => { points.push({ x, y }); };
  let font = "16px serif", fillStyle = null, textAlign = "center", tracking = 0;
  const sizeOf = () => { const m = /([0-9.]+)px/.exec(font); return m ? parseFloat(m[1]) : 16; };
  // Tracking counts, and a real canvas adds it after every character.
  const widthOf = (t) => String(t).length * (sizeOf() * 0.52 + tracking);
  const ctx = {
    texts, fills, points, beziers, gradients, strokes, canvas: { width, height },
    save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {},
    moveTo: at, lineTo: at, rect() {}, ellipse: at, arc: at,
    quadraticCurveTo(cx1, cy1, x, y) { at(x, y); },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) { beziers.push({ x, y }); at(x, y); },
    fill() { fills.push(fillStyle); }, stroke() { strokes.push(true); },
    fillRect() {}, strokeRect(x, y, w2, h2) { strokes.push(true); at(x, y); at(x + w2, y + h2); }, clearRect() {}, drawImage() {},
    createLinearGradient() {
      var stops = [];
      gradients.push(stops);
      return { addColorStop(offset, color) { stops.push({ offset, color }); } };
    },
    createRadialGradient() { return { addColorStop() {} }; },
    getImageData() { return { width: 1, height: 1, data: new Uint8ClampedArray(4) }; },
    measureText(t) {
      const s = sizeOf();
      return { width: widthOf(t), actualBoundingBoxAscent: s * 0.72, actualBoundingBoxDescent: s * 0.22 };
    },
    fillText(t, x, y) {
      const s = sizeOf();
      const width = widthOf(t);
      // Bounds depend on the alignment in force. Treating a left-aligned draw
      // as centred reports it half its width away from where it really is —
      // which both hid a real overflow and invented false ones.
      const left = textAlign === "left" ? x : (textAlign === "right" ? x - width : x - width / 2);
      texts.push({ text: String(t), x, y, width, size: s, color: fillStyle, left, right: left + width });
    }
  };
  Object.defineProperty(ctx, "font", { get: () => font, set: (v) => { font = v; } });
  Object.defineProperty(ctx, "letterSpacing", {
    get: () => `${tracking}px`,
    set: (v) => {
      // A real canvas includes letter-spacing in measureText and in what it
      // paints; stubbing it to a no-op made every measurement here optimistic
      // by 5-20% on the capitalised lines, which are set at 0.05-0.2em. An
      // off-sheet check against a context that under-measures is not a check.
      const m = /^(-?[0-9.]+)(px|em)$/.exec(String(v || "0px"));
      tracking = m ? (m[2] === "em" ? parseFloat(m[1]) * sizeOf() : parseFloat(m[1])) : 0;
    }
  });
  Object.defineProperty(ctx, "fillStyle", { get: () => fillStyle, set: (v) => { fillStyle = v; } });
  Object.defineProperty(ctx, "textAlign", { get: () => textAlign, set: (v) => { textAlign = v; } });
  for (const k of ["strokeStyle", "lineWidth", "globalAlpha", "textBaseline", "lineCap", "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY", "globalCompositeOperation"]) {
    Object.defineProperty(ctx, k, { get: () => null, set: () => {} });
  }
  return ctx;
}

/** Everything drawn outside the sheet, type and ornament alike. Pure. */
export function offSheet(ctx, width, height) {
  const out = [];
  for (const p of ctx.points) {
    if (p.x < -1 || p.x > width + 1 || p.y < -1 || p.y > height + 1) {
      out.push({ kind: "path", x: Math.round(p.x), y: Math.round(p.y) });
    }
  }
  for (const t of ctx.texts) {
    // The descender matters: a baseline inside the sheet with its tails cut
    // off by the edge is still a line a florist cannot read.
    const bottom = t.y + t.size * 0.22;
    if (t.left < -1 || t.right > width + 1 || bottom > height + 1 || t.y - t.size * 0.72 < -1) {
      out.push({ kind: "text", text: t.text, left: Math.round(t.left), right: Math.round(t.right), y: Math.round(t.y) });
    }
  }
  return out;
}
