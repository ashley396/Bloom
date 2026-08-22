/**
 * Photo Studio → Lily creative engine (AI-OS Wave 2).
 *
 * Two real, honestly-scoped capabilities — the Phase 1 inspection found
 * Photo Studio already had live AI for flower ID (photo-recipe.js) and
 * product-copy generation (the existing "Ask Lily to draft content"
 * button), but zero AI touching image PIXELS. This adds exactly that,
 * within the model's real capability boundary:
 *
 *   enhance-suggest   — vision assessment of THIS photo's lighting/color/
 *                       framing, mapped onto one of Photo Studio's own
 *                       existing four presets (clean/luxury/warm/true).
 *                       Never generates or edits a single pixel — it only
 *                       recommends which already-deterministic preset to
 *                       apply, and why. The florist still clicks Apply.
 *
 *   generate-image    — a NEW, AI-generated marketing image (reusing the
 *                       same Cloudflare flux-1-schnell model wired in
 *                       Wave 1's ai-image-engine.js), informed by the real
 *                       flowers Lily identified in the photo. This is
 *                       explicitly NOT an edit of the uploaded photo —
 *                       there is no verified image-editing/inpainting
 *                       model on this account, so true "put this bouquet
 *                       in a different scene" pixel-editing is a real
 *                       capability boundary, not something faked here.
 *                       The client is responsible for labeling the result
 *                       as AI-generated, not a photo edit.
 */
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { analyzeArrangementPhoto, assessPhotoQuality } from "./_shared/florist-ai-vision.js";
import { runCloudflareGenerate } from "./ai-assistant.js";
import { generateImage, buildImagePrompt } from "./_shared/ai-image-engine.js";
import { persistGeneratedAsset } from "./_shared/ai-creative-engine.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PRESETS = ["clean", "luxury", "warm", "true"];

function toBuffer(imageBase64) {
  const raw = String(imageBase64 || "").replace(/^data:image\/\w+;base64,/i, "");
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, "base64");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

export async function handleEnhanceSuggest(body) {
  const buffer = toBuffer(body.image_base64 || body.image);
  if (!buffer) return json(400, { error: "Add a photo first." });
  if (buffer.length > MAX_IMAGE_BYTES) return json(413, { error: "Image too large (max 10MB)." });

  let assessment = "";
  try {
    const vision = await assessPhotoQuality({ buffer });
    assessment = String(vision?.text || "").trim();
  } catch {
    return json(503, { ok: false, error: "Lily's photo vision is unavailable right now. Try a preset below, or try again in a moment." });
  }
  if (!assessment) {
    return json(200, { ok: false, message: "Lily couldn't get a clear read on this photo. Try a preset below." });
  }

  let recommendation = null;
  try {
    const gen = await runCloudflareGenerate({
      mode: "generate",
      persona: "Lily",
      task:
        "Based ONLY on this photo-quality assessment, pick the single best-matching preset from " +
        `[${PRESETS.join(", ")}] for a florist product photo, and explain why in one plain sentence a florist would understand. ` +
        "clean = neutral/bright/true-to-life; luxury = deeper, moodier, richer color; warm = warmer golden tone; true = no change, already good. " +
        "Never suggest anything outside the listed presets.",
      input: { assessment },
      schema: { recommended_preset: "string", reason: "string" },
      max_tokens: 200
    });
    const result = gen?.result || {};
    if (PRESETS.includes(result.recommended_preset)) {
      recommendation = {
        preset: result.recommended_preset,
        reason: String(result.reason || "").slice(0, 300)
      };
    }
  } catch {
    /* fall through to the assessment-only response below */
  }

  if (!recommendation) {
    return json(200, { ok: true, assessment, recommendation: null, message: "Lily looked at the photo — see her notes below and pick a preset yourself." });
  }
  return json(200, { ok: true, assessment, recommendation });
}

