import test from "node:test";
import assert from "node:assert/strict";
import { classifyRequest, ACTION_TYPES } from "../netlify/functions/_shared/ai-intent-router.js";

function mockCloudflareOnce(jsonResult) {
  const originalFetch = globalThis.fetch;
  const originalAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const originalToken = process.env.CLOUDFLARE_AI_API_TOKEN;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(jsonResult) } }) };
  };
  return {
    getSentBody: () => sentBody,
    restore() {
      globalThis.fetch = originalFetch;
      if (originalAccount !== undefined) process.env.CLOUDFLARE_ACCOUNT_ID = originalAccount;
      else delete process.env.CLOUDFLARE_ACCOUNT_ID;
      if (originalToken !== undefined) process.env.CLOUDFLARE_AI_API_TOKEN = originalToken;
      else delete process.env.CLOUDFLARE_AI_API_TOKEN;
    }
  };
}

test("classifyRequest: 'Create a Facebook post...' classifies as a create action, not general chat", async () => {
  const mock = mockCloudflareOnce({
    action_type: "create",
    domain: "marketing",
    channels: ["facebook"],
    occasion: "Homecoming",
    audience: "high school students and parents",
    summary: "Write a Facebook post reminding students and parents to order Homecoming flowers."
  });
  try {
    const routed = await classifyRequest("Create a Facebook post telling high school kids and parents to get their Homecoming orders in.");
    assert.equal(routed.action_type, "create");
    assert.equal(routed.domain, "marketing");
    assert.deepEqual(routed.channels, ["facebook"]);
    assert.equal(routed.occasion, "Homecoming");
    // The model prompt itself must tell the classifier to read the WHOLE
    // sentence, not just spot a keyword — this is the direct guard against
    // the "website" hijack failure.
    assert.match(mock.getSentBody().messages.find((m) => m.role === "user").content, /Create a Facebook post/);
  } finally {
    mock.restore();
  }
});

test("classifyRequest: a multi-channel request classifies as campaign, not a bare navigate", async () => {
  const mock = mockCloudflareOnce({
    action_type: "campaign",
    domain: "marketing",
    channels: ["facebook", "website"],
    occasion: "Homecoming",
    audience: "high school students and parents",
    summary: "Build a Homecoming campaign spanning Facebook and the website."
  });
  try {
    const routed = await classifyRequest("Make a campaign for Facebook and my website telling high school kids and parents to get their Homecoming orders in.");
    assert.equal(routed.action_type, "campaign");
    assert.deepEqual(routed.channels, ["facebook", "website"]);
  } finally {
    mock.restore();
  }
});

test("classifyRequest: the task instruction explicitly forbids single-keyword classification", async () => {
  const mock = mockCloudflareOnce({ action_type: "general", domain: "general", channels: [], occasion: null, audience: null, summary: "chat" });
  try {
    await classifyRequest("hello");
    const userMessage = mock.getSentBody().messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /never classify from a single keyword/i);
    assert.match(userMessage, /website.{0,40}not automatically navigation/i);
  } finally {
    mock.restore();
  }
});

test("classifyRequest: normalizes an invalid action_type to 'general' rather than throwing", async () => {
  const mock = mockCloudflareOnce({ action_type: "not_a_real_type", domain: "marketing", channels: [], occasion: null, audience: null, summary: "x" });
  try {
    const routed = await classifyRequest("something odd");
    assert.equal(routed.action_type, "general");
  } finally {
    mock.restore();
  }
});

test("classifyRequest: dedupes and lowercases channels", async () => {
  const mock = mockCloudflareOnce({ action_type: "campaign", domain: "marketing", channels: ["Facebook", "facebook", "Website"], occasion: null, audience: null, summary: "x" });
  try {
    const routed = await classifyRequest("campaign everywhere");
    assert.deepEqual(routed.channels, ["facebook", "website"]);
  } finally {
    mock.restore();
  }
});

test("classifyRequest: returns null (never throws) on a provider failure, so the caller can fall back to plain chat", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const routed = await classifyRequest("anything");
    assert.equal(routed, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("classifyRequest: returns null for an empty message without calling the provider", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not be called");
  };
  try {
    assert.equal(await classifyRequest(""), null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ACTION_TYPES includes every type the router/planner rely on", () => {
  for (const t of ["create", "campaign", "video", "diagnosis", "navigation", "general"]) {
    assert.ok(ACTION_TYPES.includes(t), `missing action type: ${t}`);
  }
});
