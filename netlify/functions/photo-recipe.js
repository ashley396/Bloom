/**
 * Photo Studio → Lily recipe.
 * Takes an uploaded arrangement photo, has Lily (vision) identify the flowers,
 * then turns that into a structured florist recipe (stem name + count + role).
 * Suggestions are drafts the florist edits and approves — nothing is saved here.
 */
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { analyzeArrangementPhoto } from "./_shared/florist-ai-vision.js";
import { runCloudflareGenerate } from "./ai-assistant.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const FOLIAGE = /eucalyptus|ruscus|leatherleaf|leather leaf|pittosporum|salal|lemon leaf|ivy|fern|greenery|foliage|myrtle|bear grass|lily grass/i;
const FOCAL = /rose|peony|peonies|hydrangea|dahlia|garden rose|ranunculus|sunflower|gerbera|lily|orchid|protea|anemone|tulip/i;

function guessKind(name) {
  if (FOLIAGE.test(name)) return "foliage";
  if (FOCAL.test(name)) return "focal";
  return "filler";
}

/** Preserve detected flower names without inventing quantities when generation fails. */
function fallbackRecipe(flowerText) {
  return String(flowerText || "")
    .split(/[,\n]+/)
    .map((s) => s.replace(/^possibly\s+/i, "").trim())
    .filter((s) => s && s.length <= 60)
    .slice(0, 18)
    .map((name) => {
      const kind = guessKind(name);
      return { name, qty: null, kind, quantity_status: "unknown" };
    });
}


/**
 * Retail guidance is calculated only from costs explicitly supplied by the
 * florist. Never treat model-inferred flower counts as verified inventory.
 */
export function pricePhotoRecipe(recipe, { stem_costs = {}, container_cost = 0, supply_cost = 0, labor_cost = 0, markup = 3 } = {}) {
  if (!Array.isArray(recipe) || !recipe.length) return { available: false, reason: "No recipe available." };
  if (recipe.some((row) => !Number.isFinite(row.qty) || row.qty <= 0 || row.quantity_status !== "confirmed")) {
    return { available: false, reason: "Confirm the stem quantities before calculating a price." };
  }
  const costs = recipe.map((row) => {
    const cost = stem_costs[row.name];
    return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null;
  });
  if (costs.some((cost) => cost === null)) {
    return { available: false, reason: "Enter the wholesale cost per stem for each flower before calculating a price." };
  }
  const extras = [container_cost, supply_cost, labor_cost];
  if (extras.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    return { available: false, reason: "Container, supplies, and labor costs must be nonnegative numbers." };
  }
  const factor = Number(markup);
  if (!Number.isFinite(factor) || factor < 1 || factor > 10) {
    return { available: false, reason: "Markup must be between 1 and 10." };
  }
  const wholesale = recipe.reduce((sum, row, i) => sum + row.qty * costs[i], 0);
  const base = wholesale + Number(container_cost) + Number(supply_cost);
  const suggested = Math.ceil((base * factor + Number(labor_cost)) / 5) * 5;
  return {
    available: true,
    wholesale_flower_cost: Math.round(wholesale * 100) / 100,
    materials_cost: Math.round(base * 100) / 100,
    suggested_price: suggested,
    currency: "USD",
    pricing_basis: "confirmed quantities and florist-entered costs",
    excludes: ["tax", "delivery fees", "payment processing fees"]
  };
}

function toBuffer(imageBase64) {
  const raw = String(imageBase64 || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, "base64");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (event.httpMethod !== "POST") return methodNotAllowed();

  try {
    await currentUser(event);
    const body = bodyOf(event);
    const buffer = toBuffer(body.image_base64 || body.image || body.dataUrl);
    if (!buffer) return json(400, { error: "Add a photo of the arrangement first." });
    if (buffer.length > MAX_IMAGE_BYTES) return json(413, { error: "Image too large (max 10MB). Try a smaller photo." });

    // 1) Lily looks at the photo and names the stems she can see.
    let flowerText = "";
    try {
      const vision = await analyzeArrangementPhoto({ buffer }, { caption: String(body.notes || "").slice(0, 200) });
      flowerText = String(vision?.text || "").trim();
    } catch (visionError) {
      return json(503, {
        ok: false,
        error: "Lily's photo vision is unavailable right now. You can still type the flowers into the recipe by hand."
      });
    }
    if (!flowerText) {
      return json(200, {
        ok: false,
        message: "Lily couldn't clearly identify the flowers in this photo. Try a closer, well-lit shot of the arrangement."
      });
    }

    // 2) Turn the identified stems into a real recipe with counts and roles.
    let recipe = null;
    let designNotes = "";
    try {
      const gen = await runCloudflareGenerate({
        mode: "generate",
        persona: "Lily",
        task:
          "Convert ONLY the flowers and foliage in this identified list into florist recipe rows. " +
          "Do NOT add any flower that is not in the list — never invent a fuller arrangement. " +
          "Keep each name as given (you may expand an obvious color like 'yellow rose' to a proper wholesale name). " +
          "The photo analysis contains names only, NOT observed quantities. Never claim counts were verified. " +
          "For each item suggest a provisional stem count for a standard arrangement and its role " +
          "(focal, filler, or foliage). If the list is vague or very short, return just those items. Return strict JSON.",
        input: { identified_flowers: flowerText },
        schema: {
          recipe: [{ name: "string", qty: "number", kind: "focal|filler|foliage" }],
          design_notes: "string"
        }
      });
      const result = gen?.result || {};
      if (Array.isArray(result.recipe) && result.recipe.length) {
        recipe = result.recipe
          .filter((r) => r && r.name)
          .slice(0, 24)
          .map((r) => ({
            name: String(r.name).slice(0, 60),
            qty: Math.max(1, Math.min(99, Math.round(Number(r.qty) || 1))),
            kind: /focal|filler|foliage/i.test(r.kind || "") ? String(r.kind).toLowerCase() : guessKind(r.name),
            quantity_status: "estimated"
          }));
      }
      designNotes = String(result.design_notes || "").slice(0, 600);
    } catch {
      /* fall back below */
    }

    if (!recipe || !recipe.length) recipe = fallbackRecipe(flowerText);

    // Client-supplied counts must match identified flower names before being used.
    const confirmed = body.confirmed_quantities && typeof body.confirmed_quantities === "object"
      ? body.confirmed_quantities : {};
    for (const row of recipe) {
      const quantity = confirmed[row.name];
      if (Number.isInteger(quantity) && quantity > 0 && quantity <= 999) {
        row.qty = quantity;
        row.quantity_status = "confirmed";
      }
    }
    const pricing = pricePhotoRecipe(recipe, body.pricing || {});

    return json(200, {
      ok: true,
      flowers: flowerText,
      recipe,
      design_notes: designNotes,
      stems: recipe.every((r) => r.quantity_status === "confirmed" && Number.isFinite(r.qty) && r.qty > 0)
        ? recipe.reduce((s, r) => s + r.qty, 0)
        : null,
      quantity_warning: "AI stem counts are estimates. Confirm quantities before pricing or inventory deduction.",
      requires_quantity_confirmation: recipe.some((row) => row.quantity_status !== "confirmed"),
      pricing,
      provider: "Cloudflare Workers AI Vision + Lily"
    });
  } catch (error) {
    return fail(error);
  }
}
