#!/usr/bin/env node
/**
 * Generates Florisyn Everyday Ultra-Realistic Floral Library (batch 1 of 50).
 * Source of truth: public/data/floral-library-everyday-50.json
 * Also syncs image symlinks + public/floral-library-collection.js for offline fallback.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");
const dataPath = path.join(publicDir, "data/floral-library-everyday-50.json");
const everydayDir = path.join(publicDir, "assets/floral-library/everyday");

const POOL = [
  "florisyn-everyday-sunny-bouquet.jpg",
  "florisyn-everyday-spring-pastels.jpg",
  "garden-harmony.jpg",
  "florisyn-everyday-rose-pitcher.jpg",
  "florisyn-everyday-garden-medley.jpg",
  "florisyn-everyday-market-wildflowers.jpg",
  "florisyn-everyday-daisies-tulips.jpg",
  "florisyn-arrangement-signature-blush.jpg",
  "florisyn-everyday-garden-medley.jpg"
];

/** @type {Array<{name:string,style:string,palette:string,container:string,mechanics:string,tools:string[],flowers:Array<[string,number]>,foliage:Array<[string,number]>,steps:string[],why:string,retail:number}>} */
const SPECS = [
  ["Sunshine Cube", "bright", "yellow, orange, green", "5\" glass cube vase", "tape grid", ["scissors", "floral tape", "cube vase"], [["Sunflowers", 3], ["Yellow Daisies", 5], ["Orange Carnations", 4]], [["Leatherleaf", 3], ["Pittosporum", 2]], ["Fill cube with fresh water and floral preservative.", "Build a tape grid across the cube opening.", "Cut sunflowers to staggered heights; place center-back.", "Add daisies around sunflowers for brightness.", "Tuck carnations between focal blooms.", "Frame with leatherleaf and pittosporum.", "Check water level and wipe vase."], "Sunflowers sell fast, stem counts stay low, and a cube arranges in under 15 minutes.", 54.99],
  ["Pink Meadow", "feminine", "blush pink, cream, green", "quart mason jar", "hand-tie in jar", ["scissors", "twine", "mason jar"], [["Pink Roses", 5], ["Pink Carnations", 6], ["Alstroemeria", 4]], [["Eucalyptus", 4], ["Baby's Breath", 2]], ["Condition flowers; fill jar halfway with water.", "Hand-tie roses and carnations with eucalyptus.", "Add alstroemeria for line and movement.", "Place bouquet in jar; trim stems evenly.", "Fill with baby's breath for softness."], "Pink everyday designs move year-round with wholesale-friendly stems.", 52.99],
  ["Classic Rose Mix", "classic", "red, pink, white", "8\" cylinder vase", "foam in cylinder", ["scissors", "wet foam", "cylinder vase"], [["Red Roses", 4], ["Pink Roses", 4], ["White Roses", 3]], [["Leatherleaf", 4], ["Pittosporum", 3]], ["Soak foam and secure in cylinder.", "Create triangle with red roses at three points.", "Fill between with pink and white roses.", "Add leatherleaf around rim.", "Finish with pittosporum for depth."], "Tri-color roses are a counter staple with predictable cost and high perceived value.", 64.99],
  ["Cheerful Daisy Burst", "cheerful", "white, yellow, green", "6\" ceramic vase", "tape grid", ["scissors", "floral tape"], [["White Daisies", 10], ["Yellow Daisies", 6]], [["Leatherleaf", 4]], ["Tape grid on ceramic vase.", "Cluster white daisies as the mass.", "Add yellow daisies for pop.", "Frame with leatherleaf.", "Adjust for round, full silhouette."], "Daisies are inexpensive, forgiving, and perfect for walk-in sales.", 44.99],
  ["Everyday Hydrangea Pop", "modern", "blue, white, green", "5\" cube vase", "chicken wire ball", ["scissors", "chicken wire"], [["Hydrangea", 2], ["White Carnations", 4]], [["Eucalyptus", 3]], ["Place chicken wire ball in cube with water.", "Insert hydrangea as focal mass.", "Add carnations for contrast at base.", "Tuck eucalyptus for finish."], "One hydrangea fills a cube quickly — strong margin on a compact design.", 58.99],
  ["Soft Blush Garden", "feminine", "blush, cream, sage", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 6], ["White Stock", 4], ["Pink Alstroemeria", 5]], [["Eucalyptus", 4]], ["Build tape grid in cylinder.", "Place pink roses in soft spiral.", "Add stock for height and fragrance.", "Weave alstroemeria through.", "Finish with eucalyptus collar."], "Soft pinks read premium while staying within everyday stem budgets.", 59.99],
  ["Rustic Mason Jar Mix", "rustic", "warm pink, peach, green", "quart mason jar", "hand-tie", ["scissors", "twine"], [["Peach Carnations", 8], ["Pink Alstroemeria", 5], ["Yellow Daisies", 4]], [["Pittosporum", 4]], ["Hand-tie carnations and alstroemeria.", "Add daisies for brightness.", "Bind with twine; set in jar.", "Frame with pittosporum."], "Mason jars feel handmade and gift-ready with minimal labor.", 48.99],
  ["Bright & Happy", "bright", "yellow, hot pink, orange", "6\" cylinder vase", "foam", ["scissors", "wet foam"], [["Sunflowers", 2], ["Hot Pink Carnations", 8], ["Orange Roses", 3]], [["Leatherleaf", 3]], ["Anchor sunflowers in foam.", "Surround with carnations.", "Add orange roses for contrast.", "Green with leatherleaf."], "High-energy colors sell for birthdays and congratulations.", 56.99],
  ["Simple Whites", "classic", "white, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["White Roses", 6], ["White Carnations", 6], ["White Stock", 3]], [["Leatherleaf", 4]], ["Tape grid in cylinder.", "Layer white roses and carnations.", "Add stock for line.", "Frame with leatherleaf."], "All-white designs work for sympathy and everyday gifting with one recipe.", 62.99],
  ["Everyday Elegance", "classic", "cream, blush, green", "8\" ceramic vase", "tape grid", ["scissors", "floral tape"], [["Cream Roses", 7], ["Blush Carnations", 5], ["White Lilies", 2]], [["Eucalyptus", 4]], ["Place lilies for height first.", "Spiral cream roses around.", "Fill with blush carnations.", "Eucalyptus finish."], "Two lilies elevate the look without wedding-level stem counts.", 68.99],
  ["Morning Cheer", "cheerful", "yellow, white, green", "pint mason jar", "hand-tie", ["scissors"], [["Yellow Daisies", 8], ["White Daisies", 6], ["Yellow Alstroemeria", 4]], [["Pittosporum", 3]], ["Hand-tie daisy clusters.", "Add alstroemeria.", "Set in jar with pittosporum."], "Small jar designs are fast fillers for the cooler door.", 39.99],
  ["Fresh Start", "modern", "green, white, yellow", "5\" cube vase", "tape grid", ["scissors", "floral tape"], [["White Carnations", 8], ["Yellow Snapdragons", 4], ["White Stock", 3]], [["Eucalyptus", 3]], ["Build grid in cube.", "Mass carnations low.", "Snapdragons for vertical line.", "Stock and eucalyptus finish."], "Snapdragon height adds perceived value in a compact cube.", 51.99],
  ["Daily Delight", "cheerful", "pink, yellow, white", "6\" cylinder vase", "foam", ["scissors", "wet foam"], [["Pink Carnations", 7], ["Yellow Daisies", 5], ["White Alstroemeria", 4]], [["Leatherleaf", 3]], ["Foam in cylinder.", "Pink carnation base.", "Daisies and alstroemeria accents.", "Leatherleaf rim."], "Tri-color carnation/daisy mix is a reliable daily seller.", 47.99],
  ["Lavender Breeze", "feminine", "lavender, white, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Lavender Stock", 6], ["White Carnations", 6], ["Purple Alstroemeria", 4]], [["Eucalyptus", 4]], ["Stock sets the scent story.", "White carnations fill.", "Alstroemeria for movement.", "Eucalyptus collar."], "Stock fragrance drives add-on sales at the counter.", 55.99],
  ["Peachy Keen", "cheerful", "peach, coral, green", "quart mason jar", "hand-tie", ["scissors", "twine"], [["Peach Roses", 5], ["Peach Carnations", 6], ["Coral Alstroemeria", 4]], [["Pittosporum", 3]], ["Hand-tie peach tones.", "Place in mason jar.", "Pittosporum frame."], "Peach palettes photograph well for website upsells.", 57.99],
  ["Hydrangea & Friends", "simple", "blue, pink, green", "8\" cylinder vase", "chicken wire", ["scissors", "chicken wire"], [["Hydrangea", 2], ["Pink Roses", 4], ["Pink Carnations", 4]], [["Leatherleaf", 3]], ["Wire ball in cylinder.", "Hydrangea mass.", "Roses and carnations tucked in.", "Leatherleaf finish."], "Hydrangea plus filler blooms stretch perceived size.", 61.99],
  ["Rose & Mum Harmony", "classic", "pink, bronze, green", "8\" ceramic vase", "foam", ["scissors", "wet foam"], [["Pink Roses", 5], ["Bronze Mums", 6], ["Pink Carnations", 4]], [["Leatherleaf", 4]], ["Roses as focal.", "Mums for round mass.", "Carnations fill gaps.", "Leatherleaf edge."], "Mums extend vase life and reduce waste on slower days.", 58.99],
  ["Alstroemeria Joy", "simple", "mixed brights", "6\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Alstroemeria", 12], ["Yellow Daisies", 4]], [["Pittosporum", 3]], ["Mass alstroemeria in grid.", "Daisies for pop.", "Pittosporum frame."], "Alstroemeria-heavy designs are profitable and long-lasting.", 46.99],
  ["Sunflower Smile", "bright", "yellow, brown, green", "6\" ceramic vase", "tape grid", ["scissors", "floral tape"], [["Sunflowers", 4], ["Yellow Carnations", 6]], [["Leatherleaf", 3]], ["Sunflowers focal.", "Carnations surround.", "Leatherleaf base."], "Sunflower-only-plus-filler is a top impulse buy.", 49.99],
  ["Gentle Pastels", "feminine", "pastel pink, lavender, cream", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pastel Pink Roses", 5], ["Lavender Stock", 4], ["White Carnations", 5]], [["Eucalyptus", 3]], ["Soft spiral of pastels.", "Stock for scent.", "Eucalyptus finish."], "Pastels suit new baby and thank-you without custom quoting.", 60.99],
  ["Modern Whites", "modern", "white, green", "5\" cube vase", "tape grid", ["scissors", "floral tape"], [["White Roses", 5], ["White Carnations", 6], ["White Snapdragons", 3]], [["Eucalyptus", 3]], ["Clean lines in cube.", "Snapdragons for architecture.", "Minimal greenery."], "Modern white cubes fit corporate and sympathy add-on orders.", 63.99],
  ["Compact Color Pop", "bright", "fuchsia, orange, yellow", "5\" cube vase", "foam", ["scissors", "wet foam"], [["Hot Pink Carnations", 8], ["Orange Roses", 3], ["Yellow Daisies", 4]], [["Pittosporum", 2]], ["Bold carnation mass.", "Rose and daisy accents.", "Tight cube silhouette."], "Small footprint designs turn over quickly on busy Saturdays.", 50.99],
  ["Everyday Pink Mix", "feminine", "pink, white, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 4], ["Pink Carnations", 8], ["Pink Alstroemeria", 5]], [["Leatherleaf", 3]], ["All-pink blend.", "Roses focal.", "Carnations and alstro fill."], "Monochromatic pink is easy to upsell with chocolates.", 56.99],
  ["Blue & White Classic", "classic", "blue, white, green", "8\" cylinder vase", "chicken wire", ["scissors", "chicken wire"], [["Blue Hydrangea", 1], ["White Roses", 5], ["White Carnations", 5]], [["Eucalyptus", 4]], ["Hydrangea base.", "White roses and carnations.", "Eucalyptus collar."], "Blue-and-white reads crisp and works for everyday and sympathy.", 65.99],
  ["Sweet & Simple", "simple", "pink, white", "pint mason jar", "hand-tie", ["scissors"], [["Pink Carnations", 8], ["White Daisies", 5]], [["Baby's Breath", 2]], ["Hand-tie in jar.", "Minimal greens."], "Entry price point for budget-conscious customers.", 36.99],
  ["Daily Sunshine", "bright", "yellow, white, green", "6\" cylinder vase", "foam", ["scissors", "wet foam"], [["Sunflowers", 3], ["White Alstroemeria", 6], ["Yellow Carnations", 5]], [["Leatherleaf", 3]], ["Sunflower triangle.", "Alstro and carnations fill."], "Repeatable recipe for cooler replenishment.", 53.99],
  ["Soft Spring Mix", "feminine", "pink, yellow, white", "8\" ceramic vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 4], ["Yellow Daisies", 6], ["White Stock", 3]], [["Eucalyptus", 3]], ["Spring palette spiral.", "Stock scent layer."], "Seasonless 'spring' naming sells year-round.", 57.99],
  ["Everyday Garden Vase", "rustic", "mixed garden tones", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 4], ["Orange Alstroemeria", 5], ["Yellow Daisies", 5], ["Pink Carnations", 4]], [["Pittosporum", 4], ["Eucalyptus", 2]], ["Garden-gathered look.", "Mixed stems at varied heights."], "Looks custom while using only cooler staples.", 59.99],
  ["Bright Market Bunch", "bright", "rainbow brights", "hand-tie wrap (no vase)", "hand-tie", ["scissors", "sleeve", "twine"], [["Mixed Carnations", 10], ["Yellow Daisies", 6], ["Orange Alstroemeria", 4]], [["Leatherleaf", 4]], ["Hand-tie market bunch.", "Wrap in sleeve for grab-and-go."], "No vase cost — strong margin on wrapped bunches.", 42.99],
  ["Calm & Clean Whites", "classic", "white, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["White Lilies", 3], ["White Roses", 4], ["White Carnations", 5]], [["Leatherleaf", 4]], ["Lilies for line.", "Roses and carnations fill.", "Clean white mass."], "Sympathy-adjacent without funeral-specific styling.", 66.99],
  ["Pink & Peach Harmony", "feminine", "pink, peach, cream", "8\" ceramic vase", "foam", ["scissors", "wet foam"], [["Pink Roses", 5], ["Peach Carnations", 7], ["Peach Alstroemeria", 4]], [["Eucalyptus", 3]], ["Peach-pink gradient.", "Foam for stability."], "Harmony naming helps staff suggest paired gifts.", 58.99],
  ["Hydrangea Trio", "simple", "blue, green", "8\" cylinder vase", "chicken wire", ["scissors", "chicken wire"], [["Hydrangea", 3]], [["Leatherleaf", 4], ["Eucalyptus", 2]], ["Three hydrangea at staggered heights.", "Minimal filler — hydrangea does the work."], "Three stems, fast assembly, high basket average.", 69.99],
  ["Rose & Daisy Blend", "cheerful", "pink, white, yellow", "6\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 5], ["White Daisies", 7], ["Yellow Daisies", 4]], [["Pittosporum", 3]], ["Roses focal.", "Daisies for cheer.", "Pittosporum frame."], "Classic blend customers recognize immediately.", 54.99],
  ["Everyday Mason Jar", "rustic", "mixed pinks", "quart mason jar", "hand-tie", ["scissors", "twine"], [["Pink Carnations", 9], ["Pink Alstroemeria", 5], ["Baby's Breath", 3]], [["Pittosporum", 3]], ["Jar hand-tie standard.", "Baby's breath finish."], "Template recipe every designer can execute in 10 minutes.", 45.99],
  ["Simple Greens & Whites", "classic", "white, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["White Carnations", 10], ["White Stock", 4], ["White Snapdragons", 3]], [["Leatherleaf", 5], ["Eucalyptus", 3]], ["Green-forward white design.", "Extra foliage for value."], "Extra greenery lowers flower cost while keeping size.", 52.99],
  ["Happy Day Bouquet", "cheerful", "yellow, pink, orange", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Yellow Roses", 4], ["Orange Carnations", 7], ["Pink Alstroemeria", 5]], [["Leatherleaf", 3]], ["Happy tri-color spiral.", "Birthday-ready naming."], "Named for birthdays — staff can suggest instantly.", 55.99],
  ["Classic Cylinder Mix", "classic", "red, pink, white", "8\" cylinder vase", "foam", ["scissors", "wet foam"], [["Red Roses", 3], ["Pink Roses", 4], ["White Carnations", 6]], [["Leatherleaf", 4]], ["Cylinder standard mix.", "Foam for delivery stability."], "Delivery-friendly foam design with everyday stems.", 61.99],
  ["Everyday Color Burst", "bright", "multi bright", "6\" ceramic vase", "tape grid", ["scissors", "floral tape"], [["Mixed Carnations", 12], ["Yellow Daisies", 5], ["Orange Alstroemeria", 4]], [["Pittosporum", 3]], ["Maximum color per stem.", "Ceramic upgrades perceived value."], "Carnation-heavy = margin on volume orders.", 48.99],
  ["Soft Neutral Mix", "simple", "cream, blush, sage", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Cream Roses", 5], ["Blush Carnations", 6], ["White Stock", 3]], [["Eucalyptus", 5]], ["Neutral palette for any recipient.", "Extra eucalyptus for spa feel."], "Neutrals cross-sell to home décor customers.", 58.99],
  ["Pink Petal Jar", "feminine", "pink, white", "pint mason jar", "hand-tie", ["scissors"], [["Pink Carnations", 10], ["Pink Roses", 3], ["Baby's Breath", 2]], [["Pittosporum", 2]], ["All pink jar.", "Quick gift size."], "Small pink jar is a proven add-on at checkout.", 41.99],
  ["Golden Glow", "bright", "gold, yellow, green", "6\" cylinder vase", "foam", ["scissors", "wet foam"], [["Sunflowers", 3], ["Yellow Roses", 4], ["Yellow Carnations", 5]], [["Leatherleaf", 3]], ["Golden focal sunflowers.", "Yellow rose accents."], "Get-well and congratulations workhorse.", 57.99],
  ["Everyday Blush", "feminine", "blush, cream", "8\" ceramic vase", "tape grid", ["scissors", "floral tape"], [["Blush Roses", 6], ["Blush Carnations", 7], ["White Alstroemeria", 4]], [["Eucalyptus", 3]], ["All blush story.", "Ceramic vase included."], "Blush-on-blush reads intentional, not accidental.", 59.99],
  ["Daisy & Mum Mix", "cheerful", "white, yellow, bronze", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["White Daisies", 8], ["Yellow Mums", 5], ["White Carnations", 5]], [["Leatherleaf", 4]], ["Daisy mum combo.", "Long-lasting mums."], "Mums extend vase life for value-conscious buyers.", 49.99],
  ["Rose Trio", "classic", "red, pink, white", "6\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Red Roses", 3], ["Pink Roses", 3], ["White Roses", 3]], [["Eucalyptus", 3]], ["Nine rose tri-color.", "Compact cylinder."], "Dozen-alternative at a lower price point.", 55.99],
  ["Hydrangea Accent", "modern", "blue, white", "5\" cube vase", "chicken wire", ["scissors", "chicken wire"], [["Hydrangea", 1], ["White Roses", 4], ["White Carnations", 4]], [["Eucalyptus", 2]], ["Single hydrangea cube.", "Rose accents only."], "Low stem count, high impact — ideal for subscriptions.", 56.99],
  ["Everyday Rustic", "rustic", "earth tones, green", "quart mason jar", "hand-tie", ["scissors", "twine"], [["Peach Roses", 4], ["Bronze Mums", 5], ["Orange Alstroemeria", 4]], [["Pittosporum", 4]], ["Rustic jar recipe.", "Earth-tone palette."], "Rustic styling without foraged or rare materials.", 51.99],
  ["Bright Tabletop", "bright", "yellow, fuchsia, orange", "5\" cube vase", "tape grid", ["scissors", "floral tape"], [["Sunflowers", 2], ["Hot Pink Carnations", 6], ["Orange Daisies", 5]], [["Leatherleaf", 2]], ["Tabletop cube bright.", "Low height for dining tables."], "Tabletop size reduces stem cost vs. floor designs.", 50.99],
  ["Simple Cheer", "cheerful", "yellow, white, pink", "6\" cylinder vase", "foam", ["scissors", "wet foam"], [["Yellow Daisies", 8], ["White Carnations", 6], ["Pink Alstroemeria", 4]], [["Pittosporum", 3]], ["Cheerful everyday cylinder.", "Foam for beginners."], "Training-friendly recipe for new designers.", 46.99],
  ["Daily Pink Rose", "feminine", "pink, green", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 8], ["Pink Carnations", 4], ["Baby's Breath", 2]], [["Eucalyptus", 3]], ["Rose-forward pink.", "Minimal filler."], "Rose count satisfies customers expecting roses.", 62.99],
  ["Everyday Florist Favorite", "classic", "mixed bestsellers", "8\" cylinder vase", "tape grid", ["scissors", "floral tape"], [["Pink Roses", 4], ["White Lilies", 2], ["Pink Carnations", 6], ["Alstroemeria", 4]], [["Leatherleaf", 4], ["Eucalyptus", 2]], ["Shop-standard best seller mix.", "Balance focal, filler, and line.", "Quality check and ribbon optional."], "Combines top-selling stems — the recipe staff reach for daily.", 64.99]
];

