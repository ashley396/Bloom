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
 * Design pass v2 (Ashley's live-tested visual-quality directive, replacing
 * the earlier ivory-panel design): the floral photo now fills the ENTIRE
 * canvas, full-bleed and edge to edge, with no box of any kind covering
 * it. Legibility comes from a full-width gradient band anchored to the
 * bottom of the frame (deep navy, transparent at the top fading to
 * strongly opaque near the bottom — see computeBandRect/drawGradientBand)
 * carrying the shop-name lockup, headline, body, a narrow decorative CTA
 * label with a muted-gold underline, and the contact footer — never a
 * rounded, inset, light-colored card, never a stroke/frame. Because every
 * word of text now always sits on that same consistently dark backdrop,
 * text color is fixed (warm ivory, plus a subtle drop shadow), not
 * sampled per-pixel the way the earlier design needed — the old
 * pixel-sampling contrast helpers (pickTextColor/sampleAverageColor/
 * needsScrim) stay exported and unit-tested as real, generically useful
 * pure math, they just aren't in renderFlyer()'s own critical path
 * anymore.
 *
 * Three things live here:
 *
 *   1. compositeSubjectOnBackground() — the segment+generate+composite
 *      substitute for true inpainting (this Cloudflare account has no
 *      verified image-editing model): places a real client-segmented
 *      cutout (photo-studio.js's removeBackground() output) over a
 *      server-generated backdrop-only image.
 *
 *   2. renderFlyer() — draws the full-bleed photo (Tier A) or a rich
 *      Tier-B floral wash, then the bottom gradient band and every text
 *      region on top of it, per the design pass above.
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
    var x0 = Math.max(0, Math.min(width - 1, rect.x));
    var y0 = Math.max(0, Math.min(height - 1, rect.y));
    var x1 = Math.max(x0 + 1, Math.min(width, rect.x + rect.w));
    var y1 = Math.max(y0 + 1, Math.min(height, rect.y + rect.h));
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

  /** Picks readable text color (white or near-black) for the average
   * background color behind a region — always derived from the actual
   * pixels, never a fixed color, so text can never go accidentally
   * unreadable on a generated photo. Pure. */
  function pickTextColor(avgColor) {
    var luminance = relativeLuminance(avgColor.r, avgColor.g, avgColor.b);
    return luminance > 0.55 ? "#231a26" : "#ffffff";
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

  function drawWrappedLines(ctx, lines, cx, cy, lineHeight) {
    var startY = cy - ((lines.length - 1) * lineHeight) / 2;
    for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], cx, startY + j * lineHeight);
  }

  function wrapText(ctx, text, cx, cy, maxWidth, lineHeight) {
    drawWrappedLines(ctx, measureWrappedLines(ctx, text, maxWidth), cx, cy, lineHeight);
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

  // Visual-quality directive: every region drawn by drawRegionText now
  // always sits inside the gradient band (see drawGradientBand) — a
  // consistently dark, deep-navy backdrop by construction — so text color
  // is a fixed warm ivory rather than sampled per-pixel. This is a
  // deliberate simplification, not a regression: the OLD pixel-sampling
  // contrast system existed because text used to sit directly on
  // unpredictable photo/background pixels; now that it never does (that
  // was exactly the "low-contrast text placed directly over busy flowers"
  // failure mode being fixed), a fixed color is both simpler and more
  // reliable. pickTextColor/sampleAverageColor/needsScrim stay exported
  // and unit-tested (still real, generically useful pure math) even
  // though this function no longer calls them.
  var BAND_TEXT_COLOR = "#f8f0e3";
  var BAND_TEXT_COLOR_SOFT = "rgba(248,240,227,0.88)";

  function applyTextShadow(ctx) {
    // "Subtle text shadow" — one of Ashley's explicitly allowed
    // legibility techniques, used here as real insurance on top of the
    // gradient band, never as a substitute for it.
    ctx.shadowColor = "rgba(6,10,18,0.55)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;
  }

  function drawRegionText(ctx, rect, text, emphasisKey, style, opts) {
    if (!text) return;
    var color = emphasisKey === "body" ? BAND_TEXT_COLOR_SOFT : BAND_TEXT_COLOR;
    // The target size is taken from the region's ORIGINAL height
    // (opts.baseSizeHeight), not the possibly-shrunk rect.h below — the
    // caller may have shrunk `rect` just to clear the shop-name lockup,
    // and the headline must still read as the boldest, biggest element on
    // the flyer (Ashley's "strong hierarchy" requirement). The auto-fit
    // loop right below still protects against real overflow by shrinking
    // from that full-size target if the wrapped block genuinely doesn't
    // fit in the (possibly smaller) rect.
    var sizeRefH = (opts && opts.baseSizeHeight) || rect.h;
    var baseSize = emphasisKey === "hero" ? sizeRefH * 0.4 : rect.h * 0.3;
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
      if (blockHeight <= rect.h * 0.96 || fontSize <= baseSize * 0.62) break;
      fontSize = Math.round(fontSize * 0.9);
    }
    drawWrappedLines(ctx, lines, rect.x + rect.w / 2, rect.y + rect.h / 2, lineHeight);
    setLetterSpacing(ctx, "0px");
    ctx.restore();
  }

  /** Visual-quality directive: the call-to-action is now a narrow
   * decorative LABEL — uppercase, letter-spaced text with a thin
   * muted-gold underline — instead of the old filled pill "button" shape.
   * A florist's flyer should read like an editorial ad, not an app UI
   * control; this keeps the CTA legible and clearly set apart from the
   * headline/body without ever drawing another box on top of the photo. */
  function drawCtaLabel(ctx, rect, text, accentColor) {
    if (!text) return;
    var gold = accentColor || "#c8a24a";
    var fontSize = Math.max(13, Math.round(rect.h * 0.42));
    var cx = rect.x + rect.w / 2;
    var cy = rect.y + rect.h / 2;
    ctx.save();
    applyTextShadow(ctx);
    ctx.fillStyle = BAND_TEXT_COLOR;
    ctx.font = "600 " + fontSize + "px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    setLetterSpacing(ctx, "0.1em");
    var upper = String(text).toUpperCase();
    var textY = cy - fontSize * 0.32;
    wrapText(ctx, upper, cx, textY, rect.w * 0.94, fontSize * 1.2);
    setLetterSpacing(ctx, "0px");
    ctx.restore();
    // Thin gold divider beneath the label — "a narrow decorative label for
    // the CTA" / "muted gold divider lines," never a filled button shape.
    ctx.save();
    var lineW = Math.min(rect.w * 0.42, Math.max(fontSize * 4, ctx.measureText(upper).width * 0.6));
    var lineY = textY + fontSize * 0.85;
    ctx.strokeStyle = gold;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(1.5, rect.h * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx - lineW / 2, lineY);
    ctx.lineTo(cx + lineW / 2, lineY);
    ctx.stroke();
    ctx.restore();
  }

  /** The shop's own name, presented as a tasteful small-caps, letter-spaced
   * lockup at the top of the gradient band — a real, distinct visual
   * element rather than being buried only in the small footer contact
   * line. Always ivory-on-navy now (the band guarantees the dark backdrop
   * — see drawGradientBand), with a thin muted-gold divider beneath it in
   * place of the old same-color-as-text hairline. */
  function drawShopNameLockup(ctx, bandRect, brand, accentColor) {
    var name = brand && brand.shopName;
    if (!name) return { usedHeight: 0 };
    var gold = accentColor || "#c8a24a";
    var fontSize = Math.max(12, Math.round(bandRect.h * 0.05));
    var baselineY = bandRect.y + bandRect.h * 0.12;
    ctx.save();
    applyTextShadow(ctx);
    ctx.fillStyle = BAND_TEXT_COLOR;
    ctx.font = "600 " + fontSize + "px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    setLetterSpacing(ctx, "0.26em");
    ctx.fillText(String(name).toUpperCase(), bandRect.x + bandRect.w / 2, baselineY);
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

  function drawContact(ctx, rect, brand) {
    var parts = [brand.shopName, brand.phone, brand.website].filter(Boolean);
    if (!parts.length) return;
    ctx.save();
    applyTextShadow(ctx);
    ctx.fillStyle = BAND_TEXT_COLOR_SOFT;
    // A real, comfortably-readable footer — not a tiny fine-print line.
    ctx.font = "600 " + Math.round(rect.h * 0.6) + "px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    setLetterSpacing(ctx, "0.03em");
    ctx.fillText(parts.join("   ·   "), rect.x + rect.w / 2, rect.y + rect.h / 2);
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

  /** Visual-quality directive (Ashley, live-tested feedback): the text
   * backdrop is now a full-width, bottom-anchored gradient band — deep
   * navy, transparent at its top edge fading to strongly opaque near the
   * bottom — never a rounded, inset, ivory/beige card. This is what
   * actually satisfies every one of the required rules at once: it can
   * never read as "a large white/beige rectangle" (it's dark, not light),
   * never "a heavy black frame" (no stroke, no border, no rounded corners
   * — it's a soft fill only), never "a blank box covering the center of
   * the flowers" (it only ever touches the bottom portion of the frame,
   * per computeBandRect), and it guarantees every word of text sits on a
   * consistently dark backdrop instead of directly on unpredictable photo
   * pixels. */
  function drawGradientBand(ctx, rect) {
    ctx.save();
    var g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
    g.addColorStop(0, "rgba(9,15,26,0)");
    g.addColorStop(0.32, "rgba(9,15,26,0.68)");
    g.addColorStop(1, "rgba(7,12,22,0.93)");
    ctx.fillStyle = g;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  /** Draws a full flyer: background (a generated image URL — Tier A — or
   * a rich Tier-B floral-toned wash over the template's own flat/gradient
   * brand fill, see flyer-templates.js's `palette` field), full-bleed and
   * edge to edge, plus a bottom gradient band carrying every text region.
   * Returns Promise<HTMLCanvasElement>. Never throws on a missing/failed
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

    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    var colors = effectivePaletteColors(brand, style);

    function paintTierB() {
      paintBrandBackground(ctx, width, height, template, brand, style);
      paintFloralWash(ctx, width, height, colors);
    }

    function finish() {
      var bandRect = computeBandRect(template, width, height);
      drawGradientBand(ctx, bandRect);
      var lockup = drawShopNameLockup(ctx, bandRect, brand);
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
      drawRegionText(ctx, headlineRect, content.headline, "hero", style, { baseSizeHeight: headlineFullHeight });
      drawRegionText(ctx, regionRect(template.regions.body, width, height), content.body, "body", style);
      drawCtaLabel(ctx, regionRect(template.regions.cta, width, height), content.cta, colors.accent);
      drawContact(ctx, regionRect(template.regions.contact, width, height), brand);
      return drawLogo(ctx, regionRect(template.regions.logo, width, height), brand.logoUrl).then(function () {
        return canvas;
      });
    }

    if (backgroundUrl) {
      return loadImage(backgroundUrl)
        .then(function (img) {
          drawCover(ctx, img, 0, 0, width, height);
          return finish();
        })
        .catch(function () {
          paintTierB();
          return finish();
        });
    }
    paintTierB();
    return Promise.resolve().then(finish);
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
    compositeSubjectOnBackground: compositeSubjectOnBackground,
    renderFlyer: renderFlyer
  };

  global.FlorisynFlyerRenderer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
