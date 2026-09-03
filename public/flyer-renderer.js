/**
 * Florisyn Flyer Renderer — client-side canvas compositor for the Visual
 * Creation Studio's finishing layer.
 *
 * This is NOT the primary creative engine — see the server's
 * ai-intent-router.js module docstring for the full reasoning. The
 * primary workflow generates a real AI visual concept first (a
 * photographic backdrop, via _shared/ai-image-engine.js's
 * buildFlyerBackgroundPrompt()/buildBackgroundPrompt()) or composites a
 * real segmented product photo onto one; this module's only job is what a
 * generated image alone can't guarantee: exact text, brand lockup, and
 * legibility on top of it.
 *
 * Design pass v3 (Ashley's live-tested visual-quality directive — explicit
 * rejection of v2's colored band): the floral photo fills the ENTIRE
 * canvas, full-bleed and edge to edge, with NOTHING drawn over it — no
 * box, no gradient band, no brand-color wash of any kind. "A shop's brand
 * color should not become a large transparent layer covering the
 * flowers" applies to every hue, not just navy/burgundy — v2's band was
 * exactly that, just recolored. Legibility instead comes from what the
 * photo actually is at each text region: every region's real rendered
 * pixels are sampled after the background is drawn (sampleAverageColor/
 * sampleColorVariance, both already built for exactly this and now
 * actually wired into the render path), pickTextColor chooses cream or
 * charcoal-navy from that region's real luminance, and needsScrim decides
 * whether that region additionally needs a thin outline on top of the
 * standing subtle drop shadow — real insurance, never a substitute for a
 * genuinely bright, open composition (buildFlyerBackgroundPrompt in
 * ai-image-engine.js composes the photo with real negative space where
 * text will sit, precisely so this is rarely needed at all). The shop
 * name is always drawn (drawShopNameLockup) whenever brand.shopName is
 * given — never Florisyn's own name, always the authenticated shop's.
 *
 * Three things live here:
 *
 *   1. compositeSubjectOnBackground() — the segment+generate+composite
 *      substitute for true inpainting (this Cloudflare account has no
 *      verified image-editing model): places a real client-segmented
 *      cutout (photo-studio.js's removeBackground() output) over a
 *      server-generated backdrop-only image.
 *
 *   2. renderFlyer() — draws the full-bleed photo (Tier A) or, when no
 *      photo exists, a bright ivory Tier-B floral-toned treatment, then
 *      every text region directly on top of it. There is no band and no
 *      panel — see the design pass above.
 *
 *   3. Pure, DOM-free helpers (region math, luminance, contrast decisions,
 *      band/panel-bounds math) are exported for unit testing the same way
 *      photo-studio.js's mask math is — see this file's module.exports
 *      guard at the bottom.
 */