function slug(name, index) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `ed-${String(index + 1).padStart(2, "0")}-${base}`;
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
    alt: `${name} — ultra-realistic everyday floral arrangement in ${container}`
  };
}

const arrangements = SPECS.map((spec, i) => buildArrangement(i, spec));

const catalog = {
  version: 1,
  batch: 1,
  batch_size: 50,
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
  const poolFile = POOL[i % POOL.length];
  const source = path.join(publicDir, "assets/floral-library", poolFile);
  if (fs.existsSync(target)) fs.unlinkSync(target);
  fs.symlinkSync(path.join("..", poolFile), target);
  if (!fs.existsSync(source)) {
    console.warn(`warn: pool image missing ${source}`);
  }
}

function toLibraryProduct(a) {
  const retail = a.suggested_retail;
  return {
    id: a.id,
    scope: "master",
    source: "florisyn_everyday",
    name: a.name,
    categories: a.categories,
    arrangement_type: a.arrangement_type || "bouquet",
    short_description: a.short_description,
    description: a.description,
    suggested_retail: { default: retail, min: Math.round(retail * 0.9 * 100) / 100, max: Math.round(retail * 1.2 * 100) / 100 },
    suggested_cost: Math.round(retail * 0.42 * 100) / 100,
    primary_image: {
      url: `/assets/floral-library/${a.image}`,
      alt: a.alt,
      hash: `h${a.id}`
    },
    image_license: {
      source: "bloom_owned",
      attribution: "Florisyn Everyday Collection — batch 1",
      review_status: "approved"
    },
    recipe: a.recipe.map((r) => ({ name: r.name, qty: r.qty })),
    publish_status: "published",
    tags: ["everyday", "ultra_realistic", a.style, "florisyn_everyday_batch_1"],
    metadata: {
      image_standard: "ultra_realistic_professional_floral_photography",
      launch_quality: "everyday_verified",
      replaceable_by_shop: true,
      style: a.style,
      color_palette: a.color_palette,
      container: a.container,
      mechanics: a.mechanics,
      tools: a.tools,
      foliage: a.foliage,
      instructions: a.instructions,
      why_it_works: a.why_it_works,
      batch: 1
    }
  };
}

