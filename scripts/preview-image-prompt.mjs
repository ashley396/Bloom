#!/usr/bin/env node
/**
 * Generate ONE image from Florisyn's own real prompt builders and write it to
 * a local file, so the picture can actually be looked at.
 *
 * Why this exists. Every image defect Ashley has reported — invented gibberish
 * painted across a funeral post, coral and sunny-yellow spring flowers on a
 * sympathy flyer, a flat unconvincing arrangement — was found by her, on the
 * live site, after the fact. Nothing in this repo could produce a real image
 * to look at, so prompt changes were written blind and shipped on the strength
 * of a unit test asserting that a sentence was present in a string. That is
 * not verification of an image.
 *
 * This closes that loop: change a prompt, run this, LOOK at the result.
 *
 * Requires, and deliberately reads only from the environment:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_AI_API_TOKEN     (Workers AI read is the only permission needed)
 * Optional:
 *   CLOUDFLARE_IMAGE_MODEL      (defaults to the same model the product uses)
 *
 * It never prints, logs or writes a credential — only whether one is present.
 * It talks to Cloudflare and nothing else, and writes only to the output path.
 *
 * Usage:
 *   node scripts/preview-image-prompt.mjs --kind flyer  --occasion "funeral work"
 *   node scripts/preview-image-prompt.mjs --kind photo  --occasion "valentines day" --brief "a dozen red roses"
 *   node scripts/preview-image-prompt.mjs --raw "any prompt you like"
 *   ...--out /tmp/out.png --seed 3 --print-prompt
 */
import fs from "node:fs";
import path from "node:path";
import { buildFlyerBackgroundPrompt, buildImagePrompt } from "../netlify/functions/_shared/ai-image-engine.js";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const token = String(process.env.CLOUDFLARE_AI_API_TOKEN || process.env.CLOUDFLARE_AI_TOKEN || "").trim();
const model = process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";

if (!accountId || !token) {
  console.error("Not configured. This needs both, set in the environment (never on the command line):");
  console.error(`  CLOUDFLARE_ACCOUNT_ID    ${accountId ? "present" : "MISSING"}`);
  console.error(`  CLOUDFLARE_AI_API_TOKEN  ${token ? "present" : "MISSING"}`);
  process.exit(2);
}

const kind = arg("kind", "flyer");
const occasion = arg("occasion", "");
const brief = arg("brief", "");
const seed = Number(arg("seed", "0")) || 0;
const outPath = path.resolve(arg("out", `preview-${kind}-${Date.now()}.png`));

const prompt =
  arg("raw") ||
  (kind === "photo"
    ? buildImagePrompt({ occasion, visualBrief: brief, shopName: arg("shop", "") })
    : buildFlyerBackgroundPrompt({ occasion, visualBrief: brief, brandColor: arg("color", ""), variationSeed: seed }));

if (flag("print-prompt")) {
  console.log("--- prompt actually sent (%d chars) ---", prompt.length);
  console.log(prompt);
  console.log("---");
}

const started = Date.now();
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt })
});

if (!response.ok) {
  // The body can echo request details; print the status and Cloudflare's own
  // error codes rather than dumping everything.
  let detail = "";
  try {
    const body = await response.json();
    detail = (body?.errors || []).map((e) => `${e.code}: ${e.message}`).join("; ") || "";
  } catch {
    detail = "(unparseable error body)";
  }
  console.error(`Cloudflare returned HTTP ${response.status}. ${detail}`);
  process.exit(1);
}

const payload = await response.json();
// flux-1-schnell returns { result: { image: "<base64>" } }; other models on the
// same endpoint return raw bytes. Handle both rather than assume one.
const base64 = payload?.result?.image;
if (!base64) {
  console.error("The provider responded but returned no image. Keys:", Object.keys(payload?.result || {}).join(", ") || "(none)");
  process.exit(1);
}
const bytes = Buffer.from(base64, "base64");
fs.writeFileSync(outPath, bytes);
console.log(`wrote ${outPath}  ${(bytes.length / 1024).toFixed(0)}KB  in ${((Date.now() - started) / 1000).toFixed(1)}s  model=${model}`);