(function (global) {
  "use strict";

  // Matches ai-visual-revisions.js's SCALE_STEPS ["small","normal","large",
  // "x-large","xx-large"] — five distinct steps need five distinct
  // multipliers, or two consecutive "bigger" revisions render identically.
  var SCALE_MULTIPLIER = { small: 0.72, normal: 1, large: 1.18, "x-large": 1.4, "xx-large": 1.62 };

  // The no-photo (Tier B) base tone: a bright, warm ivory. Deliberately
  // light and neutral so the fallback reads bright and premium rather than
  // as a saturated slab of the shop's own brand colour — see paintTierB.
  // This is the LAST resort, below the real floral fallback photo.
  var TIER_B_BASE = "#fbf6ef";

  // Outline thickness as a fraction of the FONT size (see outlineFor).
  // A hairline: enough to separate letterforms from petals, never enough
  // to thicken or blur them.
  var OUTLINE_WIDTH_RATIO = 0.028;

  // The smallest the shop-name lockup may go. A name long enough to need
  // this is unavoidably small, but it must still FIT — running off both
  // edges of the canvas, as an unbounded lockup did, is never acceptable.
  var LOCKUP_MIN_FONT = 26;

  // The absolute floor, used only after the tracking has already been
  // surrendered. Fitting inside the canvas outranks any preferred size:
  // a clipped shop name is a broken flyer, a small one is merely a very
  // long name.
  var LOCKUP_HARD_MIN_FONT = 16;

  // The CTA's absolute floor, reached only by a pathologically long call to
  // action that would otherwise collide with the message above it.
  var MIN_CTA_FONT = 30;

  // Tier B's real floral fallback.
  //
  // A bright background with no flowers does not meet the accepted
  // standard — a flyer that reaches a customer has to actually look like
  // a florist's flyer. When the AI backdrop is unavailable (provider
  // unconfigured, both generation attempts failed, or the stored image
  // fails to load) this real floral photograph is drawn full-bleed
  // instead, exactly like a generated one: no wash, no panel, no box,
  // with every text region still taking its colour from the real pixels.
  //
  // Chosen from assets this repository already owns and already ships
  // publicly — /assets/atelier-floral-corner.jpg is a committed asset
  // used as a background in florisyn-atelier-{ui,shell,admin}.css and on
  // the marketing index page, and it is part of the same curated local
  // floral photography family scripts/floral-library-image-pool.mjs
  // draws from. Nothing new or externally sourced is introduced here.
  // Its composition is also the right one: blooms sweeping in from the
  // upper corner, soft open space across the lower portion — which is
  // precisely where flyer-templates.js places every text region.
  //
  // NOT AI output and never to be reported as such. renderFlyer stamps
  // the canvas with which tier actually drew the background so no caller,
  // UI, or report can mistake this for a live provider image.
  var FALLBACK_FLORAL_BACKGROUND = "/assets/atelier-floral-corner.jpg";

  var BACKGROUND_TIER = {
    GENERATED: "generated",
    FALLBACK_PHOTO: "fallback-library-photo",
    PROCEDURAL: "fallback-procedural"
  };

  /** Converts a template region (fractions 0–1 of the canvas) into real
   * pixel coordinates for a given canvas size. Pure. */
  function regionRect(region, width, height) {
    region = region || {};
    return {
      x: Math.round((region.x || 0) * width),
      y: Math.round((region.y || 0) * height),
      w: Math.round((region.w || 0) * width),
      h: Math.round((region.h || 0) * height)
    };
  }

  /** Relative luminance (WCAG formula) from 0–255 channel values. Pure. */
  function relativeLuminance(r, g, b) {
    function lin(c) {
      var v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function clampRect(rect, width, height) {
    if (width <= 0 || height <= 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    // Snap to whole pixels. The samplers below index data[(y * width + x) * 4],
    // so a fractional bound makes every index fractional, every lookup
    // undefined and every luminance NaN — which does not throw, it quietly
    // returns nonsense (a variance of -255, an average of NaN). The
    // template regions happen to be integral, but a rect measured from real
    // text metrics is not, so normalise here rather than trusting callers.
    var x0 = Math.floor(Math.max(0, Math.min(width - 1, rect.x)));
    var y0 = Math.floor(Math.max(0, Math.min(height - 1, rect.y)));
    var x1 = Math.ceil(Math.max(x0 + 1, Math.min(width, rect.x + rect.w)));
    var y1 = Math.ceil(Math.max(y0 + 1, Math.min(height, rect.y + rect.h)));
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  /** Average color of one rectangle of an ImageData-shaped object
   * ({width,height,data}) — samples every `stride`th pixel for speed on
   * large canvases. Pure, works on plain typed arrays, so it's
   * unit-testable the same way photo-studio.js's mask math is. */
  function sampleAverageColor(imageData, rect, stride) {
    stride = stride || 4;
    var data = imageData.data, width = imageData.width, height = imageData.height;
    var b = clampRect(rect, width, height);
    var rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (var y = b.y0; y < b.y1; y += stride) {
      for (var x = b.x0; x < b.x1; x += stride) {
        var i = (y * width + x) * 4;
        rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
        count++;
      }
    }
    if (!count) return { r: 255, g: 255, b: 255 };
    return { r: rSum / count, g: gSum / count, b: bSum / count };
  }

  /** Spread (max − min relative luminance, 0–255 scale) over the same
   * rectangle sampleAverageColor() reads — a flat gradient scores low, a
   * busy photo (petals, leaves, shadows) scores high. Pure. */
  function sampleColorVariance(imageData, rect, stride) {
    stride = stride || 4;
    var data = imageData.data, width = imageData.width, height = imageData.height;
    var b = clampRect(rect, width, height);
    var minLum = 1, maxLum = 0, any = false;
    for (var y = b.y0; y < b.y1; y += stride) {
      for (var x = b.x0; x < b.x1; x += stride) {
        var i = (y * width + x) * 4;
        var lum = relativeLuminance(data[i], data[i + 1], data[i + 2]);
        if (lum < minLum) minLum = lum;
        if (lum > maxLum) maxLum = lum;
        any = true;
      }
    }
    if (!any) return 0;
    return (maxLum - minLum) * 255;
  }

  /** Picks readable text color for the average background color behind a
   * region — always derived from the actual pixels, never a fixed color,
   * so text can never go accidentally unreadable on a generated photo.
   * Restricted to Ashley's explicit allowed palette ("cream, white, navy
   * or charcoal text based on the photo's natural contrast"): a warm
   * cream over a dark region, a deep charcoal-navy over a light one —
   * never an arbitrary brand-color tint. Pure. */
  function pickTextColor(avgColor) {
    var luminance = relativeLuminance(avgColor.r, avgColor.g, avgColor.b);
    return luminance > 0.55 ? "#1f2733" : "#f8f0e3";
  }

  /** Whether a semi-transparent scrim is needed behind text for contrast —
   * a midtone background needs one even when the average alone looks
   * readable, and so does a background with a lot of local variation (a
   * busy photo, not a flat gradient) even at a "safe" average luminance.
   * Pure. */
  function needsScrim(avgColor, varianceEstimate) {
    var luminance = relativeLuminance(avgColor.r, avgColor.g, avgColor.b);
    var midtone = luminance > 0.35 && luminance < 0.75;
    return midtone || (varianceEstimate || 0) > 42;
  }

  /** Font-size multiplier for a revision-delta scale step ("small".."xx-large" —
   * see _shared/ai-visual-revisions.js's SCALE_STEPS). Pure, falls back to
   * "normal" for anything unrecognized rather than throwing. */
  function scaleMultiplier(scaleKey) {
    return SCALE_MULTIPLIER[scaleKey] || 1;
  }

  /**
   * The editorial card's panel bounds — the union of the headline/body/
   * cta/contact regions a template defines, expanded by a comfortable
   * margin, expressed as real pixel coordinates. Pure (only reads
   * template.regions + width/height), so the actual card geometry is
   * unit-testable without a DOM. Never exceeds the canvas bounds.
   *
   * Kept for backward compatibility (existing callers/tests of this
   * general "union of text regions" math) — renderFlyer() itself no
   * longer draws a boxed panel from this; see computeBandRect below for
   * the actual visual-quality-directive geometry (a full-width, bottom-
   * anchored gradient band, never an inset box).
   */
  function computePanelRect(template, width, height, paddingFraction) {
    var padding = paddingFraction == null ? 0.045 : paddingFraction;
    var regions = template && template.regions ? template.regions : {};
    var keys = ["headline", "body", "cta", "contact"];
    var minX = 1, minY = 1, maxX = 0, maxY = 0, any = false;
    for (var i = 0; i < keys.length; i++) {
      var r = regions[keys[i]];
      if (!r) continue;
      any = true;
      minX = Math.min(minX, r.x || 0);
      minY = Math.min(minY, r.y || 0);
      maxX = Math.max(maxX, (r.x || 0) + (r.w || 0));
      maxY = Math.max(maxY, (r.y || 0) + (r.h || 0));
    }
    if (!any) return regionRect({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 }, width, height);
    var px = Math.max(0, minX - padding);
    var py = Math.max(0, minY - padding * 0.7);
    var pw = Math.min(1 - px, maxX - minX + padding * 2);
    var ph = Math.min(1 - py, maxY - minY + padding * 1.4);
    return regionRect({ x: px, y: py, w: pw, h: ph }, width, height);
  }

  /**
   * Visual-quality directive (Ashley, live-tested feedback — "remove the
   * large white or beige content box... the floral image must fill the
   * complete canvas edge to edge"): the real geometry the renderer now
   * draws against. A full-WIDTH band (x=0, w=width — always edge to edge,
   * never inset) starting a little above the topmost text region and
   * running to the bottom of the canvas. Never a centered/inset box, so it
   * can never read as "a blank box covering the center of the flowers" —
   * it only ever touches the lower portion of the frame, and the entire
   * upper photo stays completely uncovered. Pure (only reads
   * template.regions + width/height), unit-testable without a DOM.
   */
  function computeBandRect(template, width, height) {
    var regions = template && template.regions ? template.regions : {};
    var keys = ["headline", "body", "cta", "contact"];
    var minY = 1, any = false;
    for (var i = 0; i < keys.length; i++) {
      var r = regions[keys[i]];
      if (!r) continue;
      any = true;
      minY = Math.min(minY, r.y || 0);
    }
    if (!any) minY = 0.55;
    var topFraction = Math.max(0, minY - 0.06);
    var y = Math.round(topFraction * height);
    return { x: 0, y: y, w: width, h: Math.max(0, height - y) };
  }

  // ---- Everything below needs a real DOM (canvas/Image) — not unit
  // tested directly, same convention as photo-studio.js's removeBackground()
  // browser wrapper vs. its tested removeBackgroundFromImageData(). ----

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      // crossOrigin=anonymous so a same-origin/CORS-enabled generated
      // image can still be read back via getImageData() for the
      // luminance sampling above — without it, a canvas holding a
      // cross-origin image throws on read ("tainted canvas").
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Could not load image: " + url)); };
      img.src = url;
    });
  }

  function drawCover(ctx, img, dx, dy, dw, dh) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var scale = Math.max(dw / iw, dh / ih);
    var sw = dw / scale, sh = dh / scale;
    var sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  /** Composites a real segmented cutout (photo-studio.js's
   * removeBackground() output — a canvas with alpha) over a
   * server-generated backdrop-only image, scaled to fill the requested
   * output size. This is the honest substitute for true inpainting this
   * platform doesn't have — see this module's own docstring. Returns
   * Promise<HTMLCanvasElement>. */
  function compositeSubjectOnBackground(opts) {
    opts = opts || {};
    var subjectCanvas = opts.subjectCanvas;
    var backgroundUrl = opts.backgroundUrl;
    var outWidth = opts.outWidth || 1200;
    var outHeight = opts.outHeight || 1200;
    if (!subjectCanvas || !backgroundUrl) {
      return Promise.reject(new Error("compositeSubjectOnBackground needs both subjectCanvas and backgroundUrl."));
    }
    return loadImage(backgroundUrl).then(function (bgImg) {
      var canvas = document.createElement("canvas");
      canvas.width = outWidth;
      canvas.height = outHeight;
      var ctx = canvas.getContext("2d");
      // Cover-fit the background so it always fills the frame, cropping
      // rather than distorting or leaving letterbox bars.
      drawCover(ctx, bgImg, 0, 0, outWidth, outHeight);
      // Fit the subject within a centered, generous frame — never
      // edge-to-edge, so the generated backdrop stays visible as context.
      var maxW = outWidth * 0.82, maxH = outHeight * 0.82;
      var scale = Math.min(maxW / subjectCanvas.width, maxH / subjectCanvas.height, 1);
      var w = subjectCanvas.width * scale, h = subjectCanvas.height * scale;
      var x = (outWidth - w) / 2, y = (outHeight - h) / 2 + outHeight * 0.03;
      ctx.drawImage(subjectCanvas, x, y, w, h);
      return canvas;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function measureWrappedLines(ctx, text, maxWidth) {
    var words = String(text).split(/\s+/);
    var lines = [];
    var current = "";
    for (var i = 0; i < words.length; i++) {
      var test = current ? current + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = words[i];
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  /** Draws one line of text, with an optional thin outline stroked
   * underneath the fill (needsScrim's "thin outline when needed" — real
   * insurance on a busy/midtone photo region, never a filled panel).
   * outline is {color, width} or falsy. */
  function drawTextLine(ctx, text, x, y, outline) {
    if (outline) {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.lineWidth = outline.width;
      ctx.strokeStyle = outline.color;
      ctx.strokeText(text, x, y);
      ctx.restore();
    }
    ctx.fillText(text, x, y);
  }

  function drawWrappedLines(ctx, lines, cx, cy, lineHeight, outline) {
    var startY = cy - ((lines.length - 1) * lineHeight) / 2;
    for (var j = 0; j < lines.length; j++) drawTextLine(ctx, lines[j], cx, startY + j * lineHeight, outline);
  }

  function setLetterSpacing(ctx, value) {
    // ctx.letterSpacing is a real, standard Canvas2D property in current
    // engines (unprefixed since ~Chrome 99) — feature-detected so this
    // never throws on an older/unsupported runtime, it just falls back to
    // the browser's default (zero) spacing.
    try {
      if ("letterSpacing" in ctx) ctx.letterSpacing = value;
    } catch (e) { /* unsupported — plain spacing, still fully readable */ }
  }

  // Design pass v3: no gradient band means no guaranteed-dark backdrop, so
  // text color is real per-region contrast again (pickTextColorFor,
  // below) — never this fixed pair on its own. BAND_TEXT_COLOR/
  // BAND_TEXT_COLOR_SOFT stay as the SAFE DEFAULT for when a region can't
  // be sampled at all (a tainted cross-origin canvas, or the Tier-B paint
  // path — see paintTierB, which is a known flat/gradient fill Florisyn
  // itself controls, always dark enough for cream text) — never the
  // everyday case.
  var BAND_TEXT_COLOR = "#f8f0e3";
  var BAND_TEXT_COLOR_SOFT = "rgba(248,240,227,0.88)";
  var CHARCOAL_TEXT = "#1f2733";
  var CHARCOAL_TEXT_SOFT = "rgba(31,39,51,0.88)";

  /** Real per-region contrast, sampled from the canvas's OWN actual
   * rendered pixels at `rect` — never a fixed color, never a flat
   * brand-color layer painted over the photo. Falls back to the safe
   * cream default if sampling fails (a tainted cross-origin canvas —
   * loadImage already sets crossOrigin="anonymous" specifically so this
   * doesn't happen for a real generated background, but this must never
   * throw regardless). Returns { color, softColor, outline } — outline is
   * null unless needsScrim says the region is busy/midtone enough to
   * need one (a thin stroke, Ashley's explicitly allowed "thin outline
   * when needed" — never a filled panel). */
  function pickRegionTextStyle(ctx, rect, background) {
    var safeRect = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      w: Math.max(1, Math.round(rect.w)),
      h: Math.max(1, Math.round(rect.h))
    };
    // The whole canvas has usually been read back already for the placement
    // and banner decisions. Reading five more slices of the same pixels is
    // a GPU-to-CPU round trip per region for nothing.
    var imageData, localRect;
    if (background) {
      imageData = background;
      localRect = safeRect;
    } else {
      try {
        imageData = ctx.getImageData(safeRect.x, safeRect.y, safeRect.w, safeRect.h);
      } catch (e) {
        return { color: BAND_TEXT_COLOR, softColor: BAND_TEXT_COLOR_SOFT, outline: { color: "rgba(6,10,18,0.6)", width: Math.max(1, rect.h * 0.01), widthRatio: OUTLINE_WIDTH_RATIO } };
      }
      localRect = { x: 0, y: 0, w: imageData.width, h: imageData.height };
    }
    var avg = sampleAverageColor(imageData, localRect, 4);
    var variance = sampleColorVariance(imageData, localRect, 4);
    var isDark = pickTextColor(avg) === BAND_TEXT_COLOR;
    var scrim = needsScrim(avg, variance);
    return {
      color: isDark ? BAND_TEXT_COLOR : CHARCOAL_TEXT,
      softColor: isDark ? BAND_TEXT_COLOR_SOFT : CHARCOAL_TEXT_SOFT,
      outline: scrim ? { color: isDark ? "rgba(6,10,18,0.6)" : "rgba(255,255,255,0.65)", width: Math.max(1, rect.h * 0.01), widthRatio: OUTLINE_WIDTH_RATIO } : null
    };
  }

  // --- wording that lands on flowers -----------------------------------------
  //
  // Ashley, on a live flyer whose call-to-action sat on a bank of orange
  // lilies: "you can't read it, the text should be up in the blank space
  // where no flowers are or should have a banner behind it so you can see
  // the wording."
  //
  // Both halves of that are implemented here, in that order of preference.
  // Choosing a calm part of the photograph is the better answer because it
  // leaves the picture untouched; a banner is the fallback for a photo with
  // no calm area big enough, and it hugs one block of text rather than
  // becoming the full-width panel that was rejected long ago.
  //
  // Colour and a thin outline were never enough on their own: white text
  // with a hairline stroke over bright petals is exactly the flyer that
  // prompted this, and no choice of colour is readable against pixels that
  // span the whole range underneath a single line.

  var CELL_VARIANCE_THRESHOLD = 26;   // luminance spread within one cell, 0-255
  var BUSY_FRACTION_THRESHOLD = 0.28; // how much of a block must be on flowers
  var BANNER_CONTRAST_FLOOR = 3;      // WCAG AA for large text

  /**
   * Parses either form the renderer actually uses — "#rrggbb", "#rgb", or
   * "rgba(r,g,b,a)" — into channels plus opacity.
   *
   * A hex-only parser was silently catastrophic here: two of the four blocks
   * pass an rgba() string, and slicing "rgba(31,39,51,0.88)" as if it were
   * hex yields {r:0, g:186, b:0} — bright green. So the body and the contact
   * line, the two the marketing rules single out as needing to stay readable
   * on a phone, had their readability measured against a colour that is never
   * drawn, and produced the same answer whether the text was cream or
   * charcoal. Pure.
   */
  function parseColor(color) {
    var str = String(color == null ? "" : color).trim();
    var m = /^rgba?\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(str);
    if (m) {
      return {
        r: Math.max(0, Math.min(255, parseFloat(m[1]))),
        g: Math.max(0, Math.min(255, parseFloat(m[2]))),
        b: Math.max(0, Math.min(255, parseFloat(m[3]))),
        a: m[4] === undefined ? 1 : Math.max(0, Math.min(1, parseFloat(m[4])))
      };
    }
    var h = str.replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    if (!/^[0-9a-f]{6}$/i.test(h)) return { r: 0, g: 0, b: 0, a: 1 };
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
      a: 1
    };
  }
  function hexToRgbParts(hex) { return parseColor(hex); }

  /** WCAG-style contrast ratio between two rgb colours. Pure. */
  function contrastRatio(a, b) {
    var la = relativeLuminance(a.r, a.g, a.b), lb = relativeLuminance(b.r, b.g, b.b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** The opacity a CSS colour string will really paint at. Pure. */
  function colorAlpha(color) { return parseColor(color).a; }

  /**
   * How much of a rectangle is actually sitting on flowers, measured cell by
   * cell.
   *
   * Spread across the WHOLE rectangle is the wrong question: it is a
   * max-minus-min, so a single petal clipping one corner of a wide headline
   * scores as high as a headline buried in the bouquet. Tiling it and asking
   * how MANY cells are busy answers the question that matters — is the
   * wording on top of flowers — rather than "is there a flower anywhere near
   * this". Pure.
   */
  function busyFractionIn(imageData, rect) {
    if (!imageData || !rect || rect.w <= 0 || rect.h <= 0) return 0;
    var cols = 8, rows = 3, cells = cols * rows, busy = 0, seen = 0;
    var cw = rect.w / cols, ch = rect.h / rows;
    var need = Math.ceil(cells * BUSY_FRACTION_THRESHOLD);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        seen++;
        if (sampleColorVariance(imageData, { x: rect.x + c * cw, y: rect.y + r * ch, w: cw, h: ch }, 3) >= CELL_VARIANCE_THRESHOLD) busy++;
        // Both early-outs must divide by the same thing. Dividing the hit
        // by `seen` made the score depend on SCAN ORDER: a block one third
        // on flowers scored 1.0 if those cells came first and 0.30 if they
        // came last, so mirroring a photograph changed where the wording was
        // placed. The bail-outs are an optimisation; they may not change the
        // number.
        if (busy >= need || busy + (cells - seen) < need) return busy / cells;
      }
    }
    return busy / cells;
  }

  /**
   * How much of a block of wording is genuinely UNREADABLE in the colour it
   * will be drawn in — cell by cell, against the real pixels.
   *
   * "Are there flowers here" is the wrong question and produced a banner over
   * pale blush roses where dark text read perfectly well. Ashley's complaint
   * was specifically "you can't read it", so that is what gets measured. A
   * busy area usually fails this anyway, because one colour cannot read
   * against pixels spanning the whole range — but a photo that is merely
   * detailed and uniformly pale does not, and correctly keeps its bare text.
   * Pure.
   */
  function unreadableFraction(imageData, rect, colorHex, alpha) {
    if (!imageData || !rect || rect.w <= 0 || rect.h <= 0) return 0;
    var cols = 8, rows = 3, bad = 0, cells = cols * rows;
    var cw = rect.w / cols, ch = rect.h / rows;
    var ink = hexToRgbParts(colorHex);
    var a = typeof alpha === "number" ? alpha : 1;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var behind = sampleAverageColor(imageData, { x: rect.x + c * cw, y: rect.y + r * ch, w: cw, h: ch }, 3);
        var drawn = a >= 1 ? ink : {
          r: behind.r + (ink.r - behind.r) * a,
          g: behind.g + (ink.g - behind.g) * a,
          b: behind.b + (ink.b - behind.b) * a
        };
        if (contrastRatio(behind, drawn) < BANNER_CONTRAST_FLOOR) bad++;
      }
    }
    return bad / cells;
  }

  /** Whether a block needs a banner: any real part of it cannot be read as
   * drawn. The bar is deliberately low — a phone number with a tenth of it
   * invisible is a failed flyer, not a near miss — and it is measured on the
   * GLYPH box, never on the padded banner shape. Measuring the padded shape
   * was how the call-to-action escaped: its padding and divider rule reached
   * down into the dark roses where cream reads perfectly well, diluting the
   * score to just under the threshold while the words themselves sat on pale
   * pink and could not be read at all. */
  var UNREADABLE_THRESHOLD = 0.12;
  function needsBannerBehind(imageData, rect, colorHex, alpha) {
    if (!imageData || !rect) return false;
    return unreadableFraction(imageData, rect, colorHex, alpha) >= UNREADABLE_THRESHOLD;
  }

  /**
   * A busyness reading for each horizontal strip of the picture, taken over
   * the column the wording actually occupies. This is what lets the layout
   * find "the blank space where no flowers are" instead of trusting the
   * template's fixed coordinates, which know nothing about the photograph
   * that happened to be generated. Pure.
   */
  function busyRowProfile(imageData, columnRect, rows) {
    rows = Math.max(1, rows || 24);
    var out = [];
    var stripH = columnRect.h / rows;
    for (var i = 0; i < rows; i++) {
      out.push(busyFractionIn(imageData, { x: columnRect.x, y: columnRect.y + i * stripH, w: columnRect.w, h: stripH }));
    }
    return out;
  }

  /**
   * The calmest run of `need` consecutive strips. Returns its start index and
   * mean busyness, so a caller can both place the block and tell whether the
   * best available spot is actually any good. Ties go to the earliest window,
   * which keeps the result stable for the same photo. Pure.
   */
  function findCalmWindow(profile, need) {
    if (!profile || !profile.length) return { start: 0, score: 1 };
    need = Math.max(1, Math.min(need || 1, profile.length));
    var best = { start: 0, score: Infinity }, sum = 0;
    for (var i = 0; i < profile.length; i++) {
      sum += profile[i];
      if (i >= need) sum -= profile[i - need];
      if (i >= need - 1) {
        var score = sum / need;
        if (score < best.score - 1e-9) best = { start: i - need + 1, score: score };
      }
    }
    return best;
  }

  /**
   * The band a banner occupies behind a block of wording, hugging the real
   * text extent rather than the region box — a banner the size of the region
   * IS the full-width panel that was rejected. Pure.
   */
  function bannerBand(m) {
    var pad = Math.min(m.fontSize * 0.3, Math.max(m.fontSize * 0.16, m.blockHeight * 0.1));
    // The chevron notch bites into both ends, so the words need clearance
    // past it or the first and last letters sit on the cut.
    var notch = Math.min((m.blockHeight + pad * 1.4) * 0.3, m.fontSize * 0.5);
    var x = m.cx - m.textWidth / 2 - pad - notch;
    var y = m.top - pad * 0.7;
    var w = m.textWidth + (pad + notch) * 2;
    var h = m.blockHeight + pad * 1.4;
    if (m.maxWidth > 0 && w > m.maxWidth) { x = m.cx - m.maxWidth / 2; w = m.maxWidth; }
    return { x: x, y: y, w: w, h: h, radius: Math.min(h * 0.28, m.fontSize * 0.5) };
  }

  /** Mixes a colour toward black. Used for a ribbon's folded tails, which
   * have to read as the same ribbon seen from behind. Pure. */
  function darken(color, amount) {
    var c = parseColor(color);
    return "rgb(" + Math.round(c.r * (1 - amount)) + "," + Math.round(c.g * (1 - amount)) + "," + Math.round(c.b * (1 - amount)) + ")";
  }

  /**
   * A RIBBON, not a box.
   *
   * Ashley, shown a rounded white rectangle behind the wording and her own
   * reference poster side by side: "when I say banner it should look like
   * picture 2 not a box like picture 1." Picture 2 carries its key line on a
   * proper banner — a filled shape in the shop's own colour, chevron-notched
   * at both ends, with small folded tails behind it and light text on top.
   * That is a designed device; a rounded white rectangle is a dialog box laid
   * over a photograph.
   *
   * Filled in the shop's own primary so it belongs to that florist, and dark
   * enough that the cream wording on it reads at any size.
   */
  function drawBanner(ctx, band, ribbonColor) {
    var x = band.x, y = band.y, w = band.w, h = band.h;
    var notch = Math.min(h * 0.3, w * 0.07);
    var tail = Math.min(h * 0.4, w * 0.045);
    var fold = h * 0.2;
    ctx.save();
    // The callers set a text shadow before drawing; save/restore preserves it
    // rather than clearing it, and a drop-shadowed ribbon reads as a sticker.
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // The folded tails, behind and darker, one at each end.
    ctx.fillStyle = darken(ribbonColor, 0.3);
    ctx.beginPath();
    ctx.moveTo(x, y + fold);
    ctx.lineTo(x - tail, y + fold * 1.7);
    ctx.lineTo(x - tail, y + h - fold * 0.3);
    ctx.lineTo(x, y + h - fold * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + w, y + fold);
    ctx.lineTo(x + w + tail, y + fold * 1.7);
    ctx.lineTo(x + w + tail, y + h - fold * 0.3);
    ctx.lineTo(x + w, y + h - fold * 0.6);
    ctx.closePath();
    ctx.fill();

    // The ribbon itself, chevron-notched into both ends.
    ctx.fillStyle = ribbonColor;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - notch, y + h / 2);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + notch, y + h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * How far to slide the whole block of wording so it sits in the calmest
   * part of the picture — "up in the blank space where no flowers are".
   *
   * Returns 0 when the picture cannot be read, when nothing better exists, or
   * when the gain is too small to be worth disturbing a layout that was
   * designed on purpose. Moving costs something: the template's proportions
   * are deliberate, so a shift has to earn itself.
   */
  var CALM_ROWS = 32;
  var CALM_MIN_GAIN = 0.12;      // the move must cut busyness by this much
  function calmPlacementShift(background, stack, width, height) {
    if (!background) return 0;
    var blockH = stack.bottom - stack.top;
    if (blockH <= 0 || blockH >= height) return 0;
    // Only the vertical span the block could legally occupy is searched, so
    // the stack can never be slid off the top or bottom of the flyer.
    // The logo is painted last, on top of everything. Sliding the stack up
    // into its box put the shop's own name under its own logo.
    var margin = height * 0.03;
    var searchTop = Math.max(margin, stack.floor || 0);
    var searchH = height - margin * 2;
    if (searchH <= blockH) return 0;
    var profile = busyRowProfile(background, { x: stack.x, y: searchTop, w: stack.w, h: searchH }, CALM_ROWS);
    var stripH = searchH / CALM_ROWS;
    var need = Math.max(1, Math.round(blockH / stripH));
    var best = findCalmWindow(profile, need);
    var target = searchTop + best.start * stripH;
    // What the block would score where the template already puts it.
    var currentStart = Math.max(0, Math.min(CALM_ROWS - need, Math.round((stack.top - searchTop) / stripH)));
    var current = 0;
    for (var i = currentStart; i < currentStart + need && i < profile.length; i++) current += profile[i];
    current = current / need;
    if (current - best.score < CALM_MIN_GAIN) return 0;
    return Math.round(target - stack.top);
  }

  /**
   * A context that measures exactly like the real one but paints nothing.
   *
   * The banner has to go down BEFORE the text it sits behind, but which
   * blocks need one — and how big each is — is only known once each block has
   * been fitted and wrapped. Running the real drawing code against this first
   * answers that without a second, drifting copy of the layout maths: the
   * blocks measure themselves exactly as they will draw themselves, and every
   * mark is swallowed.
   */
  function measuringContext(real) {
    var noop = function () {};
    var fake = {
      measureText: function (t) { return real.measureText(t); },
      save: noop, restore: noop, beginPath: noop, closePath: noop,
      moveTo: noop, lineTo: noop, rect: noop, arcTo: noop, arc: noop,
      quadraticCurveTo: noop, bezierCurveTo: noop,
      fill: noop, stroke: noop, fillText: noop, strokeText: noop,
      drawImage: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
      createLinearGradient: function () { return { addColorStop: noop }; },
      createRadialGradient: function () { return { addColorStop: noop }; },
      createPattern: function () { return null; },
      getImageData: function () { return real.getImageData.apply(real, arguments); }
    };
    // Assigning an unknown PROPERTY to a plain object is silent, but calling
    // an unknown METHOD throws — and the measuring pass has no catch around
    // it, so adding a clip() or a translate() to any drawer would make the
    // whole flyer fail to render rather than merely look wrong. Every
    // remaining path-and-transform call is stubbed so that cannot happen.
    ["clip", "translate", "rotate", "scale", "transform", "setTransform",
     "resetTransform", "setLineDash", "ellipse", "roundRect", "putImageData",
     "clearHitRegions", "drawFocusIfNeeded"].forEach(function (name) {
      if (typeof fake[name] !== "function") fake[name] = noop;
    });
    // The drawers set and read these; the font in particular must reach the
    // real context or measureText would report the wrong widths.
    Object.defineProperty(fake, "font", {
      get: function () { return real.font; }, set: function (v) { real.font = v; }
    });
    Object.defineProperty(fake, "letterSpacing", {
      get: function () { return real.letterSpacing; },
      set: function (v) { if ("letterSpacing" in real) real.letterSpacing = v; }
    });
    ["fillStyle", "strokeStyle", "lineWidth", "globalAlpha", "textAlign", "textBaseline",
     "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY"].forEach(function (k) {
      var store = null;
      Object.defineProperty(fake, k, { get: function () { return store; }, set: function (v) { store = v; } });
    });
    return fake;
  }

  /**
   * Merges banner bands that touch or nearly touch into single shapes.
   *
   * Three consecutive blocks each getting their own rounded rectangle reads as
   * three stacked cards with seams between them, not as one designed piece.
   * Where they are adjacent they should be one banner, which is also fewer
   * marks on the photograph. Pure.
   */
  function mergeBands(bands, gap) {
    if (!bands || !bands.length) return [];
    // Copied, not aliased. Documented pure while assigning through to the
    // caller's own objects means calling it twice on the same array gives
    // different answers the second time — a trap for any future caller.
    var sorted = bands.map(function (b) { return { x: b.x, y: b.y, w: b.w, h: b.h, radius: b.radius }; })
      .sort(function (a, b) { return a.y - b.y; });
    var out = [sorted[0]];
    for (var i = 1; i < sorted.length; i++) {
      var last = out[out.length - 1], b = sorted[i];
      if (b.y <= last.y + last.h + (gap || 0)) {
        var right = Math.max(last.x + last.w, b.x + b.w);
        var bottom = Math.max(last.y + last.h, b.y + b.h);
        last.x = Math.min(last.x, b.x);
        last.y = Math.min(last.y, b.y);
        last.w = right - last.x;
        last.h = bottom - last.y;
        last.radius = Math.max(last.radius, b.radius);
      } else {
        out.push(b);
      }
    }
    return out;
  }

  /** The whole picture, read back once before any wording is drawn, so every
   * block is judged against the photograph and never against a banner or a
   * line placed above it. Returns null when the canvas cannot be read. */
  function captureBackground(ctx, width, height) {
    try { return ctx.getImageData(0, 0, width, height); } catch (e) { return null; }
  }

  /** Where the shop-name lockup will actually be drawn, and the rectangle
   * whose real pixels decide its colour.
   *
   * Split out because the two must agree. A live-review defect: the
   * contrast sample was the full band width across the band's top 16%,
   * which on a corner-weighted floral photo is dominated by the dark
   * foliage sweeping in from one side — so the sampler judged the area
   * "dark" and chose CREAM text, while the letterforms themselves sit over
   * pale, bright backdrop in the middle. Cream on near-white, rescued only
   * by a dark outline, which is exactly the haloed look that reads as
   * blurry. Sampling the centred strip the text really occupies picks the
   * charcoal that belongs there, and usually needs no outline at all.
   * Pure. */
  function shopLockupMetrics(bandRect, shopName) {
    var fontSize = Math.max(20, Math.round(bandRect.h * 0.095));
    var baselineY = bandRect.y + bandRect.h * 0.135;
    // Generous tracking is what makes a short name read as a brand mark,
    // but on a long one it is pure width: at 0.16em a 51-character shop
    // name needs an extra ~500px it does not have. Ease it off rather than
    // paying for it in font size.
    var length = String(shopName == null ? "" : shopName).length;
    return {
      fontSize: fontSize,
      baselineY: baselineY,
      tracking: length > 22 ? "0.07em" : "0.16em",
      minFontSize: LOCKUP_MIN_FONT,
      maxWidth: bandRect.w * 0.92,
      sampleRect: {
        x: Math.round(bandRect.x + bandRect.w * 0.18),
        y: Math.round(baselineY - fontSize),
        w: Math.max(1, Math.round(bandRect.w * 0.64)),
        h: Math.max(1, Math.round(fontSize * 1.25))
      }
    };
  }

  /** Resolves the shop-name lockup to a size and tracking that genuinely
   * FIT inside `maxWidth`, mutating ctx's font/letterSpacing to match and
   * returning what it settled on.
   *
   * Exported and used by the real draw path so tests measure exactly what
   * ships — an earlier test re-implemented this arithmetic and drifted out
   * of step with it, which is its own bug. Needs only ctx.font,
   * ctx.letterSpacing and ctx.measureText.
   *
   * Order of sacrifice: size down to the preferred floor, then the
   * tracking, then size down again to the hard floor. Clipping is never
   * on the menu. */
  function fitShopLockup(ctx, bandRect, name) {
    var metrics = shopLockupMetrics(bandRect, name);
    var upper = String(name == null ? "" : name).toUpperCase();
    var maxWidth = metrics.maxWidth;
    var tracking = metrics.tracking;
    var fontSize = metrics.fontSize;

    function apply() {
      setLetterSpacing(ctx, tracking);
      ctx.font = "600 " + fontSize + "px 'Inter', sans-serif";
      return ctx.measureText(upper).width;
    }

    var width = apply();
    if (width > maxWidth) {
      fontSize = Math.max(metrics.minFontSize, Math.floor(fontSize * (maxWidth / width)));
      width = apply();
    }
    if (width > maxWidth) {
      tracking = "0px";
      width = apply();
    }
    if (width > maxWidth) {
      fontSize = Math.max(LOCKUP_HARD_MIN_FONT, Math.floor(fontSize * (maxWidth / width)));
      width = apply();
    }
    // The contrast sample must follow the text that will really be drawn,
    // not the preferred size: a long name shrinks and spreads much wider
    // than the fixed centre strip, so sampling that strip left the outer
    // letterforms judged by pixels they do not sit on — dark-on-dark on a
    // corner-weighted photo, in exactly the long-name case.
    var half = Math.max(1, width / 2);
    var centreX = bandRect.x + bandRect.w / 2;
    return {
      fontSize: fontSize,
      tracking: tracking,
      width: width,
      maxWidth: maxWidth,
      text: upper,
      baselineY: metrics.baselineY,
      sampleRect: {
        x: Math.round(Math.max(bandRect.x, centreX - half)),
        y: Math.round(metrics.baselineY - fontSize),
        w: Math.max(1, Math.round(Math.min(bandRect.w, width))),
        h: Math.max(1, Math.round(fontSize * 1.25))
      }
    };
  }

  /** The outline actually stroked under a line of text, scaled to the TEXT
   * rather than to its region.
   *
   * A real, live-found defect (Ashley's flyer review): pickRegionTextStyle
   * sized the outline from the region height (rect.h * 0.025), so the body
   * region's 140px height produced a 3.5px stroke under ~50px letterforms.
   * At real feed width that reads as blur, not contrast — exactly the
   * "heavy outlines make the small text look blurry" complaint. Tied to
   * the font size it stays the thin hairline it was always meant to be,
   * and it gets thinner as the text gets smaller instead of thicker.
   *
   * Returns null when the region didn't need an outline at all. Pure. */
  function outlineFor(textStyle, fontSize) {
    var outline = textStyle && textStyle.outline;
    if (!outline) return null;
    var ratio = typeof outline.widthRatio === "number" ? outline.widthRatio : OUTLINE_WIDTH_RATIO;
    return { color: outline.color, width: Math.max(0.75, fontSize * ratio) };
  }

  function applyTextShadow(ctx) {
    // "A subtle text shadow" — one of Ashley's explicitly allowed
    // legibility techniques, always applied as light insurance; the
    // per-region outline (pickRegionTextStyle, above) is the stronger
    // measure reserved for genuinely busy/midtone photo areas.
    ctx.shadowColor = "rgba(6,10,18,0.5)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 1;
  }

  function drawRegionText(ctx, rect, text, emphasisKey, style, opts, textStyle) {
    if (!text) return false;
    var bannered = false;
    textStyle = textStyle || { color: BAND_TEXT_COLOR, softColor: BAND_TEXT_COLOR_SOFT, outline: null };
    var color = emphasisKey === "body" ? textStyle.softColor : textStyle.color;
    // The target size is taken from the region's ORIGINAL height
    // (opts.baseSizeHeight), not the possibly-shrunk rect.h below — the
    // caller may have shrunk `rect` just to clear the shop-name lockup,
    // and the headline must still read as the boldest, biggest element on
    // the flyer (Ashley's "strong hierarchy" requirement). The auto-fit
    // loop right below still protects against real overflow by shrinking
    // from that full-size target if the wrapped block genuinely doesn't
    // fit in the (possibly smaller) rect.
    var sizeRefH = (opts && opts.baseSizeHeight) || rect.h;
    // Mobile-readability directive (Ashley, live-tested feedback — third
    // round): the closing time and phone number were too small to read
    // without zooming at normal Facebook/mobile viewing size. Body raised
    // from 0.3x to 0.38x region height — comfortably larger, still governed
    // by the same auto-fit shrink loop below so it can never overflow.
    var baseSize = emphasisKey === "hero" ? sizeRefH * 0.4 : rect.h * 0.38;
    var scaleTarget = emphasisKey === "hero" ? "headline" : emphasisKey;
    var scaleKey = (style && style.scale && style.scale[scaleTarget]) || "normal";
    var fontSize = Math.round(baseSize * scaleMultiplier(scaleKey));
    var weight = emphasisKey === "body" ? "500" : "700";
    ctx.save();
    applyTextShadow(ctx);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    setLetterSpacing(ctx, emphasisKey === "hero" ? "0.01em" : "0px");
    // Auto-fit: a wrapped block (a long closing message, a two-line
    // seasonal headline) must never grow taller than its own region and
    // spill into whatever sits above or below it — the shop-name lockup,
    // the next region down. Shrink the font in small steps until the
    // wrapped block actually fits the rect, rather than always centering
    // at the requested size and letting a tall block overflow. Floors at
    // 62% of the requested size — still fully legible, and far better
    // than an overlapping headline.
    var maxTextWidth = rect.w * 0.94;
    var lines, lineHeight;
    for (var attempt = 0; attempt < 6; attempt++) {
      ctx.font = weight + " " + fontSize + "px 'Crimson Pro', Georgia, serif";
      lineHeight = fontSize * 1.18;
      lines = measureWrappedLines(ctx, text, maxTextWidth);
      var blockHeight = lines.length * lineHeight;
      // Floor raised from 62% to 78%: shrinking this far was how the body
      // ended up unreadable at feed width. The regions are taller now, so
      // a long message wraps to another line instead of shrinking away.
      if (blockHeight <= rect.h * 0.96 || fontSize <= baseSize * 0.78) break;
      fontSize = Math.round(fontSize * 0.9);
    }
    // A banner, if this block still lands on petals, goes down BEFORE the
    // text — and is sized to the wrapped block that was just fitted, not to
    // the region, so it hugs the words instead of becoming a full-width
    // panel across the photograph.
    if (opts && opts.background) {
      var widest = 0;
      for (var li = 0; li < lines.length; li++) widest = Math.max(widest, ctx.measureText(lines[li]).width);
      var blockH = lines.length * lineHeight;
      var textRect = { x: rect.x + rect.w / 2 - widest / 2, y: rect.y + rect.h / 2 - blockH / 2, w: widest, h: blockH };
      var band = bannerBand({
        cx: rect.x + rect.w / 2, top: textRect.y,
        textWidth: widest, blockHeight: blockH, fontSize: fontSize, maxWidth: rect.w
      });
      if (needsBannerBehind(opts.background, textRect, color, colorAlpha(color))) {
        bannered = true;
        if (opts.bands) opts.bands.push(band);
        // On the ribbon, the picture's own contrast no longer decides the
        // colour — the ribbon does.
        color = emphasisKey === "body" ? BAND_TEXT_COLOR_SOFT : BAND_TEXT_COLOR;
        ctx.fillStyle = color;
        // Cream on the ribbon, and no outline — the ribbon is doing the work
        // that an outline used to fail to do.
        textStyle = { color: BAND_TEXT_COLOR, softColor: BAND_TEXT_COLOR_SOFT, outline: null };
      }
    }
    drawWrappedLines(ctx, lines, rect.x + rect.w / 2, rect.y + rect.h / 2, lineHeight, outlineFor(textStyle, fontSize));
    setLetterSpacing(ctx, "0px");
    ctx.restore();
    return bannered;
  }

  /** Visual-quality directive: the call-to-action is now a narrow
   * decorative LABEL — uppercase, letter-spaced text with a thin
   * muted-gold underline — instead of the old filled pill "button" shape.
   * A florist's flyer should read like an editorial ad, not an app UI
   * control; this keeps the CTA legible and clearly set apart from the
   * headline/body without ever drawing another box on top of the photo. */
  /** Pure layout math for the CTA lockup (wrapped text block + the thin
   * divider rule that sits UNDER it), separated out so it can be unit
   * tested the same way the region/luminance math is — a real, live-found
   * defect (Ashley's pre-live-test visual review) was that this geometry
   * was never checked anywhere: the divider was positioned as if the CTA
   * were always a single line, so the default operational-notice CTA
   * ("Call <phone> to place an order.") — which genuinely wraps to three
   * lines in the notice template's cta region — had the rule drawn
   * straight through its last line, and the block itself overflowed the
   * region toward the contact line below.
   *
   * Mirrors drawRegionText's auto-fit loop rather than introducing a
   * second, different shrink policy: same 6 attempts, same 0.9 step, same
   * 62% floor. The one addition is that the divider's own vertical space
   * is part of what has to fit, so the rule can never land on the text.
   * Requires only ctx.font + ctx.measureText, so a plain fake ctx can
   * drive it in tests. */
  function computeCtaLayout(ctx, rect, text, maxBlockHeight) {
    // Mobile-readability directive: the phone number/CTA was too small to
    // read at normal Facebook/mobile viewing size — 0.52x region height,
    // floor 17px. Unchanged; only the overflow handling below is new.
    // Ratio deliberately unchanged from the original 0.52: lowering it to
    // make the notice CTA "less dominant" silently SHRANK the CTA on the
    // six templates whose regions were not enlarged (REGIONS_STANDARD's
    // cta.h of 0.07 → 40px became 33px), which is the opposite of the
    // readability fix. The notice template gets its larger CTA from its
    // taller region instead, and the auto-fit below brings any template's
    // CTA down only as far as it genuinely must.
    // A confirmed defect on a real render (a narrow side-column region,
    // new in Phase 2.2's framed_block treatment): baseSize depended
    // only on rect.h, so a tall-but-narrow region could compute a
    // starting font far too large for its own width. A phone number is
    // one unbreakable token — measureWrappedLines never splits mid-
    // word — so at that size it simply overflowed past the region's
    // edges outright, before the height-driven shrink loop below ever
    // got a chance to react (it only ever checks fitted HEIGHT). This
    // width ceiling mirrors the one drawTypographyRole already applies
    // for the identical reason. It only ever LOWERS baseSize, and only
    // when a region is already this disproportionately narrow — every
    // normal wide CTA band (rect.w * 0.16 comfortably exceeds
    // rect.h * 0.52 there) computes exactly the same baseSize as
    // before.
    var baseSize = Math.max(28, Math.min(Math.round(rect.h * 0.52), Math.round(rect.w * 0.16)));
    var maxTextWidth = rect.w * 0.94;
    var upper = String(text).toUpperCase();
    var fontSize = baseSize;
    var lines, lineHeight, neededHeight;
    for (var attempt = 0; attempt < 6; attempt++) {
      ctx.font = "600 " + fontSize + "px 'Inter', sans-serif";
      lineHeight = fontSize * 1.2;
      lines = measureWrappedLines(ctx, upper, maxTextWidth);
      // First line's own height + every subsequent line + the gap and rule
      // beneath the last line. textBaseline is "middle", so a line's ink
      // reaches roughly ±fontSize/2 around its center.
      // First line's own height + every subsequent line + the gap and rule
      // beneath the last line. textBaseline is "middle", so a line's ink
      // reaches roughly ±fontSize/2 around its center.
      neededHeight = (lines.length - 1) * lineHeight + fontSize * 1.76;
      // Fits its own region outright — nothing more to decide.
      if (neededHeight <= rect.h * 0.96) break;
      // Past that, the 78% floor is a PREFERENCE (shrinking below it is how
      // the CTA became unreadable at feed width), but avoiding a collision
      // is a HARD requirement: a long CTA is centred in its region, so it
      // spills both ways, and at the floor alone it reached up into the
      // body text. Keep shrinking past the preferred floor only while the
      // block would still overlap a neighbour, and never below MIN_CTA_FONT.
      var collides = typeof maxBlockHeight === "number" && neededHeight > maxBlockHeight;
      if (!collides && fontSize <= baseSize * 0.78) break;
      if (fontSize <= MIN_CTA_FONT) break;
      fontSize = Math.round(fontSize * 0.9);
    }
    // Centre the WHOLE lockup (text block + divider) in the region, so the
    // rule is inside the region too rather than pushed out the bottom.
    var lockupTop = rect.y + (rect.h - neededHeight) / 2;
    var firstLineCenterY = lockupTop + fontSize * 0.5;
    var lastLineCenterY = firstLineCenterY + (lines.length - 1) * lineHeight;
    var blockCenterY = (firstLineCenterY + lastLineCenterY) / 2;
    var widest = 0;
    for (var i = 0; i < lines.length; i++) {
      var w = ctx.measureText(lines[i]).width;
      if (w > widest) widest = w;
    }
    return {
      fontSize: fontSize,
      lines: lines,
      lineHeight: lineHeight,
      blockCenterY: blockCenterY,
      blockTop: firstLineCenterY - fontSize * 0.5,
      lastLineCenterY: lastLineCenterY,
      lastLineBottom: lastLineCenterY + fontSize * 0.5,
      // Clear of the last line's descenders, never through it.
      dividerY: lastLineCenterY + fontSize * 0.5 + fontSize * 0.26,
      dividerWidth: Math.min(rect.w * 0.42, Math.max(fontSize * 4, widest * 0.6)),
      widestLineWidth: widest
    };
  }

  function drawCtaLabel(ctx, rect, text, accentColor, textStyle, maxBlockHeight, background, bands) {
    if (!text) return false;
    var bannered = false;
    textStyle = textStyle || { color: BAND_TEXT_COLOR, outline: null };
    var gold = accentColor || "#c8a24a";
    var cx = rect.x + rect.w / 2;
    ctx.save();
    applyTextShadow(ctx);
    ctx.fillStyle = textStyle.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Tracking eased from 0.1em to 0.04em: at 0.1em this sentence was so
    // wide it had to shrink to fit, which cost far more readability than
    // the tracking bought. Applied BEFORE measuring — measuring without
    // the tracking under-reports every line and the wrap comes out wrong.
    setLetterSpacing(ctx, "0.04em");
    var layout = computeCtaLayout(ctx, rect, text, maxBlockHeight);
    ctx.font = "600 " + layout.fontSize + "px 'Inter', sans-serif";
    // This is the block that was unreadable: the phone number sat on a bank
    // of bright lilies, in cream with a hairline outline. The banner covers
    // the wrapped text AND the divider rule below it, so the lockup reads as
    // one piece rather than a label on cream with a rule left on the petals.
    if (background) {
      var widest = 0;
      for (var li = 0; li < layout.lines.length; li++) widest = Math.max(widest, ctx.measureText(layout.lines[li]).width);
      var blockH = layout.lines.length * layout.lineHeight;
      var top = layout.blockCenterY - blockH / 2;
      var textRect = { x: cx - widest / 2, y: top, w: widest, h: blockH };
      var band = bannerBand({
        cx: cx, top: top,
        textWidth: Math.max(widest, layout.dividerWidth),
        blockHeight: Math.max(blockH, layout.dividerY - top),
        fontSize: layout.fontSize, maxWidth: rect.w
      });
      if (needsBannerBehind(background, textRect, textStyle.color, colorAlpha(textStyle.color))) {
        bannered = true;
        if (bands) bands.push(band);
        // Cream on the ribbon, and no outline — the ribbon is doing the work
        // that an outline used to fail to do.
        textStyle = { color: BAND_TEXT_COLOR, softColor: BAND_TEXT_COLOR_SOFT, outline: null };
        ctx.fillStyle = textStyle.color;
      }
    }
    drawWrappedLines(ctx, layout.lines, cx, layout.blockCenterY, layout.lineHeight, outlineFor(textStyle, layout.fontSize));
    setLetterSpacing(ctx, "0px");
    ctx.restore();
    // Thin gold divider beneath the label — "a narrow decorative label for
    // the CTA" / "muted gold divider lines," never a filled button shape.
    ctx.save();
    ctx.strokeStyle = gold;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(1.5, rect.h * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx - layout.dividerWidth / 2, layout.dividerY);
    ctx.lineTo(cx + layout.dividerWidth / 2, layout.dividerY);
    ctx.stroke();
    ctx.restore();
    return bannered;
  }

  /** The shop's own name (never Florisyn's — brand.shopName is always the
   * authenticated shop, see marketing-studio.js's persisted flyer content),
   * presented as a tasteful small-caps, letter-spaced lockup near the top
   * of the lower text area — a real, distinct visual element rather than
   * being buried only in the small footer contact line. Mandatory on
   * every flyer per Ashley's explicit requirement: a shared/downloaded
   * image must still identify the florist it came from. Text color/
   * outline are real sampled contrast (textStyle), never assumed. */
  /** How far below the band's top the lockup actually reaches, including its
   * divider rule. Shared so the layout can know this WITHOUT drawing — the
   * stack has to be positioned before any of it is painted — and can never
   * drift from what drawShopNameLockup really draws. Pure. */
  function lockupUsedHeight(bandRect, fit) {
    return (fit.baselineY + fit.fontSize * 0.75) - bandRect.y;
  }

  function drawShopNameLockup(ctx, bandRect, brand, accentColor, textStyle, background, presetFit, bands) {
    var name = brand && brand.shopName;
    if (!name) return { usedHeight: 0, bannered: false };
    var bannered = false;
    textStyle = textStyle || { color: BAND_TEXT_COLOR, outline: null };
    var gold = accentColor || "#c8a24a";
    // Mobile-readability pass: this is the one element that tells a
    // customer whose flyer they are looking at, and at real feed width it
    // was the smallest thing on the image. Raised from 0.05 to 0.095 of
    // the band height, with the tracking eased from 0.26em to 0.16em so
    // the extra size goes into legible letterforms rather than gaps.
    ctx.save();
    applyTextShadow(ctx);
    ctx.fillStyle = textStyle.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    // A long shop name must FIT, not merely shrink toward fitting — an
    // unbounded lockup clipped "The Wildflower & Peony Company of Northern
    // Kentucky" off both edges, a real multi-tenant defect.
    // The caller may already have fitted this in order to place the stack;
    // refitting here would silently discard the placement it just decided.
    var fit = presetFit || fitShopLockup(ctx, bandRect, name);
    // fitShopLockup leaves ctx.font and the tracking set as a side effect of
    // measuring. A preset fit was measured earlier inside a save/restore, so
    // that state is long gone and the lockup drew at the canvas default of
    // 10px sans-serif — the shop name, the one element identifying whose
    // flyer this is, rendered as an unreadable speck. Set it explicitly.
    if (presetFit) {
      // fitShopLockup MEASURES at 600 and guarantees the result fits the
      // band. Drawing at 700 spends width that was never budgeted, so the
      // name pushed out past both ends of its own ribbon.
      ctx.font = "600 " + fit.fontSize + "px 'Inter', sans-serif";
      setLetterSpacing(ctx, fit.tracking);
    }
    var fontSize = fit.fontSize;
    var upper = fit.text;
    var baselineY = fit.baselineY;
    if (background) {
      // The band has to reach the divider rule too, or the lockup ends up as
      // wording on a ribbon with its gold rule left behind on the petals —
      // the same defect the CTA already had fixed.
      var textRect = { x: bandRect.x + bandRect.w / 2 - fit.width / 2, y: baselineY - fontSize, w: fit.width, h: fontSize * 1.25 };
      var lockupBottom = bandRect.y + lockupUsedHeight(bandRect, fit);
      var band = bannerBand({
        cx: bandRect.x + bandRect.w / 2, top: textRect.y,
        textWidth: fit.width, blockHeight: Math.max(textRect.h, lockupBottom - textRect.y), fontSize: fontSize,
        // The band spans the full canvas width, so capping to it capped to
        // nothing: the lockup's ribbon alone measured 94% of the flyer.
        maxWidth: bandRect.w * 0.88
      });
      if (needsBannerBehind(background, textRect, textStyle.color, colorAlpha(textStyle.color))) {
        bannered = true;
        if (bands) bands.push(band);
        // Cream on the ribbon, and no outline — the ribbon is doing the work
        // that an outline used to fail to do.
        textStyle = { color: BAND_TEXT_COLOR, softColor: BAND_TEXT_COLOR_SOFT, outline: null };
        ctx.fillStyle = textStyle.color;
      }
    }
    drawTextLine(ctx, upper, bandRect.x + bandRect.w / 2, baselineY, outlineFor(textStyle, fontSize));
    setLetterSpacing(ctx, "0px");
    ctx.restore();
    var dividerY = bandRect.y + lockupUsedHeight(bandRect, fit);
    var dividerW = bandRect.w * 0.09;
    ctx.save();
    ctx.strokeStyle = gold;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(1, bandRect.h * 0.0035);
    ctx.beginPath();
    ctx.moveTo(bandRect.x + bandRect.w / 2 - dividerW / 2, dividerY);
    ctx.lineTo(bandRect.x + bandRect.w / 2 + dividerW / 2, dividerY);
    ctx.stroke();
    ctx.restore();
    return { usedHeight: dividerY - bandRect.y, bannered: bannered };
  }

  /** A phone number as a person should read it, from whatever the shop
   * happened to save. A real, live-found defect: a shop's stored phone was
   * the bare digit string "16063319374", and the flyer's footer printed it
   * exactly like that — unreadable at a glance on a customer-facing image.
   *
   * Deliberately conservative and general — never shop-specific, never
   * locale-presumptuous: a number the florist already punctuated is THEIR
   * formatting and is returned untouched, an international "+" number is
   * returned untouched, and anything that isn't a recognizable 10- or
   * 11-digit North American shape is returned untouched rather than
   * mangled into a wrong format. Pure. */
  function formatPhoneForDisplay(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return "";
    if (s.charAt(0) === "+") return s;
    if (/[()\-.\s]/.test(s)) return s;
    var digits = s.replace(/\D/g, "");
    if (digits.length === 10) return digits.slice(0, 3) + "-" + digits.slice(3, 6) + "-" + digits.slice(6);
    if (digits.length === 11 && digits.charAt(0) === "1") {
      return "1-" + digits.slice(1, 4) + "-" + digits.slice(4, 7) + "-" + digits.slice(7);
    }
    return s;
  }

  var ANY_PHONE_RE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/;

  /** The footer contact line. `ctaText` is passed so the flyer can never
   * show TWO different phone numbers — a real, live-found defect: a
   * request-supplied number ("call 606-506-4039") correctly became the
   * CTA, while this line independently printed the shop profile's own
   * stored number, so one customer-facing flyer advertised two different
   * numbers to call. When the CTA already shows a number, that is the
   * number this flyer is about, and the footer defers to it rather than
   * contradicting it. */
  /** The footer's parts, decided purely so it can be unit tested. Exported
   * for the same reason the region/luminance math is. */
  function contactLineParts(brand, ctaText) {
    brand = brand || {};
    var ctaPhoneMatch = String(ctaText || "").match(ANY_PHONE_RE);
    var ctaPhone = ctaPhoneMatch ? ctaPhoneMatch[0] : null;
    var brandPhone = brand.phone ? formatPhoneForDisplay(brand.phone) : null;
    // The phone appears ONCE on a flyer. Whenever the CTA already shows a
    // number — the same one written differently, or a different one — this
    // line shows none: repeating it was clutter when the numbers agreed and
    // a contradiction when they didn't.
    var phone = ctaPhone ? null : brandPhone;
    // The shop name is already the lockup, the largest identity element on
    // the flyer. Repeating it small at the bottom adds nothing, so it only
    // survives here when it is genuinely introducing something else (a
    // website). A footer that would carry the shop name alone is dropped.
    var extras = [phone, brand.website].filter(Boolean);
    if (!extras.length) return [];
    return [brand.shopName].concat(extras).filter(Boolean);
  }

  function drawContact(ctx, rect, brand, textStyle, ctaText, background, accentColor, bands) {
    var parts = contactLineParts(brand, ctaText);
    if (!parts.length) return false;
    var bannered = false;
    textStyle = textStyle || { softColor: BAND_TEXT_COLOR_SOFT, outline: null };
    ctx.save();
    applyTextShadow(ctx);
    ctx.fillStyle = textStyle.softColor;
    // A real, comfortably-readable footer — not a tiny fine-print line.
    var line = parts.join("   ·   ");
    var contactSize = Math.round(rect.h * 0.72);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    setLetterSpacing(ctx, "0.03em");
    // This line never measured itself. A shop with a name AND a website
    // (and no phone in its CTA) produces a string far wider than the
    // region, clipped at both ends. Scaled to fit like every other block.
    var contactMax = rect.w * 0.96;
    ctx.font = "600 " + contactSize + "px 'Inter', sans-serif";
    var contactWidth = ctx.measureText(line).width;
    if (contactWidth > contactMax) {
      contactSize = Math.max(14, Math.floor(contactSize * (contactMax / contactWidth)));
      ctx.font = "600 " + contactSize + "px 'Inter', sans-serif";
    }
    if (background) {
      var lineW = ctx.measureText(line).width;
      var textRect = { x: rect.x + rect.w / 2 - lineW / 2, y: rect.y + rect.h / 2 - contactSize * 0.6, w: lineW, h: contactSize * 1.2 };
      var band = bannerBand({
        cx: rect.x + rect.w / 2, top: textRect.y,
        textWidth: lineW, blockHeight: textRect.h, fontSize: contactSize, maxWidth: rect.w
      });
      if (needsBannerBehind(background, textRect, textStyle.softColor, colorAlpha(textStyle.softColor))) {
        bannered = true;
        if (bands) bands.push(band);
        // Cream on the ribbon, and no outline — the ribbon is doing the work
        // that an outline used to fail to do.
        textStyle = { color: BAND_TEXT_COLOR, softColor: BAND_TEXT_COLOR_SOFT, outline: null };
        ctx.fillStyle = textStyle.softColor;
      }
    }
    drawTextLine(ctx, line, rect.x + rect.w / 2, rect.y + rect.h / 2, outlineFor(textStyle, contactSize));
    setLetterSpacing(ctx, "0px");
    ctx.restore();
    return bannered;
  }

  function drawLogo(ctx, rect, logoUrl) {
    if (!logoUrl) return Promise.resolve();
    return loadImage(logoUrl)
      .then(function (img) {
        var scale = Math.min(rect.w / img.width, rect.h / img.height, 1);
        var w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, rect.x + (rect.w - w) / 2, rect.y, w, h);
      })
      .catch(function () { /* logo is optional — a flyer must still render without it */ });
  }

  // Matches ai-visual-revisions.js's COLOR_WORDS — a Tier-B (brand-palette)
  // background is the only place a color revision ("use more cream",
  // "less pink") has anywhere to land, since there's no generated image to
  // regenerate. Named, not exhaustive: good enough to make a revision
  // visibly do something, not a full color-naming system.
  var COLOR_NAME_HEX = {
    pink: "#e8a3c0", red: "#c0392b", blue: "#3468a0", green: "#3c6b3f",
    yellow: "#e2c04a", purple: "#7c3a8a", orange: "#d97a34", black: "#2a2226",
    white: "#ffffff", cream: "#f3ead9", blush: "#f0c6d3", burgundy: "#6e1f2e",
    gold: "#c8a24a", silver: "#c7c7c7", neon: "#39ff14", navy: "#1a2b4c",
    teal: "#2a7f7a", brown: "#6b4423"
  };

  /** Picks the two colors a Tier-B background actually paints with —
   * style.paletteInclude (a revision like "use more cream") always wins
   * when present; style.paletteExclude with nothing specified to use
   * instead falls back to the template's own neutral pair rather than
   * silently keeping the very brand colors the florist just asked to move
   * away from; with neither, the shop's own brand colors are unchanged. */
  function effectivePaletteColors(brand, style) {
    var primary = brand.primaryColor || "#7c3a58";
    var accent = brand.accentColor || "#c98fae";
    var include = (style && style.paletteInclude) || [];
    var exclude = (style && style.paletteExclude) || [];
    if (include.length) {
      primary = COLOR_NAME_HEX[include[0]] || primary;
      accent = COLOR_NAME_HEX[include[1] || include[0]] || accent;
    } else if (exclude.length) {
      primary = "#f3ead9"; // cream
      accent = "#f0c6d3"; // blush
    }
    return { primary: primary, accent: accent };
  }

  function paintBrandBackground(ctx, width, height, template, brand, style) {
    var colors = effectivePaletteColors(brand, style);
    // Whether THIS render actually carries a color revision — the
    // sympathy template's quiet default muted tone must survive an
    // untouched flyer; effectivePaletteColors() only needs to override it
    // once the florist has actually asked for a color change.
    var hasRevision = Boolean(style && ((style.paletteInclude && style.paletteInclude.length) || (style.paletteExclude && style.paletteExclude.length)));
    if (template.palette.background === "brand_gradient") {
      var g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, colors.primary);
      g.addColorStop(1, colors.accent);
      ctx.fillStyle = g;
    } else if (template.palette.background === "muted") {
      ctx.fillStyle = hasRevision ? colors.primary : "#efe9e6";
    } else {
      ctx.fillStyle = colors.primary;
    }
    ctx.fillRect(0, 0, width, height);
  }

  function hexWithAlpha(hex, alpha) {
    var h = String(hex || "#7c3a58").replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var r = parseInt(h.substring(0, 2), 16) || 0;
    var g = parseInt(h.substring(2, 4), 16) || 0;
    var b = parseInt(h.substring(4, 6), 16) || 0;
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  /** A soft, ivory-toned diagonal wash plus several large, blurred
   * radial "bloom" glows in the shop's own brand tones — real depth and
   * warmth behind the panel without depicting literal flower shapes (a
   * deliberate choice: hand-drawn "clip-art" flowers were tried and
   * rejected during design review as looking cheap; a soft light/color
   * wash is the honest, reliably-elegant Tier-B treatment). Drawn AFTER
   * paintBrandBackground()'s flat/gradient fill (never replaces it — the
   * existing color-revision tests depend on that fill being exactly what
   * it always was), so this is purely additive richness. Tier A (a real
   * generated photo) never calls this — the photo already provides real
   * depth and texture. */
  function paintFloralWash(ctx, width, height, colors) {
    ctx.save();
    var wash = ctx.createLinearGradient(0, 0, width, height);
    wash.addColorStop(0, hexWithAlpha("#fffaf3", 0.16));
    wash.addColorStop(1, hexWithAlpha(colors.primary, 0.1));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);

    var blooms = [
      { x: width * 0.06, y: height * 0.05, r: width * 0.26, color: colors.accent, alpha: 0.32 },
      { x: width * 0.95, y: height * 0.1, r: width * 0.2, color: colors.primary, alpha: 0.26 },
      { x: width * 0.08, y: height * 0.95, r: width * 0.22, color: colors.primary, alpha: 0.24 },
      { x: width * 0.94, y: height * 0.93, r: width * 0.26, color: colors.accent, alpha: 0.28 }
    ];
    for (var i = 0; i < blooms.length; i++) {
      var b = blooms[i];
      var radial = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      radial.addColorStop(0, hexWithAlpha(b.color, b.alpha));
      radial.addColorStop(1, hexWithAlpha(b.color, 0));
      ctx.fillStyle = radial;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ===========================================================================
  // Creative Direction execution (Phase 2 — "dynamic renderer + hard
  // graphic/caption allocation only"). Everything below reads the
  // creative_direction object Phase 1 already persists at
  // ai_generated_assets.content.creative_direction (see _shared/
  // marketing-creative-direction.js on the server — this file has no
  // import mechanism into that ES module, so the few small maps below
  // (HIERARCHY_DEPTH_ROLES, etc.) are a deliberate name-for-name mirror
  // of that module's own enum VALUES, never a second, independently
  // re-decided classification — the server is still the single source of
  // truth for WHICH value a flyer gets; this file only ever decides HOW
  // to draw a given value.
  //
  // Backward compatibility (Part O): every function below is additive.
  // renderFlyer() branches to renderFlyerWithCreativeDirection() only
  // when opts.creativeDirection is present; with no creative_direction
  // (a pre-Phase-1 asset, or any caller that simply doesn't pass one)
  // renderFlyer() falls through to the exact, byte-for-byte original
  // code path below it, unchanged.
  // ===========================================================================

  /** Mirrors marketing-creative-direction.js's HIERARCHY_DEPTH_SLOTS —
   * which text roles (beyond the always-on brand/headline) a given depth
   * commits to. */
  var HIERARCHY_DEPTH_ROLES = {
    headline_only: [],
    headline_plus_support: ["supportingLine"],
    headline_plus_cta: ["cta"],
    headline_support_cta: ["supportingLine", "cta"],
    headline_support_service_cta: ["supportingLine", "serviceDetail", "cta"]
  };

  /** headlineScale's real effect on headline type size — materially
   * different, not a cosmetic nudge (Part E's explicit requirement). */
  var HEADLINE_SCALE_MULTIPLIER = { standard: 1, large: 1.16, oversized: 1.34 };

  /** typographyPersonality's real font stacks. No new webfont is fetched
   * anywhere in this module (no network/provider call) — every family
   * below is either already loaded by this app ('Crimson Pro' serif,
   * 'Inter' sans, both already used throughout this file) or a
   * browser-generic fallback stack ('cursive' for a script accent,
   * standard on every real browser with no fetch at all). */
  var TYPOGRAPHY_PERSONAS = {
    editorial_serif: { headline: "'Crimson Pro', Georgia, serif", headlineWeight: "700", body: "'Crimson Pro', Georgia, serif", bodyWeight: "500", script: null },
    clean_sans: { headline: "'Inter', sans-serif", headlineWeight: "700", body: "'Inter', sans-serif", bodyWeight: "500", script: null },
    script_accent: { headline: "'Crimson Pro', Georgia, serif", headlineWeight: "600", body: "'Crimson Pro', Georgia, serif", bodyWeight: "500", script: "'Segoe Script', 'Bradley Hand', cursive" },
    bold_display: { headline: "'Inter', sans-serif", headlineWeight: "800", body: "'Inter', sans-serif", bodyWeight: "500", script: null },
    serif_script_pairing: { headline: "'Crimson Pro', Georgia, serif", headlineWeight: "700", body: "'Crimson Pro', Georgia, serif", bodyWeight: "500", script: "'Segoe Script', 'Bradley Hand', cursive" }
  };

  /**
   * Part E, serif_script_pairing's own hard rule: the serif carries the
   * main readable hierarchy, script is an accent — never paragraph copy,
   * never the whole headline on a legibility-critical operational
   * notice. Returns which PART of the headline (if any) should render in
   * the script family, given scriptAccentUsage — never invents new
   * words, only ever chooses which of the headline's OWN real words (or
   * none) get the accent treatment. Pure.
   */
  function resolveScriptAccentPlan(scriptAccentUsage, headlineText, isOperationalNotice) {
    var usage = scriptAccentUsage || "none";
    // Independent-review-equivalent safety: never a full-script headline
    // on an operational notice regardless of what was persisted —
    // legibility of a time/date always wins. Phase 1's own validator
    // already forbids this combination from persisting in the first
    // place; this is defense-in-depth at the one place that actually
    // draws pixels.
    if (isOperationalNotice && usage === "full_script_headline") usage = "accent_word";
    var words = String(headlineText || "").trim().split(/\s+/).filter(Boolean);
    if (usage === "none" || !words.length) return { mode: "none", accentWord: null };
    if (usage === "full_script_headline") return { mode: "full_headline", accentWord: null };
    if (usage === "accent_word") return { mode: "accent_word", accentWord: words[0] };
    // subhead_script: the accent lands on the supporting line (a short
    // role), never the headline itself — resolved by the caller, which
    // has the supporting line text; this function only reports the mode.
    return { mode: "subhead_script", accentWord: null };
  }

  /**
   * Part G ("move body-style copy off the graphic"): a short, honest
   * EXCERPT of the real generated caption text — never a synthesized
   * replacement. Takes the first real sentence, then truncates at a word
   * boundary under maxChars with an ellipsis. Returns null for empty
   * input. Pure.
   */
  function deriveSupportingLineText(bodyText, maxChars) {
    var text = String(bodyText || "").trim();
    if (!text) return null;
    var ceiling = typeof maxChars === "number" && maxChars > 0 ? maxChars : 60;
    var sentenceMatch = text.match(/^[^.!?]*[.!?]/);
    var candidate = sentenceMatch ? sentenceMatch[0].trim() : text;
    if (candidate.length <= ceiling) return candidate;
    var truncated = candidate.slice(0, ceiling);
    var lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > ceiling * 0.5) truncated = truncated.slice(0, lastSpace);
    return truncated.replace(/[.,;:!?]*$/, "") + "…";
  }

  /** Clamps a channel value into the real 0–255 range. Pure. */
  function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }

  /** Moves a color toward white (amount > 0) or black (amount < 0),
   * proportional to each channel's own remaining room — unlike darken()
   * (used elsewhere for a ribbon's folded tails), this is bounded and
   * safe to call repeatedly without ever producing an out-of-range
   * channel. Pure. */
  function adjustLightness(color, amount) {
    var c = parseColor(color);
    function ch(v) { return amount >= 0 ? clamp255(v + (255 - v) * amount) : clamp255(v + v * amount); }
    return "rgb(" + ch(c.r) + "," + ch(c.g) + "," + ch(c.b) + ")";
  }

  /** Phase 2.3, real contrast floor: pickTextColor's own binary cream/
   * charcoal choice is usually enough, but a palette-family color that
   * lands close to the 0.55 luminance threshold can still clear it with
   * a weak real ratio. Nudges the panel color toward the extreme its
   * own chosen text color needs until the real WCAG-style ratio clears
   * a genuine floor (4.5, the same "normal text" AA floor used
   * elsewhere in web accessibility work) — bounded so it can never run
   * away into black or white. Pure. */
  function ensurePanelContrast(panelColor) {
    var c = parseColor(panelColor);
    var textColor = pickTextColor(c);
    var textRgb = parseColor(textColor);
    var ratio = contrastRatio(c, textRgb);
    var needsDarker = textColor === BAND_TEXT_COLOR;
    var tries = 0;
    while (ratio < 4.5 && tries < 10) {
      panelColor = adjustLightness(panelColor, needsDarker ? -0.1 : 0.1);
      c = parseColor(panelColor);
      ratio = contrastRatio(c, textRgb);
      tries++;
    }
    return panelColor;
  }

  /** Which real calendar season "now" falls in — Northern-hemisphere,
   * the shop's own real operating region. Pure given `date`; the one
   * caller that matters (resolveOrnamentColors) defaults it to
   * `new Date()`, so a seasonal_feature flyer's palette genuinely
   * responds to the actual season it is rendered in, not a random or
   * invented one. */
  function resolveSeason(date) {
    var month = date.getMonth();
    if (month === 11 || month <= 1) return "winter";
    if (month <= 4) return "spring";
    if (month <= 7) return "summer";
    return "fall";
  }

  /** Genuinely season-responsive color families (Phase 2.3) — spring/
   * summer/fall/winter each get their own real hue family, with a
   * "vibrant" and a "jewel" variant so paletteMood still has a visible
   * effect within the season rather than being ignored. Pure data. */
  var SEASON_PALETTES = {
    spring: {
      vibrant: { base: "#fbf3f7", panel: "#e9d6ea", border: "#7fae6e", accent: "#c98fb0" },
      jewel: { base: "#f4ecf5", panel: "#6b4a72", border: "#4f7a44", accent: "#d9a8c2" }
    },
    summer: {
      vibrant: { base: "#fff8e8", panel: "#ffe1a8", border: "#3fa7c9", accent: "#e8734a" },
      jewel: { base: "#eaf6fb", panel: "#1f6e8c", border: "#e8734a", accent: "#f2c14e" }
    },
    fall: {
      vibrant: { base: "#fbf1e2", panel: "#e8c48a", border: "#7a3b2e", accent: "#6b6b3a" },
      jewel: { base: "#f3e6d8", panel: "#5c2a2a", border: "#c98a3f", accent: "#8a8a4a" }
    },
    winter: {
      vibrant: { base: "#f6f5f0", panel: "#f4f1e8", border: "#2f4a3a", accent: "#8c2f3a" },
      jewel: { base: "#eef1ec", panel: "#1f3327", border: "#c9a24a", accent: "#a83b47" }
    }
  };

  /** Phase 2.3 — real, bounded, deterministic palette FAMILIES per
   * occasionTreatment × paletteMood. Ashley's confirmed finding: every
   * paletteMood value was resolving to a tint/alpha variation of the
   * SAME brand.primaryColor/accentColor, so no matter what mood was
   * chosen the flyer always read as the shop's own mauve/pink — brand
   * consistency was being confused with an identical palette. Each
   * entry below is a genuinely different, occasion-appropriate hue
   * family (never AI-generated, never unbounded); `default` is used
   * when a paletteMood isn't one this occasion typically sees.
   * boutique_floral has no blanket default — that family sits closest
   * to the shop's own real territory, so it deliberately falls through
   * to a brand-anchored look instead of a hardcoded hue. */
  var PALETTE_FAMILIES = {
    everyday_floral: {
      default: { base: "#fdf8f0", panel: "#efe6d6", border: "#b7c9a8", accent: "#c98b73" },
      soft_pastel: { base: "#f6f3ea", panel: "#e7edd9", border: "#9fb589", accent: "#c98b73" },
      warm_luxury: { base: "#faf3ea", panel: "#f3e4d0", border: "#c9a24a", accent: "#b5763f" },
      neutral_blush_ivory: { base: "#faf6ef", panel: "#f7f1ea", border: "#cbb9a0", accent: "#a98a76" },
      vibrant_seasonal: { base: "#fdf4ea", panel: "#fbe6d8", border: "#e0895a", accent: "#5a8f5e" },
      jewel_tone: { base: "#fdf4ea", panel: "#fbe6d8", border: "#e0895a", accent: "#5a8f5e" }
    },
    elegant_editorial: {
      default: { base: "#faf7f2", panel: "#2b2b2e", border: "#c9a24a", accent: "#c9a24a" },
      classic_brand: { base: "#faf7f2", panel: "#2b2b2e", border: "#c9a24a", accent: "#c9a24a" },
      warm_luxury: { base: "#f7f2e6", panel: "#1b2a4a", border: "#c9a24a", accent: "#c9a24a" },
      soft_pastel: { base: "#f7f2ec", panel: "#3a3532", border: "#c9a08a", accent: "#c9a08a" },
      jewel_tone: { base: "#f5ecd8", panel: "#4a1f38", border: "#cbb98a", accent: "#cbb98a" }
    },
    boutique_floral: {
      warm_luxury: { base: "#fbeee3", panel: "#8c3b2e", border: "#f0d9b5", accent: "#f0d9b5" },
      soft_pastel: { base: "#f3ede6", panel: "#d9c7c0", border: "#8a9a7a", accent: "#8a9a7a" },
      neutral_blush_ivory: { base: "#faf4ec", panel: "#f4ece1", border: "#c1653f", accent: "#c1653f" }
    },
    sympathy_elegance: {
      default: { base: "#faf7f0", panel: "#eef1e6", border: "#9fae8e", accent: "#9fae8e" },
      neutral_blush_ivory: { base: "#faf7f0", panel: "#eef1e6", border: "#9fae8e", accent: "#9fae8e" },
      soft_pastel: { base: "#f2f2ee", panel: "#e3e8ee", border: "#8fa0b5", accent: "#8fa0b5" },
      classic_brand: { base: "#f6f0ea", panel: "#efe8df", border: "#a89685", accent: "#a89685" }
    }
  };

  /**
   * paletteMood's real effect on the flyer's non-photo colors (panel
   * fills, borders, dividers, banner/CTA accent) — bounded, deterministic
   * palette FAMILIES keyed by occasionTreatment first (Phase 2.3), so
   * different occasions genuinely stop looking like the same brand
   * template. The shop's own real brand.primaryColor/accentColor is an
   * INPUT, not a prison: classic_brand (and boutique_floral, the family
   * closest to the shop's own natural territory) stay brand-anchored on
   * purpose, operational_notice may still use the shop's own accent as
   * its one highlight, and every family runs its panel color through a
   * real numeric contrast floor before returning it. Never invents an
   * unsupported business fact from color — this only ever adjusts hue/
   * tint. Pure given `now` (defaults to the real current date so a
   * seasonal_feature flyer responds to the actual season). */
  function resolveOrnamentColors(paletteMood, brand, occasionTreatment, visualMood, now) {
    var primary = (brand && brand.primaryColor) || "#7c3a58";
    var accent = (brand && brand.accentColor) || "#c98fae";
    var entry;

    if (occasionTreatment === "seasonal_feature") {
      var season = resolveSeason(now || new Date());
      var variant = paletteMood === "jewel_tone" ? "jewel" : "vibrant";
      entry = (SEASON_PALETTES[season] || SEASON_PALETTES.spring)[variant];
    } else if (occasionTreatment === "operational_notice") {
      // Strong contrast, clean neutrals — must NOT auto-inherit the
      // boutique pink/mauve look. The shop's own accent is still
      // allowed to appear as the one highlight (Ashley's own example),
      // never as the base hue.
      entry = { base: "#f5f4f1", panel: "#20242b", border: accent, accent: accent };
    } else if (occasionTreatment === "promotional_feature") {
      // Higher contrast, a banner/offer that can genuinely pop — a
      // deliberately bolder color family, not a louder version of the
      // same brand tint, while the shop's own accent still ties the CTA
      // back to this florist specifically.
      entry = { base: "#faf3ea", panel: "#8c2140", border: accent, accent: accent };
    } else {
      var family = PALETTE_FAMILIES[occasionTreatment] || PALETTE_FAMILIES.everyday_floral;
      // "classic_brand" always means "look like our own real brand" —
      // unless a family has deliberately defined its OWN classic_brand
      // entry (elegant_editorial's ivory+charcoal, sympathy_elegance's
      // soft taupe+cream are both intentional, non-mauve looks, not an
      // oversight), fall through to the shop's actual colors rather
      // than a hardcoded family hue that has nothing to do with "brand."
      if (paletteMood === "classic_brand" && !family.classic_brand) {
        entry = { base: "#faf6f1", panel: primary, border: accent, accent: accent };
      } else {
        entry = family[paletteMood] || family.default;
      }
    }

    if (!entry) {
      // boutique_floral with no matching/default entry: this family
      // sits closest to the shop's own real territory, so anchoring on
      // the actual brand colors here is deliberate, not the old
      // "everything defaults to brand" behavior every other family used
      // to fall back on too.
      entry = { base: "#faf6f1", panel: primary, border: accent, accent: accent };
    }

    return { primary: primary, accent: entry.accent, panel: ensurePanelContrast(entry.panel), border: entry.border, base: entry.base };
  }

  /**
   * Real crop math (Part K) — a subject-aware, zoom-aware alternative to
   * drawCover()'s always-centered crop. `focal` is a 0–1 fraction of the
   * SOURCE image that should stay centered in the destination; `zoom` >1
   * shows less of the image (a tighter crop), <1 shows more (a wider,
   * more environmental crop). Never asks for more of the source than
   * exists — clamped to the image's own bounds. Pure.
   */
  function computeCoverAlignedRect(iw, ih, dw, dh, focal, zoom) {
    focal = focal || { x: 0.5, y: 0.5 };
    zoom = zoom || 1;
    var scale = Math.max(dw / iw, dh / ih) * zoom;
    var sw = Math.min(iw, dw / scale);
    var sh = Math.min(ih, dh / scale);
    var sx = Math.max(0, Math.min(iw - sw, iw * focal.x - sw / 2));
    var sy = Math.max(0, Math.min(ih - sh, ih * focal.y - sh / 2));
    return { sx: sx, sy: sy, sw: sw, sh: sh };
  }

  var IMAGE_CROP_ZOOM = { tight: 1.28, medium: 1, wide_environmental: 0.82 };
  var SUBJECT_PLACEMENT_FOCAL = {
    center: { x: 0.5, y: 0.5 },
    left_third: { x: 0.28, y: 0.5 },
    right_third: { x: 0.72, y: 0.5 },
    lower_third: { x: 0.5, y: 0.68 },
    full_bleed: { x: 0.5, y: 0.45 }
  };

  function drawCoverAligned(ctx, img, dx, dy, dw, dh, subjectPlacement, imageCrop) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var focal = SUBJECT_PLACEMENT_FOCAL[subjectPlacement] || SUBJECT_PLACEMENT_FOCAL.center;
    var zoom = IMAGE_CROP_ZOOM[imageCrop] || 1;
    var r = computeCoverAlignedRect(iw, ih, dw, dh, focal, zoom);
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, dx, dy, dw, dh);
  }

  /**
   * Part C/D — the structural skeleton for each composition family, in
   * real pixel rects. `photo` is where the photograph is drawn (full
   * canvas for hero_full_bleed/framed_panel/banner_led — all three keep
   * the photo full-bleed behind everything else, per Ashley's own "still
   * visually beautiful and floral" requirement for framed_panel/
   * banner_led; a genuinely confined sub-rect only for layered_editorial,
   * the one family actually built around image/panel asymmetry). `panel`
   * is a real filled/bordered region when the family or textRegion calls
   * for one, else null (hero_full_bleed's default text-on-photo path
   * never gets one — "no giant opaque rectangle... unless Creative
   * Direction explicitly requires a panel"). `stack` is the rect the text
   * roles are allocated within (see splitStackIntoRoles). `banner` is a
   * dedicated rect for a banner-carried headline (banner_led, or any
   * family whose textRegion is literally "banner"). Pure — only reads
   * numbers, no DOM. */
  // Target photo AREA fraction of the canvas for each imageScale — the
  // real difference between "the photo dominates" and "the photo merely
  // supports" (Part 4's explicit requirement: supporting must occupy
  // materially less visual weight than dominant, not just a label).
  var IMAGE_SCALE_AREA = { dominant: 0.86, balanced: 0.58, supporting: 0.34 };

  /** Independent-review correction (Ashley, visual audit): the first
   * Phase 2 pass only ever branched on compositionFamily + textRegion —
   * imagePlacement/imageScale/subjectPlacement were EXECUTED (fed into
   * crop math) but never actually reshaped the photo/panel/stack
   * footprint, so 3 of the 7 fixtures came back byte-identical geometry
   * despite being 3 different families ("boutique_floral"/"sympathy_
   * elegance"/"operational_notice" all measured photo=0,0,100%,100% /
   * panel=9%,28%,82%,62% — a confirmed, quantified defect, not a
   * subjective impression). Every branch below now derives its rects
   * from imagePlacement/imageScale/subjectPlacement FIRST, with
   * compositionFamily/textRegion deciding which structural TREATMENT
   * applies to those rects — real geometry diversity, not decoration
   * swapped onto one shape. Pure — only reads numbers, no DOM. */
  function resolveCompositionGeometry(cd, width, height) {
    function frac(x, y, w, h) { return { x: Math.round(x * width), y: Math.round(y * height), w: Math.round(w * width), h: Math.round(h * height) }; }
    var family = cd.compositionFamily || "hero_full_bleed";
    var textRegion = cd.textRegion || "negative_space_band_lower";
    var imagePlacement = cd.imagePlacement || "full_bleed";
    var imageScale = cd.imageScale || "dominant";
    var subject = cd.subjectPlacement || "center";
    var area = IMAGE_SCALE_AREA[imageScale] || IMAGE_SCALE_AREA.dominant;
    var geo = { photo: frac(0, 0, 1, 1), panel: null, stack: null, banner: null, isPanelFilled: false };

    if (family === "layered_editorial") {
      // Deliberately asymmetric, never a mechanical 50/50 split — and the
      // SPLIT AXIS itself now varies: a lower_third subject splits
      // horizontally (photo on the bottom, panel above it) instead of
      // always splitting vertically left/right. imageScale genuinely
      // resizes the photo's own share rather than a fixed 60%.
      var editorialFrac = Math.max(0.34, Math.min(0.74, area));
      if (subject === "lower_third") {
        geo.photo = frac(0, 1 - editorialFrac, 1, editorialFrac);
        geo.panel = frac(0, 0, 1, 1 - editorialFrac);
      } else {
        var photoRight = subject === "right_third";
        geo.photo = photoRight ? frac(1 - editorialFrac, 0, editorialFrac, 1) : frac(0, 0, editorialFrac, 1);
        geo.panel = photoRight ? frac(0, 0, 1 - editorialFrac, 1) : frac(editorialFrac, 0, 1 - editorialFrac, 1);
      }
      geo.isPanelFilled = true;
      // A side column spans the canvas edge to edge on 3 sides — a
      // rounded-card treatment would leave a visible corner mismatch
      // against the border stroke (a confirmed defect: black gaps
      // showing through at rounded corners with no rounded fill
      // underneath). This panel shape is a sharp-edged column, never a
      // floating card.
      geo.panelShape = "column";
      var epad = Math.min(geo.panel.w, geo.panel.h) * 0.11;
      geo.stack = { x: geo.panel.x + epad, y: geo.panel.y + geo.panel.h * 0.12, w: geo.panel.w - epad * 2, h: geo.panel.h * 0.76 };
    } else if (family === "framed_panel") {
      // Ashley's explicit correction: framed_panel must not simply be
      // hero_full_bleed with a border — imagePlacement now picks between
      // 3 genuinely different photo/panel relationships, not one fixed
      // full-bleed-behind-a-box shape every time.
      if (imagePlacement === "corner_accent") {
        // The photo behaves like an accent, not a hero — small, cornered,
        // sitting ON TOP of a full-canvas card rather than beside a
        // partial one (which left an unpainted black margin — a
        // confirmed defect — and let the panel fill overlap and slice
        // through the photo, painted in the wrong order). panelBehind
        // Photo tells the renderer to fill the panel FIRST, across the
        // whole canvas, then draw the photo on top, whole and unclipped.
        var cs = Math.max(0.16, Math.min(0.34, Math.sqrt(area) * 0.42));
        var cx = subject === "left_third" ? 0 : subject === "center" ? 0.5 - cs / 2 : 1 - cs;
        var cy = subject === "lower_third" ? 1 - cs : 0;
        geo.photo = frac(cx, cy, cs, cs);
        geo.isPanelFilled = true;
        // Inset (not 0,0,1,1) so its own border is actually visible as a
        // real frame — the photo is positioned to touch the true canvas
        // edge, deliberately poking past that frame in one corner, a
        // real "photo breaks the card" treatment rather than a photo
        // awkwardly boxed inside the same margin as the panel.
        geo.panel = frac(0.03, 0.03, 0.94, 0.94);
        geo.panelBehindPhoto = true;
        // Phase 2.3 fix (Ashley's confirmed fixture 03 defect): leaving
        // this to the generic "whole card minus a little padding"
        // fallback below gave the headline a huge, nearly edge-to-edge
        // box to auto-fit into — auto-fit grows to FILL the box it is
        // given, so the headline swelled to 4 oversized lines that
        // dominated the entire card and crushed supportingLine into a
        // sliver at the very bottom, with the photo/badge corner
        // accents competing for the same cramped space. A deliberately
        // bounded, moderate stack — real margin above (clear of the
        // photo/badge corner) and below — keeps the headline at a
        // proportionate size and gives supportingLine its own real,
        // unsquashed room.
        geo.stack = frac(0.1, 0.3, 0.8, 0.54);
      } else if (imagePlacement === "inset_panel") {
        // The photo occupies its OWN strip (top or bottom, sized by
        // imageScale) — a real "photo supports, panel carries the
        // message" relationship, not a photo behind a floating box. The
        // panel fills the ENTIRE remaining strip edge-to-edge (not an
        // inset box with margins around it) — a confirmed defect
        // otherwise: the margin between the photo strip and a smaller
        // floating panel was never painted at all, left as raw
        // transparent canvas (renders as an ugly black/void gap once
        // flattened for a real download), and text sampled that
        // transparent pixel data as "dark," choosing light text that
        // then went illegible wherever the transparency actually
        // composited light. panelShape "column" gives it the same
        // sharp, edge-spanning fill layered_editorial's column uses —
        // right, since it is flush against 3 canvas edges plus the
        // photo's own edge, never a floating rounded card.
        var stripFrac = Math.max(0.24, Math.min(0.5, area * 0.55));
        var photoBottom = subject === "lower_third";
        if (photoBottom) {
          geo.photo = frac(0, 1 - stripFrac, 1, stripFrac);
          geo.panel = frac(0, 0, 1, 1 - stripFrac);
        } else {
          geo.photo = frac(0, 0, 1, stripFrac);
          geo.panel = frac(0, stripFrac, 1, 1 - stripFrac);
        }
        geo.isPanelFilled = true;
        geo.panelShape = "column";
      } else if (imagePlacement === "framed_block") {
        // Phase 2.2, Gap 1: inset_panel's edge-to-edge photo STRIP left
        // sympathy_elegance and operational_notice sharing the exact
        // same "photo band + panel" architecture, just mirrored — a
        // real, disclosed similarity. framed_block is a genuinely
        // different shape: a dominant, near-full-canvas quiet card (the
        // information/text field owns the room) with the photo as a
        // floating, MARGINED block — not an edge-to-edge strip — set to
        // one side (subjectPlacement left/right_third) or grounded as a
        // lower anchor (center/lower_third), with real breathing room
        // on every side of it. Text gets whatever's left of the card,
        // which is the LARGER share either way, giving it the visual
        // center of gravity rather than a fixed 50/50-ish split.
        geo.isPanelFilled = true;
        geo.panel = frac(0.03, 0.03, 0.94, 0.94);
        geo.panelBehindPhoto = true;
        // A confirmed defect on a real render: at up to 0.5 of the
        // canvas width, a heavier hierarchy's CTA (a real phone number
        // plus copy) had too narrow a column left beside it and
        // overflowed past the canvas edge outright. A tighter ceiling
        // keeps the block genuinely sized by imageScale while always
        // leaving the text column real, usable width.
        var blockSide = Math.max(0.26, Math.min(0.4, Math.sqrt(area) * 0.55));
        if (subject === "left_third" || subject === "right_third") {
          var onLeft = subject === "left_third";
          var blockH = Math.min(0.7, blockSide * 1.3);
          var bx = onLeft ? 0.09 : 1 - blockSide - 0.09;
          geo.photo = frac(bx, (1 - blockH) / 2, blockSide, blockH);
          // A confirmed defect on a real render (a heavier hierarchy —
          // headline + supportingLine + cta — in this narrower side
          // column): drawTypographyRole vertically CENTERS a role's
          // text block on its own rect and, once shrunk to its font
          // floor, still draws the overflow rather than truncating
          // further — so too little allocated height here let
          // supportingLine's own block bleed down into the CTA role
          // sitting right below it. A tall a column as the photo block
          // itself gives every role real room instead of a narrow
          // three-way split of a shorter run.
          geo.stack = onLeft
            ? frac(bx + blockSide + 0.06, 0.05, 0.97 - (bx + blockSide + 0.06), 0.9)
            : frac(0.06, 0.05, bx - 0.09, 0.9);
        } else {
          // center / lower_third: an anchored block (never a full-width
          // strip), text owning the open majority — but WHICH edge it
          // grounds to still genuinely differs by subject, rather than
          // collapsing "center" and "lower_third" onto one identical
          // shape: lower_third grounds low (text fills the open upper
          // majority, the visual center of gravity Ashley asked for);
          // center anchors high instead, like a masthead accent, with
          // text filling the open lower majority — a real mirror, not a
          // decoration-only difference.
          var blockH2 = blockSide * 0.72;
          var anchorLow = subject === "lower_third";
          if (anchorLow) {
            geo.photo = frac((1 - blockSide) / 2, 0.94 - blockH2, blockSide, blockH2);
            geo.stack = frac(0.09, 0.08, 0.82, 0.94 - blockH2 - 0.16);
          } else {
            geo.photo = frac((1 - blockSide) / 2, 0.06, blockSide, blockH2);
            geo.stack = frac(0.09, 0.06 + blockH2 + 0.08, 0.82, 0.94 - (0.06 + blockH2 + 0.08));
          }
        }
      } else {
        // full_bleed: legibility-first — the photo stays whole behind a
        // real bordered panel (the one case that IS "hero_full_bleed
        // plus a frame," by design, for a notice that must read the
        // photo as backdrop context, not a competing subject).
        geo.isPanelFilled = true;
        if (textRegion === "negative_space_band_upper") geo.panel = frac(0.07, 0.06, 0.86, 0.4);
        else if (textRegion === "negative_space_band_lower" || textRegion === "footer") geo.panel = frac(0.06, 0.55, 0.88, 0.41);
        else geo.panel = frac(0.09, 0.28, 0.82, 0.62);
      }
      // framed_block already computed its own geo.stack — positioned
      // beside or above/below its photo block, not a generic padded
      // inset of the whole panel — and must not be clobbered here. A
      // confirmed defect otherwise: this unconditional overwrite is
      // exactly why the two Gap 1 fixtures rendered identical stack
      // rects even after their photo rects had already diverged.
      if (!geo.stack) {
        var fpad = geo.panel.w * 0.08;
        geo.stack = { x: geo.panel.x + fpad, y: geo.panel.y + fpad * 0.75, w: geo.panel.w - fpad * 2, h: geo.panel.h - fpad * 1.5 };
      }
    } else if (family === "banner_led") {
      // The banner's own position now has 3 real options (top/center/
      // lower), and — the disclosed Phase 2 rough edge Ashley flagged —
      // the stack fills essentially ALL the remaining vertical run to
      // the nearest edge, not a fixed 10%-tall sliver that read as empty
      // whenever generous negative space was selected.
      var margin = 0.06;
      var bannerLower = textRegion === "negative_space_band_lower" || textRegion === "footer";
      var bannerCenter = textRegion === "dedicated_panel" || textRegion === "framed_block" || textRegion === "integrated_editorial_region";
      if (bannerLower) {
        geo.banner = frac(0.11, 0.68, 0.78, 0.13);
        geo.stack = frac(0.09, 0.68 + 0.13 + 0.02, 0.82, 1 - margin - (0.68 + 0.13 + 0.02));
      } else if (bannerCenter) {
        geo.banner = frac(0.11, 0.42, 0.78, 0.13);
        geo.stack = frac(0.09, 0.42 + 0.13 + 0.03, 0.82, 1 - margin - (0.42 + 0.13 + 0.03));
      } else {
        geo.banner = frac(0.11, 0.13, 0.78, 0.13);
        geo.stack = frac(0.09, 0.13 + 0.13 + 0.03, 0.82, 0.98 - (0.13 + 0.13 + 0.03) - margin);
      }
      // Phase 2.2, Gap 2: imageScale/imagePlacement previously had NO
      // effect on banner_led's photo rect at all — it stayed full-bleed
      // (0,0,1,1) regardless of what Creative Direction asked for, so
      // the two fields never materially changed the geometry (only
      // subjectPlacement's own crop math did). geo.photo now genuinely
      // shrinks and repositions: corner_accent makes the photo a true
      // small accent (the banner/offer dominates); framed_block/
      // inset_panel confine it to whichever open run of canvas the
      // banner does NOT already occupy — sized by imageScale — so the
      // photo and the banner genuinely share visual weight instead of
      // the photo bleeding full-canvas underneath a banner merely
      // painted on top of it. full_bleed (or an unset/default
      // placement) is the one case left unchanged: the photo stays the
      // major visual field, matching "dominant + full_bleed" exactly.
      if (imagePlacement === "corner_accent") {
        var bCornerSide = Math.max(0.16, Math.min(0.32, Math.sqrt(area) * 0.4));
        var bCornerX = subject === "left_third" ? 0.05 : 1 - bCornerSide - 0.05;
        geo.photo = frac(bCornerX, 0.05, bCornerSide, bCornerSide);
      } else if (imagePlacement === "inset_panel" || imagePlacement === "framed_block") {
        var blockFrac = { dominant: 0.6, balanced: 0.44, supporting: 0.28 }[imageScale] || 0.44;
        var bannerTop = geo.banner.y, bannerBottom = geo.banner.y + geo.banner.h;
        var aboveRoom = bannerTop - 0.02;
        var belowRoom = 1 - bannerBottom - 0.02;
        if (belowRoom >= aboveRoom) {
          geo.photo = frac(0, bannerBottom + 0.02, 1, Math.max(0.12, Math.min(blockFrac, belowRoom)));
        } else {
          geo.photo = frac(0, 0, 1, Math.max(0.12, Math.min(blockFrac, aboveRoom)));
        }
      }
      // else full_bleed (or unset): geo.photo keeps its default
      // frac(0, 0, 1, 1) — the photo remains the dominant field.
    } else {
      // hero_full_bleed — the direct answer to the live-diagnosed
      // failure. Full-bleed and dominant by default; imagePlacement/
      // imageScale can still genuinely shrink it into a real inset hero
      // when Creative Direction asks for less than full dominance, and
      // subjectPlacement shifts WHICH SIDE the text stack lives on
      // (opposite the subject) rather than always centering, so a
      // left/right-weighted subject produces a genuinely different
      // composition, not just a differently-cropped version of the same
      // centered layout.
      if (imagePlacement !== "full_bleed" && imageScale !== "dominant") {
        // A direct per-scale side length, not sqrt(area) — an area-exact
        // square inset at "balanced" (58% of canvas area) has a side of
        // ~76% of the canvas, leaving almost no real room beside it for
        // text (a confirmed defect: a 12%-wide sliver). These two values
        // are chosen for real visual proportion instead.
        var insetSide = { balanced: 0.6, supporting: 0.4 }[imageScale] || 0.5;
        var ix = subject === "left_third" ? 0.04 : subject === "right_third" ? 1 - insetSide - 0.04 : (1 - insetSide) / 2;
        var iy = subject === "lower_third" ? 1 - insetSide - 0.05 : 0.06;
        geo.photo = frac(ix, iy, insetSide, insetSide);
        geo.stack = subject === "left_third"
          ? frac(ix + insetSide + 0.04, 0.4, 0.96 - (ix + insetSide + 0.04), 0.36)
          : subject === "right_third"
          ? frac(0.06, 0.4, ix - 0.1, 0.36)
          : frac(0.08, iy + insetSide + 0.05, 0.84, 1 - (iy + insetSide + 0.1) - 0.06);
      } else if (subject === "left_third" || subject === "right_third") {
        var stackOnRight = subject === "left_third";
        var half = stackOnRight ? { x: 0.5, w: 0.44 } : { x: 0.06, w: 0.44 };
        geo.stack = textRegion === "negative_space_band_upper" ? frac(half.x, 0.08, half.w, 0.36) : frac(half.x, 0.54, half.w, 0.4);
      } else if (subject === "lower_third") {
        // The subject sits low — the text stack moves to the open upper
        // portion instead of competing with it, regardless of
        // textRegion's own lower/upper default.
        geo.stack = frac(0.08, 0.07, 0.84, 0.34);
      } else {
        switch (textRegion) {
          case "negative_space_band_upper":
            geo.stack = frac(0.08, 0.06, 0.84, 0.4);
            break;
          case "dedicated_panel":
          case "framed_block":
            geo.isPanelFilled = true;
            geo.panel = frac(0.1, 0.6, 0.8, 0.32);
            geo.stack = frac(0.13, 0.63, 0.74, 0.26);
            break;
          case "integrated_editorial_region":
            geo.stack = frac(0.08, 0.1, 0.52, 0.34);
            break;
          case "banner":
            geo.banner = frac(0.14, 0.42, 0.72, 0.14);
            geo.stack = frac(0.1, 0.58, 0.8, 0.34);
            break;
          case "footer":
            geo.stack = frac(0.06, 0.8, 0.88, 0.16);
            break;
          case "badge":
            geo.stack = frac(0.52, 0.06, 0.42, 0.24);
            break;
          default:
            geo.stack = frac(0.08, 0.56, 0.84, 0.38);
        }
      }
    }
    return geo;
  }

  /**
   * Divides one stack rect into the active roles' own sub-rects,
   * headline first and always largest (headlineScale weights it
   * further), in the exact order Part E's hierarchy commits to. Pure. */
  function splitStackIntoRoles(stackRect, activeRoles, headlineScaleKey, includeHeadline) {
    var weights = { headline: 1 * (HEADLINE_SCALE_MULTIPLIER[headlineScaleKey] || 1), supportingLine: 0.46, serviceDetail: 0.4, cta: 0.52 };
    // A confirmed defect: when the headline actually renders on a
    // separate banner shape (banner_led, or textRegion "banner") rather
    // than in this stack at all, the headline's own (often 1.16x/1.34x)
    // weight was still reserved out of the stack's height — starving
    // supportingLine/cta down to roughly half their intended share for
    // no reason, since nothing ever draws into that reserved slice.
    // includeHeadline === false drops it from the split entirely.
    var order = includeHeadline === false ? activeRoles.slice() : ["headline"].concat(activeRoles);
    var total = 0;
    for (var i = 0; i < order.length; i++) total += weights[order[i]] || 0.4;
    var gap = stackRect.h * 0.035;
    var usableH = stackRect.h - gap * (order.length - 1);
    var rects = {};
    var y = stackRect.y;
    for (var j = 0; j < order.length; j++) {
      var role = order[j];
      var h = usableH * ((weights[role] || 0.4) / total);
      rects[role] = { x: stackRect.x, y: y, w: stackRect.w, h: h };
      y += h + gap;
    }
    return rects;
  }

  // ---- ornament primitives (Part I) -----------------------------------
  //
  // Deterministic, dependency-free Canvas vector primitives — no external
  // asset, no font, no network fetch. Honestly modest rather than
  // pretending to a fidelity plain paths can't deliver: a "wax seal" is a
  // filled circle with a pressed-look inner ring, not a photographic
  // texture; "organic_floral_frame" is a hairline plus a few small
  // curved leaf accents, not a botanical illustration. See the Phase 2
  // completion report for the honest read of what these actually look
  // like.

  /** `sharpCorners` (used for a layered_editorial side column) draws a
   * plain rectangular stroke instead of roundRect — a confirmed defect
   * otherwise: a rounded BORDER stroked over a sharp-cornered FILL left
   * small triangular gaps of raw, unpainted canvas showing through at
   * each corner. Fill and border corner treatment must always agree. */
  function drawBorderStyle(ctx, rect, borderStyle, color, sharpCorners) {
    if (!borderStyle || borderStyle === "none") return;
    ctx.save();
    ctx.strokeStyle = color;
    var r = sharpCorners ? 0 : Math.min(rect.w, rect.h) * 0.03;
    function path(x, y, w, h, radius) {
      if (sharpCorners || radius <= 0) ctx.strokeRect(x, y, w, h);
      else { roundRect(ctx, x, y, w, h, radius); ctx.stroke(); }
    }
    if (borderStyle === "hairline") {
      ctx.lineWidth = Math.max(1, rect.h * 0.006);
      path(rect.x, rect.y, rect.w, rect.h, r);
    } else if (borderStyle === "double_line") {
      ctx.lineWidth = Math.max(1, rect.h * 0.005);
      var inset = Math.max(4, rect.h * 0.025);
      path(rect.x, rect.y, rect.w, rect.h, r);
      path(rect.x + inset, rect.y + inset, rect.w - inset * 2, rect.h - inset * 2, Math.max(0, r - inset * 0.5));
    } else if (borderStyle === "ornamental_frame" || borderStyle === "organic_floral_frame") {
      ctx.lineWidth = Math.max(1, rect.h * 0.006);
      path(rect.x, rect.y, rect.w, rect.h, r);
      drawCornerFlourishes(ctx, rect, color, borderStyle === "organic_floral_frame");
    }
    ctx.restore();
  }

  function drawCornerFlourishes(ctx, rect, color, withLeaves) {
    var s = Math.min(rect.w, rect.h) * 0.08;
    var corners = [
      { x: rect.x, y: rect.y, dx: 1, dy: 1 },
      { x: rect.x + rect.w, y: rect.y, dx: -1, dy: 1 },
      { x: rect.x, y: rect.y + rect.h, dx: 1, dy: -1 },
      { x: rect.x + rect.w, y: rect.y + rect.h, dx: -1, dy: -1 }
    ];
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, s * 0.09);
    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      ctx.beginPath();
      ctx.moveTo(c.x + c.dx * s, c.y);
      ctx.quadraticCurveTo(c.x + c.dx * s * 0.3, c.y + c.dy * s * 0.3, c.x, c.y + c.dy * s);
      ctx.stroke();
      if (withLeaves) {
        ctx.save();
        ctx.fillStyle = hexWithAlpha(color, 0.5);
        ctx.beginPath();
        ctx.ellipse(c.x + c.dx * s * 0.55, c.y + c.dy * s * 0.55, s * 0.22, s * 0.11, Math.atan2(c.dy, c.dx), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawDividerStyle(ctx, cx, y, width, dividerStyle, color) {
    if (!dividerStyle || dividerStyle === "none") return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, width * 0.006);
    if (dividerStyle === "simple_rule") {
      ctx.beginPath();
      ctx.moveTo(cx - width / 2, y);
      ctx.lineTo(cx + width / 2, y);
      ctx.stroke();
    } else if (dividerStyle === "ornamental_flourish") {
      ctx.beginPath();
      ctx.moveTo(cx - width / 2, y);
      ctx.lineTo(cx + width / 2, y);
      ctx.stroke();
      var curl = Math.max(4, width * 0.05);
      [-1, 1].forEach(function (side) {
        var ex = cx + (side * width) / 2;
        ctx.beginPath();
        ctx.moveTo(ex, y);
        ctx.quadraticCurveTo(ex + side * curl, y - curl, ex + side * curl * 1.4, y);
        ctx.stroke();
      });
    } else if (dividerStyle === "floral_sprig") {
      var half = width * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx - half, y);
      ctx.lineTo(cx - half * 0.16, y);
      ctx.moveTo(cx + half * 0.16, y);
      ctx.lineTo(cx + half, y);
      ctx.stroke();
      ctx.save();
      ctx.fillStyle = hexWithAlpha(color, 0.7);
      [-1, 1].forEach(function (side) {
        ctx.beginPath();
        ctx.ellipse(cx + side * half * 0.08, y - Math.abs(side) * 0, half * 0.09, half * 0.045, side * 0.6, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.beginPath();
      ctx.arc(cx, y, half * 0.035, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /** ornamentalDensity's real effect: how many decorative accents
   * actually get drawn — never just a cosmetic label. "minimal"/"light"
   * draw at most the frame's own border; "moderate" adds one divider or
   * corner-leaf pass; "rich" adds both, still bounded (never a repeated/
   * tiled pattern — Part I's explicit "do NOT litter" rule). */
  function ornamentalDensityAllows(density, feature) {
    var rank = { minimal: 0, light: 1, moderate: 2, rich: 3 }[density] || 0;
    var need = { border: 0, corner: 1, divider: 2, motif: 3 }[feature] || 0;
    return rank >= need;
  }

  function drawDecorativeMotifAccents(ctx, rect, motif, color) {
    if (!motif || motif === "none") return;
    ctx.save();
    ctx.fillStyle = hexWithAlpha(color, 0.55);
    var s = Math.min(rect.w, rect.h) * 0.05;
    if (motif === "leaf_accents" || motif === "floral_sprigs") {
      [[rect.x + s, rect.y + s], [rect.x + rect.w - s, rect.y + s]].forEach(function (p) {
        ctx.beginPath();
        ctx.ellipse(p[0], p[1], s * 0.9, s * 0.4, Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();
      });
    } else if (motif === "botanical_line_art") {
      ctx.strokeStyle = hexWithAlpha(color, 0.6);
      ctx.lineWidth = Math.max(1, s * 0.12);
      ctx.beginPath();
      ctx.moveTo(rect.x + s, rect.y + rect.h - s);
      ctx.quadraticCurveTo(rect.x + s * 2, rect.y + rect.h - s * 3, rect.x + s * 3.4, rect.y + rect.h - s);
      ctx.stroke();
    } else if (motif === "watercolor_wash") {
      var wash = ctx.createRadialGradient(rect.x + rect.w / 2, rect.y, 0, rect.x + rect.w / 2, rect.y, rect.w * 0.5);
      wash.addColorStop(0, hexWithAlpha(color, 0.22));
      wash.addColorStop(1, hexWithAlpha(color, 0));
      ctx.fillStyle = wash;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h * 0.4);
    } else if (motif === "geometric_minimal") {
      ctx.strokeStyle = hexWithAlpha(color, 0.5);
      ctx.lineWidth = Math.max(1, s * 0.1);
      ctx.strokeRect(rect.x + s * 0.5, rect.y + s * 0.5, s, s);
    }
    ctx.restore();
  }

  /** badgeStyle (Part J) — a small, restrained, PURELY DECORATIVE accent
   * near the branding lockup. Never carries invented text (a discount
   * badge with a real "% off" claim needs real content-generation
   * support that doesn't exist yet in Phase 2 — see the completion
   * report's "not yet executed" list); this is ornament only. */
  function drawBadgeAccent(ctx, cx, cy, radius, badgeStyle, colors) {
    if (!badgeStyle || badgeStyle === "none") return;
    ctx.save();
    if (badgeStyle === "circular_badge") {
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = Math.max(1.5, radius * 0.09);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (badgeStyle === "ribbon_badge") {
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.moveTo(cx - radius * 0.5, cy - radius);
      ctx.lineTo(cx + radius * 0.5, cy - radius);
      ctx.lineTo(cx + radius * 0.5, cy + radius * 0.6);
      ctx.lineTo(cx, cy + radius * 0.3);
      ctx.lineTo(cx - radius * 0.5, cy + radius * 0.6);
      ctx.closePath();
      ctx.fill();
    } else if (badgeStyle === "wax_seal_style") {
      ctx.fillStyle = colors.primary;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hexWithAlpha("#000000", 0.18);
      ctx.lineWidth = Math.max(1, radius * 0.12);
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.62, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** bannerStyle (Part J) — the shape banner_led's headline is carried
   * on. 'ribbon_banner' reuses the existing chevron-notched ribbon
   * (drawBanner, above) exactly as-is; the other two are new, equally
   * simple shapes. `torn_paper_banner` is an honest geometric
   * approximation (a jagged-edge polygon) — never a real paper texture,
   * which plain Canvas paths can't produce without an external asset. */
  function drawBannerShape(ctx, rect, bannerStyle, color) {
    if (bannerStyle === "ribbon_banner" || !bannerStyle) {
      drawBanner(ctx, { x: rect.x, y: rect.y, w: rect.w, h: rect.h, radius: rect.h * 0.2 }, color);
      return;
    }
    ctx.save();
    ctx.fillStyle = color;
    if (bannerStyle === "flat_banner") {
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h * 0.16);
      ctx.fill();
    } else if (bannerStyle === "torn_paper_banner") {
      var teeth = 10, toothW = rect.w / teeth, jag = rect.h * 0.06;
      ctx.beginPath();
      ctx.moveTo(rect.x, rect.y + jag);
      for (var i = 0; i <= teeth; i++) {
        var x = rect.x + i * toothW;
        ctx.lineTo(x, rect.y + (i % 2 === 0 ? 0 : jag));
      }
      for (var j = teeth; j >= 0; j--) {
        var x2 = rect.x + j * toothW;
        ctx.lineTo(x2, rect.y + rect.h - (j % 2 === 0 ? 0 : jag));
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Part H — branding execution. Resolves what to actually draw
   * (never both text AND logo unless brandIdentifier === "both"; never
   * synthesizes a logo) and where, from brandingPosition/brandingScale.
   * Pure geometry/decision half — the actual logo <img> load stays in
   * the DOM half below (drawBrandIdentity), reusing the existing
   * drawLogo()'s real "logo optional, never blocks the flyer" contract. */
  function resolveBrandingRect(brandingPosition, width, height) {
    switch (brandingPosition) {
      case "top_left": return { x: Math.round(width * 0.06), y: Math.round(height * 0.04), w: Math.round(width * 0.42), h: Math.round(height * 0.09), align: "left" };
      case "bottom_center": return { x: Math.round(width * 0.1), y: Math.round(height * 0.88), w: Math.round(width * 0.8), h: Math.round(height * 0.09), align: "center" };
      case "corner_watermark": return { x: Math.round(width * 0.62), y: Math.round(height * 0.9), w: Math.round(width * 0.32), h: Math.round(height * 0.07), align: "right" };
      case "top_center":
      default:
        return { x: Math.round(width * 0.1), y: Math.round(height * 0.03), w: Math.round(width * 0.8), h: Math.round(height * 0.09), align: "center" };
    }
  }

  var BRANDING_SCALE_MULTIPLIER = { subtle: 0.85, standard: 1, prominent: 1.3 };

  /** Draws the shop's brand identity per Part H exactly: shop_name draws
   * only the name, logo draws only the logo, both draws both — a failed
   * logo load safely falls back to the shop name (never leaves the
   * flyer unbranded), and a logo is never synthesized. Returns a promise
   * resolving to { textStyle used, drew: "name"|"logo"|"both"|"none" }.
   *
   * Ashley's Phase 2.1 correction: the first pass never gave the
   * branding lockup the same banner-behind-busy-photo rescue the main
   * text roles have — a real, disclosed gap, now closed with a small
   * self-contained two-pass measure/paint (mirroring layOutText's own
   * discipline) rather than a single real-context draw that could sit
   * unreadably on a busy patch of photo. */
  function drawBrandIdentity(ctx, rect, brand, brandIdentifier, brandingScaleKey, textStyle, background, ribbonColor) {
    var scale = BRANDING_SCALE_MULTIPLIER[brandingScaleKey] || 1;
    var wantsLogo = brandIdentifier === "logo" || brandIdentifier === "both";
    var drewName = false;
    function drawName() {
      if (!brand.shopName) return { usedHeight: 0, bannered: false };
      var scaledRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h * scale };
      var fit = fitShopLockup(ctx, scaledRect, brand.shopName);
      drewName = true;
      if (background) {
        var measureBands = [];
        drawShopNameLockup(measuringContext(ctx), scaledRect, brand, null, textStyle, background, fit, measureBands);
        var merged = mergeBands(measureBands, rect.h * 0.05);
        for (var i = 0; i < merged.length; i++) drawBanner(ctx, merged[i], ribbonColor || "#7c3a58");
      }
      return drawShopNameLockup(ctx, scaledRect, brand, null, textStyle, background, fit, null);
    }
    if (!wantsLogo) {
      drawName();
      return Promise.resolve({ drew: brand.shopName ? "shop_name" : "none" });
    }
    var logoRect = { x: rect.x + rect.w * 0.5 - (rect.h * scale) / 2, y: rect.y, w: rect.h * scale, h: rect.h * scale };
    return drawLogo(ctx, logoRect, brand.logoUrl)
      .then(function (loaded) {
        // drawLogo() (existing, unmodified) resolves even when the image
        // fails to load or logoUrl is empty — it swallows the error
        // itself (a logo is optional). We can't distinguish "drew" from
        // "failed silently" from its own return value, so re-check the
        // one fact that matters: was a real logoUrl even provided.
        var logoAttempted = Boolean(brand.logoUrl);
        if (brandIdentifier === "both") {
          drawName();
          return { drew: logoAttempted ? "both" : "shop_name" };
        }
        if (logoAttempted) return { drew: "logo" };
        // brandIdentifier was "logo" but there's no real logo to draw —
        // safe fallback to the shop name rather than leaving the flyer
        // completely unbranded.
        drawName();
        return { drew: "shop_name" };
      });
  }

  /**
   * Draws one text role (headline/supportingLine/serviceDetail/cta) into
   * its allocated rect, reusing the EXACT existing legibility machinery
   * (pickRegionTextStyle for real per-pixel contrast, drawRegionText's
   * own auto-fit-with-floor loop, the banner-behind-busy-text fallback)
   * rather than re-implementing any of it. Character limits (Part F) are
   * enforced here — never by truncating into nonsense; only by refusing
   * to draw MORE than the ceiling allows the same way drawRegionText's
   * own auto-fit floor already refuses to shrink past legibility.
   */
  function roleFontFamily(role, typography) {
    if (role === "cta") return null; // CTA keeps its existing dedicated 'Inter' treatment (drawCtaLabel) — a hard UI convention, not a headline/body role.
    return role === "headline" ? typography.headline : typography.body;
  }

  /** Whether text, even at drawRegionText's own legibility floor (78% of
   * target, or the CTA's 62%), would still overflow its rect badly
   * enough to overlap a neighbor or spill off the canvas — Part F's
   * "mandatory headline should fail render safely if truly impossible."
   * A cheap, conservative pure estimate (character count vs. rect area)
   * — never a full text-shaping pass — so this can run before any
   * canvas exists at all. Pure. */
  function isRoleImpossibleToFit(text, rect, minFontSize) {
    var len = String(text || "").length;
    if (!len) return false;
    if (rect.w <= 0 || rect.h <= 0) return true;
    // A rough, deliberately generous character budget: at the legibility
    // floor, one character needs roughly minFontSize*0.55 of width and a
    // line needs minFontSize*1.15 of height. If the text would need more
    // TOTAL area than the rect can offer even wrapped across every line
    // the rect's own height could hold, it is genuinely impossible, not
    // just tight.
    var maxLines = Math.max(1, Math.floor(rect.h / (minFontSize * 1.15)));
    var charsPerLine = Math.max(1, Math.floor(rect.w / (minFontSize * 0.5)));
    return len > maxLines * charsPerLine * 1.15;
  }

  /** Draws one text role (headline/supportingLine) in a chosen font
   * family/weight, with the exact same auto-fit-with-floor and
   * banner-behind-busy-photo fallback behavior drawRegionText already
   * gives the legacy path — reused via the same helpers
   * (measureWrappedLines/drawWrappedLines/needsBannerBehind/bannerBand),
   * never a second, independently-drifting legibility policy. */
  function drawTypographyRole(ctx, rect, text, roleOpts) {
    if (!text) return { drew: false, bannered: false };
    roleOpts = roleOpts || {};
    var background = roleOpts.background, bands = roleOpts.bands;
    var textStyle = roleOpts.textStyle || { color: BAND_TEXT_COLOR, softColor: BAND_TEXT_COLOR_SOFT, outline: null };
    // Sized from the role's HEIGHT allocation, then capped by its WIDTH —
    // a tall-but-narrow column (layered_editorial's panel side) can
    // otherwise compute a starting size and floor both far too large for
    // the actual width available, no matter how much the loop below
    // shrinks, because the floor itself was derived from the oversized
    // starting point rather than from the real available width.
    var baseSize = Math.min(rect.h * (roleOpts.baseSizeRatio || 0.36), rect.w * 0.42);
    var minFont = Math.max(16, Math.min(baseSize * (roleOpts.minFontRatio || 0.7), rect.w * 0.22));
    var fontSize = baseSize;
    var maxTextWidth = rect.w * 0.94;
    var weight = roleOpts.weight || "600";
    var family = roleOpts.family;
    var lines = [text], lineHeight = fontSize * 1.2;
    ctx.save();
    applyTextShadow(ctx);
    ctx.fillStyle = textStyle.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // A real, visually-confirmed defect in this exact new code path (a
    // narrow layered_editorial panel column): the height-only check below
    // let a single WORD wider than the column overflow horizontally
    // completely unchecked — measureWrappedLines never breaks a word
    // mid-string, so a too-large font just drew each word as its own
    // massively-overflowing line while still reporting a "short enough"
    // total block height. Every attempt now also measures its own widest
    // actual line and keeps shrinking until BOTH dimensions genuinely
    // fit, not just height — this is new code fixing its own bug, not a
    // change to the legacy drawRegionText path (whose own regions are
    // always wide enough in practice that this never surfaced there).
    // Matches drawHeadlineWithAccentWord's own script styling exactly —
    // that function always italicizes the script family; this one must
    // too, or the two script-accent modes (accent_word vs. subhead_
    // script) render inconsistently for the identical font choice (a
    // real, visually-confirmed defect: the generic 'cursive' fallback
    // this app relies on for the script role only actually LOOKS like a
    // script face when italicized on this environment's font set).
    var italicPrefix = roleOpts.italic ? "italic " : "";
    for (var attempt = 0; attempt < 9; attempt++) {
      ctx.font = italicPrefix + weight + " " + Math.round(fontSize) + "px " + family;
      lineHeight = fontSize * 1.2;
      lines = measureWrappedLines(ctx, text, maxTextWidth);
      var blockHeight = lines.length * lineHeight;
      var widestLine = 0;
      for (var wl = 0; wl < lines.length; wl++) widestLine = Math.max(widestLine, ctx.measureText(lines[wl]).width);
      var fitsHeight = blockHeight <= rect.h * 0.96;
      var fitsWidth = widestLine <= maxTextWidth * 1.02;
      if ((fitsHeight && fitsWidth) || fontSize <= minFont) break;
      fontSize = Math.round(fontSize * 0.85);
    }
    var bannered = false;
    if (background) {
      var widest = 0;
      for (var li = 0; li < lines.length; li++) widest = Math.max(widest, ctx.measureText(lines[li]).width);
      var blockH = lines.length * lineHeight;
      var textRect = { x: rect.x + rect.w / 2 - widest / 2, y: rect.y + rect.h / 2 - blockH / 2, w: widest, h: blockH };
      var band = bannerBand({ cx: rect.x + rect.w / 2, top: textRect.y, textWidth: widest, blockHeight: blockH, fontSize: fontSize, maxWidth: rect.w });
      if (needsBannerBehind(background, textRect, textStyle.color, colorAlpha(textStyle.color))) {
        bannered = true;
        if (bands) bands.push(band);
        textStyle = { color: BAND_TEXT_COLOR, softColor: BAND_TEXT_COLOR_SOFT, outline: null };
        ctx.fillStyle = textStyle.color;
      }
    }
    drawWrappedLines(ctx, lines, rect.x + rect.w / 2, rect.y + rect.h / 2, lineHeight, outlineFor(textStyle, fontSize));
    ctx.restore();
    return { drew: true, bannered: bannered, fontSize: fontSize, wrapped: lines.length > 1 };
  }

  /**
   * Part E's serif_script_pairing + scriptAccentUsage:"accent_word" —
   * renders the headline's OWN first word in the script family and the
   * rest in the serif family, on one line, as two genuinely different
   * typographic roles (never inline-mixed across a wrapped multi-line
   * block, which canvas text can't shape cleanly). Returns null — the
   * caller falls back to a plain single-family render — when the
   * combined text can't be brought to fit one line above the legibility
   * floor; deliberately skipped whenever the busy-photo banner-behind
   * fallback might be needed (a real, disclosed Phase 2 simplification —
   * see the completion report), so it only ever actually renders over a
   * calm photo area or a flat panel color.
   */
  function drawHeadlineWithAccentWord(ctx, rect, fullText, accentWord, serifFamily, scriptFamily, weight, textStyle, baseSize) {
    var rest = String(fullText).slice(accentWord.length).trim();
    // Same width-based cap as drawTypographyRole, and for the same
    // reason: a narrow panel column can make a height-derived baseSize
    // (and the floor derived from it) far too large for the width
    // actually available, regardless of how far the shrink loop below
    // runs.
    var fontSize = Math.min(baseSize, rect.w * 0.42);
    var minFont = Math.max(18, Math.min(baseSize * 0.7, rect.w * 0.22));
    function measure() {
      ctx.font = "italic 400 " + Math.round(fontSize * 1.18) + "px " + scriptFamily;
      var scriptW = ctx.measureText(accentWord).width;
      ctx.font = weight + " " + Math.round(fontSize) + "px " + serifFamily;
      var restW = rest ? ctx.measureText(" " + rest).width : 0;
      return { scriptW: scriptW, restW: restW, total: scriptW + restW };
    }
    ctx.save();
    var m = measure();
    while (m.total > rect.w * 0.94 && fontSize > minFont) {
      fontSize = Math.round(fontSize * 0.92);
      m = measure();
    }
    if (m.total > rect.w * 0.94) {
      ctx.restore();
      return null;
    }
    var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    var startX = cx - m.total / 2;
    applyTextShadow(ctx);
    ctx.fillStyle = textStyle.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "italic 400 " + Math.round(fontSize * 1.18) + "px " + scriptFamily;
    ctx.fillText(accentWord, startX, cy);
    if (rest) {
      ctx.font = weight + " " + Math.round(fontSize) + "px " + serifFamily;
      ctx.fillText(" " + rest, startX + m.scriptW, cy);
    }
    ctx.restore();
    return { fontSize: fontSize, bannered: false };
  }

  /**
   * Phase 2 — the Creative Direction execution path. Reuses every
   * legibility primitive the legacy path already relies on (contrast
   * sampling, calm-placement search, banner-behind-busy-photo, the
   * auto-fit-with-floor loop) rather than re-implementing any of them;
   * only the LAYOUT geometry, typography, ornament, and which roles get
   * drawn at all are actually new. Returns Promise<HTMLCanvasElement>,
   * exactly like renderFlyer() itself — rejects (never silently paints a
   * broken result) only when a MANDATORY role (the headline) is
   * genuinely impossible to fit at the legibility floor (Part F).
   */
  function renderFlyerWithCreativeDirection(opts) {
    var cd = opts.creativeDirection;
    var content = opts.content || {};
    var brand = opts.brand || {};
    var backgroundUrl = opts.backgroundUrl || null;
    var width = opts.width || 1080;
    var height = opts.height || 1080;
    var fallbackBackgroundUrl = opts.fallbackBackgroundUrl === undefined ? FALLBACK_FLORAL_BACKGROUND : opts.fallbackBackgroundUrl;

    var typography = TYPOGRAPHY_PERSONAS[cd.typographyPersonality] || TYPOGRAPHY_PERSONAS.editorial_serif;
    var geo = resolveCompositionGeometry(cd, width, height);
    var ornamentColors = resolveOrnamentColors(cd.paletteMood, brand, cd.occasionTreatment, cd.visualMood);
    var slots = cd.graphicTextSlots || {};
    var isOperationalNotice = cd.occasionTreatment === "operational_notice";

    // Which roles actually get text, gated by BOTH hierarchyDepth (the
    // family's own intended shape) AND graphicTextSlots (the hard
    // contract) — either one saying "no" is enough to keep a role off
    // the graphic. serviceDetail is intentionally never drawn in Phase 2
    // (see the completion report's "not yet executed" list: no real
    // content-generation field carries service-detail text yet, and this
    // renderer never invents wording).
    var depthRoles = HIERARCHY_DEPTH_ROLES[cd.hierarchyDepth] || [];
    var activeRoles = depthRoles.filter(function (r) { return r !== "serviceDetail" && slots[r]; });

    // Part F: a mandatory headline that is genuinely impossible to fit,
    // even at the legibility floor, fails the render rather than paints
    // overlapping/broken text.
    var headlineRoleRectForCheck = geo.stack || geo.banner || { x: 0, y: 0, w: width, h: height * 0.2 };
    if (isRoleImpossibleToFit(content.headline, splitStackIntoRoles(headlineRoleRectForCheck, activeRoles, cd.headlineScale).headline, 18)) {
      return Promise.reject(new Error("This headline cannot be rendered legibly in the space Creative Direction allocated for it — nothing was drawn."));
    }

    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    var backgroundTier = null;

    // A confirmed defect (real pixel inspection, not just tests): several
    // geometries — an inset hero with real negative space around it,
    // corner_accent's own margin, a strip panel's edge run — leave part
    // of the canvas outside both the photo rect and any filled panel.
    // With no base fill, that area is raw transparent canvas: it reads
    // as an ugly black void once flattened for a real download/post
    // (violates the "never dark/moody by default" rule), and worse, text
    // legibility sampling reads a transparent pixel's (0,0,0,0) as a
    // dark background and chooses light text that then goes illegible
    // wherever the transparency actually composites light. One opaque,
    // neutral base fill under everything else closes every such gap at
    // the root, regardless of which geometry branch produced it — every
    // real paint step still fully covers it wherever a photo or panel
    // belongs. Phase 2.3: this now uses the resolved palette family's
    // own base tone (not the fixed cream TIER_B_BASE every family used
    // to share) — the negative-space "airy neutral," the operational
    // notice's clean off-white, a season's own base tint all now
    // actually show through wherever the canvas is otherwise open.
    ctx.fillStyle = ornamentColors.base || TIER_B_BASE;
    ctx.fillRect(0, 0, width, height);

    function paintPhotoInto(rect, url) {
      if (!url) return Promise.resolve(false);
      return loadImage(url).then(function (img) {
        drawCoverAligned(ctx, img, rect.x, rect.y, rect.w, rect.h, cd.subjectPlacement, cd.imageCrop);
        return true;
      }).catch(function () { return false; });
    }

    function paintBackground() {
      if (backgroundUrl) {
        return paintPhotoInto(geo.photo, backgroundUrl).then(function (ok) {
          if (ok) { backgroundTier = BACKGROUND_TIER.GENERATED; return; }
          return paintPhotoInto(geo.photo, fallbackBackgroundUrl).then(function (ok2) {
            backgroundTier = ok2 ? BACKGROUND_TIER.FALLBACK_PHOTO : BACKGROUND_TIER.PROCEDURAL;
            if (!ok2) { ctx.fillStyle = ornamentColors.base || TIER_B_BASE; ctx.fillRect(geo.photo.x, geo.photo.y, geo.photo.w, geo.photo.h); }
          });
        });
      }
      return paintPhotoInto(geo.photo, fallbackBackgroundUrl).then(function (ok2) {
        backgroundTier = ok2 ? BACKGROUND_TIER.FALLBACK_PHOTO : BACKGROUND_TIER.PROCEDURAL;
        if (!ok2) { ctx.fillStyle = ornamentColors.base || TIER_B_BASE; ctx.fillRect(geo.photo.x, geo.photo.y, geo.photo.w, geo.photo.h); }
      });
    }

    // A confined photo rect (layered_editorial's side column, or
    // framed_panel's own strip/corner treatments) leaves real canvas
    // outside the photo — filled with the panel color BEFORE the photo
    // ever paints, so there is never a gap of raw, unpainted (black)
    // canvas anywhere. panelShape "column" (a side column spanning the
    // canvas edge to edge) fills sharp-edged; everything else fills as a
    // rounded card, matching the border's own corner treatment exactly
    // (a confirmed defect otherwise: a rounded border stroked over a
    // sharp fill left visible black wedges at each corner).
    function paintPanelFill() {
      if (!(geo.panel && geo.isPanelFilled)) return;
      ctx.save();
      ctx.fillStyle = ornamentColors.panel;
      if (geo.panelShape === "column") {
        ctx.fillRect(geo.panel.x, geo.panel.y, geo.panel.w, geo.panel.h);
      } else {
        roundRect(ctx, geo.panel.x, geo.panel.y, geo.panel.w, geo.panel.h, Math.min(geo.panel.w, geo.panel.h) * 0.04);
        ctx.fill();
      }
      ctx.restore();
    }
    function paintPanelBorderAndOrnament() {
      if (!(geo.panel && geo.isPanelFilled)) return;
      drawBorderStyle(ctx, geo.panel, cd.borderStyle, ornamentColors.border, geo.panelShape === "column");
      // drawBorderStyle already draws its OWN corner flourishes for
      // "ornamental_frame"/"organic_floral_frame" — that pairing IS
      // what makes those two border styles ornamental, independent of
      // density. Only a plainer border (hairline/double_line/none)
      // gets a SEPARATE, density-gated corner accent here — never a
      // redundant second pass over the same flourish.
      var borderAlreadyOrnamental = cd.borderStyle === "ornamental_frame" || cd.borderStyle === "organic_floral_frame";
      if (!borderAlreadyOrnamental && ornamentalDensityAllows(cd.ornamentalDensity, "corner")) {
        drawCornerFlourishes(ctx, geo.panel, ornamentColors.border, false);
      }
      if (ornamentalDensityAllows(cd.ornamentalDensity, "motif")) drawDecorativeMotifAccents(ctx, geo.panel, cd.decorativeMotif, ornamentColors.accent);
    }

    // framed_panel's corner_accent treatment (Part C correction: the
    // photo is a small accent sitting ON TOP of the panel, not beside a
    // partial one) needs the panel painted BEFORE the photo, so the
    // photo lands whole and unclipped on top of it rather than the
    // panel fill painting back over part of an already-drawn photo (a
    // confirmed defect: the panel's own rounded corner arc sliced
    // straight through the photo).
    if (geo.panelBehindPhoto) paintPanelFill();

    return paintBackground().then(function () {
      if (!geo.panelBehindPhoto) paintPanelFill();
      paintPanelBorderAndOrnament();
      if (geo.banner && cd.bannerStyle && cd.bannerStyle !== "none") {
        drawBannerShape(ctx, geo.banner, cd.bannerStyle, ornamentColors.primary);
      }

      var background = captureBackground(ctx, width, height);
      var onPanel = Boolean(geo.panel && geo.isPanelFilled);
      var panelTextStyle = onPanel
        ? (function () {
            var c = parseColor(ornamentColors.panel);
            var isDark = pickTextColor(c) === BAND_TEXT_COLOR;
            return { color: isDark ? BAND_TEXT_COLOR : CHARCOAL_TEXT, softColor: isDark ? BAND_TEXT_COLOR_SOFT : CHARCOAL_TEXT_SOFT, outline: null };
          })()
        : null;

      // Headline — the one always-mandatory role. Uses the banner rect
      // instead of the stack when this family carries its headline on a
      // literal banner shape (banner_led, or textRegion "banner") — in
      // which case the stack split below must NOT reserve headline's own
      // share of the stack height for a role that never actually draws
      // there (a confirmed defect: it was starving supportingLine/cta to
      // roughly half their intended size).
      var headlineOnBanner = Boolean(geo.banner) && (cd.compositionFamily === "banner_led" || cd.textRegion === "banner");
      var roleRects = splitStackIntoRoles(geo.stack || headlineRoleRectForCheck, activeRoles, cd.headlineScale, !headlineOnBanner);
      var drawnRoles = [];

      function styleFor(rect) {
        return panelTextStyle || pickRegionTextStyle(ctx, rect, background);
      }

      var headlineRect = headlineOnBanner ? geo.banner : roleRects.headline;
      var headlineStyle = geo.banner === headlineRect ? { color: BAND_TEXT_COLOR, softColor: BAND_TEXT_COLOR_SOFT, outline: null } : styleFor(headlineRect);
      var scriptPlan = resolveScriptAccentPlan(cd.scriptAccentUsage, content.headline, isOperationalNotice);
      var headlineFamily = typography.headline;
      // The full-script-headline and accent-word treatments are only
      // attempted on a calm/flat surface (a panel, or the dedicated
      // banner shape) — never against an unpredictable photo area, where
      // the banner-behind-busy fallback below is the safety net that
      // already exists and is proven; this is a deliberate, disclosed
      // Phase 2 scope limit.
      var safeForScriptTreatment = onPanel || headlineRect === geo.banner;

      var contactRect = { x: Math.round(width * 0.06), y: Math.round(height * 0.93), w: Math.round(width * 0.88), h: Math.round(height * 0.05) };
      var supportingText = activeRoles.indexOf("supportingLine") !== -1 && roleRects.supportingLine
        ? deriveSupportingLineText(content.body, cd.graphicTextLimits && cd.graphicTextLimits.supportingLineMaxChars)
        : null;

      // Independent-review-equivalent fix: a role that needed a
      // banner-behind-busy-photo rescue was previously drawn immediately
      // (in real cream text) and THEN the ribbon itself was painted on
      // top afterward — silently erasing the very text the ribbon was
      // supposed to rescue (a confirmed defect: an entirely empty ribbon
      // where a headline should have been, on a real generated
      // screenshot). This mirrors the legacy renderFlyer() path's own
      // proven two-pass discipline instead: `layOutText` runs once
      // against measuringContext(ctx) (measures and decides which roles
      // need a band, paints nothing for real), the merged bands are
      // painted for real, and only THEN does the exact same function run
      // again against the real ctx — by which point any banner a role
      // needs is already underneath it.
      function layOutText(targetCtx, bandsSink) {
        var localDrawn = [];
        if (typography.script && scriptPlan.mode === "full_headline" && safeForScriptTreatment) {
          var full = drawTypographyRole(targetCtx, headlineRect, content.headline, {
            family: typography.script, weight: "400", textStyle: headlineStyle,
            baseSizeRatio: 0.34 * (HEADLINE_SCALE_MULTIPLIER[cd.headlineScale] || 1),
            italic: true
          });
          if (full.drew) localDrawn.push("headline");
        } else if (typography.script && scriptPlan.mode === "accent_word" && safeForScriptTreatment && scriptPlan.accentWord) {
          var accentResult = drawHeadlineWithAccentWord(
            targetCtx, headlineRect, content.headline, scriptPlan.accentWord,
            headlineFamily, typography.script, typography.headlineWeight, headlineStyle,
            headlineRect.h * 0.36 * (HEADLINE_SCALE_MULTIPLIER[cd.headlineScale] || 1)
          );
          localDrawn.push("headline");
          if (!accentResult) {
            // Doesn't fit on one line at any size — fall back to the
            // plain wrapped render for THIS pass only (deterministic:
            // both passes make the identical choice since nothing
            // between them changes the measurement).
            drawTypographyRole(targetCtx, headlineRect, content.headline, {
              family: headlineFamily, weight: typography.headlineWeight, textStyle: headlineStyle,
              background: headlineRect === geo.banner ? null : background, bands: bandsSink,
              baseSizeRatio: 0.36 * (HEADLINE_SCALE_MULTIPLIER[cd.headlineScale] || 1)
            });
          }
        } else {
          var hResult = drawTypographyRole(targetCtx, headlineRect, content.headline, {
            family: headlineFamily, weight: typography.headlineWeight, textStyle: headlineStyle,
            background: headlineRect === geo.banner ? null : background, bands: bandsSink,
            baseSizeRatio: 0.36 * (HEADLINE_SCALE_MULTIPLIER[cd.headlineScale] || 1)
          });
          if (hResult.drew) localDrawn.push("headline");
        }

        // Supporting line — a real EXCERPT of the actual caption, never
        // invented (Part G). subhead_script renders it in the script
        // family when the plan calls for one.
        if (supportingText) {
          var supportFamily = typography.script && scriptPlan.mode === "subhead_script" && safeForScriptTreatment ? typography.script : typography.body;
          var supportWeight = supportFamily === typography.script ? "400" : typography.bodyWeight;
          var sResult = drawTypographyRole(targetCtx, roleRects.supportingLine, supportingText, {
            family: supportFamily, weight: supportWeight, textStyle: styleFor(roleRects.supportingLine),
            background: onPanel ? null : background, bands: bandsSink, baseSizeRatio: 0.3, minFontRatio: 0.75,
            italic: supportFamily === typography.script
          });
          if (sResult.drew) localDrawn.push("supportingLine");
        }

        // CTA — the existing, unmodified drawCtaLabel/computeCtaLayout,
        // gated on the hard contract exactly like every other role.
        if (activeRoles.indexOf("cta") !== -1 && roleRects.cta && content.cta) {
          drawCtaLabel(targetCtx, roleRects.cta, content.cta, ornamentColors.accent, styleFor(roleRects.cta), roleRects.cta.h, onPanel ? null : background, bandsSink);
          localDrawn.push("cta");
        }

        // Phone (Part F/Q): a footer contact line is drawn AT ALL only
        // when graphicTextSlots.phone is true — no phone number reaches
        // the graphic in any form otherwise, even when the shop profile
        // has one on file. contactLineParts' own existing dedup logic
        // still applies underneath this gate (never repeats a number the
        // CTA already shows).
        if (slots.phone) {
          drawContact(targetCtx, contactRect, brand, styleFor(contactRect), content.cta, onPanel ? null : background, ornamentColors.accent, bandsSink);
          if (contactLineParts(brand, content.cta).length) localDrawn.push("contact");
        }
        return localDrawn;
      }

      var wantedBands = [];
      layOutText(measuringContext(ctx), wantedBands);
      var merged = mergeBands(wantedBands, height * 0.004);
      for (var mi = 0; mi < merged.length; mi++) drawBanner(ctx, merged[mi], ornamentColors.primary);
      drawnRoles = layOutText(ctx, null);

      // Branding (Part H). drawBrandIdentity now runs its own internal
      // measure/paint pass (see its own docstring) whenever the lockup
      // sits directly on the photo, so a busy patch behind the shop name
      // gets the same real ribbon rescue the main text roles have —
      // closing the rough edge Ashley flagged in the Phase 2 review.
      var brandRect = resolveBrandingRect(cd.brandingPosition, width, height);
      var brandStyle = onPanel ? panelTextStyle : pickRegionTextStyle(ctx, brandRect, background);
      var brandingPromise = drawBrandIdentity(ctx, brandRect, brand, cd.brandIdentifier, cd.brandingScale, brandStyle, onPanel ? null : background, ornamentColors.primary);

      // Badge (Part J) — a small, restrained, purely decorative accent
      // near the branding corner, never carrying invented text.
      if (cd.badgeStyle && cd.badgeStyle !== "none" && ornamentalDensityAllows(cd.ornamentalDensity, "corner")) {
        var badgeR = Math.min(width, height) * 0.035 * (BRANDING_SCALE_MULTIPLIER[cd.brandingScale] || 1);
        // Positioned relative to the ACTUAL branding lockup rect, not a
        // fixed canvas corner — a confirmed defect otherwise: a
        // bottom-anchored brandingPosition (bottom_center,
        // corner_watermark) still pinned the badge to the top-right
        // corner regardless, reading as an orphaned mark with no visual
        // relationship to the lockup it was meant to accent.
        var badgeCx = brandRect.align === "right" ? brandRect.x + badgeR * 1.3 : brandRect.x + brandRect.w - badgeR * 1.3;
        var badgeCy = brandRect.y + brandRect.h / 2;
        badgeCx = Math.max(badgeR + 4, Math.min(width - badgeR - 4, badgeCx));
        badgeCy = Math.max(badgeR + 4, Math.min(height - badgeR - 4, badgeCy));
        drawBadgeAccent(ctx, badgeCx, badgeCy, badgeR, cd.badgeStyle, ornamentColors);
      }

      return brandingPromise.then(function () {
        if (canvas.dataset) {
          canvas.dataset.florisynBackgroundTier = backgroundTier || BACKGROUND_TIER.PROCEDURAL;
          canvas.dataset.florisynCreativeDirection = "1";
          canvas.dataset.florisynOccasionTreatment = cd.occasionTreatment || "";
          canvas.dataset.florisynCompositionFamily = cd.compositionFamily || "";
          canvas.dataset.florisynTextRegion = cd.textRegion || "";
          canvas.dataset.florisynDrawnRoles = drawnRoles.join(",");
        }
        return canvas;
      });
    });
  }

  /** Draws a full flyer: background (a generated image URL — Tier A — or
   * a rich Tier-B floral-toned wash over the template's own flat/gradient
   * brand fill, see flyer-templates.js's `palette` field), full-bleed and
   * edge to edge, with NOTHING painted over it — every text region reads
   * its color and (when needed) its thin outline from the photo's own
   * real pixels at that exact spot (pickRegionTextStyle). Returns
   * Promise<HTMLCanvasElement>. Never throws on a missing/failed
   * background image — falls back to the Tier-B wash instead, so a flyer
   * is always renderable even if a generated visual never arrives. */
  function renderFlyer(opts) {
    opts = opts || {};
    // Phase 2: a real creative_direction object branches into the
    // dynamic execution path below — a pre-Phase-1 asset, or any caller
    // that simply doesn't pass one, falls straight through to the
    // original code beneath this check, completely unchanged (Part O:
    // backward compatibility is never optional).
    if (opts.creativeDirection) return renderFlyerWithCreativeDirection(opts);
    var template = opts.template;
    var content = opts.content || {};
    var style = opts.style || { scale: {} };
    var brand = opts.brand || {};
    var backgroundUrl = opts.backgroundUrl || null;
    var width = opts.width || 1080;
    var height = opts.height || 1080;
    // Callers may override or disable the floral fallback; default it on.
    if (opts.fallbackBackgroundUrl === undefined) opts.fallbackBackgroundUrl = FALLBACK_FLORAL_BACKGROUND;

    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    var colors = effectivePaletteColors(brand, style);
    // Which tier actually drew the background. Stamped onto the canvas at
    // the end so nothing downstream can present a fallback as live AI
    // output — the single most important thing to never get wrong in a
    // report about this renderer.
    var backgroundTier = null;

    // Ashley's standing rule — no full-image colour wash, regardless of hue
    // — applies to the no-photo fallback too, and a real pre-live-test
    // render proved it was being broken here: with no generated background
    // (provider unconfigured, call failed, or the image URL simply failed
    // to load) this filled the ENTIRE canvas with the shop's brand primary.
    // For a real shop whose primary is a saturated magenta that is a solid
    // magenta flyer with no flowers at all — precisely the "full-image
    // colour wash" the rule forbids, and the opposite of the required
    // bright/happy/colourful default.
    //
    // The base is now bright ivory. An EXPLICIT colour revision from the
    // florist ("make it navy", "use more cream") still wins and still goes
    // through paintBrandBackground unchanged — that feature is untouched;
    // only the silent default stops being a saturated slab.
    function paintProcedural() {
      var explicitColorRevision = Boolean(
        style && ((style.paletteInclude && style.paletteInclude.length) || (style.paletteExclude && style.paletteExclude.length))
      );
      if (explicitColorRevision) {
        paintBrandBackground(ctx, width, height, template, brand, style);
      } else {
        ctx.fillStyle = TIER_B_BASE;
        ctx.fillRect(0, 0, width, height);
      }
      paintFloralWash(ctx, width, height, colors);
      backgroundTier = BACKGROUND_TIER.PROCEDURAL;
    }

    // Real floral photograph first; the procedural treatment only if even
    // that can't load. An explicit colour revision is the florist's own
    // instruction about the background, so it skips the photo and goes
    // straight to the procedural path where that instruction can apply.
    function paintTierB() {
      var explicitColorRevision = Boolean(
        style && ((style.paletteInclude && style.paletteInclude.length) || (style.paletteExclude && style.paletteExclude.length))
      );
      if (explicitColorRevision || !opts.fallbackBackgroundUrl) {
        paintProcedural();
        return Promise.resolve();
      }
      return loadImage(opts.fallbackBackgroundUrl)
        .then(function (img) {
          drawCover(ctx, img, 0, 0, width, height);
          backgroundTier = BACKGROUND_TIER.FALLBACK_PHOTO;
        })
        .catch(function () {
          paintProcedural();
        });
    }

    function finish() {
      // The photograph, read once before a single word is drawn. Every
      // placement and banner decision below is judged against the picture
      // itself and never against wording already placed on it.
      var background = captureBackground(ctx, width, height);

      // computeBandRect is pure LAYOUT geometry only now — the lower
      // portion of the frame where the shop-name lockup lives — never
      // painted (see drawGradientBand's removal, design pass v3 above).
      var bandRect = computeBandRect(template, width, height);
      var lockupFit = null, lockupSampleRect, lockupReach = 0;
      if (brand.shopName) {
        ctx.save();
        lockupFit = fitShopLockup(ctx, bandRect, brand.shopName);
        ctx.restore();
        lockupSampleRect = lockupFit.sampleRect;
        lockupReach = lockupUsedHeight(bandRect, lockupFit);
      } else {
        lockupSampleRect = shopLockupMetrics(bandRect, brand.shopName).sampleRect;
      }
      var headlineRect = regionRect(template.regions.headline, width, height);
      var headlineFullHeight = headlineRect.h;
      // Push the headline fully clear of the shop-name lockup, not just a
      // capped fractional nudge — a partial nudge left the lockup's own
      // divider rule cutting straight through single-line headlines, and
      // let a two-line headline overlap "LILIES IN BLOOM" outright (both
      // caught in a design review before this fix). lockup.usedHeight is
      // already an absolute canvas offset from bandRect.y, so this only
      // shifts the headline down as far as the lockup actually reaches,
      // plus a small breathing gap — never more than needed, and never so
      // much it collapses the headline rect (floors at 45% of its own
      // height so drawRegionText's own auto-fit always has real room to
      // work with).
      if (lockupReach) {
        var lockupBottom = bandRect.y + lockupReach + headlineRect.h * 0.08;
        if (lockupBottom > headlineRect.y) {
          var clear = Math.min(lockupBottom - headlineRect.y, headlineRect.h * 0.55);
          headlineRect.y += clear;
          headlineRect.h -= clear;
        }
      }
      var bodyRect = regionRect(template.regions.body, width, height);
      var ctaRect = regionRect(template.regions.cta, width, height);
      var contactRect = regionRect(template.regions.contact, width, height);

      // "The text should be up in the blank space where no flowers are."
      //
      // The template's coordinates are fixed and know nothing about the photo
      // that happened to be generated for this flyer, so on a picture whose
      // flowers bank along the bottom the call-to-action lands right in them.
      // Read the picture, find the calmest run tall enough to hold the whole
      // stack, and slide the stack there as one piece. Moving it together is
      // what preserves the layout — shifting regions independently would open
      // and close the gaps the design depends on.
      var stackTop = Math.min(bandRect.y, headlineRect.y);
      var stackBottom = Math.max(contactRect.y + contactRect.h, ctaRect.y + ctaRect.h);
      var logoRect = regionRect(template.regions.logo, width, height);
      var shift = calmPlacementShift(background, {
        x: width * 0.08, w: width * 0.84,
        top: stackTop, bottom: stackBottom,
        // drawLogo runs last and paints over everything, so the wording must
        // never be slid up into the logo's box.
        floor: logoRect.y + logoRect.h
      }, width, height);
      if (shift) {
        bandRect.y += shift; headlineRect.y += shift; bodyRect.y += shift;
        ctaRect.y += shift; contactRect.y += shift;
        lockupSampleRect.y += shift;
        if (lockupFit) lockupFit.baselineY += shift;
      }

      // The CTA's real vertical freedom is the gap between the message
      // above it and the contact line below — not the nominal region box.
      var ctaBand = Math.max(ctaRect.h, contactRect.y - (bodyRect.y + bodyRect.h));

      // Every block is laid out twice: once against a context that measures
      // but paints nothing, to learn which blocks cannot be read and how big
      // a banner each needs, and once for real. The banners are merged and
      // painted in between, so adjacent ones become a single shape instead of
      // three stacked cards with seams, and each is under its own words.
      // Every text colour is decided ONCE, against the photograph, before
      // either pass runs. Sampling per pass would read the banners painted in
      // between on the second one, so a block could ask for a banner while
      // measuring and decline it while drawing — leaving cream paint with no
      // colour change under it, or a colour change with no paint. The colour
      // belongs to the picture, not to what was just laid on top of it.
      var styles = {
        lockup: pickRegionTextStyle(ctx, lockupSampleRect, background),
        headline: pickRegionTextStyle(ctx, headlineRect, background),
        body: pickRegionTextStyle(ctx, bodyRect, background),
        cta: pickRegionTextStyle(ctx, ctaRect, background),
        contact: pickRegionTextStyle(ctx, contactRect, background)
      };
      function layOut(target, bands) {
        var out = [];
        var l = drawShopNameLockup(target, bandRect, brand, colors.accent,
          styles.lockup, background, lockupFit, bands);
        if (l && l.bannered) out.push("shopName");
        if (drawRegionText(target, headlineRect, content.headline, "hero", style,
          { baseSizeHeight: headlineFullHeight, background: background, accentColor: colors.accent, bands: bands },
          styles.headline)) out.push("headline");
        if (drawRegionText(target, bodyRect, content.body, "body", style,
          { background: background, accentColor: colors.accent, bands: bands },
          styles.body)) out.push("body");
        if (drawCtaLabel(target, ctaRect, content.cta, colors.accent,
          styles.cta, ctaBand, background, bands)) out.push("cta");
        if (drawContact(target, contactRect, brand, styles.contact,
          content.cta, background, colors.accent, bands)) out.push("contact");
        return out;
      }

      var wanted = [];
      layOut(measuringContext(ctx), wanted);
      // Only bands that would actually collide are joined. Merging generously
      // turned three ribbons into one slab covering nearly half the flyer —
      // the very panel-over-the-photo this is meant to avoid. A ribbon
      // carries its own block; separate blocks get separate ribbons.
      var merged = mergeBands(wanted, height * 0.004);
      for (var bi = 0; bi < merged.length; bi++) drawBanner(ctx, merged[bi], colors.primary);
      var bannered = layOut(ctx, null);
      return drawLogo(ctx, regionRect(template.regions.logo, width, height), brand.logoUrl).then(function () {
        if (canvas.dataset) {
          canvas.dataset.florisynBackgroundTier = backgroundTier || BACKGROUND_TIER.PROCEDURAL;
          // Observable, like the background tier: which blocks needed rescuing
          // and how far the stack was moved to find calm pixels. Without this
          // the only way to know is to look at the picture and guess.
          canvas.dataset.florisynBanners = bannered.join(",");
          canvas.dataset.florisynCalmShift = String(shift || 0);
        }
        return canvas;
      });
    }

    if (backgroundUrl) {
      return loadImage(backgroundUrl)
        .then(function (img) {
          drawCover(ctx, img, 0, 0, width, height);
          backgroundTier = BACKGROUND_TIER.GENERATED;
          return finish();
        })
        .catch(function () {
          return Promise.resolve(paintTierB()).then(finish);
        });
    }
    return Promise.resolve(paintTierB()).then(finish);
  }

  var api = {
    regionRect: regionRect,
    relativeLuminance: relativeLuminance,
    sampleAverageColor: sampleAverageColor,
    sampleColorVariance: sampleColorVariance,
    pickTextColor: pickTextColor,
    needsScrim: needsScrim,
    scaleMultiplier: scaleMultiplier,
    effectivePaletteColors: effectivePaletteColors,
    paintBrandBackground: paintBrandBackground,
    computePanelRect: computePanelRect,
    computeBandRect: computeBandRect,
    computeCtaLayout: computeCtaLayout,
    formatPhoneForDisplay: formatPhoneForDisplay,
    outlineFor: outlineFor,
    shopLockupMetrics: shopLockupMetrics,
    fitShopLockup: fitShopLockup,
    BACKGROUND_TIER: BACKGROUND_TIER,
    FALLBACK_FLORAL_BACKGROUND: FALLBACK_FLORAL_BACKGROUND,
    contactLineParts: contactLineParts,
    pickRegionTextStyle: pickRegionTextStyle,
    contrastRatio: contrastRatio,
    colorAlpha: colorAlpha,
    parseColor: parseColor,
    darken: darken,
    busyFractionIn: busyFractionIn,
    needsBannerBehind: needsBannerBehind,
    unreadableFraction: unreadableFraction,
    busyRowProfile: busyRowProfile,
    findCalmWindow: findCalmWindow,
    bannerBand: bannerBand,
    calmPlacementShift: calmPlacementShift,
    mergeBands: mergeBands,
    measuringContext: measuringContext,
    lockupUsedHeight: lockupUsedHeight,
    compositeSubjectOnBackground: compositeSubjectOnBackground,
    renderFlyer: renderFlyer,
    // Phase 2 — Creative Direction execution.
    HIERARCHY_DEPTH_ROLES: HIERARCHY_DEPTH_ROLES,
    HEADLINE_SCALE_MULTIPLIER: HEADLINE_SCALE_MULTIPLIER,
    TYPOGRAPHY_PERSONAS: TYPOGRAPHY_PERSONAS,
    resolveScriptAccentPlan: resolveScriptAccentPlan,
    deriveSupportingLineText: deriveSupportingLineText,
    resolveOrnamentColors: resolveOrnamentColors,
    resolveSeason: resolveSeason,
    SEASON_PALETTES: SEASON_PALETTES,
    PALETTE_FAMILIES: PALETTE_FAMILIES,
    ensurePanelContrast: ensurePanelContrast,
    computeCoverAlignedRect: computeCoverAlignedRect,
    IMAGE_CROP_ZOOM: IMAGE_CROP_ZOOM,
    SUBJECT_PLACEMENT_FOCAL: SUBJECT_PLACEMENT_FOCAL,
    resolveCompositionGeometry: resolveCompositionGeometry,
    splitStackIntoRoles: splitStackIntoRoles,
    ornamentalDensityAllows: ornamentalDensityAllows,
    resolveBrandingRect: resolveBrandingRect,
    BRANDING_SCALE_MULTIPLIER: BRANDING_SCALE_MULTIPLIER,
    isRoleImpossibleToFit: isRoleImpossibleToFit,
    renderFlyerWithCreativeDirection: renderFlyerWithCreativeDirection
  };

  global.FlorisynFlyerRenderer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
