import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  FLORIST_PERSONAS,
  normalizePersona,
  systemPromptFor,
  temperatureForPersona,
  localPersonaResponse
} from "../netlify/functions/_shared/florist-ai-personas.js";

test("normalizePersona accepts Lily, Rose, and Daisy", () => {
  assert.equal(normalizePersona("lily"), "Lily");
  assert.equal(normalizePersona("ROSE"), "Rose");
  assert.equal(normalizePersona("Daisy"), "Daisy");
  assert.equal(normalizePersona(""), "Lily");
  assert.equal(normalizePersona("unknown"), "Lily");
});

test("systemPromptFor forbids generic placeholder stems for Lily", () => {
  const prompt = systemPromptFor("Lily", "generate");
  assert.match(prompt, /seasonal focal flower/i);
  assert.match(prompt, /Freedom rose|spray rose/i);
});

test("systemPromptFor includes business guidance for Rose", () => {
  const prompt = systemPromptFor("Rose", "chat");
  assert.match(prompt, /pricing|margin/i);
  assert.match(prompt, /non-repetitive/i);
});

test("temperatureForPersona varies by persona and mode", () => {
  assert.ok(temperatureForPersona("Lily", "generate") > 0);
  assert.ok(temperatureForPersona("Daisy", "chat") >= temperatureForPersona("Rose", "chat"));
  assert.equal(FLORIST_PERSONAS.length, 3);
});

test("local persona fallback is useful and preserves each voice", () => {
  const context = { inventory: [{ name: "Rose" }], recent_orders: [{ id: 1 }, { id: 2 }] };
  const lily = localPersonaResponse("Lily", "Help with inventory", context);
  const rose = localPersonaResponse("Rose", "How do I improve margin?", context);
  const daisy = localPersonaResponse("Daisy", "I feel overwhelmed", context);

  assert.match(lily, /low-stock|reorder/i);
  assert.match(lily, /1 inventory item/i);
  assert.match(rose, /labor costs|target cost percentage/i);
  assert.match(daisy, /Tiny bouquet|three-item list/i);
  assert.notEqual(lily, rose);
  assert.notEqual(rose, daisy);
});

test("local fallback gives topic-specific replies instead of one repeated answer", () => {
  const inventory = localPersonaResponse("Lily", "What should I reorder?", {});
  const deliveries = localPersonaResponse("Lily", "Help with today's deliveries", {});
  const marketing = localPersonaResponse("Lily", "Write an Instagram post", {});
  assert.notEqual(inventory, deliveries);
  assert.notEqual(deliveries, marketing);
  assert.match(deliveries, /due times|delivery notes/i);
  assert.match(marketing, /occasion|featured arrangement/i);
});

test("local AI bridge imports shared persona module", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "local-ai-bridge/server.js"), "utf8");
  assert.match(src, /florist-ai-personas\.js/);
  assert.match(src, /systemPromptFor/);
  assert.match(src, /normalizePersona/);
});
