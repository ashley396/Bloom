/**
 * Florisyn Poster Compositions — the designed-poster layer for the flyer
 * renderer.
 *
 * Why this exists: the existing renderer draws text over a full-bleed
 * photograph. That is correct and safe, and it is not what a florist's
 * marketing actually looks like. A real florist poster is COMPOSED — a
 * light ground, botanical framing rather than a backdrop, a rule border, a
 * script/serif type pairing, a ribbon carrying the one fact that matters,
 * and a bordered panel for the phone number. Ashley's own reference is
 * exactly that, and it is a layout, not an AI photograph.
 *
 * This is a composition layer, NOT a second renderer. Every measurement,
 * wrap, fit, contrast and phone-formatting decision still comes from
 * public/flyer-renderer.js's own exported helpers — there is one set of
 * those and this file borrows them. What it adds is design vocabulary the
 * renderer never had: grounds, borders, ribbons, panels, ornaments, a
 * script display face, and a palette derived from the actual flowers.
 *
 * Two hard rules carried over unchanged from the renderer:
 *   1. Wording is never invented or altered here. This file receives the
 *      exact deterministic strings and draws them; it has no opinion about
 *      what they say.
 *   2. The shop identified is always the authenticated shop's own.
 *
 * Fonts are ones the product already ships and already loads on the
 * Marketing Studio page (platform-v21.1.css imports Parisienne, Playfair
 * Display and DM Sans) — nothing new is introduced.
 */
