#!/usr/bin/env node
/** Local launch readiness — file + pricing + test smoke (no Stripe/Netlify secrets required). */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PRICING_TIERS } from "../lib/pricing/florisyn-pricing.js";
import { economicsScenario } from "../lib/platform/platform-economics.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let failed = 0;

function ok(label) {
  console.log(`✓ ${label}`);
}

function fail(label, detail = "") {
  failed += 1;
  console.error(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

function mustExist(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    fail(`Missing ${rel}`);
    return false;
  }
  ok(`Found ${rel}`);
  return true;
}

console.log("Florisyn launch readiness (local)\n");

[
  "public/company/pricing/index.html",
  "public/company/case-studies/index.html",
  "public/company/compare/index.html",
  "public/signup.html",
  "public/florist-migration-wizard.js",
  "public/referral-hub.js",
  "lib/platform/platform-economics.js",
  "PUBLIC_LAUNCH_GUIDE.md",
  "OWNER_NEXT_STEPS.md",
  "netlify/functions/create-subscription-checkout.js",
  "netlify/functions/stripe-subscription-webhook.js",
  "netlify/functions/referral-program.js",
  "netlify/functions/florist-migration.js"
].forEach(mustExist);

const prices = PRICING_TIERS.map((t) => t.monthly).sort((a, b) => a - b);
if (prices.join(",") === "59,99,149") {
  ok("Pricing tiers 59 / 99 / 149");
} else {
  fail("Pricing tiers", `got ${prices.join(", ")}`);
}

const e500 = economicsScenario(500);
if (e500.mrr_usd > 40000 && e500.estimated_burn_usd < 2000) {
  ok(`500-subscriber model: MRR $${e500.mrr_usd}, burn ~$${e500.estimated_burn_usd}/mo`);
} else {
  fail("500-subscriber economics model");
}

const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
for (const key of [
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_PROFESSIONAL",
  "STRIPE_PRICE_PREMIUM",
  "STRIPE_PRICE_STARTER_ANNUAL",
  "STRIPE_PRICE_PROFESSIONAL_ANNUAL",
  "STRIPE_PRICE_PREMIUM_ANNUAL"
]) {
  if (envExample.includes(key)) ok(`Documented ${key}`);
  else fail(`Missing ${key} in .env.example`);
}

console.log("\nRunning focused tests…");
const test = spawnSync(
  process.execPath,
  [
    "--test",
    "tests/florisyn-pricing.test.js",
    "tests/platform-economics.test.js",
    "tests/florisyn-growth-features.test.js",
    "tests/shop-billing.test.js"
  ],
  { cwd: root, stdio: "inherit" }
);
if (test.status !== 0) {
  fail("Focused test suite");
  process.exit(1);
}

console.log("\n---");
if (failed) {
  console.error(`${failed} local check(s) failed.`);
  process.exit(1);
}
console.log("Local launch readiness OK.");
console.log("\nNext (manual): merge PR #56 → Stripe prices → Netlify env → pilot florist.");
console.log("See OWNER_NEXT_STEPS.md and PUBLIC_LAUNCH_GUIDE.md");
