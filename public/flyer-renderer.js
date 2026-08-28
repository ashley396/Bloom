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
  function pickRegionTextStyle(ctx, rect) {
    var safeRect = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      w: Math.max(1, Math.round(rect.w)),
      h: Math.max(1, Math.round(rect.h))
    };
    var imageData;
    try {
      imageData = ctx.getImageData(safeRect.x, safeRect.y, safeRect.w, safeRect.h);
    } catch (e) {
      return { color: BAND_TEXT_COLOR, softColor: BAND_TEXT_COLOR_SOFT, outline: { color: "rgba(6,10,18,0.6)", width: Math.max(1, rect.h * 0.01), widthRatio: OUTLINE_WIDTH_RATIO } };
    }
    var localRect = { x: 0, y: 0, w: imageData.width, h: imageData.height };
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
    if (!text) return;
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
    drawWrappedLines(ctx, lines, rect.x + rect.w / 2, rect.y + rect.h / 2, lineHeight, outlineFor(textStyle, fontSize));
    setLetterSpacing(ctx, "0px");
    ctx.restore();
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
    var baseSize = Math.max(28, Math.round(rect.h * 0.52));
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

  function drawCtaLabel(ctx, rect, text, accentColor, textStyle, maxBlockHeight) {
    if (!text) return;
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
  }

  /** The shop's own name (never Florisyn's — brand.shopName is always the
   * authenticated shop, see marketing-studio.js's persisted flyer content),
   * presented as a tasteful small-caps, letter-spaced lockup near the top
   * of the lower text area — a real, distinct visual element rather than
   * being buried only in the small footer contact line. Mandatory on
   * every flyer per Ashley's explicit requirement: a shared/downloaded
   * image must still identify the florist it came from. Text color/
   * outline are real sampled contrast (textStyle), never assumed. */
  function drawShopNameLockup(ctx, bandRect, brand, accentColor, textStyle) {
    var name = brand && brand.shopName;
    if (!name) return { usedHeight: 0 };
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
    var fit = fitShopLockup(ctx, bandRect, name);
    var fontSize = fit.fontSize;
    var upper = fit.text;
    var baselineY = fit.baselineY;
    drawTextLine(ctx, upper, bandRect.x + bandRect.w / 2, baselineY, outlineFor(textStyle, fontSize));
    setLetterSpacing(ctx, "0px");
    ctx.restore();
    var dividerY = baselineY + fontSize * 0.75;
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
    return { usedHeight: dividerY - bandRect.y };
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

  function drawContact(ctx, rect, brand, textStyle, ctaText) {
    var parts = contactLineParts(brand, ctaText);
    if (!parts.length) return;
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
    drawTextLine(ctx, line, rect.x + rect.w / 2, rect.y + rect.h / 2, outlineFor(textStyle, contactSize));
    setLetterSpacing(ctx, "0px");
    ctx.restore();
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
      // computeBandRect is pure LAYOUT geometry only now — the lower
      // portion of the frame where the shop-name lockup lives — never
      // painted (see drawGradientBand's removal, design pass v3 above).
      var bandRect = computeBandRect(template, width, height);
      var lockupSampleRect;
      if (brand.shopName) {
        ctx.save();
        lockupSampleRect = fitShopLockup(ctx, bandRect, brand.shopName).sampleRect;
        ctx.restore();
      } else {
        lockupSampleRect = shopLockupMetrics(bandRect, brand.shopName).sampleRect;
      }
      var lockup = drawShopNameLockup(ctx, bandRect, brand, colors.accent, pickRegionTextStyle(ctx, lockupSampleRect));
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
      if (lockup && lockup.usedHeight) {
        var lockupBottom = bandRect.y + lockup.usedHeight + headlineRect.h * 0.08;
        if (lockupBottom > headlineRect.y) {
          var shift = Math.min(lockupBottom - headlineRect.y, headlineRect.h * 0.55);
          headlineRect.y += shift;
          headlineRect.h -= shift;
        }
      }
      var bodyRect = regionRect(template.regions.body, width, height);
      var ctaRect = regionRect(template.regions.cta, width, height);
      var contactRect = regionRect(template.regions.contact, width, height);
      drawRegionText(ctx, headlineRect, content.headline, "hero", style, { baseSizeHeight: headlineFullHeight }, pickRegionTextStyle(ctx, headlineRect));
      drawRegionText(ctx, bodyRect, content.body, "body", style, undefined, pickRegionTextStyle(ctx, bodyRect));
      // The CTA's real vertical freedom is the gap between the message
      // above it and the contact line below — not the nominal region box.
      var ctaBand = Math.max(ctaRect.h, contactRect.y - (bodyRect.y + bodyRect.h));
      drawCtaLabel(ctx, ctaRect, content.cta, colors.accent, pickRegionTextStyle(ctx, ctaRect), ctaBand);
      drawContact(ctx, contactRect, brand, pickRegionTextStyle(ctx, contactRect), content.cta);
      return drawLogo(ctx, regionRect(template.regions.logo, width, height), brand.logoUrl).then(function () {
        if (canvas.dataset) canvas.dataset.florisynBackgroundTier = backgroundTier || BACKGROUND_TIER.PROCEDURAL;
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
    compositeSubjectOnBackground: compositeSubjectOnBackground,
    renderFlyer: renderFlyer
  };

  global.FlorisynFlyerRenderer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
