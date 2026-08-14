#!/usr/bin/env node
/**
 * Regenerate the POS quick-sale tile photos using Cloudflare Workers AI
 * (flux-1-schnell). The original batch (public/assets/*.png) had garbled
 * hallucinated text baked into several images — this regenerates all of
 * them with an explicit "no text" negative constraint and saves them as
 * .jpg (flux returns JPEG bytes; renaming from .png to .jpg avoids
 * shipping mislabeled file content).
 *
 * Requires env (read from process.env or a local .env):
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_AI_API_TOKEN
 * Optional:
 *   CLOUDFLARE_IMAGE_MODEL   (default: @cf/black-forest-labs/flux-1-schnell)
 *
 * Usage:
 *   node scripts/generate-pos-tile-images.mjs               # all tiles
 *   node scripts/generate-pos-tile-images.mjs --ids fresh,basket
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const assetsDir = path.join(root, "public/assets");

function loadDotEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (process.env[key]) continue;
    process.env[key] = rawVal.replace(/^["']|["']$/g, "");
  }
}
loadDotEnv();

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_AI_API_TOKEN;
const MODEL = process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_API_TOKEN.");
  process.exit(1);
}

const args = process.argv.slice(2);
const idsArg = args.includes("--ids") ? args[args.indexOf("--ids") + 1] : null;
const ONLY_IDS = idsArg ? new Set(idsArg.split(",").map((s) => s.trim())) : null;

// id -> { file, prompt subject }
const TILES = [
  { id: "fresh", file: "fresh.jpg", subject: "a fresh mixed cut-flower arrangement in a clear glass vase" },
  { id: "basket", file: "basket.jpg", subject: "a mixed flower arrangement in a woven wicker basket" },
  { id: "rose-arr", file: "rose-arr.jpg", subject: "a dozen red and pink roses arranged in a clear glass vase" },
  { id: "tulips", file: "tulips.jpg", subject: "a loose hand-tied bunch of pink tulips, unwrapped, standing in a glass vase" },
  { id: "chocolates", file: "chocolates.jpg", subject: "an open box of gourmet chocolate truffles tied with a ribbon" },
  { id: "corsage", file: "corsage.jpg", subject: "a delicate wrist corsage of small white roses with greenery" },
  { id: "boutonniere", file: "boutonniere.jpg", subject: "a single rose boutonniere with greenery, pinned with a ribbon" },
  { id: "sympathy", file: "sympathy.jpg", subject: "an elegant white lily and white rose sympathy arrangement in a vase" },
  { id: "spray", file: "spray.jpg", subject: "a standing sympathy funeral spray of white and pink flowers on an easel" },
  { id: "basket2", file: "basket2.jpg", subject: "a sympathy basket arrangement of white lilies and greenery" },
  { id: "plant", file: "plant.jpg", subject: "a blooming pink potted plant in a ceramic pot" },
  { id: "orchid", file: "orchid.jpg", subject: "a potted purple phalaenopsis orchid plant in a ceramic pot" },
  { id: "green", file: "green.jpg", subject: "a lush green potted foliage plant in a ceramic pot" },
  { id: "dish", file: "dish.jpg", subject: "a dish garden of small succulents and green plants in a shallow ceramic dish" }
];

function buildPrompt(subject) {
  return [
    `Professional e-commerce product photograph of ${subject}.`,
    "Centered in frame, soft neutral studio background, soft even studio lighting,",
    "ultra-realistic, photorealistic, sharp focus, high detail, florist shop quality.",
    "No text, no words, no letters, no writing, no watermark, no logo, no caption,",
    "no signature, no people, no hands."
  ].join(" ");
}

async function generateImage(prompt) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, steps: 8 })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Cloudflare HTTP ${res.status}: ${text.slice(0, 200)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!json.success || !json.result?.image) {
    throw new Error(`No image in response: ${JSON.stringify(json.errors || json).slice(0, 200)}`);
  }
  const buf = Buffer.from(json.result.image, "base64");
  if (buf.length < 2000) throw new Error("Suspiciously small image buffer");
  return buf;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let done = 0;
  let failed = 0;
  for (const tile of TILES) {
    if (ONLY_IDS && !ONLY_IDS.has(tile.id)) continue;
    const prompt = buildPrompt(tile.subject);
    const target = path.join(assetsDir, tile.file);
    try {
      process.stdout.write(`generating ${tile.id} -> ${tile.file} … `);
      const buf = await generateImage(prompt);
      fs.writeFileSync(target, buf);
      done += 1;
      console.log(`ok (${buf.length} bytes)`);
      await sleep(400);
    } catch (err) {
      failed += 1;
      console.log(`FAILED: ${err.message}`);
    }
  }
  console.log(`\ngenerate-pos-tile-images: ${done} generated, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
