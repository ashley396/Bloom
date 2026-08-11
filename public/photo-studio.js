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
    var maxClusters = typeof options.maxClusters === "number" ? options.maxClusters : 6;
    var clusterLink = typeof options.clusterLink === "number" ? options.clusterLink : 45;
    var minCoverage = typeof options.minCoverage === "number" ? options.minCoverage : 0.55;
    var shareFloor = typeof options.shareFloor === "number" ? options.shareFloor : 0.02;
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

    // Estimate the background from a 2px border ring. Real studio photos have
    // gradients / soft shadow bands on the wall, so we cluster the quantized
    // border colours and accept clusters that chain from the dominant one.
    // Subject petals crossing the frame edge form distant clusters and are
    // rejected, as are busy multi-colour backgrounds (low accepted coverage).
    var ring = 2;
    var n = 0;
    var bins = new Map();
    var x, y, i, key, entry;
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        if (x >= ring && x < width - ring && y >= ring && y < height - ring) continue;
        i = (y * width + x) * 4;
        key = ((src[i] >> 5) << 10) | ((src[i + 1] >> 5) << 5) | (src[i + 2] >> 5);
        entry = bins.get(key);
        if (!entry) { entry = { c: 0, r: 0, g: 0, b: 0 }; bins.set(key, entry); }
        entry.c++; entry.r += src[i]; entry.g += src[i + 1]; entry.b += src[i + 2];
        n++;
      }
    }
    var sorted = [];
    bins.forEach(function (e) { sorted.push(e); });
    sorted.sort(function (a, b) { return b.c - a.c; });

    var clusterDist = function (a, b) {
      var dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
      return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
    };
    var clusters = [];
    var coverage = 0;
    for (var s = 0; s < sorted.length && clusters.length < maxClusters; s++) {
      var mean = { r: sorted[s].r / sorted[s].c, g: sorted[s].g / sorted[s].c, b: sorted[s].b / sorted[s].c };
      var share = sorted[s].c / n;
      if (clusters.length && share < shareFloor) break;
      if (clusters.length) {
        var linked = false;
        for (var c = 0; c < clusters.length; c++) {
          if (clusterDist(mean, clusters[c]) <= clusterLink) { linked = true; break; }
        }
        if (!linked) continue;
      }
      clusters.push(mean);
      coverage += share;
    }
    if (coverage < minCoverage) {
      return { ok: false, reason: "complex-background", removedRatio: 0, borderCoverage: coverage, clusterCount: clusters.length };
    }

    var minDist = function (offset) {
      var best = Infinity, dd;
      for (var c = 0; c < clusters.length; c++) {
        dd = colorDistance(src, offset, clusters[c].r, clusters[c].g, clusters[c].b);
        if (dd < best) best = dd;
      }
      return best;
    };

    // Flood-fill from the border through background-coloured pixels. The flood
    // refuses to cross strong luminance edges (drawn outlines, vase rims), so a
    // white vase sitting on a white pedestal is not hollowed out even though it
    // matches the background colour.
    var reach = tolerance + softness;
    var edgeStop = typeof options.edgeStop === "number" ? options.edgeStop : 10;
    var out = new Uint8ClampedArray(src);
    var visited = new Uint8Array(total);
    var queue = new Int32Array(total);
    var head = 0, tail = 0;
    var p, px, py, d, alpha;

    var seed = function (idx, fromIdx) {
      if (visited[idx]) return;
      if (fromIdx >= 0) {
        var a4 = idx * 4, b4 = fromIdx * 4;
        var step = Math.max(
          Math.abs(src[a4] - src[b4]),
          Math.abs(src[a4 + 1] - src[b4 + 1]),
          Math.abs(src[a4 + 2] - src[b4 + 2])
        );
        if (step > edgeStop) return;
      }
      d = minDist(idx * 4);
      if (d > reach) return;
      visited[idx] = 1;
      queue[tail++] = idx;
    };
    for (x = 0; x < width; x++) { seed(x, -1); seed((height - 1) * width + x, -1); }
    for (y = 0; y < height; y++) { seed(y * width, -1); seed(y * width + width - 1, -1); }

    while (head < tail) {
      p = queue[head++];
      d = minDist(p * 4);
      alpha = d <= tolerance ? 0 : Math.min(255, Math.round(((d - tolerance) / softness) * 255));
      if (alpha < out[p * 4 + 3]) out[p * 4 + 3] = alpha;
      px = p % width;
      py = (p - px) / width;
      if (px > 0) seed(p - 1, p);
      if (px < width - 1) seed(p + 1, p);
      if (py > 0) seed(p - width, p);
      if (py < height - 1) seed(p + width, p);
    }

    // Drop tiny disconnected leftovers (price signs, pedestal marks) that are
    // clearly not part of the main arrangement.
    var minIslandShare = typeof options.minIslandShare === "number" ? options.minIslandShare : 0.01;
    // Components are traced over solid pixels (alpha > 64) so a feathered
    // shadow smear cannot bridge junk to the arrangement and protect it.
    var comp = new Int32Array(total);
    var sizes = [0];
    var label = 0;
    var q2, h2, t2, cpx, cpy;
    for (p = 0; p < total; p++) {
      if (comp[p] || out[p * 4 + 3] <= 64) continue;
      label++;
      sizes.push(0);
      comp[p] = label;
      q2 = queue; q2[0] = p; h2 = 0; t2 = 1;
      while (h2 < t2) {
        var cp = q2[h2++];
        sizes[label]++;
        cpx = cp % width;
        cpy = (cp - cpx) / width;
        var neighbors = [cpx > 0 ? cp - 1 : -1, cpx < width - 1 ? cp + 1 : -1, cpy > 0 ? cp - width : -1, cpy < height - 1 ? cp + width : -1];
        for (var nn = 0; nn < 4; nn++) {
          var np = neighbors[nn];
          if (np >= 0 && !comp[np] && out[np * 4 + 3] > 64) { comp[np] = label; q2[t2++] = np; }
        }
      }
    }
    var largest = 0;
    for (var l = 1; l <= label; l++) if (sizes[l] > largest) largest = sizes[l];
    var minKeep = Math.max(24, Math.round(largest * minIslandShare));
    for (p = 0; p < total; p++) {
      if (comp[p] && sizes[comp[p]] < minKeep) out[p * 4 + 3] = 0;
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
