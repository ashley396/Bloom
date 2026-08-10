#!/usr/bin/env node
/**
 * Batch 2 — adds 50 NEW everyday arrangements (ed-51 … ed-100).
 * Does NOT modify batch 1 JSON. Run sync-floral-library-catalog.mjs after this.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");
const dataPath = path.join(publicDir, "data/floral-library-everyday-batch-2.json");
const everydayDir = path.join(publicDir, "assets/floral-library/everyday");

const POOL = [
  "florisyn-everyday-sunny-bouquet.jpg",
  "florisyn-everyday-spring-pastels.jpg",
  "garden-harmony.jpg",
  "florisyn-everyday-rose-pitcher.jpg",
  "florisyn-everyday-garden-medley.jpg",
  "florisyn-everyday-market-wildflowers.jpg",
  "florisyn-everyday-daisies-tulips.jpg",
  "florisyn-arrangement-signature-blush.jpg"
];

const BATCH_OFFSET = 50;

/** name, style, palette, container, mechanics, tools, flowers, foliage, steps, why, retail */
const SPECS = [
  ["Daily Pink Cylinder", "feminine", "pink, blush, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 5], ["Pink Carnations", 7], ["Pink Alstroemeria", 4]], [["Eucalyptus", 3]], ["Tape grid in cylinder.", "Spiral pink roses.", "Fill with carnations and alstro.", "Eucalyptus collar.", "Check symmetry."], "Pink cylinder is a daily counter reorder with predictable stem cost.", 57.99],
  ["Soft Garden Morning", "feminine", "blush, cream, sage", "8\" ceramic vase", "tape grid", ["scissors", "floral tape"], [["Blush Roses", 4], ["White Stock", 4], ["Pink Carnations", 5]], [["Pittosporum", 4]], ["Condition stems.", "Stock for morning height.", "Roses and carnations fill.", "Pittosporum finish."], "Soft morning palette sells before noon on walk-ins.", 58.99],
  ["White Meadow Vase", "classic", "white, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["White Daisies", 9], ["White Carnations", 6], ["White Stock", 3]], [["Leatherleaf", 4]], ["Mass white daisies.", "Carnations for body.", "Stock line.", "Leatherleaf frame."], "All-white meadow look without premium stem markup.", 54.99],
  ["Everyday Citrus Mix", "bright", "yellow, orange, green", "6\" cylinder vase", "foam", ["scissors", "wet foam"], [["Yellow Roses", 3], ["Orange Carnations", 8], ["Yellow Snapdragons", 3]], [["Leatherleaf", 3]], ["Foam in cylinder.", "Citrus carnation base.", "Roses and snapdragons accent."], "Citrus naming drives impulse buys for kitchens and offices.", 52.99],
  ["Hydrangea Cottage Jar", "rustic", "blue, white, green", "quart mason jar", "hand-tie", ["scissors", "twine"], [["Hydrangea", 1], ["White Daisies", 6], ["White Carnations", 4]], [["Eucalyptus", 3]], ["Hand-tie around hydrangea.", "Set in cottage jar.", "Daisies tuck around base."], "Single hydrangea jar fills fast with high perceived value.", 51.99],
  ["Rose & Stock Everyday", "classic", "pink, white, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 5], ["White Stock", 5], ["White Carnations", 4]], [["Leatherleaf", 3]], ["Roses focal triangle.", "Stock for scent and height.", "Carnations fill."], "Stock scent upsells at the register.", 59.99],
  ["Daisy Porch Jar", "cheerful", "white, yellow, green", "quart mason jar", "hand-tie", ["scissors"], [["White Daisies", 8], ["Yellow Daisies", 6], ["Yellow Carnations", 4]], [["Pittosporum", 3]], ["Hand-tie daisy mix.", "Place in porch jar.", "Pittosporum wrap."], "Porch jar size is perfect for front-desk gifts.", 43.99],
  ["Blush Countertop Mix", "feminine", "blush, cream", "5\" cube vase", "tape grid", ["scissors", "floral tape"], [["Blush Roses", 4], ["Blush Carnations", 6], ["White Alstroemeria", 3]], [["Eucalyptus", 2]], ["Compact cube grid.", "Blush mass.", "Alstro line."], "Countertop cube turns quickly on busy days.", 49.99],
  ["Neutral Rose Vase", "simple", "cream, blush, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Cream Roses", 6], ["Blush Carnations", 5], ["White Stock", 2]], [["Eucalyptus", 4]], ["Neutral rose spiral.", "Minimal palette.", "Eucalyptus finish."], "Neutrals match any home — easy add-on sale.", 60.99],
  ["Sunflower Simple Jar", "bright", "yellow, green", "pint mason jar", "hand-tie", ["scissors"], [["Sunflowers", 2], ["Yellow Daisies", 5], ["Yellow Carnations", 4]], [["Leatherleaf", 2]], ["Two sunflowers anchor jar.", "Daisies and carnations fill."], "Minimal sunflower jar — fast and profitable.", 41.99],
  ["Clean Greens & Whites", "classic", "white, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["White Carnations", 8], ["White Roses", 4], ["White Snapdragons", 2]], [["Leatherleaf", 5], ["Eucalyptus", 4]], ["Green-heavy white design.", "Extra foliage value."], "Foliage-forward lowers flower COGS while keeping size.", 53.99],
  ["Pink Breeze Vase", "feminine", "pink, white, green", "6\" ceramic vase", "tape grid", ["scissors", "floral tape"], [["Pink Carnations", 9], ["Pink Alstroemeria", 5], ["Baby's Breath", 2]], [["Pittosporum", 3]], ["Pink carnation mass.", "Alstro movement.", "Baby's breath soft finish."], "Light pink breeze design for everyday gifting.", 48.99],
  ["Everyday Hydrangea Cube", "modern", "blue, white, green", "5\" glass cube vase", "chicken wire ball", ["scissors", "chicken wire"], [["Hydrangea", 2], ["White Carnations", 3]], [["Eucalyptus", 2]], ["Wire ball in cube.", "Two hydrangea faces.", "Carnations at base."], "Hydrangea cube is a subscription-friendly SKU.", 62.99],
  ["Soft Yellow Harmony", "cheerful", "yellow, cream, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Yellow Roses", 4], ["Yellow Carnations", 6], ["White Alstroemeria", 4]], [["Leatherleaf", 3]], ["Yellow harmony spiral.", "Alstro soft contrast."], "Yellow harmony works for get-well without custom work.", 55.99],
  ["Rose & Mum Daily Vase", "classic", "pink, bronze, green", "8\" cylinder vase", "foam", ["scissors", "wet foam"], [["Pink Roses", 4], ["Bronze Mums", 6], ["Pink Carnations", 4]], [["Leatherleaf", 3]], ["Rose focal.", "Mums for longevity.", "Carnation fill."], "Mums extend life — fewer remakes for the shop.", 56.99],
  ["Bright Market Jar", "bright", "multi bright", "quart mason jar", "hand-tie", ["scissors", "twine"], [["Mixed Carnations", 9], ["Yellow Daisies", 5], ["Orange Alstroemeria", 4]], [["Pittosporum", 3]], ["Market-style hand-tie.", "Jar presentation."], "Market jar bundles move at farmers-market price points.", 44.99],
  ["Calm White Garden", "classic", "white, green", "8\" ceramic vase", "tape grid", ["scissors", "floral tape"], [["White Lilies", 2], ["White Roses", 4], ["White Carnations", 5]], [["Eucalyptus", 4]], ["Lilies for calm height.", "White mass fill."], "Calm white garden suits sympathy-adjacent everyday orders.", 65.99],
  ["Peach & Pink Blend", "feminine", "peach, pink, cream", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Peach Roses", 4], ["Pink Carnations", 7], ["Peach Alstroemeria", 4]], [["Eucalyptus", 3]], ["Peach-pink gradient.", "Even spiral."], "Peach-pink reads custom without extra labor.", 57.99],
  ["Hydrangea & Daisy Mix", "simple", "blue, white, yellow", "8\" cylinder vase", "chicken wire", ["scissors", "chicken wire"], [["Hydrangea", 1], ["White Daisies", 7], ["Yellow Daisies", 4]], [["Leatherleaf", 3]], ["Hydrangea anchor.", "Daisy ring around base."], "Hydrangea plus daisies = big look, modest stem count.", 55.99],
  ["Everyday Rustic Cylinder", "rustic", "earth tones, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Peach Carnations", 7], ["Bronze Mums", 4], ["Orange Alstroemeria", 4]], [["Pittosporum", 4]], ["Rustic earth-tone cylinder.", "Pittosporum heavy."], "Rustic cylinder uses hardy mums and carnations.", 52.99],
  ["Modern Neutral Jar", "modern", "cream, sage, white", "quart mason jar", "hand-tie", ["scissors"], [["Cream Roses", 4], ["White Carnations", 6], ["White Stock", 2]], [["Eucalyptus", 4]], ["Modern neutral hand-tie.", "Jar set."], "Modern neutral jar fits minimalist décor trends.", 50.99],
  ["Daily Blush Bouquet", "feminine", "blush, pink, green", "hand-tie wrap (no vase)", "hand-tie", ["scissors", "sleeve"], [["Blush Roses", 5], ["Pink Carnations", 6], ["Pink Alstroemeria", 4]], [["Baby's Breath", 2], ["Eucalyptus", 2]], ["Hand-tie blush bouquet.", "Wrap for delivery."], "Wrapped blush bouquet — no vase cost, strong margin.", 46.99],
  ["Soft Lavender Mix", "feminine", "lavender, white, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Lavender Stock", 5], ["White Carnations", 6], ["Purple Alstroemeria", 4]], [["Eucalyptus", 3]], ["Stock lavender note.", "White carnation body."], "Lavender stock drives fragrance-led sales.", 54.99],
  ["Rose & Carnation Classic", "classic", "red, pink, white", "8\" cylinder vase", "foam", ["scissors", "wet foam"], [["Red Roses", 3], ["Pink Roses", 3], ["White Carnations", 7]], [["Leatherleaf", 4]], ["Classic tri-color.", "Foam for stability."], "Staff know this recipe by heart — zero training time.", 61.99],
  ["Sunshine Table Vase", "bright", "yellow, white, green", "6\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Sunflowers", 2], ["Yellow Daisies", 6], ["White Carnations", 4]], [["Leatherleaf", 2]], ["Low table height.", "Sunflower pair focal."], "Table height reduces stems and fits dining orders.", 47.99],
  ["Gentle White Trio", "classic", "white, green", "6\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["White Roses", 3], ["White Lilies", 2], ["White Carnations", 5]], [["Eucalyptus", 3]], ["Three white focal types.", "Compact cylinder."], "White trio reads elegant at a mid price point.", 58.99],
  ["Pink Market Bunch", "cheerful", "pink, green", "hand-tie wrap (no vase)", "hand-tie", ["scissors", "sleeve"], [["Pink Carnations", 10], ["Pink Alstroemeria", 5], ["Baby's Breath", 2]], [["Leatherleaf", 3]], ["Pink market bunch.", "Sleeve and go."], "Grab-and-go pink bunch for cooler door.", 40.99],
  ["Everyday Hydrangea Rose", "simple", "blue, pink, green", "8\" cylinder vase", "chicken wire", ["scissors", "chicken wire"], [["Hydrangea", 1], ["Pink Roses", 5], ["Pink Carnations", 4]], [["Eucalyptus", 3]], ["Hydrangea plus roses.", "Everyday cylinder."], "Hydrangea-rose combo is a proven upsell pair.", 63.99],
  ["Daisy & Stock Harmony", "cheerful", "white, yellow, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["White Daisies", 8], ["Yellow Stock", 4], ["White Carnations", 4]], [["Leatherleaf", 3]], ["Daisy mass.", "Stock harmony line."], "Stock and daisies are cooler staples with long life.", 51.99],
  ["Clean Color Pop", "bright", "fuchsia, yellow, orange", "5\" cube vase", "foam", ["scissors", "wet foam"], [["Hot Pink Carnations", 7], ["Yellow Daisies", 5], ["Orange Roses", 2]], [["Pittosporum", 2]], ["Bold cube pop.", "Tight color blocks."], "Small bright cube sells as desk décor.", 49.99],
  ["Soft Neutral Jar", "simple", "cream, blush, sage", "pint mason jar", "hand-tie", ["scissors"], [["Cream Roses", 3], ["Blush Carnations", 6], ["White Alstroemeria", 3]], [["Eucalyptus", 3]], ["Soft neutral jar tie.", "Minimal stems."], "Neutral jar is a reliable everyday filler SKU.", 42.99],
  ["Rose Garden Everyday", "rustic", "pink, peach, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 5], ["Peach Carnations", 5], ["Pink Alstroemeria", 4], ["White Daisies", 4]], [["Pittosporum", 3]], ["Garden-gathered spiral.", "Mixed heights."], "Garden naming feels bespoke with standard cooler stems.", 58.99],
  ["Hydrangea & Greens Mix", "simple", "blue, green", "8\" cylinder vase", "chicken wire", ["scissors", "chicken wire"], [["Hydrangea", 2], ["White Carnations", 3]], [["Leatherleaf", 5], ["Eucalyptus", 4], ["Pittosporum", 2]], ["Hydrangea pair.", "Green-heavy collar.", "Minimal blooms."], "Greens mix protects margin when bloom costs spike.", 54.99],
  ["Bright Daily Cylinder", "bright", "yellow, pink, orange", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Yellow Carnations", 7], ["Hot Pink Carnations", 5], ["Orange Alstroemeria", 4]], [["Leatherleaf", 3]], ["Daily bright cylinder.", "Carnation-forward."], "Carnation-heavy bright cylinder = fast assembly.", 47.99],
  ["Pink & White Everyday", "feminine", "pink, white, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 4], ["White Roses", 3], ["Pink Carnations", 6], ["White Carnations", 4]], [["Eucalyptus", 3]], ["Tape grid in cylinder.", "Pink-white checker spiral.", "Eucalyptus collar finish."], "Pink and white is the most requested everyday palette.", 59.99],
  ["Sunflower Accent Vase", "bright", "yellow, white, green", "6\" ceramic vase", "tape grid", ["scissors", "floral tape"], [["Sunflowers", 3], ["White Daisies", 6], ["White Carnations", 4]], [["Leatherleaf", 3]], ["Sunflower accent trio.", "White fill."], "Three sunflowers feel generous without dozen pricing.", 50.99],
  ["Classic Rose Jar", "classic", "red, pink, cream", "quart mason jar", "hand-tie", ["scissors", "twine"], [["Red Roses", 3], ["Pink Roses", 3], ["Cream Carnations", 5]], [["Pittosporum", 3]], ["Classic rose jar.", "Tri-color tie."], "Rose jar hits gift price point under sixty dollars.", 55.99],
  ["Soft Spring Color Mix", "feminine", "pastel pink, yellow, white", "8\" ceramic vase", "tape grid", ["scissors", "floral tape"], [["Pastel Pink Roses", 4], ["Yellow Daisies", 5], ["White Carnations", 5], ["Pink Alstroemeria", 3]], [["Eucalyptus", 3]], ["Pastel spring mix.", "Ceramic presentation."], "Spring color mix sells year-round with seasonless appeal.", 56.99],
  ["Neutral Countertop Arrangement", "modern", "cream, sage, white", "5\" cube vase", "tape grid", ["scissors", "floral tape"], [["Cream Roses", 3], ["White Carnations", 5], ["White Snapdragons", 2]], [["Eucalyptus", 3]], ["Countertop cube neutral.", "Clean lines."], "Neutral cube fits corporate and medical office orders.", 51.99],
  ["Blush & Cream Harmony", "feminine", "blush, cream, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Blush Roses", 5], ["Cream Roses", 4], ["Blush Carnations", 5]], [["Eucalyptus", 3]], ["Blush-cream harmony.", "Soft spiral."], "Harmony pairings simplify staff recommendations.", 60.99],
  ["Daisy Sunshine Cube", "cheerful", "yellow, white, green", "5\" glass cube vase", "tape grid", ["scissors", "floral tape"], [["Yellow Daisies", 8], ["White Daisies", 6], ["Yellow Carnations", 3]], [["Leatherleaf", 2]], ["Daisy sunshine cube.", "All-around brightness."], "Daisy cube is kid-friendly and hospital-safe styling.", 45.99],
  ["Everyday Rose & Lily", "classic", "pink, white, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 4], ["White Lilies", 2], ["White Carnations", 5]], [["Leatherleaf", 3]], ["Rose and lily pair.", "Not bridal — everyday scale."], "Two lilies add prestige without event-level stem counts.", 64.99],
  ["Hydrangea Soft Blend", "feminine", "blue, blush, green", "8\" cylinder vase", "chicken wire", ["scissors", "chicken wire"], [["Hydrangea", 1], ["Blush Roses", 4], ["Blush Carnations", 5]], [["Eucalyptus", 3]], ["Soft hydrangea blend.", "Blush tuck-ins."], "Soft hydrangea blend photographs well for web menus.", 61.99],
  ["Rustic Greens & Whites", "rustic", "white, green", "quart mason jar", "hand-tie", ["scissors", "twine"], [["White Carnations", 7], ["White Daisies", 5], ["White Stock", 2]], [["Pittosporum", 5], ["Leatherleaf", 3]], ["Rustic green-white jar.", "Foliage-heavy."], "Extra greens stretch white designs on tight budgets.", 49.99],
  ["Daily Pink & Yellow", "cheerful", "pink, yellow, green", "6\" cylinder vase", "foam", ["scissors", "wet foam"], [["Pink Carnations", 6], ["Yellow Daisies", 6], ["Yellow Alstroemeria", 4]], [["Leatherleaf", 3]], ["Pink-yellow daily mix.", "Foam base."], "Pink-yellow reads happy for same-day delivery.", 46.99],
  ["Bright Everyday Vase", "bright", "orange, yellow, pink", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Orange Roses", 3], ["Yellow Carnations", 7], ["Pink Alstroemeria", 4]], [["Pittosporum", 3]], ["Bright everyday spiral.", "High color density."], "Bright vase is the default birthday substitute design.", 53.99],
  ["Soft Pastel Jar", "feminine", "pastel pink, lavender, cream", "pint mason jar", "hand-tie", ["scissors"], [["Pastel Pink Carnations", 8], ["Lavender Stock", 3], ["White Alstroemeria", 3]], [["Baby's Breath", 2]], ["Soft pastel jar.", "Light and airy."], "Pastel jar targets gift under forty-five dollars.", 41.99],
  ["Rose & Daisy Color Pop", "cheerful", "pink, white, yellow", "6\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 4], ["White Daisies", 6], ["Yellow Daisies", 4]], [["Pittosporum", 3]], ["Rose daisy pop.", "Color blocks."], "Recognizable combo — customers order by name.", 52.99],
  ["Hydrangea Everyday Trio", "simple", "blue, white, green", "8\" cylinder vase", "chicken wire", ["scissors", "chicken wire"], [["Hydrangea", 3]], [["Leatherleaf", 4], ["Eucalyptus", 2]], ["Three hydrangea everyday.", "Minimal filler."], "Three-stem hydrangea = premium price with low labor.", 67.99],
  ["Florist Counter Classic", "classic", "mixed bestsellers", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 3], ["White Carnations", 6], ["Yellow Daisies", 4], ["Alstroemeria", 4], ["White Stock", 2]], [["Leatherleaf", 3], ["Eucalyptus", 2]], ["Counter classic mix.", "Balance focal and filler.", "Ribbon optional.", "QC water and stems."], "The design staff reach for when the line is long — fast and profitable.", 58.99]
];

function slug(name, index) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `ed-${String(BATCH_OFFSET + index + 1).padStart(2, "0")}-${base}`;
}

function buildArrangement(index, spec) {
  const [name, style, palette, container, mechanics, tools, flowers, foliage, steps, why, retail] = spec;
  const id = slug(name, index);
  const imageFile = `everyday/${id}.jpg`;
  const recipe = [
    ...flowers.map(([n, q]) => ({ name: n, qty: q, kind: "flower" })),
    ...foliage.map(([n, q]) => ({ name: n, qty: q, kind: "foliage" }))
  ];
  const recipeLine = recipe.map((r) => `${r.qty} ${r.name}`).join(", ");
  const short = `Ultra-realistic everyday ${style} design in a ${container.toLowerCase()} — ${palette}.`;
  const description = [
    short,
    `Style: ${style}. Color palette: ${palette}. Container: ${container}. Mechanics: ${mechanics}. Tools: ${tools.join(", ")}.`,
    `Recipe: ${recipeLine}.`,
    `Steps: ${steps.join(" ")}`,
    why
  ].join(" ");

  return {
    id,
    name,
    style,
    color_palette: palette,
    categories: ["Everyday"],
    arrangement_type: "bouquet",
    container,
    mechanics,
    tools,
    recipe,
    foliage: foliage.map(([n, q]) => ({ name: n, qty: q })),
    instructions: steps,
    why_it_works: why,
    short_description: short,
    description,
    suggested_retail: retail,
    image: imageFile,
    alt: `${name} — ultra-realistic everyday floral arrangement in ${container}`,
    batch: 2
  };
}

const arrangements = SPECS.map((spec, i) => buildArrangement(i, spec));

const catalog = {
  version: 1,
  batch: 2,
  batch_size: 50,
  batch_offset: BATCH_OFFSET,
  target_total: 500,
  collection: "Florisyn Everyday Ultra-Realistic",
  generated_at: new Date().toISOString(),
  arrangements
};

fs.mkdirSync(path.dirname(dataPath), { recursive: true });
fs.writeFileSync(dataPath, JSON.stringify(catalog, null, 2) + "\n");

fs.mkdirSync(everydayDir, { recursive: true });
for (let i = 0; i < arrangements.length; i++) {
  const a = arrangements[i];
  const target = path.join(everydayDir, `${a.id}.jpg`);
  const poolFile = POOL[(BATCH_OFFSET + i) % POOL.length];
  if (fs.existsSync(target)) fs.unlinkSync(target);
  fs.symlinkSync(path.join("..", poolFile), target);
}

console.log(`generate-everyday-library-batch-2: wrote ${arrangements.length} new arrangements (ed-51 … ed-100)`);
console.log(`  JSON: ${dataPath}`);
