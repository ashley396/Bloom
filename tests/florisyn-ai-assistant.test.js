import test from "node:test";
import assert from "node:assert/strict";
import {
  cloudflareAiToken,
  extractCloudflareText
} from "../netlify/functions/ai-assistant.js";

test("cloudflareAiToken accepts API token aliases", () => {
  assert.equal(cloudflareAiToken({ CLOUDFLARE_AI_API_TOKEN: "a" }), "a");
  assert.equal(cloudflareAiToken({ CLOUDFLARE_AI_TOKEN: "b" }), "b");
  assert.equal(cloudflareAiToken({}), "");
});

test("extractCloudflareText reads Workers AI response shapes", () => {
  assert.equal(extractCloudflareText({ response: "Hello florist" }), "Hello florist");
  assert.equal(extractCloudflareText({ result: "Draft" }), "Draft");
  assert.equal(extractCloudflareText("plain"), "plain");
  assert.equal(
    extractCloudflareText({ choices: [{ message: { content: "Hi" } }] }),
    "Hi"
  );
});

// Handler-level wiring (source check, same rationale as ai-context.test.js:
// thin glue around currentUser()'s auth, not worth a full session mock).
// Direct callers of this endpoint (smartAi() from the dashboard assistant
// panel) never set systemSuffix themselves, so this is the one place that
// turns a shop's onboarding-collected voice (ai_shop_profiles, fetched into
// context.ai_profile by ai-context.js) into a real instruction for a plain
// chat turn — without it, that data reached this endpoint and was ignored.
import fs from "node:fs";
const handlerSrc = fs.readFileSync(new URL("../netlify/functions/ai-assistant.js", import.meta.url), "utf8");

test("ai-assistant handler derives a systemSuffix from context.ai_profile for chat mode", () => {
  assert.match(handlerSrc, /shopVoiceSuffix\(payload\.context\?\.ai_profile\)/);
  assert.match(handlerSrc, /mode===["']generate["']/);
});

test("ai-assistant handler never overwrites a caller-supplied systemSuffix", () => {
  assert.match(handlerSrc, /!payload\.systemSuffix/);
});
