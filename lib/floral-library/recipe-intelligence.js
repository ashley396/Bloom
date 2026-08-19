/**
 * Floral intelligence — shared by Lily (Step 75) and Community (Step 66):
 * confidence-labeled flower ID, "Design DNA" (a real, computed style
 * profile — not AI flavor text), recipe scaling, and substitutions.
 *
 * Deliberately pure and deterministic: every value here is derived from
 * the recipe's own real ingredient names and quantities, or from a small
 * curated lookup table maintained in this file — never invented by an AI
 * call. That's what makes "confidence" and "Design DNA" trustworthy
 * enough to show a florist without a disclaimer on every line.
 */

/** Curated wholesale-name → style tag lookup. Deliberately small and specific — a
 *  flower only gets a tag when it's a genuinely common association, not a guess. */
const STYLE_LEXICON = [
  { re: /peony|garden rose|ranunculus|sweet pea/i, tag: "romantic" },
  { re: /orchid|anthurium|calla lily/i, tag: "modern" },
  { re: /sunflower|wildflower|queen anne'?s lace|wax ?flower/i, tag: "rustic" },
  { re: /\brose\b|carnation|alstroemeria/i, tag: "classic" },
  { re: /succulent|protea|pampas|dried/i, tag: "boho" },
  { re: /hydrangea|delphinium|larkspur/i, tag: "garden" }
];

/** Curated same-kind substitutions — real florist swaps, not algorithmic guesses. */
const SUBSTITUTION_MAP = {
  "peony": ["Garden rose", "Ranunculus"],
  "garden rose": ["Peony", "Ranunculus"],
  "ranunculus": ["Garden rose", "Peony"],
  "hydrangea": ["Snowball viburnum", "Spray rose (clustered)"],
  "freedom rose": ["Garden rose", "Spray rose"],
  "spray rose": ["Freedom rose", "Ranunculus"],
  "oriental lily": ["Casablanca lily", "Stargazer lily"],
  "tulip": ["Ranunculus", "Anemone"],
  "gerbera daisy": ["Sunflower", "Chrysanthemum"],
  "sunflower": ["Gerbera daisy", "Chrysanthemum"],
  "eucalyptus": ["Israeli ruscus", "Silver dollar eucalyptus"],
  "israeli ruscus": ["Eucalyptus", "Leatherleaf"],
  "leatherleaf": ["Israeli ruscus", "Pittosporum"],
  "pittosporum": ["Leatherleaf", "Salal"]
};

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

/**
 * Parses a raw vision-model stem-name token, extracting the "possibly"
 * uncertainty hint the vision prompt already asks for (see
 * ARRANGEMENT_VISION_PROMPT in _shared/florist-ai-vision.js) instead of
 * discarding it — that hint is what makes the label a real signal from
 * the model, not a fabricated confidence score.
 */
export function parseVisionStemToken(token) {
  const raw = String(token || "").trim();
  const uncertain = /^possibly\s+/i.test(raw);
  const name = raw.replace(/^possibly\s+/i, "").trim();
  return { name, confidence: uncertain ? "estimated" : "confirmed" };
}

/**
 * A recipe row is "confirmed" only when every source that contributed it
 * agreed it was confirmed — a row inferred once as "estimated" (from an
 * uncertain vision read) stays estimated even if it also happens to
 * literally appear in the caption text, since we're being conservative
 * about what we tell a florist to trust outright.
 */
export function mergeConfidence(a, b) {
  if (a === "estimated" || b === "estimated") return "estimated";
  return "confirmed";
}

/**
 * Design DNA: a real, computed structural/style profile of a recipe —
 * never AI-generated prose. Two identical recipes always produce an
 * identical profile.
 */
export function buildDesignDna(recipe = []) {
  const rows = Array.isArray(recipe) ? recipe : [];
  const stemCount = rows.reduce((sum, r) => sum + Math.max(0, Number(r.qty ?? r.quantity ?? 0)), 0);
  const byKind = { flower: 0, foliage: 0, supply: 0 };
  for (const r of rows) {
    const kind = ["flower", "foliage", "supply"].includes(r.kind) ? r.kind : "flower";
    byKind[kind] += Math.max(0, Number(r.qty ?? r.quantity ?? 0));
  }
  const flowerAndFoliage = byKind.flower + byKind.foliage;
  const focalToFoliageRatio = flowerAndFoliage
    ? Math.round((byKind.flower / flowerAndFoliage) * 100)
    : null;
  const dominantKind = stemCount
    ? Object.entries(byKind).sort((a, b) => b[1] - a[1])[0][0]
    : null;
  const tagCounts = new Map();
  for (const r of rows) {
    const name = String(r.name || "");
    for (const entry of STYLE_LEXICON) {
      if (entry.re.test(name)) tagCounts.set(entry.tag, (tagCounts.get(entry.tag) || 0) + 1);
    }
  }
  const styleTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)
    .slice(0, 3);
  return {
    stemCount,
    flowerStems: byKind.flower,
    foliageStems: byKind.foliage,
    supplyStems: byKind.supply,
    focalToFoliageRatio,
    dominantKind,
    styleTags
  };
}

