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
 * This is a composition layer, NOT a second renderer. What it adds is design
 * vocabulary the renderer never had: grounds, borders, ribbons, panels,
 * ornaments, a script display face, and a palette derived from the actual
 * flowers.
 *
 * What it genuinely borrows from public/flyer-renderer.js, rather than
 * keeping a second copy of: colour parsing, contrast and pixel sampling,
 * phone formatting, the resolution of a florist's colour revision, and the
 * measuring context. What is local to this file and deliberately so: its own
 * wrap and fit, because the poster's columns are ribbons and panels rather
 * than template regions. An earlier version of this header claimed every
 * measurement came from the renderer, which was not true — worth keeping
 * accurate, because a comment that overstates its own discipline is how the
 * next person stops checking.
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

  /** Parses the colour forms a shop record can actually hold. A hex-only
   * slice turned "rebeccapurple" into a cyan with no error at all, which
   * would have been that florist's entire poster palette. Pure. */
  function hexToRgb(hex) {
    if (R && R.parseColor) {
      var c = R.parseColor(hex);
      // parseColor reports unparseable input as black; fall back to the
      // product default rather than painting a shop's poster in black.
      if (c.r || c.g || c.b) return { r: c.r, g: c.g, b: c.b };
      if (/^#?(000|000000)$/i.test(String(hex || "").trim())) return { r: 0, g: 0, b: 0 };
      return { r: 0x7c, g: 0x3a, b: 0x58 };
    }
    var h = String(hex || "#7c3a58").replace("#", "");
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

  /** Mixes a hex colour toward an rgb one and returns hex. Pure. */
  function mixHex(hex, toward, t) { return rgbToHex(mix(hexToRgb(hex), toward, t)); }

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
    // The same defaults the renderer uses, so a shop with no brand colour
    // does not get a different flyer depending on which layer drew it.
    var brand = hexToRgb(brandPrimary || "#7c3a58");
    var accent = hexToRgb(brandAccent || "#c98fae");

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
    // A null ctx means "consume the same randomness, draw nothing" — the
    // measuring pass needs the seed to advance identically without paying
    // for two full-size image composites.
    if (!ctx) {
      var flipDry = rand() > 0.5;
      var sizeDry = Math.round(Math.min(w, h) * (0.46 + rand() * 0.06));
      if (!img) return [];
      var cornersDry = flipDry
        ? [{ x: 0, y: 0 }, { x: w, y: h }]
        : [{ x: w, y: 0 }, { x: 0, y: h }];
      var r0d = 0.06, r1d = 0.92, stopD = 0.78;
      return cornersDry.map(function (c) {
        return { x: c.x, y: c.y, radius: sizeDry * (r0d + stopD * (r1d - r0d)) };
      });
    }
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

    // Corner arrangements, not a backdrop. At 0.62 of the short side the
    // clusters reached well into the middle of the sheet, so the shop's own
    // name landed on petals and had to be rescued with a ribbon behind it —
    // which is not what the reference does at all. The centre column is the
    // design; the flowers frame it.
    var size = Math.round(Math.min(w, h) * (0.46 + rand() * 0.06));

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
    // The folded tails behind each end.
    //
    // Ashley circled the first attempt: drawn as free-standing quadrilaterals
    // set off from the banner, they read as two detached boxes sitting beside
    // it, not as the ribbon folding back on itself. A real fold TOUCHES the
    // banner along its full end, tucks UNDER it, and is cut back at an angle
    // — so it starts at the banner's own edge, is shorter than the banner is
    // tall, and its inner corner is hidden behind the banner drawn on top.
    if (opts.tails !== false && !opts.fill) {
      var tail = Math.min(h * 0.55, w * 0.05);
      var drop = h * 0.30;
      ctx.fillStyle = mixHex(palette.ink, { r: 0, g: 0, b: 0 }, 0.34);
      for (var side = -1; side <= 1; side += 2) {
        var edge = cx + side * w / 2;
        ctx.beginPath();
        // Starts inside the banner so no seam shows, drops below it, and
        // takes a notch out of its outer end like the banner's own.
        ctx.moveTo(edge - side * h * 0.12, cy - h / 2 + drop);
        ctx.lineTo(edge + side * tail, cy - h / 2 + drop);
        ctx.lineTo(edge + side * (tail - h * 0.16), cy + h / 2 + drop * 0.42);
        ctx.lineTo(edge + side * tail, cy + h / 2 + drop * 0.86);
        ctx.lineTo(edge - side * h * 0.12, cy + h / 2 + drop * 0.86);
        ctx.closePath();
        ctx.fill();
      }
    }
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
        // One denominator, or the score depends on which cells were scanned
        // first — the same fault already fixed in the renderer's copy.
        if (busy >= need || busy + (cells - seen) < need) return busy / cells;
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
  /**
   * Shrinks a line until it fits. The floor used to win outright, so a very
   * long shop name simply ran off both edges of the sheet — measured at
   * 1297px on a 1080px canvas. Nothing here clips, so overflow is not a near
   * miss: the words are cut off by the edge of the flyer.
   *
   * A florist's own shop name is not something to drop, so below the floor
   * the size gives way to fitting rather than letting a word leave the page.
   */
  function fitLine(ctx, text, font, size, maxWidth, minSize) {
    var s = size;
    for (var i = 0; i < 24; i++) {
      ctx.font = font.replace("%s", s);
      if (ctx.measureText(text).width <= maxWidth || s <= minSize) break;
      s = Math.floor(s * 0.94);
    }
    ctx.font = font.replace("%s", s);
    var w = ctx.measureText(text).width;
    if (w > maxWidth && w > 0) {
      s = Math.max(6, Math.floor(s * (maxWidth / w)));
      ctx.font = font.replace("%s", s);
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

  // --- ornament vocabulary --------------------------------------------------
  //
  // Drawn from Ashley's own reference poster, which is a printed-card design:
  // a framed ground, a script/serif name lockup, small rules and hearts
  // separating the sections, a filled ribbon carrying the one fact that
  // matters, and a bordered panel for the phone number. These are the parts
  // that make it read as designed rather than as words placed on a picture.

  /** A small filled heart. The reference uses one as its section mark. */
  function drawHeart(ctx, cx, cy, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy + size * 0.55);
    ctx.bezierCurveTo(cx - size * 1.1, cy - size * 0.2, cx - size * 0.45, cy - size * 0.95, cx, cy - size * 0.28);
    ctx.bezierCurveTo(cx + size * 0.45, cy - size * 0.95, cx + size * 1.1, cy - size * 0.2, cx, cy + size * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** A rule broken by a heart — the reference's divider between sections. */
  function drawHeartRule(ctx, cx, y, width, palette) {
    ctx.save();
    ctx.strokeStyle = rgba(palette.ink, 0.45);
    ctx.lineWidth = Math.max(1, width * 0.005);
    var gap = width * 0.09;
    ctx.beginPath();
    ctx.moveTo(cx - width / 2, y); ctx.lineTo(cx - gap, y);
    ctx.moveTo(cx + gap, y); ctx.lineTo(cx + width / 2, y);
    ctx.stroke();
    ctx.restore();
    drawHeart(ctx, cx, y, width * 0.028, rgba(palette.ink, 0.6));
  }

  /** A leafy sprig, mirrored by a negative `dir`. The reference flanks its
   * date with a pair of these. */
  function drawSprig(ctx, x, y, len, dir, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, len * 0.03);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + dir * len * 0.5, y - len * 0.16, x + dir * len, y - len * 0.1);
    ctx.stroke();
    for (var i = 1; i <= 3; i++) {
      var t = i / 4;
      var lx = x + dir * len * t, ly = y - len * 0.13 * t;
      ctx.beginPath();
      ctx.ellipse(lx, ly - len * 0.11, len * 0.14, len * 0.055, dir * -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Short radiating strokes around the display word, as in the reference. */
  function drawSparkles(ctx, cx, cy, radius, color, rand) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    for (var side = -1; side <= 1; side += 2) {
      for (var i = 0; i < 3; i++) {
        var a = (-0.42 + i * 0.42) + (side < 0 ? Math.PI : 0);
        var r0 = radius * (0.98 + (rand ? rand() * 0.06 : 0));
        var r1 = r0 + radius * 0.16;
        ctx.lineWidth = Math.max(2, radius * 0.028);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.62);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.62);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** The tapering underline swash beneath the display word. */
  function drawSwash(ctx, cx, y, width, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2, width * 0.012);
    ctx.beginPath();
    ctx.moveTo(cx - width / 2, y);
    ctx.quadraticCurveTo(cx, y + width * 0.075, cx + width / 2, y - width * 0.02);
    ctx.stroke();
    ctx.restore();
  }

  /** Corner brackets on the frame, as on a printed card. */
  function drawCornerBrackets(ctx, w, h, inset, palette) {
    var len = Math.min(w, h) * 0.06;
    ctx.save();
    ctx.strokeStyle = rgba(palette.ink, 0.5);
    ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.0026);
    var corners = [[inset, inset, 1, 1], [w - inset, inset, -1, 1], [inset, h - inset, 1, -1], [w - inset, h - inset, -1, -1]];
    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      ctx.beginPath();
      ctx.moveTo(c[0] + c[2] * len, c[1]);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(c[0], c[1] + c[3] * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Splits a shop name for the display lockup the way the reference sets one:
   * the first word large in script, a short connector small between rules, the
   * rest in serif capitals. "Lilies in Bloom" becomes Lilies / IN / BLOOM.
   *
   * This is TYPESETTING, not rewriting — every word survives, in order. A name
   * with no connector simply gets script + capitals, and a single-word name
   * gets script alone. Pure.
   */
  var CONNECTOR_RE = /^(in|of|the|and|at|on|by|for|de|la|le|&)$/i;
  function splitShopName(name) {
    var words = String(name == null ? "" : name).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { script: "", connector: "", rest: "" };
    if (words.length === 1) return { script: words[0], connector: "", rest: "" };
    if (words.length >= 3 && CONNECTOR_RE.test(words[1])) {
      return { script: words[0], connector: words[1], rest: words.slice(2).join(" ") };
    }
    return { script: words[0], connector: "", rest: words.slice(1).join(" ") };
  }

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
    var inset = Math.round(Math.min(w, h) * 0.038);

    // The measuring pass exists only to learn how tall the composition comes
    // out. Painting the flowers there composites two full-size layers into
    // real canvases whose marks are then swallowed, and capturing the ground
    // reads back a canvas that — precisely because the marks were swallowed —
    // is still blank, so every ribbon decision made against it is meaningless.
    // Skipped outright: half the image work disappears, and the two passes
    // can no longer disagree about what is underneath the wording.
    //
    // rand() must still be consumed identically in both passes or the seed
    // would pick one composition while measuring and another while drawing,
    // so the same calls are made either way.
    var clusters = paintGroundAndFlorals(opts.measureOnly ? null : ctx, w, h, opts.image, palette, rand);
    // The composition now decides what actually differs. It used to be
    // stamped onto the canvas and returned while every branch drew the
    // identical poster — the dataset advertised a variation that did not
    // exist, and "generates differently every time" was not true.
    var borderVariant = composition === "card" ? "single" : "double";
    rand();
    var ground = null;
    if (!opts.measureOnly) {
      drawBorder(ctx, w, h, palette, borderVariant);
      drawCornerBrackets(ctx, w, h, inset, palette);
      ground = captureGround(ctx, w, h, clusters);
    }

    var gap = opts.extraGap || 0;
    var y = h * 0.115 + gap * 0.5;

    // --- the shop's name, set as a display lockup ---
    // The reference's whole identity is here: the name large in script over
    // the name in capitals, not a line of tracked-out type. Nothing is
    // renamed — the same words in the same order, set differently.
    if (brand.shopName) {
      var parts = splitShopName(brand.shopName);
      var nameScriptSize = fitLine(ctx, parts.script,
        "400 %spx 'Parisienne', 'Brush Script MT', cursive",
        Math.round(h * 0.085), maxW * 0.8, Math.round(h * 0.04));
      ctx.font = "400 " + nameScriptSize + "px 'Parisienne', 'Brush Script MT', cursive";
      placeLine(ctx, ground, parts.script, cx, y + nameScriptSize * 0.74, nameScriptSize, palette, palette.ink);
      y += nameScriptSize * 0.82;

      if (parts.connector) {
        var conSize = Math.max(12, Math.round(h * 0.017));
        ctx.font = "600 " + conSize + "px 'Playfair Display', Georgia, serif";
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0.2em";
        var conText = parts.connector.toUpperCase();
        var conW = ctx.measureText(conText).width;
        centreText(ctx, conText, cx, y + conSize * 0.5, rgba(palette.ink, 0.8));
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
        ctx.save();
        ctx.strokeStyle = rgba(palette.ink, 0.45);
        ctx.lineWidth = Math.max(1, h * 0.0012);
        ctx.beginPath();
        ctx.moveTo(cx - conW / 2 - w * 0.055, y + conSize * 0.16);
        ctx.lineTo(cx - conW / 2 - w * 0.012, y + conSize * 0.16);
        ctx.moveTo(cx + conW / 2 + w * 0.012, y + conSize * 0.16);
        ctx.lineTo(cx + conW / 2 + w * 0.055, y + conSize * 0.16);
        ctx.stroke();
        ctx.restore();
        y += conSize * 1.15;
      }

      if (parts.rest) {
        var restSize = fitLine(ctx, parts.rest.toUpperCase(),
          "600 %spx 'Playfair Display', Georgia, serif",
          Math.round(h * 0.052), maxW * 0.82, Math.round(h * 0.026));
        ctx.font = "600 " + restSize + "px 'Playfair Display', Georgia, serif";
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0.07em";
        placeLine(ctx, ground, parts.rest.toUpperCase(), cx, y + restSize * 0.85, restSize, palette, palette.ink);
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
        y += restSize * 1.05;
      }
      y += h * 0.018;
      // A printed card is ruled with a diamond; the other two take the heart.
      if (composition === "card") drawFlourish(ctx, cx, y, w * 0.34, palette);
      else drawHeartRule(ctx, cx, y, w * 0.34, palette);
      y += h * 0.042 + gap;
    }

    // --- the headline: a plain lead over one word in script ---
    var head = splitHeadline(content.headline);
    if (head.lead) {
      var leadSize = fitLine(ctx, head.lead.toUpperCase(),
        "600 %spx 'Playfair Display', Georgia, serif",
        Math.round(h * 0.058), maxW * 0.84, Math.round(h * 0.028));
      ctx.font = "600 " + leadSize + "px 'Playfair Display', Georgia, serif";
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0.05em";
      placeLine(ctx, ground, head.lead.toUpperCase(), cx, y + leadSize * 0.82, leadSize, palette, rgba(palette.ink, 0.86));
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      y += leadSize * 1.02;
    }
    if (head.script) {
      var scriptSize = fitLine(ctx, head.script,
        "400 %spx 'Parisienne', 'Brush Script MT', cursive",
        Math.round(h * 0.15), maxW * 0.94, Math.round(h * 0.07));
      ctx.font = "400 " + scriptSize + "px 'Parisienne', 'Brush Script MT', cursive";
      var scriptBase = y + scriptSize * 0.76;
      var scriptW = ctx.measureText(head.script).width;
      placeLine(ctx, ground, head.script, cx, scriptBase, scriptSize, palette, palette.ink);
      drawSwash(ctx, cx, scriptBase + scriptSize * 0.14, Math.min(scriptW * 1.02, maxW), rgba(palette.ink, 0.75));
      drawSparkles(ctx, cx, scriptBase - scriptSize * 0.28, scriptW * 0.55, rgba(palette.accent, 0.85), rand);
      // Parisienne descends a long way below its baseline; without real
      // clearance the next line was struck through by the tail of a "g".
      y = scriptBase + scriptSize * 0.42;
    }
    if (head.tail) {
      var tailSize = fitLine(ctx, head.tail.toUpperCase(),
        "600 %spx 'Playfair Display', Georgia, serif",
        Math.round(h * 0.046), maxW * 0.78, Math.round(h * 0.024));
      ctx.font = "600 " + tailSize + "px 'Playfair Display', Georgia, serif";
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0.07em";
      placeLine(ctx, ground, head.tail.toUpperCase(), cx, y + tailSize, tailSize, palette, rgba(palette.ink, 0.86));
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      y += tailSize * 1.35;
    }

    y += h * 0.012 + gap;

    // --- the message, on the ribbon ---
    // This is the reference's signature device and it carries the one fact
    // that matters. It is a compositional shape on a light ground, never a
    // wash laid over the flowers.
    var body = String(content.body || "");
    if (body) {
      var bodySize = Math.round(h * 0.034);
      // Shrink until the wrapped block fits the ribbon's own column, so an
      // unbreakable run — an email address, a URL — cannot push past the
      // ribbon and off the sheet. wrapLines cannot break inside a word.
      var lines;
      for (var attempt = 0; attempt < 8; attempt++) {
        ctx.font = "600 " + bodySize + "px 'DM Sans', 'Inter', sans-serif";
        lines = wrapLines(ctx, body, maxW * 0.86);
        var over = 0;
        for (var wi = 0; wi < lines.length; wi++) over = Math.max(over, ctx.measureText(lines[wi]).width);
        if (over <= maxW * 0.86 || bodySize <= h * 0.016) break;
        bodySize = Math.floor(bodySize * 0.9);
      }
      ctx.font = "600 " + bodySize + "px 'DM Sans', 'Inter', sans-serif";
      var rh = bodySize * (1.15 * lines.length + 0.95);
      var widest = 0;
      for (var i = 0; i < lines.length; i++) widest = Math.max(widest, ctx.measureText(lines[i]).width);
      // The limit caps the ribbon BODY; the tails are drawn outside it, so
      // an ordinary two-line message pushed them past the border rules and
      // 3px past the outer frame. Budget for them here.
      var tailAllowance = Math.min(rh * 0.4, w * 0.045) * 2;
      var rw = Math.min(ribbonWidthLimit(w, h) - tailAllowance, widest + rh * 0.64 + w * 0.09);
      drawRibbon(ctx, cx, y + rh / 2, rw, rh, palette);
      for (var j = 0; j < lines.length; j++) {
        ctx.font = "600 " + bodySize + "px 'DM Sans', 'Inter', sans-serif";
        centreText(ctx, lines[j], cx, y + rh / 2 - (lines.length - 1) * bodySize * 0.575 + j * bodySize * 1.15 + bodySize * 0.34, palette.cream);
      }
      y += rh * 1.16;
      drawHeart(ctx, cx, y, h * 0.011, rgba(palette.ink, 0.6));
      // The reference flanks its date with a pair of leafy sprigs; the
      // banner composition is the one that takes them.
      if (composition === "banner") {
        drawSprig(ctx, cx - w * 0.055, y + h * 0.004, w * 0.05, -1, rgba(palette.ink, 0.45));
        drawSprig(ctx, cx + w * 0.055, y + h * 0.004, w * 0.05, 1, rgba(palette.ink, 0.45));
      }
      y += h * 0.032 + gap;
    }

    // --- the call to action, in a bordered panel ---
    var cta = String(content.cta || "");
    var contentBottom = y, panelTop = y;
    if (cta) {
      // Split on the FIRST occurrence only. Splitting on every one meant a
      // call-to-action naming the number twice printed it twice, and a
      // "1-555-..." prefix left the leading 1 orphaned onto the label line —
      // so the number a customer read was not the number supplied.
      var m = cta.match(/\+?1?[-.\s]?\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/);
      var phone = m ? m[0].trim() : null;
      var lead = phone ? cta.slice(0, m.index).replace(/[\s,–—-]+$/, "").trim() : cta;
      var trail = phone ? cta.slice(m.index + m[0].length).replace(/^[\s,]+/, "").trim() : "";
      // A call-to-action with no number at all must not leave the flyer with
      // no way to reach the shop. The renderer already decides this; reuse it
      // rather than inventing a second rule.
      if (!phone && brand.phone) {
        phone = (R && R.formatPhoneForDisplay) ? R.formatPhoneForDisplay(brand.phone) : String(brand.phone);
      }

      var padY = h * 0.03;
      var leadS = lead ? Math.round(h * 0.026) : 0;
      var phoneS = phone ? Math.round(h * 0.062) : 0;
      var trailS = trail ? Math.round(h * 0.023) : 0;
      var panelH = padY * 2 + (leadS ? leadS * 1.5 : 0) + (phoneS ? phoneS * 1.12 : 0) + (trailS ? trailS * 1.9 : 0);
      var panelW = maxW;
      // Bottom-anchored so the sheet is filled rather than the design
      // stacking from the top and leaving the lower third empty.
      contentBottom = y;
      // Bottom-anchored so the sheet fills — but never past the bottom of
      // it. Without the clamp, ordinary two-sentence copy pushed the trailing
      // line of the call to action clean off the canvas: drawn at y=1412 on a
      // 1350-tall sheet, taking the shop's phone number with it. A florist
      // would have posted a flyer with no way to reach them on it.
      var panelY = Math.max(y, h - panelH - h * 0.075);
      var lowest = h - panelH - h * 0.02;
      if (panelY > lowest) panelY = Math.max(h * 0.02, lowest);
      panelTop = panelY;
      drawPanel(ctx, cx - panelW / 2, panelY, panelW, panelH, palette);

      var inner = panelY + padY;
      if (lead) {
        var leadFit = fitLine(ctx, lead.toUpperCase(), "500 %spx 'Playfair Display', Georgia, serif",
          leadS, panelW * 0.86, Math.round(h * 0.018));
        ctx.font = "500 " + leadFit + "px 'Playfair Display', Georgia, serif";
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0.07em";
        centreText(ctx, lead.toUpperCase(), cx, inner + leadFit, rgba(palette.ink, 0.85));
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
        inner += leadFit * 1.5;
      }
      if (phone) {
        var phoneFit = fitLine(ctx, phone, "600 %spx 'Playfair Display', Georgia, serif",
          phoneS, panelW * 0.84, Math.round(h * 0.036));
        ctx.font = "600 " + phoneFit + "px 'Playfair Display', Georgia, serif";
        centreText(ctx, phone, cx, inner + phoneFit * 0.9, palette.ink);
        inner += phoneFit * 1.12;
      }
      if (trail) {
        var trailFit = fitLine(ctx, trail.toUpperCase(), "500 %spx 'Playfair Display', Georgia, serif",
          trailS, panelW * 0.86, Math.round(h * 0.016));
        ctx.font = "500 " + trailFit + "px 'Playfair Display', Georgia, serif";
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0.06em";
        drawHeart(ctx, cx, inner + trailFit * 0.35, h * 0.0095, rgba(palette.ink, 0.55));
        centreText(ctx, trail.toUpperCase(), cx, inner + trailFit * 1.75, rgba(palette.ink, 0.8));
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      }
    }

    return { composition: composition, contentBottom: contentBottom, panelTop: panelTop };
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

    function compose(img, tier) {
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
      // An explicit colour revision from the florist ("less pink", "use more
      // cream") is their own instruction about this flyer and outranks the
      // shop's stored brand colour. effectivePaletteColors is the renderer's
      // own resolution of that, reused rather than reimplemented.
      var colors = (R && R.effectivePaletteColors)
        ? R.effectivePaletteColors(brand, opts.style)
        : { primary: brand.primaryColor, accent: brand.accentColor };
      var palette = derivePalette(colors.primary, colors.accent, sample);
      var base = {
        width: width, height: height, content: opts.content, brand: brand,
        palette: palette, image: img, seed: seed
      };
      // Lay the poster out once against a context that measures but paints
      // nothing, to learn how tall it naturally is. Short wording used to
      // stack from the top and leave a band of empty sheet above the
      // bottom-anchored contact panel; long wording ran the other way. The
      // slack that remains is shared between the three section joints, so
      // the design breathes to fill whatever it is given instead of the
      // spacing being a fixed guess that only suits one length.
      var probeCtx = R.measuringContext ? R.measuringContext(ctx) : null;
      if (probeCtx) {
        var dry = drawPoster(probeCtx, Object.assign({}, base, { measureOnly: true }));
        var slack = dry.panelTop - dry.contentBottom;
        // The gap is applied at three joints plus a half share at the top —
        // three and a half times in total — so dividing by three overshot the
        // measured anchor by slack/6 and quietly ate the bottom margin on
        // every short-copy poster.
        if (slack > 0) base.extraGap = Math.min(slack / 3.5, height * 0.045);
      }
      var laid = drawPoster(ctx, base);
      var composition = laid.composition;
      if (canvas.dataset) {
        canvas.dataset.florisynPosterComposition = composition;
        canvas.dataset.florisynPosterSeed = String(seed);
        canvas.dataset.florisynBackgroundTier = tier || "fallback-procedural";
        // Measured, not asked. If the display faces did not really arrive
        // the poster is drawn in fallbacks and looks nothing like itself —
        // that must be visible to callers, never silently shipped as fine.
        // DM Sans carries the ribbon's message — the one line a customer has
        // to read — and was never checked at all, so a missing body face was
        // shipped silently while the stamp claimed everything had arrived.
        canvas.dataset.florisynPosterFonts = [
          fontReallyLoaded("Parisienne", "400", 120) ? "script" : "script-missing",
          fontReallyLoaded("Playfair Display", "600", 64) ? "display" : "display-missing",
          fontReallyLoaded("DM Sans", "600", 40) ? "body" : "body-missing"
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
    // Every weight the composition actually draws. These were out of step
    // with it — DM Sans was requested at 500 and drawn at 600, Playfair
    // requested at 600 and also drawn at 500 — and a request for one weight
    // does not fetch another, so those lines could land in a fallback face on
    // the first draw with nothing reporting it.
    var REQUIRED_FACES = [
      "400 120px 'Parisienne'",
      "500 40px 'Playfair Display'",
      "600 64px 'Playfair Display'",
      "600 40px 'DM Sans'"
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

    function load(url) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error("image failed")); };
        img.src = url;
      });
    }

    // The same tiers the flyer renderer uses, and stamped the same way.
    // Without a fallback a failed image left the poster with no flowers at
    // all — a framed sheet of type — and without the stamp nothing
    // downstream could tell a generated photograph from a library one, which
    // is the single thing a report about this must never get wrong.
    var FALLBACK = (R && R.FALLBACK_FLORAL_BACKGROUND) || "/assets/atelier-floral-corner.jpg";
    return fontsReady.then(function () {
      if (!opts.backgroundUrl) {
        return load(FALLBACK)
          .then(function (img) { return compose(img, "fallback-library-photo"); })
          .catch(function () { return compose(null, "fallback-procedural"); });
      }
      return load(opts.backgroundUrl)
        .then(function (img) { return compose(img, "generated"); })
        .catch(function () {
          return load(FALLBACK)
            .then(function (img) { return compose(img, "fallback-library-photo"); })
            .catch(function () { return compose(null, "fallback-procedural"); });
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
    drawPoster: drawPoster,
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
    splitShopName: splitShopName,
    COMPOSITIONS: COMPOSITIONS,
    renderPoster: renderPoster
  };

  global.FlorisynFlyerPoster = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