export async function handleGenerateImage(client, { shopId, userId }, body) {
  const style = String(body.style || "").trim();
  const STYLE_BRIEFS = {
    website_hero: "wide 16:9 website hero banner composition, professional florist marketing photography, generous negative space for headline text",
    social_square: "square social media post composition, professional florist marketing photography, eye-catching centered arrangement",
    story: "vertical 9:16 Instagram Story/Reel cover composition, professional florist marketing photography",
    pinterest: "tall Pinterest pin composition, professional florist marketing photography, aspirational styling"
  };
  if (!STYLE_BRIEFS[style]) return json(400, { error: "style must be one of: " + Object.keys(STYLE_BRIEFS).join(", ") });

  let flowers = Array.isArray(body.flowers) ? body.flowers.filter(Boolean).slice(0, 6).map(String) : [];
  // No flower list yet (the florist hasn't run "build a recipe" this
  // session) but a photo came along — identify it here so the image
  // prompt is still grounded in the real arrangement, not generic.
  const imageBuffer = !flowers.length ? toBuffer(body.image_base64) : null;
  if (imageBuffer) {
    try {
      flowers = await identifyFlowersForImagePrompt(imageBuffer);
    } catch {
      /* generation still proceeds without a flower list below */
    }
  }
  const occasion = body.occasion ? String(body.occasion).slice(0, 80) : null;
  const shopName = body.shop_name ? String(body.shop_name).slice(0, 120) : null;

  const prompt = buildImagePrompt({
    occasion,
    products: flowers,
    shopName,
    visualBrief: `${STYLE_BRIEFS[style]}${flowers.length ? `, featuring ${flowers.join(", ")}` : ""}${occasion ? `, ${occasion} theme` : ""}.`
  });

  const gen = await generateImage(client, shopId, { prompt, filename: `photo-studio-${style}-${Date.now()}.jpg` });
  if (!gen.ok) {
    await persistGeneratedAsset(client, { shopId, userId, persona: "Lily", assetType: "image", provider: "cloudflare", model: "unknown", prompt, status: "failed", error: gen.error });
    return json(502, { ok: false, error: gen.error });
  }

  const { data: mediaRow } = await client
    .from("website_media")
    .insert({ shop_id: shopId, storage_path: gen.path, filename: gen.path.split("/").pop(), source: "generated", mime: "image/jpeg" })
    .select()
    .single();

  const persisted = await persistGeneratedAsset(client, {
    shopId,
    userId,
    persona: "Lily",
    assetType: "image",
    provider: gen.provider,
    model: gen.model,
    prompt: gen.prompt,
    content: { url: gen.url, style },
    mediaId: mediaRow?.id || null,
    status: "completed"
  });

  return json(200, {
    ok: true,
    url: gen.url,
    asset_id: persisted.ok ? persisted.asset.id : null,
    // The client is responsible for showing this alongside the image —
    // it is a new AI-generated image, never an edit of the uploaded photo.
    generated: true
  });
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    const { client, shopId, user } = await currentUser(event);
    const body = bodyOf(event);
    const action = String(body.action || "").toLowerCase();

    if (action === "enhance-suggest") return await handleEnhanceSuggest(body);
    if (action === "generate-image") return await handleGenerateImage(client, { shopId, userId: user.id }, body);

    return json(400, { error: "Unsupported action. Use enhance-suggest or generate-image." });
  } catch (error) {
    return fail(error);
  }
}

/** Exposed for the flower-context step: reuses the exact same vision call
 * photo-recipe.js already relies on, so a caller doesn't need a second
 * round trip if it already has the flower list, but can get one here if
 * it doesn't (e.g. a photo that was never run through "build a recipe"). */
export async function identifyFlowersForImagePrompt(buffer) {
  const vision = await analyzeArrangementPhoto({ buffer });
  const text = String(vision?.text || "").trim();
  if (!text) return [];
  return text
    .split(/[,\n]+/)
    .map((s) => s.replace(/^possibly\s+/i, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}
