/**
 * Lily arrangement photo → draft recipe (vision). Never auto-saves — florist approves first.
 */

import { json, preflight, methodNotAllowed, bodyOf } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { runVisionAnalysis } from "./_shared/ai-provider.js";
import { validateDeliveryProofUpload, parseDataUrl } from "./_shared/upload-validation.js";
import { aiUnavailableMessage } from "../../lib/ai/provider-config.js";

const ARRANGEMENT_RECIPE_SCHEMA = {
  arrangement_style: "string — likely style name",
  color_palette: ["string colors"],
  focal_flowers: [{ name: "string", estimated_stems: "number", confidence: "likely|estimated" }],
  secondary_flowers: [{ name: "string", estimated_stems: "number", confidence: "likely|estimated" }],
  greenery: [{ name: "string", estimated_stems: "number" }],
  container: "string — likely vessel/mechanics",
  mechanics: "string — likely foam/tape/wire notes",
  difficulty: "beginner|intermediate|advanced",
  substitutions: ["string"],
  estimated_wholesale_cost: { min: "number", max: "number", note: "estimated" },
  suggested_retail_price: { min: "number", max: "number", note: "estimated" },
  margin_percent: { estimated: "number", note: "estimated" },
  care_notes: ["string"],
  production_notes: ["string"],
  recipe_lines: [{ name: "string", qty: "number", kind: "flower|foliage|supply", note: "string" }],
  uncertainty: "Always remind florist to review stem counts and pricing.",
  requires_approval: true,
};

const VISION_PROMPT = `You are Lily, Florisyn's creative florist assistant. Analyze this floral arrangement photo for a professional florist.
Return ONLY valid JSON matching this shape (use "likely" or "estimated" language — never claim certainty):
${JSON.stringify(ARRANGEMENT_RECIPE_SCHEMA)}

Rules:
- Name real flower varieties when possible (Freedom rose, spray rose, alstroemeria, leatherleaf, etc.).
- Stem counts are estimates — label confidence as likely or estimated.
- Include substitution options using common wholesale flowers.
- Wholesale and retail pricing are rough ranges based on typical US florist shops.
- Never state that anything was saved or published.
- Include uncertainty reminder in the uncertainty field.`;

function manualFallbackDraft(note = "") {
  return {
    draft: {
      arrangement_style: "Custom arrangement (manual review)",
      color_palette: [],
      focal_flowers: [],
      secondary_flowers: [],
      greenery: [],
      container: "",
      mechanics: "",
      difficulty: "intermediate",
      substitutions: [],
      estimated_wholesale_cost: { min: 0, max: 0, note: "estimated — enter after review" },
      suggested_retail_price: { min: 0, max: 0, note: "estimated — enter after review" },
      margin_percent: { estimated: 0, note: "estimated" },
      care_notes: ["Hydrate stems, clean foliage below waterline, use flower food."],
      production_notes: ["Open the Floral Library recipe builder to add stems manually."],
      recipe_lines: [],
      uncertainty:
        note ||
        "Vision AI is unavailable. Use the manual recipe builder — all counts and prices need florist approval.",
      requires_approval: true,
      manual_fallback: true,
    },
    provider: "manual_fallback",
  };
}

function parseVisionDraft(text) {
  const raw = String(text || "").trim();
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    const { shopId } = await currentUser(event);
    const body = bodyOf(event);
    const dataUrl = String(body.image_data_url || body.data_url || "").trim();
    if (!dataUrl) return json(400, { error: "Upload an arrangement photo to analyze." });

    const validation = validateDeliveryProofUpload({ dataUrl });
    if (!validation.valid) return json(400, { error: validation.error });

    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return json(400, { error: "Invalid image encoding." });

    try {
      const vision = await runVisionAnalysis({
        imageBase64: parsed.buffer.toString("base64"),
        mime: parsed.mime,
        prompt: VISION_PROMPT,
        env: process.env,
      });
      const draft = parseVisionDraft(vision.text);
      if (!draft) {
        return json(200, {
          ...manualFallbackDraft("Vision AI returned unstructured text. Please review manually."),
          raw_preview: vision.text.slice(0, 800),
          shop_id: shopId,
        });
      }
      draft.requires_approval = true;
      draft.uncertainty =
        draft.uncertainty ||
        "Please review all stem counts, substitutions, and pricing before saving to your library.";
      return json(200, {
        draft,
        provider: vision.provider,
        model: vision.model,
        shop_id: shopId,
      });
    } catch (visionError) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "lily_arrangement_vision_fallback",
          shop_id: shopId,
          detail: String(visionError.message || visionError).slice(0, 200),
        })
      );
      return json(200, manualFallbackDraft(aiUnavailableMessage(String(visionError.message || ""))));
    }
  } catch (error) {
    return fail(error);
  }
}
