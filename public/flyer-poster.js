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
  /**
   * Where the wording lives, and how the photograph is used, per composition.
   *
   * Ashley: "you are just recreating the same chatGPT flyer and not trying to
   * make it better." She was right — the three compositions differed only by
   * which ornament they drew, which is one template re-skinned three ways.
   * These are three genuinely different silhouettes: a centred sheet framed
   * by corner arrangements, a card with a full photographic band across its
   * head, and an asymmetric layout with the flowers as a full-height column
   * beside the type. A florist regenerating gets a different DESIGN, not the
   * same design with a different squiggle. Pure.
   */
  // The smallest the message on the ribbon may ever be set, as a fraction of
  // the sheet's height — about 32px on a 1080x1350 poster, which is still
  // comfortably readable in a phone-sized feed. The one line a customer has to
  // read is not the place to win back space.
  var RIBBON_BODY_FLOOR = 0.024;

  function layoutFor(composition, w, h, textSide) {
    if (composition === "editorial") {
      // The photograph IS the poster: a full-bleed staged scene with the
      // wording set into its calm half, and one bar across the foot carrying
      // the phone number. This is the shape of the work Ashley gets from
      // ChatGPT for a marketing post, and the shape the other three cannot
      // make — they all put type on a printed sheet with the flowers around
      // it, which is right for a notice and wrong for an advertisement.
      var half = w * 0.52;
      var left = textSide !== "right";
      var pad = w * 0.075;
      return {
        kind: "editorial",
        colX: left ? pad : w - half + pad * 0.4,
        colW: half - pad * 1.4,
        cx: left ? pad + (half - pad * 1.4) / 2 : w - half + pad * 0.4 + (half - pad * 1.4) / 2,
        topY: h * 0.085, bottomPad: h * 0.045, barH: h * 0.125
      };
    }
    if (composition === "card") {
      var bandH = Math.round(h * 0.30);
      return {
        kind: "card", bandH: bandH,
        colX: w * 0.10, colW: w * 0.80, cx: w / 2,
        topY: bandH + h * 0.055, bottomPad: h * 0.055
      };
    }
    if (composition === "banner") {
      var sideW = Math.round(w * 0.30);
      return {
        kind: "banner", sideW: sideW,
        colX: sideW + w * 0.055, colW: w - sideW - w * 0.105, cx: sideW + (w - sideW - w * 0.105) / 2 + w * 0.055,
        topY: h * 0.10, bottomPad: h * 0.06
      };
    }
    return {
      kind: "atelier",
      colX: w * 0.11, colW: w * 0.78, cx: w / 2,
      topY: h * 0.115, bottomPad: h * 0.075
    };
  }

  /** The photograph as a band across the head of a card, fading into the
   * ground so it reads as one printed piece rather than a pasted rectangle. */
  function paintHeadBand(ctx, w, h, img, palette, layout) {
    if (!img) return [];
    var bandH = layout.bandH;
    var layer = document.createElement("canvas");
    layer.width = w; layer.height = bandH;
    var lx = layer.getContext("2d");
    var scale = Math.max(w / img.width, bandH / img.height);
    lx.drawImage(img, (w - img.width * scale) / 2, (bandH - img.height * scale) / 2, img.width * scale, img.height * scale);
    lx.globalCompositeOperation = "destination-in";
    var fade = lx.createLinearGradient(0, 0, 0, bandH);
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(0.72, "rgba(0,0,0,1)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    lx.fillStyle = fade;
    lx.fillRect(0, 0, w, bandH);
    ctx.drawImage(layer, 0, 0, w, bandH);
    return [{ x: w / 2, y: bandH * 0.45, radius: Math.max(w, bandH) * 0.62 }];
  }

  /** The photograph full-bleed, as the poster itself. */
  function paintFullBleed(ctx, w, h, img) {
    if (!img) return [];
    var scale = Math.max(w / img.width, h / img.height);
    ctx.drawImage(img, (w - img.width * scale) / 2, (h - img.height * scale) / 2, img.width * scale, img.height * scale);
    return [];
  }

  /**
   * The bar across the foot of an editorial poster: the phone number, set once,
   * in vector type that is always correct.
   *
   * This is the one thing a diffusion model cannot do. Ashley has already had
   * a post come back with invented gibberish painted across it; a shop's phone
   * number is not something to leave to a model that cannot spell.
   */
  function drawCtaBar(ctx, x, y, w, h, palette) {
    ctx.save();
    ctx.fillStyle = rgba(palette.ink, 0.92);
    roundRectPath(ctx, x, y, w, h, Math.min(h * 0.3, w * 0.03));
    ctx.fill();
    ctx.strokeStyle = rgba(palette.cream, 0.35);
    ctx.lineWidth = Math.max(1, h * 0.018);
    roundRectPath(ctx, x + h * 0.06, y + h * 0.06, w - h * 0.12, h - h * 0.12, Math.min(h * 0.24, w * 0.028));
    ctx.stroke();
    ctx.restore();
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /** The photograph as a full-height column beside the type. */
  function paintSideColumn(ctx, w, h, img, palette, layout) {
    if (!img) return [];
    var sw = layout.sideW;
    var layer = document.createElement("canvas");
    layer.width = sw; layer.height = h;
    var lx = layer.getContext("2d");
    var scale = Math.max(sw / img.width, h / img.height);
    lx.drawImage(img, (sw - img.width * scale) / 2, (h - img.height * scale) / 2, img.width * scale, img.height * scale);
    lx.globalCompositeOperation = "destination-in";
    var fade = lx.createLinearGradient(0, 0, sw, 0);
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(0.74, "rgba(0,0,0,1)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    lx.fillStyle = fade;
    lx.fillRect(0, 0, sw, h);
    ctx.drawImage(layer, 0, 0, sw, h);
    return [{ x: sw * 0.4, y: h / 2, radius: Math.max(sw, h) * 0.6 }];
  }

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
    // No folded tails.
    //
    // Two attempts at them, and Ashley's verdict on the second was that it
    // looked worse than the first. Drawn as separate shapes they read as
    // boxes stuck beside the banner; tucked under and dropped below, as dark
    // flags hanging off its ends. The chevron-notched banner is a ribbon on
    // its own and does not need them, and a device that has to be explained
    // is not working. Removed rather than attempted a third time.
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
  function captureGround(ctx, w, h, clusters, columnWidth) {
    var probe = null;
    try { probe = ctx.getImageData(0, 0, w, h); } catch (e) { probe = null; }
    // The readability ribbon is centred on the COLUMN, but its width limit was
    // derived from the SHEET. On the banner composition — whose column is
    // offset to the right of centre, the photograph taking the left third —
    // that let a ribbon 926px wide be centred at x=705 on a 1080px flyer: it
    // ran to x=1168, well off the sheet. A ribbon may never be wider than the
    // column it is centred in.
    var limit = ribbonWidthLimit(w, h);
    return {
      probe: probe,
      clusters: clusters || [],
      maxRibbonWidth: columnWidth ? Math.min(limit, columnWidth) : limit
    };
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

  // ---------------------------------------------------------------------------
  // Sympathy work.
  //
  // The ornament vocabulary below came from Ashley's reference, which is a
  // celebration card: hearts as section marks, a heart beside the phone
  // number, little starburst sparkles flanking the display word. On a
  // Valentine's or a birthday poster that is exactly right.
  //
  // On a funeral flyer it is not. The poster layer had no idea what it was
  // drawing, so a sympathy piece came out with a pink heart under the shop
  // name, a second one under the message, a third beside the phone number,
  // and sparkles around the word "Funeral". Ashley's standing instruction
  // about this kind of post — "these types of post need to ... make sense" —
  // is about the words, but a heart on a funeral flyer is the same fault one
  // level down, and it is the kind of thing a grieving family notices.
  //
  // Deliberately a mirror of BEREAVEMENT_CONTEXT_RE in
  // netlify/functions/_shared/marketing-content-revision.js — this file is a
  // browser IIFE and cannot import it. tests/flyer-poster.js holds the two
  // to the same corpus so they cannot drift apart. Never shop-specific: it
  // reads the wording actually being drawn, nothing else.
  var SYMPATHY_RE =
    /\b(funeral|sympathy|memorial|bereave(?:d|ment)|condolence|casket|graveside|wake|passed away|loss of|in memory|tribute|remembrance)\b/i;

  /**
   * True when the wording on this poster is sympathy work, in which case the
   * celebratory half of the ornament vocabulary is not drawn.
   *
   * The shop's own name is removed before the test. A flyer's message
   * routinely contains it ("Wake & Bloom is closing at 2:30 today"), so a real
   * shop whose name happens to carry one of these words — Memorial Gardens
   * Florist, Wake & Bloom, Tribute Flowers — would otherwise have EVERY poster
   * it ever made read as a funeral, including its Valentine's Day one. Names
   * are not occasions. Multi-tenant by construction: the name is passed in
   * from the shop's own record, never assumed.
   *
   * Pure.
   */
  function isSympathyContent(content, shopName) {
    content = content || {};
    var text = [content.headline, content.body, content.cta].filter(Boolean).join(" ");
    var name = String(shopName || "").trim();
    if (name) text = text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
    return SYMPATHY_RE.test(text);
  }

  /** A small filled diamond — the restrained section mark, and the one a
   * sympathy poster takes in place of the heart. */
  function drawDiamondMark(ctx, cx, cy, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size * 0.72, cy);
    ctx.lineTo(cx, cy + size);
    ctx.lineTo(cx - size * 0.72, cy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

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

  var COMPOSITIONS = ["atelier", "card", "banner", "editorial"];

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
    var L = layoutFor(composition, w, h, opts.textSide);
    var cx = L.cx;
    var maxW = L.colW;
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
    // The ground tinting is common to all three; only how the photograph is
    // used differs. rand() is consumed identically either way so the seed
    // picks the same design in the measuring pass as in the drawing one.
    var clusters = paintGroundAndFlorals(opts.measureOnly ? null : ctx, w, h,
      L.kind === "atelier" ? opts.image : null, palette, rand);
    if (!opts.measureOnly && L.kind === "card") clusters = paintHeadBand(ctx, w, h, opts.image, palette, L);
    if (!opts.measureOnly && L.kind === "banner") clusters = paintSideColumn(ctx, w, h, opts.image, palette, L);
    if (!opts.measureOnly && L.kind === "editorial") {
      clusters = paintFullBleed(ctx, w, h, opts.image);
      // One soft card behind the whole column, and only when the scene
      // genuinely cannot carry the type — never a wash across the picture.
      if (opts.needsBackdrop) {
        // Faded toward the picture rather than cut off at a hard edge. A
        // rectangle with a straight side slices whatever it lands on — here
        // it cut a clean vertical seam down the middle of the bouquet. Light
        // falling across the frame is what this should look like.
        var right = L.colX > w * 0.4;
        var bx = right ? L.colX - w * 0.06 : 0;
        var bw = right ? w - bx : L.colX + L.colW + w * 0.14;
        ctx.save();
        var wash = ctx.createLinearGradient(right ? bx : bw, 0, right ? bx + bw : 0, 0);
        wash.addColorStop(0, rgba(palette.cream, 0));
        wash.addColorStop(0.42, rgba(palette.cream, 0.72));
        wash.addColorStop(1, rgba(palette.cream, 0.9));
        ctx.fillStyle = wash;
        ctx.fillRect(bx, 0, bw, h);
        ctx.restore();
      }
    }
    // The composition now decides what actually differs. It used to be
    // stamped onto the canvas and returned while every branch drew the
    // identical poster — the dataset advertised a variation that did not
    // exist, and "generates differently every time" was not true.
    var borderVariant = composition === "card" ? "single" : "double";
    var frameRect = null, panelRect = null;
    // Decided once, from the wording actually being drawn, and used wherever
    // the ornament vocabulary would otherwise be celebratory. Suppressing an
    // ornament consumes no rand() that anything later depends on — the
    // sparkles are the last consumer of the sequence — so a sympathy poster
    // picks exactly the same composition, corner flip and border as any other
    // from the same seed. Determinism, and therefore Undo, are untouched.
    var sympathy = isSympathyContent(content, brand.shopName);
    rand();
    var ground = null;
    if (!opts.measureOnly) {
      // A rule drawn across a photographic band or column reads as a line on
      // top of a picture, not as a frame. The card and banner layouts frame
      // only the printed area.
      if (L.kind === "editorial") {
        // A rule around a photograph reads as a border on a picture. The
        // editorial poster is framed by the scene itself.
      } else if (L.kind === "atelier") {
        drawBorder(ctx, w, h, palette, borderVariant);
        drawCornerBrackets(ctx, w, h, inset, palette);
        frameRect = { x: inset, y: inset, w: w - inset * 2, h: h - inset * 2 };
      } else {
        var fx = L.kind === "banner" ? L.sideW + inset * 0.5 : inset;
        var fy = L.kind === "card" ? L.bandH + inset * 0.5 : inset;
        var fw = w - fx - inset;
        var fh = h - fy - inset;
        frameRect = { x: fx, y: fy, w: fw, h: fh };
        ctx.save();
        ctx.strokeStyle = rgba(palette.ink, 0.45);
        ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.0022);
        ctx.strokeRect(fx, fy, fw, fh);
        ctx.restore();
      }
      ground = captureGround(ctx, w, h, clusters, maxW);
    }

    var gap = opts.extraGap || 0;
    // Every display size is scaled by this. The measuring pass sets it when
    // the composition comes out taller than the sheet can hold — without it,
    // the bottom-anchored contact panel was dragged up over the ribbon and
    // the two printed on top of each other.
    var ts = typeof opts.typeScale === "number" ? opts.typeScale : 1;
    var y = L.topY + gap * 0.5;

    // --- the shop's name, set as a display lockup ---
    // The reference's whole identity is here: the name large in script over
    // the name in capitals, not a line of tracked-out type. Nothing is
    // renamed — the same words in the same order, set differently.
    if (brand.shopName) {
      var parts = splitShopName(brand.shopName);
      var nameScriptSize = fitLine(ctx, parts.script,
        "400 %spx 'Parisienne', 'Brush Script MT', cursive",
        Math.round(h * 0.085 * ts), maxW * 0.8, Math.round(h * 0.04 * ts));
      ctx.font = "400 " + nameScriptSize + "px 'Parisienne', 'Brush Script MT', cursive";
      placeLine(ctx, L.kind === "editorial" ? null : ground, parts.script, cx, y + nameScriptSize * 0.74, nameScriptSize, palette, palette.ink);
      y += nameScriptSize * 0.82;

      if (parts.connector) {
        var conSize = Math.max(10, Math.round(h * 0.017 * ts));
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
          Math.round(h * 0.052 * ts), maxW * 0.82, Math.round(h * 0.026 * ts));
        ctx.font = "600 " + restSize + "px 'Playfair Display', Georgia, serif";
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0.07em";
        placeLine(ctx, L.kind === "editorial" ? null : ground, parts.rest.toUpperCase(), cx, y + restSize * 0.85, restSize, palette, palette.ink);
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
        y += restSize * 1.05;
      }
      y += h * 0.018;
      // A printed card is ruled with a diamond; the other two take the heart —
      // except on sympathy work, where every composition takes the diamond.
      if (composition === "card" || sympathy) drawFlourish(ctx, cx, y, w * 0.34, palette);
      else drawHeartRule(ctx, cx, y, w * 0.34, palette);
      y += h * 0.042 + gap;
    }

    // --- the headline: a plain lead over one word in script ---
    var head = splitHeadline(content.headline);
    if (head.lead) {
      var leadSize = fitLine(ctx, head.lead.toUpperCase(),
        "600 %spx 'Playfair Display', Georgia, serif",
        Math.round(h * 0.058 * ts), maxW * 0.84, Math.round(h * 0.028 * ts));
      ctx.font = "600 " + leadSize + "px 'Playfair Display', Georgia, serif";
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0.05em";
      placeLine(ctx, L.kind === "editorial" ? null : ground, head.lead.toUpperCase(), cx, y + leadSize * 0.82, leadSize, palette, rgba(palette.ink, 0.86));
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      y += leadSize * 1.02;
    }
    if (head.script) {
      var scriptSize = fitLine(ctx, head.script,
        "400 %spx 'Parisienne', 'Brush Script MT', cursive",
        Math.round(h * 0.15 * ts), maxW * 0.94, Math.round(h * 0.07 * ts));
      ctx.font = "400 " + scriptSize + "px 'Parisienne', 'Brush Script MT', cursive";
      var scriptBase = y + scriptSize * 0.76;
      var scriptW = ctx.measureText(head.script).width;
      placeLine(ctx, L.kind === "editorial" ? null : ground, head.script, cx, scriptBase, scriptSize, palette, palette.ink);
      drawSwash(ctx, cx, scriptBase + scriptSize * 0.14, Math.min(scriptW * 1.02, maxW), rgba(palette.ink, 0.75));
      // The sparkles flank the display word, and the radius was taken from
      // the word alone with no reference to the column it sits in. On the
      // banner composition — whose printed column is only 60% of the sheet,
      // the rest being the photograph — that put the outermost dashes at
      // x=1094 on a 1080-wide flyer: a decoration running off the edge of the
      // sheet, across the frame it is supposed to sit inside.
      //
      // Simply clamping the radius to the column is worse, not better: it
      // moves the dashes INWARD onto the word, striking through the F and the
      // l of the shop's own headline. The flourish has to sit outside the
      // word AND inside the column, and on a long word in a narrow column
      // there is no such place. So it is drawn only when it genuinely fits,
      // and otherwise not at all — an ornament is optional, the headline is
      // not.
      var sparkleR = scriptW * 0.55;
      if (!sympathy && sparkleR * 1.2 <= maxW / 2) {
        drawSparkles(ctx, cx, scriptBase - scriptSize * 0.28, sparkleR, rgba(palette.accent, 0.85), rand);
      }
      // Parisienne descends a long way below its baseline; without real
      // clearance the next line was struck through by the tail of a "g".
      y = scriptBase + scriptSize * 0.42;
    }
    if (head.tail) {
      var tailSize = fitLine(ctx, head.tail.toUpperCase(),
        "600 %spx 'Playfair Display', Georgia, serif",
        Math.round(h * 0.046 * ts), maxW * 0.78, Math.round(h * 0.024 * ts));
      ctx.font = "600 " + tailSize + "px 'Playfair Display', Georgia, serif";
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0.07em";
      placeLine(ctx, L.kind === "editorial" ? null : ground, head.tail.toUpperCase(), cx, y + tailSize, tailSize, palette, rgba(palette.ink, 0.86));
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      y += tailSize * 1.35;
    }

    y += h * 0.012 + gap;
    // Where the headline actually finished. The ribbon is allowed to be
    // pushed DOWN the sheet, never pulled up past this line — see the clamp
    // below for the flyer it destroyed.
    var headBottom = y;

    // How much of the sheet the contact panel will claim. Resolved before the
    // ribbon is placed so the ribbon can be held clear of it: the composition
    // must not rely on its caller running a fit pass to avoid printing one
    // element on top of another, or off the sheet altogether.
    var ctaText = String(content.cta || "");
    var ctaPhone = null, ctaLead = "", ctaTrail = "";
    if (ctaText) {
      // Split on the FIRST occurrence only. Splitting on every one meant a
      // call to action naming the number twice printed it twice, and a
      // "1-555-..." prefix left the leading 1 orphaned onto the label line —
      // so the number a customer read was not the number supplied.
      var pm = ctaText.match(/\+?1?[-.\s]?\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/);
      ctaPhone = pm ? pm[0].trim() : null;
      ctaLead = ctaPhone ? ctaText.slice(0, pm.index).replace(/[\s,–—-]+$/, "").trim() : ctaText;
      ctaTrail = ctaPhone ? ctaText.slice(pm.index + pm[0].length).replace(/^[\s,]+/, "").trim() : "";
      // A call to action with no number must not leave the flyer with no way
      // to reach the shop. The renderer already decides this; reuse it rather
      // than inventing a second rule.
      if (!ctaPhone && brand.phone) {
        ctaPhone = (R && R.formatPhoneForDisplay) ? R.formatPhoneForDisplay(brand.phone) : String(brand.phone);
      }
    }
    var padY = h * 0.03;
    var leadS = ctaLead ? Math.round(h * 0.026 * ts) : 0;
    var phoneS = ctaPhone ? Math.round(h * 0.062 * ts) : 0;
    var trailS = ctaTrail ? Math.round(h * 0.023 * ts) : 0;
    var panelH = ctaText
      ? (L.kind === "editorial"
          ? L.barH
          : padY * 2 + (leadS ? leadS * 1.5 : 0) + (phoneS ? phoneS * 1.12 : 0) + (trailS ? trailS * 1.9 : 0))
      : 0;
    var contentFloor = h - panelH - L.bottomPad;

    // --- the message, on the ribbon ---
    // This is the reference's signature device and it carries the one fact
    // that matters. It is a compositional shape on a light ground, never a
    // wash laid over the flowers.
    var body = String(content.body || "");
    var ribbonRect = null;
    var bodyWidth = null;
    if (body) {
      var bodySize = Math.round(h * 0.034 * ts);
      // How wide the message may run. The 0.86 inset is the room the ribbon's
      // notched ends and padding need — but the editorial composition draws no
      // ribbon at all, so there it was simply throwing away a seventh of its
      // own column: a 79-character sentence came out as six lines of two and
      // three words down a narrow gutter, with the rest of the sheet empty.
      var bodyW = L.kind === "editorial" ? maxW : maxW * 0.86;
      bodyWidth = bodyW;
      // Shrink until the wrapped block fits the ribbon's own column, so an
      // unbreakable run — an email address, a URL — cannot push past the
      // ribbon and off the sheet. wrapLines cannot break inside a word.
      var lines;
      for (var attempt = 0; attempt < 8; attempt++) {
        ctx.font = "600 " + bodySize + "px 'DM Sans', 'Inter', sans-serif";
        lines = wrapLines(ctx, body, bodyW);
        var over = 0;
        for (var wi = 0; wi < lines.length; wi++) over = Math.max(over, ctx.measureText(lines[wi]).width);
        if (over <= bodyW) break;
        if (bodySize <= h * 0.016) {
          // Below the comfortable floor, scale straight to the width. An
          // unbreakable run — an email address, a URL — is otherwise wider
          // than the column at any size the floor allows, and the floor
          // winning means the words are cut off by the edge of the sheet.
          // Small and readable beats large and missing.
          bodySize = Math.max(8, Math.floor(bodySize * ((bodyW) / over)));
          ctx.font = "600 " + bodySize + "px 'DM Sans', 'Inter', sans-serif";
          lines = wrapLines(ctx, body, bodyW);
          break;
        }
        bodySize = Math.floor(bodySize * 0.9);
      }
      // And then make it fit the room it actually has, between the bottom of
      // the headline and the top of the contact panel. Only the width was
      // ever fitted; the height was whatever the wrap came to. That was
      // survivable while the ribbon could be slid up the sheet to make room —
      // but sliding it up is what printed it over the headline, so the height
      // has to be fitted properly instead.
      var rh, widest, rw;
      var room = contentFloor - headBottom;
      for (var hAttempt = 0; hAttempt < 10; hAttempt++) {
        ctx.font = "600 " + bodySize + "px 'DM Sans', 'Inter', sans-serif";
        lines = wrapLines(ctx, body, bodyW);
        rh = bodySize * (1.15 * lines.length + 0.95);
        widest = 0;
        for (var i = 0; i < lines.length; i++) widest = Math.max(widest, ctx.measureText(lines[i]).width);
        rw = Math.min(maxW, widest + rh * 0.64 + w * 0.09);
        if (rh <= room || bodySize <= RIBBON_BODY_FLOOR * h) break;
        // Straight to the size that fits rather than creeping down: a smaller
        // face wraps to fewer lines, so one proportional step lands close and
        // the loop settles in two or three.
        //
        // Floored, though, and that floor matters more than the fit. Without
        // it the message shrank to a 9px strip inside a full-size ribbon while
        // the headline above it stayed enormous — legible in a screenshot,
        // illegible on a phone, and exactly the fault Ashley reported in the
        // first place ("you can't read it"). Below the floor the right answer
        // is not a smaller message: it is a smaller POSTER, which is what the
        // caller's fit pass does — and it can only do it if the overflow is
        // still visible to it. So this stops, and lets it be seen.
        bodySize = Math.max(
          Math.ceil(RIBBON_BODY_FLOOR * h),
          Math.floor(bodySize * Math.max(0.6, room / rh))
        );
      }
      // Never into the room the contact panel needs — but never up over the
      // headline either. This clamp used to floor at h * 0.04, a fixed line
      // near the top of the SHEET, which on the card composition (whose
      // printed area starts a third of the way down, below the photographic
      // band) is far above where the headline ends. So a poster with no room
      // for the ribbon had the ribbon moved up ON TOP of its own headline:
      // "Closing" was cut through mid-glyph and "EARLY TODAY" disappeared
      // under it completely. The florist's own words, gone from the flyer,
      // with nothing reporting it.
      //
      // Worse, moving it up made the overflow invisible to the fit pass:
      // contentBottom came back inside panelTop, so typeScale never shrank
      // and the collision was never resolved, only hidden. Held at headBottom
      // the overflow is real again, and the caller's shrink loop — which
      // exists precisely for this — deals with it by making the type smaller.
      if (y + rh > contentFloor) y = Math.max(headBottom, contentFloor - rh);
      if (L.kind === "editorial") {
        // A filled ribbon laid across a photograph is a slab on a picture.
        // Here the message is set plainly into the scene's own calm half, and
        // only a line that genuinely cannot be read gets anything behind it.
        for (var ej = 0; ej < lines.length; ej++) {
          ctx.font = "500 " + bodySize + "px 'DM Sans', 'Inter', sans-serif";
          centreText(ctx, lines[ej], cx, y + bodySize * (ej + 1) * 1.34, rgba(palette.ink, 0.92));
        }
        y += bodySize * 1.34 * lines.length + h * 0.02;
      } else {
        ribbonRect = { x: cx - rw / 2, y: y, w: rw, h: rh };
        drawRibbon(ctx, cx, y + rh / 2, rw, rh, palette);
        for (var j = 0; j < lines.length; j++) {
          ctx.font = "600 " + bodySize + "px 'DM Sans', 'Inter', sans-serif";
          centreText(ctx, lines[j], cx, y + rh / 2 - (lines.length - 1) * bodySize * 0.575 + j * bodySize * 1.15 + bodySize * 0.34, palette.cream);
        }
        y += rh * 1.16;
      }
      // The section mark under the message, and the pair of leafy sprigs the
      // banner composition flanks it with — both only when there is genuinely
      // room below the ribbon for them. A poster with no call to action gives
      // the ribbon the whole sheet, and the mark was drawn 2px past the bottom
      // edge. An ornament is optional; the sheet's edge is not.
      if (L.kind !== "editorial" && y + h * 0.016 <= contentFloor) {
        if (sympathy) drawDiamondMark(ctx, cx, y, h * 0.009, rgba(palette.ink, 0.5));
        else drawHeart(ctx, cx, y, h * 0.011, rgba(palette.ink, 0.6));
        // The reference flanks its date with a pair of leafy sprigs; the
        // banner composition is the one that takes them. They belong to the
        // mark, so they live inside the same test for room rather than
        // carrying a second copy of it that could drift.
        if (composition === "banner") {
          drawSprig(ctx, cx - w * 0.055, y + h * 0.004, w * 0.05, -1, rgba(palette.ink, 0.45));
          drawSprig(ctx, cx + w * 0.055, y + h * 0.004, w * 0.05, 1, rgba(palette.ink, 0.45));
        }
      }
      y += h * 0.032 + gap;
    }

    // --- the call to action, in a bordered panel ---
    // Everything about the contact panel was resolved above, so the ribbon
    // could be kept clear of it. Reusing those values rather than working
    // them out a second time is what keeps the two in step.
    var cta = ctaText, phone = ctaPhone, lead = ctaLead, trail = ctaTrail;
    var contentBottom = y, panelTop = y;
    if (cta) {
      var panelW = maxW;
      // Bottom-anchored so the sheet is filled rather than the design
      // stacking from the top and leaving the lower third empty.
      contentBottom = y;
      // Bottom-anchored so the sheet fills — but never past the bottom of
      // it. Without the clamp, ordinary two-sentence copy pushed the trailing
      // line of the call to action clean off the canvas: drawn at y=1412 on a
      // 1350-tall sheet, taking the shop's phone number with it. A florist
      // would have posted a flyer with no way to reach them on it.
      var panelY = Math.max(y, h - panelH - L.bottomPad);
      // The emergency floor, for copy long enough to push the panel down past
      // its intended margin. It was the bare sheet's edge less 2%, which on
      // every framed composition is BELOW the frame rule: long copy printed
      // the bordered contact panel straight across the poster's own border.
      // The frame inset is the real floor — the panel is inside the frame or
      // it is not part of the design.
      var lowest = h - panelH - Math.max(h * 0.02, inset);
      if (panelY > lowest) panelY = Math.max(h * 0.02, lowest);
      panelTop = panelY;
      panelRect = { x: cx - maxW / 2, y: panelY, w: maxW, h: panelH };

      if (L.kind === "editorial") {
        // One bar across the whole foot of the picture — the phone number set
        // in vector type that is always correct, which is precisely what the
        // image model behind a scene like this cannot be trusted to do.
        var barX = w * 0.055, barW = w - barX * 2;
        drawCtaBar(ctx, barX, panelY, barW, panelH, palette);
        var barCx = w / 2;
        // Sized to the BAR, not to the sheet. Taken from the height alone, a
        // taller canvas gave the bar enormous type and the "CALL <number>"
        // line ran off both ends of it — 41 of 3600 fuzzed combinations, all
        // at Story height. The heart sits outside the line too, so its room
        // is part of what has to fit.
        var callSize = Math.round(panelH * 0.30);
        var numSize = Math.round(panelH * 0.42);
        var innerW = barW - panelH * 0.9;
        var numW = 0, leadW = 0, lineW = 0;
        for (var fit = 0; fit < 12; fit++) {
          ctx.font = "600 " + numSize + "px 'Playfair Display', Georgia, serif";
          numW = ctx.measureText(phone || "").width;
          ctx.font = "500 " + callSize + "px 'Playfair Display', Georgia, serif";
          leadW = lead ? ctx.measureText(lead.toUpperCase() + " ").width : 0;
          lineW = leadW + numW;
          if (lineW <= innerW || numSize <= 10) break;
          numSize = Math.max(10, Math.floor(numSize * 0.92));
          callSize = Math.max(8, Math.floor(callSize * 0.92));
        }
        var startX = barCx - lineW / 2;
        var baseY = panelY + panelH * (trail ? 0.5 : 0.62);
        ctx.save();
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        if (lead) {
          ctx.font = "500 " + callSize + "px 'Playfair Display', Georgia, serif";
          ctx.fillStyle = rgba(palette.cream, 0.92);
          ctx.fillText(lead.toUpperCase() + " ", startX, baseY);
        }
        if (phone) {
          ctx.font = "600 " + numSize + "px 'Playfair Display', Georgia, serif";
          ctx.fillStyle = palette.cream;
          ctx.fillText(phone, startX + leadW, baseY);
        }
        ctx.restore();
        if (sympathy) drawDiamondMark(ctx, startX - panelH * 0.26, baseY - numSize * 0.32, panelH * 0.075, rgba(palette.cream, 0.7));
        else drawHeart(ctx, startX - panelH * 0.26, baseY - numSize * 0.32, panelH * 0.09, rgba(palette.cream, 0.75));
        if (trail) {
          var tSize = Math.round(panelH * 0.19);
          ctx.font = "500 " + tSize + "px 'Playfair Display', Georgia, serif";
          if ("letterSpacing" in ctx) ctx.letterSpacing = "0.08em";
          centreText(ctx, trail.toUpperCase(), barCx, panelY + panelH * 0.83, rgba(palette.cream, 0.82));
          if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
        }
        return { composition: composition, contentBottom: contentBottom, panelTop: panelTop, headBottom: headBottom, ribbon: ribbonRect, column: maxW, bodyWidth: bodyWidth, frame: frameRect, panel: panelRect };
      }

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
        if (sympathy) drawDiamondMark(ctx, cx, inner + trailFit * 0.35, h * 0.008, rgba(palette.ink, 0.45));
        else drawHeart(ctx, cx, inner + trailFit * 0.35, h * 0.0095, rgba(palette.ink, 0.55));
        centreText(ctx, trail.toUpperCase(), cx, inner + trailFit * 1.75, rgba(palette.ink, 0.8));
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      }
    }

    return { composition: composition, contentBottom: contentBottom, panelTop: panelTop, headBottom: headBottom, ribbon: ribbonRect, column: maxW, bodyWidth: bodyWidth, frame: frameRect, panel: panelRect };
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
  /**
   * Lays the poster out once against a context that measures but paints
   * nothing, to learn how tall it naturally is, then sets `typeScale` and
   * `extraGap` on `base` so it fits the sheet it was given.
   *
   * Extracted from renderPoster so the tests can exercise the composition the
   * way the product actually calls it. A guarantee that only holds when a
   * helper happens to have run first is not a guarantee, and the off-sheet
   * checks were being made against a drawPoster call no shipped code path
   * makes. Mutates and returns `base`.
   */
  function fitPoster(ctx, base) {
    var probeCtx = R.measuringContext ? R.measuringContext(ctx) : null;
    if (!probeCtx) return base;
    var height = base.height;
    var measure = function (extra) {
      return drawPoster(probeCtx, Object.assign({}, base, extra, { measureOnly: true }));
    };
    // Shrink first, then breathe. A composition taller than its sheet cannot
    // be fixed by spacing: the bottom-anchored contact panel gets dragged up
    // over the ribbon and the two print on top of each other, which is
    // exactly what the head-band layout did on its first render.
    var scale = 1, dry = measure({});
    for (var attempt = 0; attempt < 5 && dry.contentBottom > dry.panelTop; attempt++) {
      var over = dry.contentBottom - dry.panelTop;
      var span = Math.max(1, dry.contentBottom - height * 0.05);
      scale = Math.max(0.55, scale * Math.max(0.82, 1 - over / span));
      dry = measure({ typeScale: scale });
    }
    if (scale < 1) base.typeScale = scale;
    // Only once it fits is the leftover room shared between the three section
    // joints, plus a half share at the top — three and a half times in total,
    // which is what it has to be divided by.
    var slack = dry.panelTop - dry.contentBottom;
    if (slack > 0) base.extraGap = Math.min(slack / 3.5, height * 0.045);
    return base;
  }

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
      // Which half of the photograph the wording goes in, decided from the
      // picture itself rather than guessed — and decided ONCE, so the
      // measuring pass and the drawing pass cannot disagree about it.
      var textSide = "left";
      if (img) {
        try {
          var sideProbe = document.createElement("canvas");
          sideProbe.width = 32; sideProbe.height = 40;
          var sp = sideProbe.getContext("2d", { willReadFrequently: true });
          sp.drawImage(img, 0, 0, 32, 40);
          var sd = sp.getImageData(0, 0, 32, 40);
          var leftBusy = R.busyFractionIn ? R.busyFractionIn(sd, { x: 0, y: 4, w: 15, h: 32 }) : 0;
          var rightBusy = R.busyFractionIn ? R.busyFractionIn(sd, { x: 17, y: 4, w: 15, h: 32 }) : 0;
          textSide = rightBusy < leftBusy ? "right" : "left";
        } catch (e) {
          textSide = "left";
        }
      }
      // And whether that half can carry dark type at all. Judged once for the
      // WHOLE column: backing each line separately turned the message into a
      // stack of little staggered banners, which is the same mistake as three
      // cards with seams, one level down.
      var needsBackdrop = false;
      if (img) {
        try {
          var bp = document.createElement("canvas");
          bp.width = 60; bp.height = 60;
          var bc = bp.getContext("2d", { willReadFrequently: true });
          bc.drawImage(img, 0, 0, 60, 60);
          var bd = bc.getImageData(0, 0, 60, 60);
          var col = textSide === "right" ? { x: 32, y: 6, w: 26, h: 44 } : { x: 2, y: 6, w: 26, h: 44 };
          needsBackdrop = R.needsBannerBehind ? R.needsBannerBehind(bd, col, palette.ink, 0.92) : false;
        } catch (e) {
          needsBackdrop = false;
        }
      }
      var base = {
        width: width, height: height, content: opts.content, brand: brand,
        palette: palette, image: img, seed: seed, textSide: textSide,
        needsBackdrop: needsBackdrop
      };
      // Lay the poster out once against a context that measures but paints
      // nothing, to learn how tall it naturally is. Short wording used to
      // stack from the top and leave a band of empty sheet above the
      // bottom-anchored contact panel; long wording ran the other way. The
      // slack that remains is shared between the three section joints, so
      // the design breathes to fill whatever it is given instead of the
      // spacing being a fixed guess that only suits one length.
      fitPoster(ctx, base);
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
    isSympathyContent: isSympathyContent,
    fitPoster: fitPoster,
    renderPoster: renderPoster
  };

  global.FlorisynFlyerPoster = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
