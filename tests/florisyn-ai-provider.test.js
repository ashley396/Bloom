import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  resolveAiConfig,
  aiUnavailableMessage,
  cloudflareAiToken,
  DEFAULT_TEXT_MODEL,
  DEFAULT_VISION_MODEL,
} from "../lib/ai/provider-config.js";
import {
  extractCloudflareText,
  normalizeHistory,
  safeText,
} from "../netlify/functions/_shared/ai-provider.js";

test("resolveAiConfig uses Cloudflare env without OpenAI", () => {
  const cfg = resolveAiConfig({
    AI_PROVIDER: "cloudflare",
    AI_TEXT_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    AI_VISION_MODEL: "@cf/llava-hf/llava-1.5-7b-hf",
    CLOUDFLARE_ACCOUNT_ID: "acct",
    CLOUDFLARE_AI_API_TOKEN: "tok",
    AI_TIMEOUT_MS: "15000",
    AI_DAILY_CAP_PER_SHOP: "100",
  });
  assert.equal(cfg.provider, "cloudflare");
  assert.equal(cfg.textModel, "@cf/meta/llama-3.1-8b-instruct-fast");
  assert.equal(cfg.visionModel, "@cf/llava-hf/llava-1.5-7b-hf");
  assert.equal(cfg.accountId, "acct");
  assert.equal(cfg.token, "tok");
  assert.equal(cfg.timeoutMs, 15000);
  assert.equal(cfg.dailyCapPerShop, 100);
  assert.equal(/openai/i.test(JSON.stringify(cfg)), false);
});

test("cloudflareAiToken reads aliases", () => {
  assert.equal(cloudflareAiToken({ CLOUDFLARE_AI_API_TOKEN: "a" }), "a");
  assert.equal(cloudflareAiToken({ CLOUDFLARE_AI_TOKEN: "b" }), "b");
});

test("normalizeHistory trims and caps turns", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  const out = normalizeHistory(rows);
  assert.ok(out.length <= 20);
  assert.equal(out[0].role, "user");
});

test("safeText strips embedded data URLs", () => {
  assert.match(safeText("data:image/png;base64,abc"), /omitted/);
});

test("extractCloudflareText handles Workers AI shapes", () => {
  assert.equal(extractCloudflareText({ response: "Hi" }), "Hi");
  assert.equal(extractCloudflareText({ description: "Vision" }), "Vision");
});

test("ai-assistant re-exports provider helpers", async () => {
  const mod = await import("../netlify/functions/ai-assistant.js");
  assert.equal(typeof mod.cloudflareAiToken, "function");
  assert.equal(typeof mod.runCloudflareGenerate, "function");
});

test("defaults avoid OpenAI models", () => {
  assert.match(DEFAULT_TEXT_MODEL, /^@cf\//);
  assert.match(DEFAULT_VISION_MODEL, /^@cf\//);
  assert.match(aiUnavailableMessage(), /temporarily unavailable/i);
});

test("lily-ai imports server-side generative chat", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/lily-ai.js"), "utf8");
  assert.match(src, /runTextChat/);
  assert.match(src, /loadConversationHistory/);
  assert.match(src, /clear-memory/);
});
