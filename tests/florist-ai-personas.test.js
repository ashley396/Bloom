import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  FLORIST_PERSONAS,
  normalizePersona,
  shopVoiceSuffix,
  systemPromptFor,
  temperatureForPersona,
  domainOwner,
  suggestHandoff,
  jobDomainOwner
} from "../netlify/functions/_shared/florist-ai-personas.js";

test("normalizePersona accepts Lily, Rose, Daisy, and Bud", () => {
  assert.equal(normalizePersona("lily"), "Lily");
  assert.equal(normalizePersona("ROSE"), "Rose");
  assert.equal(normalizePersona("Daisy"), "Daisy");
  assert.equal(normalizePersona("bud"), "Bud");
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
  assert.equal(FLORIST_PERSONAS.length, 4);
});

test("Bud is Florisyn's problem-solving persona — plain language, no false claims of an already-shipped fix", () => {
  const prompt = systemPromptFor("Bud", "chat");
  assert.match(prompt, /problem solver/i);
  assert.match(prompt, /I gotcha/);
  assert.match(prompt, /don't ever say it's already fixed/i);
  assert.ok(temperatureForPersona("Bud", "chat") > 0);
});

test("local AI bridge imports shared persona module", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "local-ai-bridge/server.js"), "utf8");
  assert.match(src, /florist-ai-personas\.js/);
  assert.match(src, /systemPromptFor/);
  assert.match(src, /normalizePersona/);
});

test("shopVoiceSuffix: no profile row produces no instruction (default experience unchanged)", () => {
  assert.equal(shopVoiceSuffix(null), "");
  assert.equal(shopVoiceSuffix(undefined), "");
});

test("shopVoiceSuffix: a blank/never-customized profile produces no instruction", () => {
  assert.equal(shopVoiceSuffix({ shop_tone: "", delivery_notes: null, marketing_notes: undefined }), "");
});

test("shopVoiceSuffix: real onboarding answers become explicit instructions, not silently dropped", () => {
  const suffix = shopVoiceSuffix({
    shop_tone: "bright, upbeat, modern",
    delivery_notes: "No deliveries after 3pm on Saturdays.",
    marketing_notes: "Keep it playful, avoid formal language."
  });
  assert.match(suffix, /bright, upbeat, modern/);
  assert.match(suffix, /No deliveries after 3pm on Saturdays/);
  assert.match(suffix, /Keep it playful, avoid formal language/);
});

test("shopVoiceSuffix: only the fields actually filled in produce a line", () => {
  const suffix = shopVoiceSuffix({ shop_tone: "warm, capable, florist-friendly", delivery_notes: "", marketing_notes: "" });
  assert.match(suffix, /warm, capable, florist-friendly/);
  assert.doesNotMatch(suffix, /delivery notes/i);
  assert.doesNotMatch(suffix, /marketing/i);
});

test("domainOwner: reports and coach questions are structurally Rose's — a real, unambiguous signal, not a keyword guess", () => {
  assert.equal(domainOwner("reports"), "Rose");
  assert.equal(domainOwner("coach"), "Rose");
});

test("domainOwner: a domain with no declared owner returns null, never an invented persona", () => {
  assert.equal(domainOwner("marketing"), null);
  assert.equal(domainOwner("general"), null);
  assert.equal(domainOwner(""), null);
});

test("suggestHandoff: a reports question asked of Bud names Rose as the owner", () => {
  const handoff = suggestHandoff("Bud", "reports", "what made the most profit this month");
  assert.equal(handoff.to, "Rose");
  assert.match(handoff.line, /Rose/);
});

test("suggestHandoff: Rose asking herself a reports question never suggests handing off to herself", () => {
  assert.equal(suggestHandoff("Rose", "reports", "what made the most profit this month"), null);
});

test("suggestHandoff: open chat about a bug points to Bud, the fuzzy topic-hint owner", () => {
  const handoff = suggestHandoff("Lily", "general", "the checkout button keeps erroring when I click it");
  assert.equal(handoff.to, "Bud");
});

test("jobDomainOwner: marketing/creative jobs are always Lily's — Florisyn's designated creative director", () => {
  assert.equal(jobDomainOwner("marketing"), "Lily");
});

test("jobDomainOwner: a domain with no declared job owner returns null, never an invented author", () => {
  assert.equal(jobDomainOwner("support"), null);
  assert.equal(jobDomainOwner("reports"), null);
  assert.equal(jobDomainOwner(""), null);
});
