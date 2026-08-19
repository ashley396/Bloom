/**
 * Curated local floral photography pool + content-aware picker for everyday library.
 * Netlify does not deploy symlinked JPGs reliably — materialize copies instead.
 */
import fs from "node:fs";
import path from "node:path";

export const IMAGE_POOL = [
  "florisyn-everyday-sunny-bouquet.jpg",
  "florisyn-everyday-spring-pastels.jpg",
  "garden-harmony.jpg",
  "florisyn-everyday-rose-pitcher.jpg",
  "florisyn-everyday-garden-medley.jpg",
  "florisyn-everyday-market-wildflowers.jpg",
  "florisyn-everyday-daisies-tulips.jpg",
  "florisyn-arrangement-signature-blush.jpg",
  "pink-bouquet.jpg",
  "atelier-bouquet-hero.jpg"
];

/** Pick the best-matching pool photo for stem/style keywords (falls back to index rotation). */
export function pickPoolImage(arrangement, index = 0) {
  const text = [
    arrangement.name,
    arrangement.style,
    arrangement.color_palette,
    ...(arrangement.categories || []),
    ...(arrangement.recipe || []).map((r) => r.name)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const rules = [
    [/sunflower|sunshine|golden glow|bright & happy|bright table|daily sun|citrus|golden glow/, "florisyn-everyday-sunny-bouquet.jpg"],
    [/daisy|mum mix|cheerful daisy|simple cheer|daisy burst/, "florisyn-everyday-daisies-tulips.jpg"],
    [/hydrangea|blue, white|blue and white|blue, pink/, "garden-harmony.jpg"],
    [/sympathy|funeral|calm.*white|simple white|modern white|simple whites/, "garden-harmony.jpg"],
    [/rustic|mason|jar|market bunch|wildflower|everyday rustic/, "florisyn-everyday-market-wildflowers.jpg"],
    [/rose pitcher|romance|rose trio|daily pink rose|classic rose mix/, "florisyn-everyday-rose-pitcher.jpg"],
    [/pastel|lavender|blush|peach|pink meadow|soft blush|feminine|pink petal/, "florisyn-everyday-spring-pastels.jpg"],
    [/garden|medley|harvest|garden vase/, "florisyn-everyday-garden-medley.jpg"],
    [/luxury|elegance|lily|ceramic/, "florisyn-arrangement-signature-blush.jpg"],
    [/pink|peach|blush/, "pink-bouquet.jpg"]
  ];

  for (const [pattern, file] of rules) {
    if (pattern.test(text) && IMAGE_POOL.includes(file)) return file;
  }
  return IMAGE_POOL[index % IMAGE_POOL.length];
}

export function materializeEverydayImage(publicDir, arrangement, index) {
  const poolFile = pickPoolImage(arrangement, index);
  const libraryDir = path.join(publicDir, "assets/floral-library");
  let source = path.join(libraryDir, poolFile);
  if (!fs.existsSync(source) && poolFile === "pink-bouquet.jpg") {
    source = path.join(publicDir, "assets/pink-bouquet.jpg");
  }
  if (!fs.existsSync(source) && poolFile === "atelier-bouquet-hero.jpg") {
    source = path.join(publicDir, "assets/atelier-bouquet-hero.jpg");
  }
  const target = path.join(publicDir, "assets/floral-library/everyday", `${arrangement.id}.jpg`);
  if (!fs.existsSync(source)) {
    throw new Error(`Pool image missing: ${source}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) fs.unlinkSync(target);
  fs.copyFileSync(source, target);
  return poolFile;
}

export function isRegularJpegFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  const head = fs.readFileSync(filePath).subarray(0, 3);
  return head[0] === 0xff && head[1] === 0xd8;
}
