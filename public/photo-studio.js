/**
 * Florisyn Photo Studio — client-side arrangement cut-out.
 *
 * Removes a photo's original background so the bouquet/vase can be composited
 * onto a new studio background. Everything runs in the browser (no external
 * service, no paid API). The approach is edge-connected flood segmentation:
 *
 *   1. Sample the border ring to estimate the background colour. If the border
 *      is not reasonably flat (busy shop/outdoor background), we refuse and
 *      report failure instead of pretending it worked.
 *   2. Flood-fill from every border pixel, clearing pixels whose colour stays
 *      within tolerance of the background estimate. Pixels between `tolerance`
 *      and `tolerance + softness` get a feathered alpha, which keeps natural
 *      soft shadows faintly visible instead of punching hard holes.
 *   3. Interior regions that merely look like the background (white petals,
 *      vase highlights) are preserved because the flood can only travel
 *      through edge-connected background pixels.
 *
 * The core works on plain ImageData-shaped objects so it is unit-testable in
 * Node without a DOM.
 */
(function (global) {
  "use strict";

  var FAILURE_MESSAGE = "Background could not be fully removed. Try a cleaner product photo.";
  var MAX_WORK_EDGE = 1600;

  function colorDistance(data, i, r, g, b) {
    var dr = data[i] - r;
    var dg = data[i + 1] - g;
    var db = data[i + 2] - b;
    return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
  }

  function removeBackgroundFromImageData(imageData, options) {
    options = options || {};
    var width = imageData && imageData.width;
    var height = imageData && imageData.height;
    var src = imageData && imageData.data;
    if (!width || !height || !src || src.length < width * height * 4) {
      return { ok: false, reason: "invalid-image", removedRatio: 0 };
    }
    var tolerance = typeof options.tolerance === "number" ? options.tolerance : 30;
    var softness = typeof options.softness === "number" ? options.softness : 26;
    var maxBorderSpread = typeof options.maxBorderSpread === "number" ? options.maxBorderSpread : 32;
    var total = width * height;

    // Photos that already carry meaningful transparency are treated as cut out.
    var transparent = 0;
    for (var t = 3; t < src.length; t += 4) if (src[t] < 8) transparent++;
    if (transparent / total > 0.08) {
      return {
        ok: true,
        alreadyTransparent: true,
        data: new Uint8ClampedArray(src),
        width: width,
        height: height,
        removedRatio: transparent / total,
      };
    }

    // Estimate background colour from a 2px border ring.
    var ring = 2;
    var n = 0, sr = 0, sg = 0, sb = 0, qr = 0, qg = 0, qb = 0;
    var x, y, i;
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        if (x >= ring && x < width - ring && y >= ring && y < height - ring) continue;
        i = (y * width + x) * 4;
        sr += src[i]; sg += src[i + 1]; sb += src[i + 2];
        qr += src[i] * src[i]; qg += src[i + 1] * src[i + 1]; qb += src[i + 2] * src[i + 2];
        n++;
      }
    }
    var mr = sr / n, mg = sg / n, mb = sb / n;
    var spread = (
      Math.sqrt(Math.max(0, qr / n - mr * mr)) +
      Math.sqrt(Math.max(0, qg / n - mg * mg)) +
      Math.sqrt(Math.max(0, qb / n - mb * mb))
    ) / 3;
    if (spread > maxBorderSpread) {
      return { ok: false, reason: "complex-background", removedRatio: 0, borderSpread: spread };
    }

    // Flood-fill from the border through background-coloured pixels.
    var reach = tolerance + softness;
    var out = new Uint8ClampedArray(src);
    var visited = new Uint8Array(total);
    var queue = new Int32Array(total);
    var head = 0, tail = 0;
    var p, px, py, d, alpha;

    var seed = function (idx) {
      if (visited[idx]) return;
      d = colorDistance(src, idx * 4, mr, mg, mb);
      if (d > reach) return;
      visited[idx] = 1;
      queue[tail++] = idx;
    };
    for (x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
    for (y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }

    while (head < tail) {
      p = queue[head++];
      d = colorDistance(src, p * 4, mr, mg, mb);
      alpha = d <= tolerance ? 0 : Math.min(255, Math.round(((d - tolerance) / softness) * 255));
      if (alpha < out[p * 4 + 3]) out[p * 4 + 3] = alpha;
      px = p % width;
      py = (p - px) / width;
      if (px > 0) seed(p - 1);
      if (px < width - 1) seed(p + 1);
      if (py > 0) seed(p - width);
      if (py < height - 1) seed(p + width);
    }

    var removed = 0;
    for (t = 3; t < out.length; t += 4) if (out[t] < 128) removed++;
    var ratio = removed / total;
    if (ratio < 0.05) {
      return { ok: false, reason: "background-not-detected", removedRatio: ratio };
    }
    if (ratio > 0.985) {
      return { ok: false, reason: "subject-not-found", removedRatio: ratio };
    }
    return { ok: true, data: out, width: width, height: height, removedRatio: ratio };
  }

  /** Browser helper: image/canvas in, cut-out canvas (with alpha) out. */
  function removeBackground(source, options) {
    var w0 = (source && (source.naturalWidth || source.width)) || 0;
    var h0 = (source && (source.naturalHeight || source.height)) || 0;
    if (!w0 || !h0) return { ok: false, reason: "empty-image", removedRatio: 0 };
    var scale = Math.min(1, MAX_WORK_EDGE / Math.max(w0, h0));
    var w = Math.max(1, Math.round(w0 * scale));
    var h = Math.max(1, Math.round(h0 * scale));
    var work = document.createElement("canvas");
    work.width = w;
    work.height = h;
    var ctx = work.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    var imageData;
    try {
      imageData = ctx.getImageData(0, 0, w, h);
    } catch (err) {
      return { ok: false, reason: "canvas-blocked", removedRatio: 0 };
    }
    var result = removeBackgroundFromImageData(imageData, options);
    if (!result.ok) return result;
    ctx.putImageData(new ImageData(result.data, w, h), 0, 0);
    return { ok: true, canvas: work, width: w, height: h, removedRatio: result.removedRatio };
  }

  var api = {
    FAILURE_MESSAGE: FAILURE_MESSAGE,
    MAX_WORK_EDGE: MAX_WORK_EDGE,
    removeBackground: removeBackground,
    removeBackgroundFromImageData: removeBackgroundFromImageData,
  };

  global.FlorisynPhotoStudio = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
