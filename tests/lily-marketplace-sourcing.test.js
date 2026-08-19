import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  detectFlowerMentions,
  isMarketplaceSourcingMessage,
  searchMarketplaceForLily,
  buildMarketplaceSourcingAnswer
} from "../netlify/functions/_shared/marketplace-lily-sourcing.js";
import { detectIntent } from "../netlify/functions/_shared/lily-ai-engine.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

const root = process.cwd();

test("detectFlowerMentions only reports real, deduplicated flower names from the shared lexicon", () => {
  assert.deepEqual(detectFlowerMentions("find me 100 white roses for Friday"), ["Freedom rose"]);
  assert.deepEqual(detectFlowerMentions("roses and more roses"), ["Freedom rose"]);
  assert.deepEqual(detectFlowerMentions("who has Quicksand roses and hydrangeas"), ["Freedom rose", "Hydrangea"]);
  assert.deepEqual(detectFlowerMentions("John Smith called about his invoice"), []);
});

test("isMarketplaceSourcingMessage requires BOTH real sourcing language AND a real flower name", () => {
  assert.equal(isMarketplaceSourcingMessage("find me 100 white roses for Friday"), true);
  assert.equal(isMarketplaceSourcingMessage("who has Quicksand roses this week?"), true);
  assert.equal(isMarketplaceSourcingMessage("find the least expensive option for 200 pink roses"), true);
  // Sourcing verb, no real flower — must not fire.
  assert.equal(isMarketplaceSourcingMessage("find John Smith"), false);
  // Flower mentioned, no sourcing verb — must not fire (e.g. small talk).
  assert.equal(isMarketplaceSourcingMessage("roses are my favorite flower"), false);
});

test("detectIntent routes a real flower-sourcing question to marketplace.search, not customers.find, even though it starts with 'find'", () => {
  const intent = detectIntent("Find me 100 white roses for Friday.");
  assert.equal(intent.intent, "marketplace.search");
  assert.deepEqual(intent.slots.flowers, ["Freedom rose"]);
});

test("detectIntent still routes a genuine customer search correctly — the marketplace check doesn't swallow it", () => {
  assert.equal(detectIntent("Find John Smith.").intent, "customers.find");
});

test("searchMarketplaceForLily only returns real, currently-available listings, matched, sorted cheapest-first", async () => {
  const client = createFakeSupabaseClient([
    {
      data: [
        { id: "l1", shop_id: "s1", supplier_name: "Bloom Wholesale", product_name: "Freedom Rose", price: 3, unit: "stem", active: true, archived_at: null, publish_status: "published", allows_local_pickup: true, allows_shipping: true },
        { id: "l2", shop_id: "s2", supplier_name: "Garden Co", product_name: "Freedom Rose", price: 2, unit: "stem", active: true, archived_at: null, publish_status: "published", allows_local_pickup: false, allows_shipping: true },
        { id: "l3", shop_id: "s3", supplier_name: "Sold Out Supply", product_name: "Freedom Rose", price: 1, unit: "stem", active: true, archived_at: null, publish_status: "published", availability_status: "sold_out" },
        { id: "l4", shop_id: "s4", supplier_name: "Unrelated Co", product_name: "Tulip", price: 1, unit: "stem", active: true, archived_at: null, publish_status: "published" },
      ],
      error: null
    }
  ]);
  const matches = await searchMarketplaceForLily(client, ["Freedom rose"]);
  assert.deepEqual(matches.map((m) => m.supplier_name), ["Garden Co", "Bloom Wholesale"]);
  assert.equal(matches.some((m) => m.supplier_name === "Sold Out Supply"), false, "a sold-out listing must never be recommended");
  assert.equal(matches.some((m) => m.supplier_name === "Unrelated Co"), false, "a non-matching flower must never appear");
});

test("buildMarketplaceSourcingAnswer is honest when nothing real was found — never invents a supplier", () => {
  const text = buildMarketplaceSourcingAnswer([], ["Freedom rose"]);
  assert.match(text, /don't see any listings/i);
  assert.doesNotMatch(text, /\$\d/);
});

test("buildMarketplaceSourcingAnswer states only real prices/sellers/units actually passed in", () => {
  const text = buildMarketplaceSourcingAnswer(
    [{ supplier_name: "Garden Co", product_name: "Freedom Rose", price: 2, unit: "stem", pickup: false, shipping: true }],
    ["Freedom rose"]
  );
  assert.match(text, /Garden Co/);
  assert.match(text, /\$2\.00\/stem/);
});

test("lily-ai.js routes marketplace.search through the real deterministic search path, never the freeform LLM chat, when a real flower was detected", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/lily-ai.js"), "utf8");
  assert.match(src, /intent\.intent === "marketplace\.search" && permission\.allowed && intent\.slots\.flowers\?\.length/);
  assert.match(src, /searchMarketplaceForLily\(client, intent\.slots\.flowers\)/);
  assert.match(src, /planned\.message = buildMarketplaceSourcingAnswer/);
});
