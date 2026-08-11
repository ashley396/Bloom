/**
 * Florist Community shared recipes — Lily draft, publish, and shop import.
 */

export const RECIPE_AI_SCHEMA = {
  name: "arrangement title",
  description: "2 short paragraphs for florists",
  category: "Everyday|Wedding|Sympathy|Plants|Gifts|Other",
  suggested_retail: "number USD",
  container: "vase type",
  mechanics: "foam, tape, etc.",
  recipe: [
    {
      name: "Freedom rose or spray rose — real wholesale flower name only",
      qty: "stem count number",
      kind: "flower|foliage|supply",
    },
  ],
  instructions: ["step strings"],
};

const GENERIC_INGREDIENT =
  /^(seasonal focal|accent bloom|filler flower|accent flower|focal flower|seasonal flower|mixed greenery|greenery stems?|flower stems?|focal blooms?|accent blooms?|filler blooms?|seasonal blooms?)$/i;

/** Common florist wholesale names detected in caption/body text. */
const FLOWER_LEXICON = [
  { re: /\bspray\s+roses?\b/i, name: "Spray rose", qty: 5, kind: "flower" },
  { re: /\bgarden\s+roses?\b/i, name: "Garden rose", qty: 5, kind: "flower" },
  { re: /\broses?\b/i, name: "Freedom rose", qty: 6, kind: "flower" },
  { re: /\bhydrangeas?\b/i, name: "Hydrangea", qty: 2, kind: "flower" },
  { re: /\bpeonies?\b/i, name: "Peony", qty: 3, kind: "flower" },
  { re: /\branunculus\b/i, name: "Ranunculus", qty: 5, kind: "flower" },
  { re: /\btulips?\b/i, name: "Tulip", qty: 7, kind: "flower" },
  { re: /\blilies?\b/i, name: "Oriental lily", qty: 3, kind: "flower" },
  { re: /\balstroemeria\b/i, name: "Alstroemeria", qty: 6, kind: "flower" },
  { re: /\bgerberas?\b/i, name: "Gerbera daisy", qty: 4, kind: "flower" },
  { re: /\bdaisies?\b/i, name: "Gerbera daisy", qty: 4, kind: "flower" },
  { re: /\bcarnations?\b/i, name: "Carnation", qty: 6, kind: "flower" },
  { re: /\bchrysanthemums?\b|\bmums?\b/i, name: "Chrysanthemum", qty: 5, kind: "flower" },
  { re: /\bsunflowers?\b/i, name: "Sunflower", qty: 3, kind: "flower" },
  { re: /\borchids?\b/i, name: "Phalaenopsis orchid", qty: 2, kind: "flower" },
  { re: /\bstock\b/i, name: "Stock", qty: 4, kind: "flower" },
  { re: /\blarkspur\b/i, name: "Larkspur", qty: 4, kind: "flower" },
  { re: /\bsnapdragons?\b/i, name: "Snapdragon", qty: 5, kind: "flower" },
  { re: /\beucalyptus\b/i, name: "Eucalyptus", qty: 4, kind: "foliage" },
  { re: /\bruscus\b/i, name: "Israeli ruscus", qty: 4, kind: "foliage" },
  { re: /\bleatherleaf\b/i, name: "Leatherleaf", qty: 3, kind: "foliage" },
  { re: /\bpittosporum\b/i, name: "Pittosporum", qty: 3, kind: "foliage" },
  { re: /\bferns?\b/i, name: "Leather fern", qty: 3, kind: "foliage" },
];

const STYLE_PRESETS = [
  [
    { name: "Freedom rose", qty: 6, kind: "flower" },
    { name: "Spray rose", qty: 4, kind: "flower" },
    { name: "Alstroemeria", qty: 5, kind: "flower" },
    { name: "Israeli ruscus", qty: 4, kind: "foliage" },
  ],
  [
    { name: "Hydrangea", qty: 2, kind: "flower" },
    { name: "Garden rose", qty: 4, kind: "flower" },
    { name: "Stock", qty: 4, kind: "flower" },
    { name: "Leatherleaf", qty: 3, kind: "foliage" },
  ],
  [
    { name: "Gerbera daisy", qty: 5, kind: "flower" },
    { name: "Carnation", qty: 6, kind: "flower" },
    { name: "Snapdragon", qty: 4, kind: "flower" },
    { name: "Pittosporum", qty: 3, kind: "foliage" },
  ],
  [
    { name: "Ranunculus", qty: 6, kind: "flower" },
    { name: "Tulip", qty: 5, kind: "flower" },
    { name: "Waxflower", qty: 4, kind: "flower" },
    { name: "Eucalyptus", qty: 4, kind: "foliage" },
  ],
  [
    { name: "Oriental lily", qty: 3, kind: "flower" },
    { name: "Rose", qty: 5, kind: "flower" },
    { name: "Lily grass", qty: 4, kind: "foliage" },
    { name: "Leather fern", qty: 3, kind: "foliage" },
  ],
];

export function isGenericIngredientName(name) {
  const text = String(name || "").trim();
  if (!text) return true;
  if (GENERIC_INGREDIENT.test(text)) return true;
  return /^(seasonal|accent|filler|mixed|assorted)\b/i.test(text);
}

function simpleHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function inferFlowersFromPostText(caption = "", body = "") {
  const text = `${caption}\n${body}`.trim();
  if (!text) return [];
  const found = [];
  const used = new Set();
  for (const row of FLOWER_LEXICON) {
    if (!row.re.test(text)) continue;
    const key = row.name.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    found.push({ name: row.name, qty: row.qty, kind: row.kind });
  }
  return found.slice(0, 8);
}

export function sanitizeRecipeDraft(raw) {
  if (!raw || typeof raw !== "object") return null;
  const recipe = Array.isArray(raw.recipe)
    ? raw.recipe
        .slice(0, 24)
        .map((row) => ({
          name: String(row?.name || "").trim().slice(0, 120),
          qty: Math.max(0, Number(row?.qty ?? row?.quantity ?? 0) || 0),
          kind: String(row?.kind || "flower").slice(0, 24),
        }))
        .filter((row) => row.name && row.qty > 0 && !isGenericIngredientName(row.name))
    : [];
  const instructions = Array.isArray(raw.instructions)
    ? raw.instructions.map((s) => String(s || "").trim().slice(0, 500)).filter(Boolean).slice(0, 12)
    : [];
  const name = String(raw.name || raw.title || "").trim().slice(0, 120);
  if (!name || !recipe.length) return null;
  const specificCount = recipe.filter((row) => !isGenericIngredientName(row.name)).length;
  if (specificCount === 0) return null;
  return {
    name,
    description: String(raw.description || "").trim().slice(0, 2000) || null,
    category: String(raw.category || "Everyday").trim().slice(0, 80) || "Everyday",
    suggested_retail: Math.max(0, Number(raw.suggested_retail ?? raw.suggested_price ?? 0) || 0),
    container: String(raw.container || "").trim().slice(0, 200) || null,
    mechanics: String(raw.mechanics || "").trim().slice(0, 200) || null,
    recipe,
    instructions,
  };
}

export function recipeToProductItems(draft) {
  return (draft?.recipe || []).map((row) => ({
    ingredient_name: row.name,
    quantity: row.qty,
    unit: "stem",
    unit_cost: 0,
  }));
}

export function publicRecipeSummary(row, { imageUrl = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    post_id: row.post_id,
    title: row.title,
    description: row.description || null,
    category: row.category || null,
    recipe: row.recipe || [],
    instructions: row.instructions || [],
    suggested_retail: Number(row.suggested_retail || 0),
    image_url: imageUrl,
    import_count: Number(row.import_count || 0),
    author_user_id: row.author_user_id,
    created_at: row.created_at,
  };
}

export function buildLocalRecipeDraftFromPost(post = {}) {
  const caption = String(post.caption || "Community arrangement").trim().slice(0, 120);
  const body = String(post.body || "").trim();
  const category =
    String(post.category || "").trim() === "Arrangement Share"
      ? "Everyday"
      : String(post.category || "Everyday").trim().slice(0, 80) || "Everyday";

  let recipe = inferFlowersFromPostText(caption, body);
  if (!recipe.length) {
    const idx = simpleHash(`${caption}|${body}|${post.id || ""}`) % STYLE_PRESETS.length;
    recipe = STYLE_PRESETS[idx].map((row) => ({ ...row }));
  }

  const retailBase = 65 + (recipe.length * 4) + (simpleHash(caption) % 5) * 3;

  return {
    name: caption || "Florist arrangement",
    description:
      body.slice(0, 2000) ||
      `Stem-count recipe inspired by "${caption || "your post"}". Lily inferred likely wholesale flowers — edit counts to match your design.`,
    category,
    suggested_retail: retailBase,
    container: /vase|jar|basket|box/i.test(`${caption} ${body}`) ? "Designer vase" : "Clear glass vase",
    mechanics: /foam|wire|tape|grid/i.test(body) ? "Designer's choice mechanics" : "Clean water, fresh cut stems",
    recipe,
    instructions: [
      "Condition stems and strip foliage below the waterline.",
      "Build silhouette with foliage, then place focal flowers, fillers, and accents.",
      "Adjust stem counts for size and price point before publishing.",
    ],
  };
}

const RECIPE_GENERATE_TASK = `From a florist's community arrangement post, write a professional stem-count recipe other florists can copy.
Rules:
- Use REAL wholesale flower and foliage names only (Freedom rose, spray rose, hydrangea, alstroemeria, leatherleaf, Israeli ruscus, etc.).
- NEVER use placeholders like "seasonal focal flower", "accent bloom", or "filler flower".
- Infer likely flowers from caption, category, and details; vary counts realistically for the described style.
- Never include customer, order, or payment data.`;

export async function generateRecipeWithCloudflare(runGenerate, input, { onCloudError } = {}) {
  try {
    const result = await runGenerate({
      mode: "generate",
      persona: "Lily",
      task: RECIPE_GENERATE_TASK,
      input,
      schema: RECIPE_AI_SCHEMA,
      max_tokens: 900,
    });
    const draft = sanitizeRecipeDraft(result?.result || result);
    if (draft) return { draft, source: "cloudflare" };
  } catch (error) {
    if (typeof onCloudError === "function") onCloudError(error);
  }
  return { draft: null, source: "unavailable" };
}