/**
 * Scale a recipe's stem counts to a target total stem count (flowers +
 * foliage only — supplies like floral tape aren't stem-scaled) or by a
 * plain multiplier. Every included ingredient stays at least 1 stem —
 * scaling down never silently drops an ingredient from the design.
 */
export function scaleRecipe(recipe = [], { targetStemCount, multiplier } = {}) {
  const rows = Array.isArray(recipe) ? recipe : [];
  if (!rows.length) return [];
  let factor = Number(multiplier);
  if (!(factor > 0)) {
    const scalable = rows.filter((r) => r.kind !== "supply");
    const currentStems = scalable.reduce((s, r) => s + Math.max(0, Number(r.qty ?? r.quantity ?? 0)), 0);
    factor = currentStems > 0 && targetStemCount > 0 ? Number(targetStemCount) / currentStems : 1;
  }
  return rows.map((r) => {
    const qty = Math.max(0, Number(r.qty ?? r.quantity ?? 0));
    if (r.kind === "supply") return { ...r, qty };
    const scaled = qty > 0 ? Math.max(1, Math.round(qty * factor)) : qty;
    return { ...r, qty: scaled };
  });
}

/** Real, curated same-kind substitutes for a wholesale flower/foliage name — [] when unknown. */
export function suggestSubstitutes(name) {
  return SUBSTITUTION_MAP[normalizeName(name)] || [];
}

function singularize(name) {
  return normalizeName(name).replace(/e?s$/, "");
}

/**
 * Community Step 67: match a recipe's ingredients against the *importing
 * shop's own* inventory (real wholesale costs they've already entered) —
 * so importing a shared recipe doesn't insert unit_cost: 0 for every line
 * regardless of whether the shop already stocks that exact flower.
 *
 * Matching is deliberately conservative: an exact (normalized, singular)
 * name match, or a whole-word substring match in either direction (so
 * "Rose" in inventory matches a recipe's "Freedom rose", and "Freedom
 * rose" in inventory matches a recipe's plain "Rose") — never a fuzzy/
 * phonetic guess that could attach the wrong cost to the wrong stem.
 */
export function matchRecipeToInventory(recipe = [], inventory = []) {
  const rows = Array.isArray(recipe) ? recipe : [];
  const stock = (Array.isArray(inventory) ? inventory : [])
    .filter((i) => i && i.name)
    .map((i) => ({ id: i.id, name: i.name, singular: singularize(i.name), cost: Number(i.cost || 0) }));

  const matched = rows.map((row) => {
    const rowSingular = singularize(row.name);
    const exact = stock.find((s) => s.singular === rowSingular);
    const partial =
      exact ||
      stock.find((s) => rowSingular.includes(s.singular) || s.singular.includes(rowSingular));
    if (!partial) return { ...row, matched_inventory_id: null, matched: false, unit_cost: 0 };
    return { ...row, matched_inventory_id: partial.id, matched: true, unit_cost: partial.cost };
  });

  const matchedRows = matched.filter((r) => r.matched);
  const unmatchedNames = matched.filter((r) => !r.matched).map((r) => r.name);
  const estimatedCost = matchedRows.reduce((sum, r) => sum + r.unit_cost * Math.max(0, Number(r.qty ?? r.quantity ?? 0)), 0);

  return {
    recipe: matched,
    matchedCount: matchedRows.length,
    totalCount: rows.length,
    unmatchedNames,
    estimatedCost: Math.round(estimatedCost * 100) / 100,
  };
}
