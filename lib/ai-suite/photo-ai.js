/**
 * AI Photo module — analysis, correction suggestions, social export presets.
 * Works with BloomShot client metadata; optional server enhance via sharp.
 */

export const SOCIAL_PRESETS = {
  instagram_square: { width: 1080, height: 1080, label: "Instagram post", aspect: "1:1" },
  instagram_portrait: { width: 1080, height: 1350, label: "Instagram portrait", aspect: "4:5" },
  facebook_cover: { width: 820, height: 312, label: "Facebook cover", aspect: "2.39:1" },
  pinterest: { width: 1000, height: 1500, label: "Pinterest pin", aspect: "2:3" },
  website_hero: { width: 1600, height: 900, label: "Website hero", aspect: "16:9" }
};

export function analyzePhotoMetadata(meta = {}) {
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  const brightness = Number(meta.avgBrightness ?? meta.brightness ?? 128);
  const issues = [];
  const tags = [];

  if (width && height) {
    if (width < 800 || height < 800) issues.push("Resolution is low for hero or print use — shoot wider or upscale carefully.");
    if (width > height * 1.3) tags.push("landscape");
    else if (height > width * 1.1) tags.push("portrait");
    else tags.push("square-ish");
  }
  if (brightness < 85) issues.push("Image may be underexposed — increase brightness slightly.");
  if (brightness > 200) issues.push("Image may be overexposed — reduce brightness or recover highlights.");
  if (!meta.alt?.trim()) issues.push("Missing alt text — add for SEO and accessibility.");

  const floralHints = detectFloralHints(meta.name || meta.filename || meta.notes || "");
  tags.push(...floralHints);

  return {
    dimensions: width && height ? { width, height } : null,
    brightness,
    issues,
    tags: [...new Set(tags)],
    recognition: {
      confidence: floralHints.length ? 0.72 : 0.35,
      labels: floralHints.length ? floralHints : ["floral arrangement"],
      note: "Recognition uses florist keyword heuristics; confirm before publishing."
    },
    quality_score: Math.max(0, Math.min(100, 100 - issues.length * 15 - (width < 800 ? 20 : 0)))
  };
}

function detectFloralHints(text = "") {
  const t = String(text).toLowerCase();
  const found = [];
  if (/rose|roses/i.test(t)) found.push("roses");
  if (/hydrangea/i.test(t)) found.push("hydrangea");
  if (/sympathy|funeral|spray/i.test(t)) found.push("sympathy");
  if (/wedding|bridal/i.test(t)) found.push("wedding");
  if (/orchid|plant/i.test(t)) found.push("plants");
  if (/bouquet|arrangement/i.test(t)) found.push("bouquet");
  return found;
}

export function suggestPhotoCorrections(meta = {}, currentAdjustments = {}) {
  const analysis = analyzePhotoMetadata(meta);
  const brightness = Number(currentAdjustments.brightness ?? 100);
  const contrast = Number(currentAdjustments.contrast ?? 100);
  const saturation = Number(currentAdjustments.saturation ?? 100);
  const warmth = Number(currentAdjustments.warmth ?? 0);

  const suggested = { brightness, contrast, saturation, warmth, preset: null };
  const reasons = [];

  if (analysis.brightness < 90) {
    suggested.brightness = Math.min(130, brightness + 12);
    reasons.push("Lift shadows for a fresher floral look.");
  }
  if (analysis.brightness > 200) {
    suggested.brightness = Math.max(85, brightness - 10);
    reasons.push("Recover highlight detail on petals and wrapping.");
  }
  if (analysis.tags.includes("sympathy")) {
    suggested.saturation = Math.max(85, saturation - 8);
    suggested.warmth = warmth - 5;
    suggested.preset = "soft_sympathy";
    reasons.push("Soft, muted tones suit sympathy work.");
  }
  if (analysis.tags.includes("wedding") || analysis.tags.includes("roses")) {
    suggested.warmth = warmth + 6;
    suggested.preset = "romantic_warmth";
    reasons.push("Warmth enhances romance and cream tones.");
  }
  if (!reasons.length) {
    suggested.preset = "natural_florist";
    reasons.push("Balanced natural preset — good for everyday catalog photos.");
  }

  return { suggested, reasons, analysis };
}

export function socialExportPlan(sourceWidth, sourceHeight) {
  return Object.entries(SOCIAL_PRESETS).map(([id, p]) => {
    const crop = recommendCrop(sourceWidth, sourceHeight, p.width, p.height);
    return { id, ...p, crop, platform_url_hint: platformShareHint(id) };
  });
}

function recommendCrop(sw, sh, tw, th) {
  if (!sw || !sh) return { mode: "center", note: "Upload image to compute crop." };
  const targetRatio = tw / th;
  const sourceRatio = sw / sh;
  if (Math.abs(targetRatio - sourceRatio) < 0.05) return { mode: "fit", note: "Aspect ratio matches — minimal crop." };
  return sourceRatio > targetRatio
    ? { mode: "center_crop_horizontal", note: "Crop left/right to fit platform frame." }
    : { mode: "center_crop_vertical", note: "Crop top/bottom to fit platform frame." };
}

function platformShareHint(presetId) {
  const map = {
    instagram_square: "Share to Instagram feed via BloomShot caption export",
    instagram_portrait: "Ideal for Reels cover or portrait feed posts",
    facebook_cover: "Upload as shop Facebook cover photo",
    pinterest: "Pin with product link to your storefront",
    website_hero: "Set as Website Studio hero image"
  };
  return map[presetId] || "Export from Photo Studio";
}

/**
 * Server-side auto-enhance using sharp (when image buffer provided).
 */
export async function autoEnhanceBuffer(buffer, sharpModule = null) {
  if (!buffer?.length) return { ok: false, error: "Image buffer required." };
  let sharp = sharpModule;
  if (!sharp) {
    try {
      sharp = (await import("sharp")).default;
    } catch {
      return { ok: false, error: "Image processing unavailable on this environment." };
    }
  }
  const pipeline = sharp(buffer).rotate().normalize().modulate({ brightness: 1.03, saturation: 1.05 });
  const out = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return {
    ok: true,
    buffer: out,
    mime: "image/jpeg",
    operations: ["auto_rotate", "normalize", "brightness+3%", "saturation+5%"]
  };
}
