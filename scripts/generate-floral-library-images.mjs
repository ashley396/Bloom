#!/usr/bin/env node
/**
 * Generate realistic, white-background product photos for every everyday
 * Floral Library arrangement using Cloudflare Workers AI (flux-1-schnell).
 *
 * One image per arrangement, saved to public/assets/floral-library/everyday/<id>.jpg,
 * with the JSON `image`, `content_sha256`, and `image_license` fields updated to match.
 * This also repairs the historical id/image mismatch (every image now matches its id).
 *
 * Requires env (read from process.env or a local .env):
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_AI_API_TOKEN
 * Optional:
 *   CLOUDFLARE_IMAGE_MODEL   (default: @cf/black-forest-labs/flux-1-schnell)
 *
 * Usage:
 *   node scripts/generate-floral-library-images.mjs --limit 5     # sample first 5 (review these!)
 *   node scripts/generate-floral-library-images.mjs               # all missing images
 *   node scripts/generate-floral-library-images.mjs --force       # regenerate everything
 *   node scripts/generate-floral-library-images.mjs --ids ed-01-sunshine-cube,ed-07-...
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const publicDir = path.join(root, "public");
const everydayDir = path.join(publicDir, "assets/floral-library/everyday");
const batchFiles = [
  path.join(publicDir, "data/floral-library-everyday-50.json"),
  path.join(publicDir, "data/floral-library-everyday-batch-2.json")
];

// ── Minimal .env loader (no dependency) ──────────────────────────────────────
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
  console.error(
    "Missing Cloudflare credentials. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_API_TOKEN " +
      "in your environment or .env before running."
  );
  process.exit(1);
}

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const FORCE = args.includes("--force");
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : Infinity;
const ONLY_IDS = argValue("--ids") ? new Set(argValue("--ids").split(",").map((s) => s.trim())) : null;

// ── Prompt builder from arrangement data ─────────────────────────────────────
function buildPrompt(a) {
  const flowers = (a.recipe || [])
    .filter((r) => r.kind === "flower")
    .map((r) => r.name)
    .join(", ");
  const foliage = (a.foliage || [])
    .map((f) => (typeof f === "string" ? f : f.name))
    .filter(Boolean)
    .join(", ");
  const parts = [
    `Professional e-commerce product photograph of a fresh florist flower arrangement titled "${a.name}".`,
    `${a.arrangement_type || "arrangement"} in a ${a.container || "vase"}.`,
    flowers ? `Featured flowers: ${flowers}.` : "",
    foliage ? `Greenery: ${foliage}.` : "",
    a.color_palette ? `Color palette: ${a.color_palette}.` : "",
    a.style ? `Style: ${a.style}.` : "",
    "Single arrangement centered in frame, pure white seamless studio background,",
    "soft even studio lighting, ultra-realistic, photorealistic, sharp focus, high detail,",
    "florist shop quality, no text, no watermark, no logo, no people, no hands."
  ];
  return parts.filter(Boolean).join(" ");
}

// ── Cloudflare flux call ─────────────────────────────────────────────────────
async function generateImage(prompt) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json"
    },
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
  // flux-1-schnell returns a base64-encoded JPEG string.
  const buf = Buffer.from(json.result.image, "base64");
  if (buf.length < 2000) throw new Error("Suspiciously small image buffer");
  return buf;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(everydayDir, { recursive: true });
  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of batchFiles) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    let mutated = false;

    for (const a of data.arrangements || []) {
      if (done >= LIMIT) break;
      if (ONLY_IDS && !ONLY_IDS.has(a.id)) continue;

      const target = path.join(everydayDir, `${a.id}.jpg`);
      const alreadyCorrect = a.image === `everyday/${a.id}.jpg` &&
        a.image_license?.source === "ai_generated_cloudflare_flux";
      if (!FORCE && alreadyCorrect && fs.existsSync(target)) {
        skipped += 1;
        continue;
      }

      const prompt = buildPrompt(a);
      try {
        process.stdout.write(`generating ${a.id} … `);
        const buf = await generateImage(prompt);
        fs.writeFileSync(target, buf);
        a.image = `everyday/${a.id}.jpg`;
        a.content_sha256 = sha256(buf);
        a.needs_image_replacement = false;
        a.image_license = {
          source: "ai_generated_cloudflare_flux",
          model: MODEL,
          attribution: "AI-generated for Florisyn (Cloudflare Workers AI)",
          review_status: "needs_review"
        };
        mutated = true;
        done += 1;
        console.log(`ok (${buf.length} bytes)`);
        await sleep(400); // be gentle with the API
      } catch (err) {
        failed += 1;
        console.log(`FAILED: ${err.message}`);
      }
    }

    if (mutated) {
      data.generated_at = new Date().toISOString();
      data.image_source = "ai_generated_cloudflare_flux";
      fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
      console.log(`updated ${path.basename(file)}`);
    }
    if (done >= LIMIT) break;
  }

  console.log(`\ngenerate-floral-library-images: ${done} generated, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