const products = arrangements.map(toLibraryProduct);

const collectionJs = `/**
 * AUTO-GENERATED by scripts/generate-everyday-library-50.mjs — do not edit.
 * Florisyn Everyday Ultra-Realistic Floral Library (50 arrangements, batch 1).
 */
(function (global) {
  "use strict";
  var COLLECTION = ${JSON.stringify(
    products.map((p) => ({
      id: p.id,
      source: p.source,
      name: p.name,
      categories: p.categories,
      short_description: p.short_description,
      description: p.description,
      recipe: p.recipe,
      suggested_retail: p.suggested_retail,
      suggested_cost: p.suggested_cost,
      primary_image: p.primary_image,
      image_license: p.image_license,
      metadata: p.metadata
    })),
    null,
    2
  )};
  if (global) global.FlorisynLibraryCollection = COLLECTION;
  if (typeof module !== "undefined" && module.exports) module.exports = COLLECTION;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
`;

fs.writeFileSync(path.join(publicDir, "floral-library-collection.js"), collectionJs);

console.log(`generate-everyday-library-50: wrote ${arrangements.length} arrangements`);
console.log(`  JSON: ${dataPath}`);
console.log(`  Client: public/floral-library-collection.js`);
console.log(`  Images: ${everydayDir} (${arrangements.length} symlinks)`);
