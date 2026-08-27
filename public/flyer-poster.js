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
    // Ink must stay dark enough to read on a pale ground whatever the photo.
    while (luminance(ink) > 0.24) ink = mix(ink, { r: 0, g: 0, b: 0 }, 0.16);

    var tintSource = sample || brand;
    var ground = mix({ r: 255, g: 253, b: 251 }, tintSource, 0.055);
    var groundDeep = mix({ r: 255, g: 253, b: 251 }, tintSource, 0.13);

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

    if (!img) return;

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
  function drawRibbon(ctx, cx, cy, w, h, palette) {
    var notch = h * 0.32;
    ctx.save();
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy - h / 2);
    ctx.lineTo(cx + w / 2 - notch, cy);
    ctx.lineTo(cx + w / 2, cy + h / 2);
    ctx.lineTo(cx - w / 2, cy + h / 2);
    ctx.lineTo(cx - w / 2 + notch, cy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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

    paintGroundAndFlorals(ctx, w, h, opts.image, palette, rand);
    drawBorder(ctx, w, h, palette, rand() > 0.45 ? "double" : "single");

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
      centreText(ctx, String(brand.shopName).toUpperCase(), cx, y, palette.ink);
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
      centreText(ctx, parts.lead.toUpperCase(), cx, y + leadSize * 0.8, rgba(palette.ink, 0.85));
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
      centreText(ctx, parts.script, cx, y + scriptSize * 0.78, palette.ink);
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
      centreText(ctx, parts.tail.toUpperCase(), cx, y + tailSize, rgba(palette.ink, 0.85));
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
          centreText(ctx, lines[li], cx, y + bodySize * (li + 1) * 1.32, rgba(palette.ink, 0.9));
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
      if (composition !== "atelier") drawPanel(ctx, cx - panelW / 2, panelY, panelW, panelH, palette);

      var inner = panelY + panelH * 0.34;
      if (lead) {
        var leadS = fitLine(ctx, lead.toUpperCase(), "500 %spx 'DM Sans', 'Inter', sans-serif",
          Math.round(h * 0.03), panelW * 0.88, Math.round(h * 0.019));
        ctx.font = "500 " + leadS + "px 'DM Sans', 'Inter', sans-serif";
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0.06em";
        centreText(ctx, lead.toUpperCase(), cx, inner, rgba(palette.ink, 0.82));
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      }
      if (phone) {
        var phoneS = fitLine(ctx, phone, "600 %spx 'Playfair Display', Georgia, serif",
          Math.round(h * 0.072), panelW * 0.9, Math.round(h * 0.04));
        ctx.font = "600 " + phoneS + "px 'Playfair Display', Georgia, serif";
        centreText(ctx, phone, cx, inner + phoneS * 0.98, palette.ink);
        if (trail) {
          var trailS = Math.round(h * 0.026);
          ctx.font = "500 " + trailS + "px 'DM Sans', 'Inter', sans-serif";
          if ("letterSpacing" in ctx) ctx.letterSpacing = "0.05em";
          centreText(ctx, trail.toUpperCase(), cx, inner + phoneS * 1.05 + trailS * 1.5, rgba(palette.ink, 0.78));
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
