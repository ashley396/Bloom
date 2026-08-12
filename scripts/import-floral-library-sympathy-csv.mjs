#!/usr/bin/env node
/**
 * Import Sympathy Floral Library batch from CSV source of truth.
 * Output: public/data/floral-library-sympathy-10.json
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { FLORAL_LIBRARY_CSV_COLUMNS } from "../lib/floral-library/csv-standard.js";

const root = process.cwd();
const csvPath = path.join(root, "public/data/floral-library-sympathy-source.csv");
const outPath = path.join(root, "public/data/floral-library-sympathy-10.json");
const placeholderRel = "sympathy/approved-vase-placeholder.jpg";
const placeholderAbs = path.join(root, "public/assets/floral-library", placeholderRel);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (field.length || row.length) {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
      continue;
    }
    field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseRecipe(text) {
  return String(text || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(\d+)\s+(.+)$/);
      if (!m) throw new Error(`Invalid recipe segment: ${part}`);
      return { name: m[2].trim(), qty: Number(m[1]), kind: /eucalyptus|ruscus|salal|pittosporum|leatherleaf|bear grass|foliage/i.test(m[2]) ? "foliage" : "flower" };
    });
}

function slugFromSku(sku) {
  return String(sku).toLowerCase().replace(/^sym-/, "sym-").replace(/_/g, "-");
}

function buildArrangement(row, headers, index) {
  const data = Object.fromEntries(headers.map((h, i) => [h, row[i]]));
  for (const col of FLORAL_LIBRARY_CSV_COLUMNS) {
    if (data[col] == null || data[col] === "") throw new Error(`Row ${index + 1} missing ${col}`);
  }
  const recipe = parseRecipe(data["Flowers / recipe"]);
  const foliage = recipe.filter((r) => r.kind === "foliage").map(({ name, qty }) => ({ name, qty }));
  const sku = data.SKU;
  const id = slugFromSku(sku);
  const retail = Number(data.Price);
  const short = `Sympathy ${data.Style} design in ${data.Vase} — ${data.Palette}.`;
  const recipeText = recipe.map((r) => `${r.qty} ${r.name}`).join(", ");
  const description = `${short} Style: ${data.Style}. Palette: ${data.Palette}. Vase: ${data.Vase}. Recipe: ${recipeText}. ${data["Visual Notes"]}`;
  return {
    id,
    sku,
    name: data.Name,
    style: data.Style,
    color_palette: data.Palette,
    categories: [data.Category],
    occasion: data.Occasion,
    arrangement_type: "vase_arrangement",
    container: data.Vase,
    mechanics: "tape grid",
    tools: ["scissors", "floral tape", data.Vase.includes("jar") ? "twine" : "vase"],
    recipe,
    foliage,
    instructions: [
      "Condition stems in clean water with preservative.",
      `Prepare ${data.Vase} with mechanics and fresh water.`,
      "Build sympathy focal height, then fill with supporting blooms.",
      "Frame with foliage; check water level and finish vase.",
    ],
    why_it_works: data["Visual Notes"],
    visual_notes: data["Visual Notes"],
    image_prompt: data["Image Prompt"],
    short_description: short,
    description,
    suggested_retail: retail,
    image: placeholderRel,
    alt: `${data.Name} sympathy vase arrangement — approved placeholder pending final photography`,
    image_license: {
      source: "bloom_owned",
      attribution: "Florisyn Sympathy Collection — approved placeholder",
      review_status: "approved_placeholder",
    },
    needs_image_replacement: true,
    approved_placeholder: true,
    vase_arrangement_verified: true,
    image_verified: true,
    image_subject: "approved_placeholder",
    batch: "sympathy",
    stem_count: Number(data["Stem Count"]),
  };
}

function ensurePlaceholder() {
  fs.mkdirSync(path.dirname(placeholderAbs), { recursive: true });
  if (fs.existsSync(placeholderAbs)) return;
  const minimalJpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=",
    "base64"
  );
  fs.writeFileSync(placeholderAbs, minimalJpeg);
}

function main() {
  ensurePlaceholder();
  const contentHash = crypto.createHash("sha256").update(fs.readFileSync(placeholderAbs)).digest("hex");
  const parsed = parseCsv(fs.readFileSync(csvPath, "utf8").trim());
  const [headers, ...body] = parsed;
  if (headers.join(",") !== FLORAL_LIBRARY_CSV_COLUMNS.join(",")) {
    throw new Error("Sympathy CSV headers must match FLORAL_LIBRARY_CSV_COLUMNS");
  }
  const arrangements = body.map((row, i) => {
    const a = buildArrangement(row, headers, i);
    a.content_sha256 = contentHash;
    if (!a.sku.startsWith("SYM-")) throw new Error(`${a.sku} must begin with SYM-`);
    if (!a.categories.includes("Sympathy")) throw new Error(`${a.id} must be Sympathy category`);
    return a;
  });
  if (arrangements.length !== 10) throw new Error(`Expected 10 Sympathy items, got ${arrangements.length}`);
  const out = {
    version: 1,
    batch: "sympathy",
    batch_size: 10,
    collection: "Florisyn Sympathy Vase Collection",
    generated_at: new Date().toISOString(),
    source_csv: "floral-library-sympathy-source.csv",
    arrangements,
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify({ items: arrangements.length, out: path.basename(outPath) }));
}

main();