(function (global) {
  "use strict";

  var R = global.FlorisynFlyerRenderer;

  /** Deterministic 32-bit hash → a stable seed from any string. Pure. */
  function hashSeed(value) {
    var s = String(value == null ? "" : value);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** A small deterministic PRNG so one seed reproduces one poster exactly —
   * "Regenerate" varies because the SEED changes, never because the draw is
   * random. Same seed in, same poster out, every time. Pure. */
  function seededRandom(seed) {
    var state = (seed >>> 0) || 1;
    return function next() {
      state ^= state << 13; state >>>= 0;
      state ^= state >> 17;
      state ^= state << 5;  state >>>= 0;
      return state / 4294967296;
    };
  }

  // --- colour ---------------------------------------------------------------

  function clamp255(n) { return Math.max(0, Math.min(255, Math.round(n))); }

  function hexToRgb(hex) {
    var h = String(hex || "#8f3f68").replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    return {
      r: parseInt(h.substring(0, 2), 16) || 0,
      g: parseInt(h.substring(2, 4), 16) || 0,
      b: parseInt(h.substring(4, 6), 16) || 0
    };
  }

  function rgbToHex(c) {
    function p(n) { var s = clamp255(n).toString(16); return s.length === 1 ? "0" + s : s; }
    return "#" + p(c.r) + p(c.g) + p(c.b);
  }

  function mix(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
  }

  function rgba(hex, alpha) {
    var c = hexToRgb(hex);
    return "rgba(" + clamp255(c.r) + "," + clamp255(c.g) + "," + clamp255(c.b) + "," + alpha + ")";
  }

  /** Relative luminance, borrowed from the renderer so both layers agree. */
  function luminance(c) {
    return R.relativeLuminance(c.r, c.g, c.b);
  }

  /** WCAG-style contrast ratio between two rgb colours. Pure. */
  function contrastRatio(a, b) {
    var la = luminance(a), lb = luminance(b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** WCAG AA for normal-size text. The body and contact lines are normal
   * size, so this is the bar the shop's ink has to clear on its own ground. */
  var INK_GROUND_MIN_CONTRAST = 4.5;

  /**
   * The poster's palette, derived from the ACTUAL flowers plus the shop's
   * own brand colour.
   *
   * Ashley's requirement, in her words: it has to "match the flower colour
   * wise". So the ink is not simply the brand colour — it is the brand
   * colour pulled toward the dominant floral hue, and the ground is a very
   * pale tint of that same hue. A pink-and-cream bouquet yields a blush
   * poster; a sunflower bouquet yields a warm gold one. The brand colour
   * keeps it recognisably this shop's; the photo keeps it matched.
   *
   * `sample` is {r,g,b} averaged from the real drawn pixels, or null when
   * there is no photo to sample — in which case the brand colour alone
   * decides and nothing is invented. Pure.
   */
  function derivePalette(brandPrimary, brandAccent, sample) {
    var brand = hexToRgb(brandPrimary || "#8f3f68");
    var accent = hexToRgb(brandAccent || "#6f8f72");

    // Pull the brand colour toward the flowers, but never so far that the
    // shop stops looking like itself.
    var ink = sample ? mix(brand, sample, 0.22) : brand;

    var tintSource = sample || brand;
    var ground = mix({ r: 255, g: 253, b: 251 }, tintSource, 0.055);
    var groundDeep = mix({ r: 255, g: 253, b: 251 }, tintSource, 0.13);

    // The ink must actually READ on this shop's own ground — measured, not
    // assumed. A flat luminance cap was the wrong test: a sage, gold, grey
    // or dusty-rose brand can pass a cap of 0.24 and still land under 4:1
    // against the pale ground. Every one of those shops then tripped the
    // ribbon's contrast safety net on EVERY line, over open ground with no
    // flowers anywhere near it — which is the filled-box look that was
    // already rejected, appearing for every shop except the plum default.
    // 4.5:1 is WCAG AA for normal-size text, which is what the body and
    // contact lines are; darken toward black until the shop's own colour
    // genuinely clears it.
    for (var guard = 0; guard < 40 && contrastRatio(ink, groundDeep) < INK_GROUND_MIN_CONTRAST; guard++) {
      ink = mix(ink, { r: 0, g: 0, b: 0 }, 0.12);
    }

    return {
      ink: rgbToHex(ink),
      inkSoft: rgbToHex(mix(ink, { r: 255, g: 255, b: 255 }, 0.3)),
      accent: rgbToHex(accent),
      ground: rgbToHex(ground),
      groundDeep: rgbToHex(groundDeep),
      cream: "#fffaf4"
    };
  }

  // --- ground + botanical framing -------------------------------------------

  /**
   * Draws the photograph as botanical FRAMING on a light ground rather than
   * as a full-bleed backdrop: soft clusters bleeding in from two opposite
   * corners, faded out toward the centre where the words live.
   *
   * This is the structural difference between a poster and a caption over a
   * picture, and it is why the text area stays calm without any wash, panel
   * or overlay being painted on top of the flowers — there are simply no
   * flowers in the middle to fight with.
   */
  function paintGroundAndFlorals(ctx, w, h, img, palette, rand) {
    ctx.save();
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, palette.groundDeep);
    g.addColorStop(0.45, palette.ground);
    g.addColorStop(1, palette.groundDeep);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    if (!img) return [];

    // Two diagonally opposite corners, chosen by the seed so successive
    // posters for the same shop genuinely differ.
    var flip = rand() > 0.5;
    var corners = flip
      ? [{ x: 0, y: 0, ax: 0, ay: 0 }, { x: w, y: h, ax: 1, ay: 1 }]
      : [{ x: w, y: 0, ax: 1, ay: 0 }, { x: 0, y: h, ax: 0, ay: 1 }];

    var size = Math.round(Math.min(w, h) * (0.62 + rand() * 0.08));

    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      var layer = document.createElement("canvas");
      layer.width = size;
      layer.height = size;
      var lx = layer.getContext("2d");

      // Cover-fill the layer with the photo, taking a different crop per
      // corner so the two clusters are not mirror images of each other.
      var scale = Math.max(size / img.width, size / img.height);
      var dw = img.width * scale, dh = img.height * scale;
      var offX = (size - dw) * (i === 0 ? 0.15 : 0.85);
      var offY = (size - dh) * (i === 0 ? 0.1 : 0.9);
      lx.drawImage(img, offX, offY, dw, dh);

      // Fade the cluster out toward the middle of the poster.
      lx.globalCompositeOperation = "destination-in";
      var mask = lx.createRadialGradient(
        c.ax * size, c.ay * size, size * 0.06,
        c.ax * size, c.ay * size, size * 0.92
      );
      mask.addColorStop(0, "rgba(0,0,0,1)");
      mask.addColorStop(0.5, "rgba(0,0,0,0.92)");
      mask.addColorStop(0.78, "rgba(0,0,0,0.35)");
      mask.addColorStop(1, "rgba(0,0,0,0)");
      lx.fillStyle = mask;
      lx.fillRect(0, 0, size, size);

      ctx.save();
      ctx.globalAlpha = 0.97;
      ctx.drawImage(layer, c.x - c.ax * size, c.y - c.ay * size, size, size);
      ctx.restore();
    }

    // Report where the petals actually are, in poster coordinates. The mask
    // is anchored at (c.x, c.y); its 0.35-alpha stop is at gradient offset
    // 0.78, which is NOT a radius fraction — the gradient runs from
    // 0.06 * size to 0.92 * size, so that offset sits at
    // 0.06 + 0.78 * 0.86 = 0.731 * size. Reading the stop as a radius
    // over-reported the flowers by ~7%. This is the fallback the ribbon
    // decision uses when the canvas cannot be read back.
    var r0 = 0.06, r1 = 0.92, alphaStop = 0.78;
    return corners.map(function (c) {
      return { x: c.x, y: c.y, radius: size * (r0 + alphaStop * (r1 - r0)) };
    });
  }

  // --- ornament -------------------------------------------------------------

  /** A restrained double rule inset from the edge. Not a heavy frame — a
   * hairline pair, the way a printed card is bordered. */
  function drawBorder(ctx, w, h, palette, variant) {
    var inset = Math.round(Math.min(w, h) * 0.038);
    ctx.save();
    ctx.strokeStyle = rgba(palette.ink, 0.55);
    ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.0022);
    ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    if (variant !== "single") {
      var gap = Math.round(Math.min(w, h) * 0.011);
      ctx.strokeStyle = rgba(palette.ink, 0.3);
      ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.0013);
      ctx.strokeRect(inset + gap, inset + gap, w - (inset + gap) * 2, h - (inset + gap) * 2);
    }
    ctx.restore();
  }

  /** A small centred flourish — a rule with a diamond at its middle. Used
   * to separate the shop name from the message the way a printed card does. */
  function drawFlourish(ctx, cx, y, width, palette) {
    ctx.save();
    ctx.strokeStyle = rgba(palette.ink, 0.5);
    ctx.lineWidth = Math.max(1, width * 0.006);
    var gap = width * 0.08;
    ctx.beginPath();
    ctx.moveTo(cx - width / 2, y);
    ctx.lineTo(cx - gap, y);
    ctx.moveTo(cx + gap, y);
    ctx.lineTo(cx + width / 2, y);
    ctx.stroke();
    var d = width * 0.022;
    ctx.fillStyle = rgba(palette.ink, 0.55);
    ctx.beginPath();
    ctx.moveTo(cx, y - d);
    ctx.lineTo(cx + d, y);
    ctx.lineTo(cx, y + d);
    ctx.lineTo(cx - d, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** The ribbon banner that carries the one fact that matters — a closing
   * time, a deadline. A filled shape with notched ends, in the poster's ink,
   * with cream text on it. This is a deliberate exception to "no filled
   * shapes": it is a compositional device sitting on a light ground, never
   * a wash laid over the flowers. */
  function drawRibbon(ctx, cx, cy, w, h, palette, opts) {
    opts = opts || {};
    var notch = typeof opts.notch === "number" ? opts.notch : h * 0.32;
    ctx.save();
    ctx.fillStyle = opts.fill || palette.ink;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy - h / 2);
    ctx.lineTo(cx + w / 2 - notch, cy);
    ctx.lineTo(cx + w / 2, cy + h / 2);
    ctx.lineTo(cx - w / 2, cy + h / 2);
    ctx.lineTo(cx - w / 2 + notch, cy);
    ctx.closePath();
    ctx.fill();
    if (opts.stroke) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = opts.lineWidth || Math.max(1, h * 0.03);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- wording that lands on flowers ---------------------------------------

  /**
   * Ashley's correction, in her own words: "if the wording is on top of
   * flowers you probably need a small ribbon behind it."
   *
   * The corner clusters bleed inward, so a long shop name or a wrapped
   * message can reach into them even though the middle of the poster is
   * kept calm by design. Where that happens the line gets its own small
   * cream ribbon — sized to that one line, with notched ends and a hairline
   * edge, the way a printed poster carries a banner.
   *
   * What this deliberately is NOT: a ribbon behind every line. A ribbon
   * everywhere is the filled-panel look that was already rejected, and it
   * would flatten the composition back into text-in-a-box. Each line is
   * judged against the pixels actually underneath it, so lines sitting on
   * calm ground stay bare.
   */
  var CELL_VARIANCE_THRESHOLD = 26;     // luminance spread within one cell, 0-255
  var BUSY_FRACTION_THRESHOLD = 0.28;   // how much of the line must be on flowers
  var RIBBON_CONTRAST_FLOOR = 3;        // WCAG AA for large text; the ink already clears 4.5 on its own ground
  var RIBBON_OVERLAP_THRESHOLD = 0.2;   // fraction of the line inside a cluster

  /**
   * The band a hugging ribbon occupies for one measured line, plus the
   * glyph box to sample. Sized from the real glyph extent rather than the
   * font size, so it hugs a 200px script word and a 40px message line
   * equally tightly instead of becoming a slab behind the big one. Pure.
   */
  function ribbonBand(m) {
    var asc = m.ascent > 0 ? m.ascent : m.fontSize * 0.72;
    var desc = m.descent > 0 ? m.descent : m.fontSize * 0.24;
    // Padding follows the GLYPHS, not the em box. Derived from font size
    // alone it put 52px of cream above and below a 64px run of capitals —
    // a slab 2.6x the height of the thing it was protecting, which is the
    // filled-panel look under another name. Capped so a big script word
    // still gets a proportionate band, floored so small type keeps air.
    var pad = Math.min(m.fontSize * 0.26, Math.max(m.fontSize * 0.1, (asc + desc) * 0.3));
    var top = m.baselineY - asc - pad;
    var bottom = m.baselineY + desc + pad;
    var h = bottom - top;
    var glyphTop = m.baselineY - asc;
    // The notch eats into both ends, so the text needs clearance past it or
    // the first and last glyphs sit on the cut corner.
    var notch = Math.min(h * 0.32, m.fontSize * 0.42);
    var w = m.textWidth + notch * 2 + m.fontSize * 0.7;
    if (m.maxWidth > 0) w = Math.min(w, m.maxWidth);
    // Clamping the width does not shrink the notches with it, so a long
    // headline fitted near the limit had its first and last glyphs hanging
    // off the cut corners entirely. The notch yields to the text, not the
    // other way round.
    if (m.textWidth + notch * 2 > w) notch = Math.max(0, (w - m.textWidth) * 0.3);
    // Never crowd the line above. Bands are taller than the line pitch for
    // text with descenders, so two ribboned lines in a row overlapped by
    // construction — and a ribbon drawn for a lower line painted over the
    // glyphs of one already drawn above it. Text is drawn correctly and then
    // buried, which no call-site check would ever catch.
    if (m.ceiling > top) {
      top = m.ceiling;
      h = Math.max(0, bottom - top);
    }
    return {
      cx: m.cx,
      cy: (top + bottom) / 2,
      w: w,
      h: h,
      notch: notch,
      // A band clipped so hard it no longer covers the glyphs cannot protect
      // the line; the caller must skip it rather than draw a useless sliver.
      protects: h > 0 && top <= glyphTop && bottom >= m.baselineY + desc,
      probe: {
        x: m.cx - m.textWidth / 2,
        y: m.baselineY - asc,
        w: m.textWidth,
        h: asc + desc
      }
    };
  }

  /**
   * How much of a rectangle falls inside the floral clusters, from their
   * real reported geometry. This is the fallback path: when the photo taints
   * the canvas, getImageData throws and there are no pixels to judge — but
   * the flowers are still drawn and the wording still has to stay readable.
   * Guessing "no flowers" there would silently reintroduce the defect. Pure.
   */
  function floralOverlap(rect, clusters) {
    if (!clusters || !clusters.length || !rect) return 0;
    var inside = 0, total = 0;
    for (var gy = 0; gy <= 4; gy++) {
      for (var gx = 0; gx <= 4; gx++) {
        var px = rect.x + rect.w * (gx / 4);
        var py = rect.y + rect.h * (gy / 4);
        total++;
        for (var i = 0; i < clusters.length; i++) {
          var dx = px - clusters[i].x, dy = py - clusters[i].y;
          if (Math.sqrt(dx * dx + dy * dy) <= clusters[i].radius) { inside++; break; }
        }
      }
    }
    return total ? inside / total : 0;
  }

  /**
   * How much of a line is actually sitting on flowers, measured cell by cell.
   *
   * Spread across the WHOLE band is the wrong question: it is a max-minus-min,
   * so one petal clipping a single corner of a 700px-wide headline scores as
   * high as a headline buried in the bouquet, and the big script word got a
   * slab behind it while lying on clean ground. Tiling the band and asking
   * how MANY cells are busy answers the question Ashley actually asked —
   * is the wording on top of flowers — instead of "does this band contain a
   * flower anywhere".
   */
  function busyFraction(probe, rect) {
    if (!probe || !rect || rect.w <= 0 || rect.h <= 0) return 0;
    var cols = 8, rows = 3, cells = cols * rows, busy = 0, seen = 0;
    var cw = rect.w / cols, ch = rect.h / rows;
    var need = Math.ceil(cells * BUSY_FRACTION_THRESHOLD);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        seen++;
        if (R.sampleColorVariance(probe, { x: rect.x + c * cw, y: rect.y + r * ch, w: cw, h: ch }, 3)
            >= CELL_VARIANCE_THRESHOLD) busy++;
        // Every luminance costs three Math.pow calls, and this runs for every
        // line of every poster on the florist's phone. Stop as soon as the
        // verdict is settled either way.
        if (busy >= need) return busy / seen;
        if (busy + (cells - seen) < need) return busy / cells;
      }
    }
    return busy / cells;
  }

  /**
   * Whether one line needs a ribbon behind it. Two independent reasons, both
   * measured from the real drawn result:
   *   - enough of the line is BUSY (petals, leaves, shadows). A calm ground is
   *     one smooth vertical tint, so its cells score near zero;
   *   - or the pixels are calm but too close to the ink to read against.
   */
  function needsRibbonBehind(ground, rect, inkHex, alpha) {
    if (!ground || !rect) return false;
    if (ground.probe) {
      if (busyFraction(ground.probe, rect) >= BUSY_FRACTION_THRESHOLD) return true;
      // Most lines are drawn at less than full opacity, so full-opacity ink
      // overstates their real contrast. Composite the ink over what is
      // actually behind and measure THAT, which is what a reader sees.
      var behind = R.sampleAverageColor(ground.probe, rect, 3);
      var a = typeof alpha === "number" ? alpha : 1;
      var drawn = a >= 1 ? hexToRgb(inkHex) : mix(behind, hexToRgb(inkHex), a);
      return contrastRatio(behind, drawn) < RIBBON_CONTRAST_FLOOR;
    }
    return floralOverlap(rect, ground.clusters) >= RIBBON_OVERLAP_THRESHOLD;
  }

  /** The alpha a CSS colour string will actually paint at. Pure. */
  function colorAlpha(color) {
    var m = /^rgba\s*\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)$/.exec(String(color || ""));
    return m ? Math.max(0, Math.min(1, parseFloat(m[1]))) : 1;
  }

  /** Snapshots the ground BEFORE any wording is drawn, so every line is
   * judged against the flowers and never against a ribbon or a line drawn
   * above it. */
  function captureGround(ctx, w, h, clusters) {
    var probe = null;
    try { probe = ctx.getImageData(0, 0, w, h); } catch (e) { probe = null; }
    return { probe: probe, clusters: clusters || [], maxRibbonWidth: ribbonWidthLimit(w, h) };
  }

  /** The widest a ribbon may be: inside the border rules with clear air, not
   * merely inside the sheet. Derived from the same insets drawBorder uses, so
   * the two can never drift apart. Pure. */
  function ribbonWidthLimit(w, h) {
    var m = Math.min(w, h);
    var inset = Math.round(m * 0.038);
    var gap = Math.round(m * 0.011);
    var clear = m * 0.022;
    return Math.max(w * 0.4, w - (inset + gap + clear) * 2);
  }

  /**
   * Draws one centred line, laying a small ribbon behind it first if it
   * lands on flowers. The line keeps its intended ink colour either way —
   * the ribbon is cream, so the poster's own voice never changes just
   * because a petal happened to be underneath.
   */
  function placeLine(ctx, ground, text, cx, baselineY, fontSize, palette, color) {
    if (!text) return false;
    var ribboned = false;
    var m = ctx.measureText(text);
    var desc = m.actualBoundingBoxDescent || fontSize * 0.24;
    if (ground) {
      var band = ribbonBand({
        textWidth: m.width,
        ascent: m.actualBoundingBoxAscent || 0,
        descent: m.actualBoundingBoxDescent || 0,
        fontSize: fontSize,
        baselineY: baselineY,
        cx: cx,
        maxWidth: ground.maxRibbonWidth,
        // Nothing may be painted back over what has already been drawn.
        ceiling: typeof ground.lastBottom === "number" ? ground.lastBottom : -Infinity
      });
      if (band.protects && needsRibbonBehind(ground, band.probe, palette.ink, colorAlpha(color))) {
        drawRibbon(ctx, band.cx, band.cy, band.w, band.h, palette, {
          fill: rgba(palette.cream, 0.94),
          stroke: rgba(palette.ink, 0.42),
          lineWidth: Math.max(1, band.h * 0.028),
          notch: band.notch
        });
        ribboned = true;
        ground.lastBottom = band.cy + band.h / 2;
      }
    }
    centreText(ctx, text, cx, baselineY, color);
    if (ground) {
      ground.lastBottom = Math.max(
        typeof ground.lastBottom === "number" ? ground.lastBottom : -Infinity,
        baselineY + desc
      );
    }
    return ribboned;
  }

  /** The CTA panel — a thin bordered card on the ground, never a filled box
   * over the photograph. */
  function drawPanel(ctx, x, y, w, h, palette) {
    ctx.save();
    ctx.fillStyle = rgba(palette.cream, 0.72);
    ctx.strokeStyle = rgba(palette.ink, 0.45);
    ctx.lineWidth = Math.max(1.2, w * 0.0022);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // --- type -----------------------------------------------------------------

  /** Shrinks a single line until it fits `maxWidth`, honouring a floor.
   * Mirrors the renderer's own fit discipline rather than inventing another. */
  function fitLine(ctx, text, font, size, maxWidth, minSize) {
    var s = size;
    for (var i = 0; i < 24; i++) {
      ctx.font = font.replace("%s", s);
      if (ctx.measureText(text).width <= maxWidth || s <= minSize) break;
      s = Math.floor(s * 0.94);
    }
    return s;
  }

  function centreText(ctx, text, cx, y, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, cx, y);
    ctx.restore();
  }

  /**
   * Splits a headline into a plain lead and one emphasised word, so the
   * poster can set the emotive word in script the way Ashley's reference
   * does ("WILL BE" over a script "Closing").
   *
   * Chooses the LAST significant word, which for these headlines is the one
   * carrying the meaning — "Closing Early Today" → "Closing Early" + script
   * "Today" would be wrong, so words that are merely temporal are skipped
   * in favour of the real subject. Never rewrites, never reorders: the same
   * words in the same order, only set differently. Pure.
   */
  var TEMPORAL_WORDS = /^(today|tomorrow|tonight|now|soon|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
  function splitHeadline(headline) {
    var words = String(headline || "").trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return { lead: "", script: words.join(" "), tail: "" };
    // The FIRST significant word is the one carrying the message — a
    // poster sets "Closing" in script and lets "Early Today" qualify it,
    // not the other way round. Picking the last significant word instead
    // scripted "Early", which reads as emphasis on the wrong idea.
    var idx = -1;
    for (var i = 0; i < words.length; i++) {
      if (!TEMPORAL_WORDS.test(words[i])) { idx = i; break; }
    }
    if (idx < 0) idx = 0;
    return {
      lead: words.slice(0, idx).join(" "),
      script: words[idx],
      tail: words.slice(idx + 1).join(" ")
    };
  }

  // --- the composition ------------------------------------------------------

  var COMPOSITIONS = ["atelier", "card", "banner"];

  /**
   * Draws one complete poster.
   *
   * `content` carries the exact deterministic strings; nothing here edits
   * them. `seed` selects the composition, the corner flip, the border
   * variant and the ornament — so the same asset re-renders identically and
   * a regenerate produces a genuinely different design rather than the same
   * one re-rolled.
   */
  function drawPoster(ctx, opts) {
    var w = opts.width, h = opts.height;
    var content = opts.content || {};
    var brand = opts.brand || {};
    var palette = opts.palette;
    var rand = seededRandom(hashSeed("florisyn-poster:" + opts.seed));
    var composition = COMPOSITIONS[Math.floor(rand() * COMPOSITIONS.length) % COMPOSITIONS.length];
    var cx = w / 2;
    var margin = w * 0.11;
    var maxW = w - margin * 2;

    var clusters = paintGroundAndFlorals(ctx, w, h, opts.image, palette, rand);
    drawBorder(ctx, w, h, palette, rand() > 0.45 ? "double" : "single");

    // Snapshot the ground now, while it is only ground. Every ribbon
    // decision below reads these pixels, so no line is ever judged against
    // another line's ribbon.
    var ground = captureGround(ctx, w, h, clusters);

    var y = h * 0.145;

    // --- shop name (always drawn; the authenticated shop's own) ---
    if (brand.shopName) {
      var nameSize = fitLine(
        ctx,
        String(brand.shopName).toUpperCase(),
        "600 %spx 'Playfair Display', Georgia, serif",
        Math.round(h * 0.042),
        maxW * 0.9,
        Math.round(h * 0.02)
      );
      ctx.font = "600 " + nameSize + "px 'Playfair Display', Georgia, serif";
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0.18em";
      placeLine(ctx, ground, String(brand.shopName).toUpperCase(), cx, y, nameSize, palette, palette.ink);
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      y += nameSize * 0.75;
      drawFlourish(ctx, cx, y, w * 0.3, palette);
      y += h * 0.055;
    }

    // --- headline: plain lead + one script word ---
    var parts = splitHeadline(content.headline);
    if (parts.lead) {
      var leadSize = fitLine(
        ctx, parts.lead.toUpperCase(),
        "600 %spx 'Playfair Display', Georgia, serif",
        Math.round(h * 0.062), maxW * 0.86, Math.round(h * 0.03)
      );
      ctx.font = "600 " + leadSize + "px 'Playfair Display', Georgia, serif";
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0.06em";
      placeLine(ctx, ground, parts.lead.toUpperCase(), cx, y + leadSize * 0.8, leadSize, palette, rgba(palette.ink, 0.85));
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      y += leadSize * 1.1;
    }
    if (parts.script) {
      var scriptSize = fitLine(
        ctx, parts.script,
        "400 %spx 'Parisienne', 'Brush Script MT', cursive",
        Math.round(h * 0.165), maxW, Math.round(h * 0.07)
      );
      ctx.font = "400 " + scriptSize + "px 'Parisienne', 'Brush Script MT', cursive";
      placeLine(ctx, ground, parts.script, cx, y + scriptSize * 0.78, scriptSize, palette, palette.ink);
      y += scriptSize * 0.92;
    }
    if (parts.tail) {
      var tailSize = fitLine(
        ctx, parts.tail.toUpperCase(),
        "600 %spx 'Playfair Display', Georgia, serif",
        Math.round(h * 0.05), maxW * 0.8, Math.round(h * 0.026)
      );
      ctx.font = "600 " + tailSize + "px 'Playfair Display', Georgia, serif";
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0.08em";
      placeLine(ctx, ground, parts.tail.toUpperCase(), cx, y + tailSize, tailSize, palette, rgba(palette.ink, 0.85));
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      y += tailSize * 1.3;
    }

    y += h * 0.018;

    // --- the message, on a ribbon when the composition calls for one ---
    var body = String(content.body || "");
    if (body) {
      var bodySize = Math.round(h * 0.036);
      ctx.font = "500 " + bodySize + "px 'DM Sans', 'Inter', sans-serif";
      var lines = R.sampleAverageColor ? wrapLines(ctx, body, maxW * 0.94) : [body];
      if (composition === "banner" && lines.length === 1) {
        var rw = Math.min(maxW, ctx.measureText(body).width + w * 0.13);
        var rh = bodySize * 2.1;
        drawRibbon(ctx, cx, y + rh / 2, rw, rh, palette);
        ctx.font = "500 " + bodySize + "px 'DM Sans', 'Inter', sans-serif";
        centreText(ctx, body, cx, y + rh / 2 + bodySize * 0.35, palette.cream);
        y += rh * 1.35;
      } else {
        for (var li = 0; li < lines.length; li++) {
          ctx.font = "500 " + bodySize + "px 'DM Sans', 'Inter', sans-serif";
          placeLine(ctx, ground, lines[li], cx, y + bodySize * (li + 1) * 1.32, bodySize, palette, rgba(palette.ink, 0.9));
        }
        y += bodySize * 1.32 * lines.length + h * 0.026;
      }
    }

    // --- CTA, in a bordered panel ---
    var cta = String(content.cta || "");
    if (cta) {
      var phone = (cta.match(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/) || [])[0] || null;
      var lead = phone ? cta.split(phone)[0].replace(/[\s,–—-]+$/, "").trim() : cta;
      var trail = phone ? cta.split(phone).slice(1).join(phone).replace(/^[\s,]+/, "").trim() : "";

      var panelW = maxW;
      // The panel has to contain every line it is given. Sized for the lead,
      // the phone AND the trailing line — without the trail allowance,
      // "TO PLACE AN ORDER." was drawn below the border it belongs inside.
      var panelH = h * (phone ? (trail ? 0.2 : 0.155) : 0.1);
      // Bottom-anchored so the composition fills the sheet instead of
      // stacking from the top and leaving a quarter of the poster empty.
      var panelY = Math.max(y, h - panelH - h * 0.1);
      var panelDrawn = composition !== "atelier";
      if (panelDrawn) drawPanel(ctx, cx - panelW / 2, panelY, panelW, panelH, palette);
      // A panel is already a light card standing off the flowers; putting a
      // ribbon inside one would be the same device twice. Only the panel-less
      // "atelier" composition needs its contact lines protected.
      var ctaGround = panelDrawn ? null : ground;

      var inner = panelY + panelH * 0.34;
      if (lead) {
        var leadS = fitLine(ctx, lead.toUpperCase(), "500 %spx 'DM Sans', 'Inter', sans-serif",
          Math.round(h * 0.03), panelW * 0.88, Math.round(h * 0.019));
        ctx.font = "500 " + leadS + "px 'DM Sans', 'Inter', sans-serif";
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0.06em";
        placeLine(ctx, ctaGround, lead.toUpperCase(), cx, inner, leadS, palette, rgba(palette.ink, 0.82));
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      }
      if (phone) {
        var phoneS = fitLine(ctx, phone, "600 %spx 'Playfair Display', Georgia, serif",
          Math.round(h * 0.072), panelW * 0.9, Math.round(h * 0.04));
        ctx.font = "600 " + phoneS + "px 'Playfair Display', Georgia, serif";
        placeLine(ctx, ctaGround, phone, cx, inner + phoneS * 0.98, phoneS, palette, palette.ink);
        if (trail) {
          var trailS = Math.round(h * 0.026);
          ctx.font = "500 " + trailS + "px 'DM Sans', 'Inter', sans-serif";
          if ("letterSpacing" in ctx) ctx.letterSpacing = "0.05em";
          placeLine(ctx, ctaGround, trail.toUpperCase(), cx, inner + phoneS * 1.05 + trailS * 1.5, trailS, palette, rgba(palette.ink, 0.78));
          if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
        }
      }
    }

    return composition;
  }

  /** Word-wraps against the CURRENT ctx font. Kept local because the
   * renderer's own wrapper is not exported; the algorithm is the same. */
  function wrapLines(ctx, text, maxWidth) {
    var words = String(text).split(/\s+/);
    var lines = [], line = "";
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  /**
   * Renders a poster to a canvas.
   *
   * Waits for the real fonts before drawing — Parisienne and Playfair are
   * the whole look, and a canvas drawn before they load silently falls back
   * to a system face with no error at all.
   */
  function renderPoster(opts) {
    opts = opts || {};
    var width = opts.width || 1080;
    var height = opts.height || 1350;
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var brand = opts.brand || {};
    var seed = typeof opts.seed === "number" ? opts.seed : hashSeed(opts.seedText || (opts.content && opts.content.headline) || "");

    function compose(img) {
      var sample = null;
      if (img) {
        // Sample the photo's own dominant colour so the poster matches the
        // flowers, which is the requirement in Ashley's own words.
        var probe = document.createElement("canvas");
        probe.width = 24; probe.height = 24;
        var px = probe.getContext("2d", { willReadFrequently: true });
        try {
          px.drawImage(img, 0, 0, 24, 24);
          var d = px.getImageData(0, 0, 24, 24);
          sample = R.sampleAverageColor(d, { x: 0, y: 0, w: 24, h: 24 }, 1);
        } catch (e) {
          sample = null;
        }
      }
      var palette = derivePalette(brand.primaryColor, brand.accentColor, sample);
      var composition = drawPoster(ctx, {
        width: width, height: height, content: opts.content, brand: brand,
        palette: palette, image: img, seed: seed
      });
      if (canvas.dataset) {
        canvas.dataset.florisynPosterComposition = composition;
        canvas.dataset.florisynPosterSeed = String(seed);
        // Measured, not asked. If the display faces did not really arrive
        // the poster is drawn in fallbacks and looks nothing like itself —
        // that must be visible to callers, never silently shipped as fine.
        canvas.dataset.florisynPosterFonts = [
          fontReallyLoaded("Parisienne", "400", 120) ? "script" : "script-missing",
          fontReallyLoaded("Playfair Display", "600", 64) ? "display" : "display-missing"
        ].join(",");
      }
      return canvas;
    }

    // A canvas cannot trigger a webfont fetch. document.fonts.ready only
    // settles loads that something has ALREADY requested, so a face used
    // nowhere else on the page is never downloaded and ctx.font falls back
    // to a system serif with no error whatsoever — which is exactly how the
    // first poster came out set in the wrong faces. Each face must be
    // explicitly loaded, at a real size, before anything is drawn.
    var REQUIRED_FACES = [
      "400 120px 'Parisienne'",
      "600 64px 'Playfair Display'",
      "500 40px 'DM Sans'"
    ];
    var fontsReady;
    if (global.document && document.fonts && document.fonts.load) {
      fontsReady = Promise.all(
        REQUIRED_FACES.map(function (f) {
          return document.fonts.load(f).catch(function () { return null; });
        })
      ).catch(function () { return null; });
    } else {
      fontsReady = Promise.resolve(null);
    }

    return fontsReady.then(function () {
      if (!opts.backgroundUrl) return compose(null);
      return new Promise(function (resolve) {
        var img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = function () { resolve(compose(img)); };
        img.onerror = function () { resolve(compose(null)); };
        img.src = opts.backgroundUrl;
      });
    });
  }

  /**
   * Whether a font face ACTUALLY took effect, measured rather than asked.
   *
   * document.fonts.check() cannot be trusted here: it returns true whenever
   * a matching @font-face RULE exists, even when the font FILE never
   * downloaded. Verified directly — a page whose webfont request was
   * blocked reported Parisienne as loaded while the canvas was quietly
   * drawing in a system serif, with no error anywhere.
   *
   * That silent fallback is the whole risk: a poster whose entire look is
   * its script face renders wrong and still reports success. Comparing the
   * measured width against a sentinel fallback is the only honest check.
   */
  function fontReallyLoaded(family, weight, size) {
    if (!global.document) return false;
    var probe = document.createElement("canvas").getContext("2d");
    var text = "Closing Handgloves 2:30";
    probe.font = weight + " " + size + "px monospace";
    var fallbackWidth = probe.measureText(text).width;
    probe.font = weight + " " + size + "px '" + family + "', monospace";
    var actualWidth = probe.measureText(text).width;
    return Math.abs(actualWidth - fallbackWidth) > 1;
  }

  var api = {
    fontReallyLoaded: fontReallyLoaded,
    contrastRatio: contrastRatio,
    ribbonBand: ribbonBand,
    floralOverlap: floralOverlap,
    busyFraction: busyFraction,
    ribbonWidthLimit: ribbonWidthLimit,
    colorAlpha: colorAlpha,
    placeLine: placeLine,
    INK_GROUND_MIN_CONTRAST: INK_GROUND_MIN_CONTRAST,
    needsRibbonBehind: needsRibbonBehind,
    hashSeed: hashSeed,
    seededRandom: seededRandom,
    derivePalette: derivePalette,
    splitHeadline: splitHeadline,
    COMPOSITIONS: COMPOSITIONS,
    renderPoster: renderPoster
  };

  global.FlorisynFlyerPoster = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
