/**
 * Florisyn Photo Studio — client-side arrangement cut-out.
 *
 * Removes a photo's original background so the bouquet/vase can be composited
 * onto a new studio background. Everything runs in the browser (no external
 * service, no paid API). The approach is edge-connected flood segmentation
 * followed by a strict quality gate so rough masks never appear as success:
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
 *   4. Quality gate — reject side transparent/opaque strips, subject damage
 *      (holes / fragmentation inside the arrangement bbox), leftover islands
 *      near the subject, and rectangular photo-frame seams.
 *
 * Optional HQ path (photo-studio-hq.mjs, lazy-loaded only when the fast flood
 * path fails): local ONNX segmentation via @imgly/background-removal. Images
 * stay on-device; HQ output must still pass assessMaskQuality.
 *
 * The core works on plain ImageData-shaped objects so it is unit-testable in
 * Node without a DOM.
 */
(function (global) {
  "use strict";

  var FAILURE_MESSAGE = "Background could not be fully removed. Try a cleaner product photo.";
  var FALLBACK_LABEL = "Background removal was not applied. Brightness, contrast, and color tools still work on the original photo.";
  var MAX_WORK_EDGE = 1600;

  /** Launch-quality thresholds for the post-removal mask gate. */
  var QUALITY_THRESHOLDS = {
    maxEnclosedHoleRatio: 0.04,
    /* Lower-zone row fragmentation catches eaten vase/base regions without
       punishing natural bouquet silhouettes (narrow vase under a wide head). */
    maxFragLowerRatio: 0.32,
    maxStripeColRatio: 0.2,
    maxNearIslandRatio: 0.025,
    maxEdgeOpaqueRatio: 0.08,
    messySideOpaqueMin: 0.05,
    messySideOpaqueMax: 0.7,
    rectangularSeamCoverage: 0.93,
    rectangularSeamFill: 0.7,
    alphaOpaque: 128,
    stripeFlipMin: 6,
    fragRunMin: 6,
  };

  function colorDistance(data, i, r, g, b) {
    var dr = data[i] - r;
    var dg = data[i + 1] - g;
    var db = data[i + 2] - b;
    return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
  }

  /**
   * Inspect a cut-out mask. Returns { ok, reason?, metrics }.
   * Call after segmentation (or on already-transparent images) so rough masks
   * never surface as approved studio output.
   */
  function assessMaskQuality(imageData, options) {
    options = options || {};
    var width = imageData && imageData.width;
    var height = imageData && imageData.height;
    var data = imageData && imageData.data;
    if (!width || !height || !data || data.length < width * height * 4) {
      return { ok: false, reason: "invalid-image", metrics: {} };
    }
    var t = Object.assign({}, QUALITY_THRESHOLDS, options.thresholds || {});
    var opaqueCut = t.alphaOpaque;
    var total = width * height;
    var minX = width, minY = height, maxX = -1, maxY = -1;
    var opaque = 0;
    var x, y, p, a;

    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        a = data[(y * width + x) * 4 + 3];
        if (a >= opaqueCut) {
          opaque++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || opaque < 16) {
      return { ok: false, reason: "subject-not-found", metrics: { opaque: opaque } };
    }

    var bw = maxX - minX + 1;
    var bh = maxY - minY + 1;
    var bbox = bw * bh;
    var bboxOpaque = 0;
    var inside = new Uint8Array(bbox);
    var idx = function (sx, sy) { return (sy - minY) * bw + (sx - minX); };

    for (y = minY; y <= maxY; y++) {
      for (x = minX; x <= maxX; x++) {
        if (data[(y * width + x) * 4 + 3] >= opaqueCut) bboxOpaque++;
        else inside[idx(x, y)] = 1;
      }
    }

    // Enclosed holes inside the subject bbox (do not touch the bbox border).
    var vis = new Uint8Array(bbox);
    var queue = [];
    var seed = function (sx, sy) {
      if (sx < minX || sx > maxX || sy < minY || sy > maxY) return;
      var i = idx(sx, sy);
      if (!inside[i] || vis[i]) return;
      vis[i] = 1;
      queue.push(sx, sy);
    };
    for (x = minX; x <= maxX; x++) { seed(x, minY); seed(x, maxY); }
    for (y = minY; y <= maxY; y++) { seed(minX, y); seed(maxX, y); }
    for (var qi = 0; qi < queue.length; qi += 2) {
      var qx = queue[qi], qy = queue[qi + 1];
      seed(qx - 1, qy); seed(qx + 1, qy); seed(qx, qy - 1); seed(qx, qy + 1);
    }
    var enclosed = 0;
    for (p = 0; p < bbox; p++) if (inside[p] && !vis[p]) enclosed++;
    var enclosedHoleRatio = enclosed / bbox;

    // Row fragmentation in the lower subject zone (vase / base damage).
    var fragLowerRows = 0, fragLowerCount = 0;
    var lower0 = minY + Math.round(bh * 0.45);
    for (y = lower0; y <= maxY; y++) {
      var runs = 0, prev = null, op;
      for (x = minX; x <= maxX; x++) {
        op = data[(y * width + x) * 4 + 3] >= opaqueCut;
        if (prev === null || op !== prev) { runs++; prev = op; }
      }
      fragLowerCount++;
      if (runs >= t.fragRunMin) fragLowerRows++;
    }
    var fragLowerRatio = fragLowerCount ? fragLowerRows / fragLowerCount : 0;

    // Checker / broken vertical strip columns (many alpha flips).
    var stripeCols = 0;
    for (x = 0; x < width; x++) {
      var flips = 0;
      prev = data[x * 4 + 3] >= opaqueCut;
      for (y = 1; y < height; y++) {
        var cur = data[(y * width + x) * 4 + 3] >= opaqueCut;
        if (cur !== prev) { flips++; prev = cur; }
      }
      if (flips >= t.stripeFlipMin) stripeCols++;
    }
    var stripeColRatio = stripeCols / width;

    // Leftover opaque content in the outer left/right strips.
    var strip = Math.max(3, Math.round(width * 0.05));
    var edgeOp = 0, edgeTot = 0, leftOp = 0, leftTot = 0, rightOp = 0, rightTot = 0;
    for (y = 0; y < height; y++) {
      for (x = 0; x < strip; x++) {
        edgeTot++; leftTot++;
        if (data[(y * width + x) * 4 + 3] >= opaqueCut) { edgeOp++; leftOp++; }
      }
      for (x = width - strip; x < width; x++) {
        edgeTot++; rightTot++;
        if (data[(y * width + x) * 4 + 3] >= opaqueCut) { edgeOp++; rightOp++; }
      }
    }
    var edgeOpaqueRatio = edgeTot ? edgeOp / edgeTot : 0;
    var leftEdgeOpaque = leftTot ? leftOp / leftTot : 0;
    var rightEdgeOpaque = rightTot ? rightOp / rightTot : 0;

    // Connected opaque components — leftover islands near the main subject.
    var comp = new Int32Array(total);
    var sizes = [0];
    var label = 0;
    var q2 = new Int32Array(total);
    for (p = 0; p < total; p++) {
      if (comp[p] || data[p * 4 + 3] < opaqueCut) continue;
      label++;
      sizes[label] = 0;
      var h2 = 0, t2 = 0;
      q2[t2++] = p;
      comp[p] = label;
      while (h2 < t2) {
        var cp = q2[h2++];
        sizes[label]++;
        var cx = cp % width;
        var cy = (cp - cx) / width;
        var neighbors = [
          cx > 0 ? cp - 1 : -1,
          cx < width - 1 ? cp + 1 : -1,
          cy > 0 ? cp - width : -1,
          cy < height - 1 ? cp + width : -1,
        ];
        for (var nn = 0; nn < 4; nn++) {
          var np = neighbors[nn];
          if (np >= 0 && !comp[np] && data[np * 4 + 3] >= opaqueCut) {
            comp[np] = label;
            q2[t2++] = np;
          }
        }
      }
    }
    var largest = 0, largestL = 0;
    for (var l = 1; l <= label; l++) {
      if (sizes[l] > largest) { largest = sizes[l]; largestL = l; }
    }
    var nearIsland = 0;
    var pad = Math.round(Math.max(width, height) * 0.1);
    for (l = 1; l <= label; l++) {
      if (l === largestL) continue;
      var cminX = width, cminY = height, cmaxX = -1, cmaxY = -1;
      for (p = 0; p < total; p++) {
        if (comp[p] !== l) continue;
        cx = p % width;
        cy = (p - cx) / width;
        if (cx < cminX) cminX = cx;
        if (cx > cmaxX) cmaxX = cx;
        if (cy < cminY) cminY = cy;
        if (cy > cmaxY) cmaxY = cy;
      }
      if (!(cmaxX < minX - pad || cminX > maxX + pad || cmaxY < minY - pad || cminY > maxY + pad)) {
        nearIsland += sizes[l];
      }
    }
    var nearIslandRatio = nearIsland / Math.max(1, largest);
    var bboxCoverage = bbox / total;
    var fillRatio = bboxOpaque / bbox;

    var metrics = {
      enclosedHoleRatio: enclosedHoleRatio,
      fragLowerRatio: fragLowerRatio,
      stripeColRatio: stripeColRatio,
      edgeOpaqueRatio: edgeOpaqueRatio,
      leftEdgeOpaque: leftEdgeOpaque,
      rightEdgeOpaque: rightEdgeOpaque,
      nearIslandRatio: nearIslandRatio,
      bboxCoverage: bboxCoverage,
      fillRatio: fillRatio,
      componentCount: label,
      opaque: opaque,
      subjectBBox: { minX: minX, minY: minY, maxX: maxX, maxY: maxY },
    };

    var messySide = function (ratio) {
      return ratio >= t.messySideOpaqueMin && ratio <= t.messySideOpaqueMax;
    };

    // Rectangular photo-frame seam first — a nearly full-frame opaque plate
    // with only a hairline border cleared must never count as a cut-out.
    if (bboxCoverage >= t.rectangularSeamCoverage && fillRatio >= t.rectangularSeamFill) {
      return { ok: false, reason: "rectangular-seam", metrics: metrics };
    }
    if (minX <= 2 && maxX >= width - 3 && minY <= 2 && maxY >= height - 3 && fillRatio >= t.rectangularSeamFill) {
      return { ok: false, reason: "rectangular-seam", metrics: metrics };
    }
    if (stripeColRatio > t.maxStripeColRatio || messySide(leftEdgeOpaque) || messySide(rightEdgeOpaque)) {
      return { ok: false, reason: "side-strip-artifacts", metrics: metrics };
    }
    if (edgeOpaqueRatio > t.maxEdgeOpaqueRatio) {
      return { ok: false, reason: "side-strip-artifacts", metrics: metrics };
    }
    if (enclosedHoleRatio > t.maxEnclosedHoleRatio) {
      return { ok: false, reason: "excessive-subject-holes", metrics: metrics };
    }
    if (fragLowerRatio > t.maxFragLowerRatio) {
      return { ok: false, reason: "subject-damage", metrics: metrics };
    }
    if (nearIslandRatio > t.maxNearIslandRatio) {
      return { ok: false, reason: "leftover-background-islands", metrics: metrics };
    }

    return { ok: true, metrics: metrics };
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
    var skipQualityGate = options.skipQualityGate === true;
    var total = width * height;

    // Photos that already carry meaningful transparency are treated as cut out,
    // but still must pass the quality gate before being shown as success.
    var transparent = 0;
    for (var t = 3; t < src.length; t += 4) if (src[t] < 8) transparent++;
    if (transparent / total > 0.08) {
      var passthrough = {
        ok: true,
        alreadyTransparent: true,
        data: new Uint8ClampedArray(src),
        width: width,
        height: height,
        removedRatio: transparent / total,
      };
      if (!skipQualityGate) {
        var passGate = assessMaskQuality(passthrough, options);
        if (!passGate.ok) {
          return {
            ok: false,
            reason: passGate.reason || "mask-quality",
            removedRatio: passthrough.removedRatio,
            metrics: passGate.metrics,
          };
        }
        passthrough.metrics = passGate.metrics;
      }
      return passthrough;
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

    var seedFlood = function (idxFlood, fromIdx) {
      if (visited[idxFlood]) return;
      if (fromIdx >= 0) {
        var a4 = idxFlood * 4, b4 = fromIdx * 4;
        var step = Math.max(
          Math.abs(src[a4] - src[b4]),
          Math.abs(src[a4 + 1] - src[b4 + 1]),
          Math.abs(src[a4 + 2] - src[b4 + 2])
        );
        if (step > edgeStop) return;
      }
      d = minDist(idxFlood * 4);
      if (d > reach) return;
      visited[idxFlood] = 1;
      queue[tail++] = idxFlood;
    };
    for (x = 0; x < width; x++) { seedFlood(x, -1); seedFlood((height - 1) * width + x, -1); }
    for (y = 0; y < height; y++) { seedFlood(y * width, -1); seedFlood(y * width + width - 1, -1); }

    while (head < tail) {
      p = queue[head++];
      d = minDist(p * 4);
      alpha = d <= tolerance ? 0 : Math.min(255, Math.round(((d - tolerance) / softness) * 255));
      if (alpha < out[p * 4 + 3]) out[p * 4 + 3] = alpha;
      px = p % width;
      py = (p - px) / width;
      if (px > 0) seedFlood(p - 1, p);
      if (px < width - 1) seedFlood(p + 1, p);
      if (py > 0) seedFlood(p - width, p);
      if (py < height - 1) seedFlood(p + width, p);
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

    var candidate = { ok: true, data: out, width: width, height: height, removedRatio: ratio };
    if (!skipQualityGate) {
      var gate = assessMaskQuality(candidate, options);
      if (!gate.ok) {
        return {
          ok: false,
          reason: gate.reason || "mask-quality",
          removedRatio: ratio,
          metrics: gate.metrics,
        };
      }
      candidate.metrics = gate.metrics;
    }
    return candidate;
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
    return {
      ok: true,
      canvas: work,
      width: w,
      height: h,
      removedRatio: result.removedRatio,
      metrics: result.metrics,
    };
  }

  var api = {
    FAILURE_MESSAGE: FAILURE_MESSAGE,
    FALLBACK_LABEL: FALLBACK_LABEL,
    MAX_WORK_EDGE: MAX_WORK_EDGE,
    QUALITY_THRESHOLDS: QUALITY_THRESHOLDS,
    assessMaskQuality: assessMaskQuality,
    removeBackground: removeBackground,
    removeBackgroundFromImageData: removeBackgroundFromImageData,
  };

  global.FlorisynPhotoStudio = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
