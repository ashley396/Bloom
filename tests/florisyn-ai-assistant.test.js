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
