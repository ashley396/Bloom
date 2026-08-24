import test from "node:test";
import assert from "node:assert/strict";
import { classifyPersonalBrandCommand, MEMORY_ACTIONS } from "../netlify/functions/_shared/creative-ai/personal-brand-intent.js";

function mockCloudflareOnce(jsonResult) {
  const originalFetch = globalThis.fetch;
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
    }
  };
}

function mockCloudflareThrow() {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  return {
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

test("classifyPersonalBrandCommand: 'make me a professional founder portrait' resolves to the founder_portrait mode", async () => {
  const mock = mockCloudflareOnce({
    mode: "founder_portrait",
    memory_action: "none",
    memory_category: null,
    memory_text: null,
    use_digital_twin: false,
    use_voice: false,
    suppress_voice: false,
    target_platform: null,
    content_format_hint: null,
    tone_hint: "professional",
    summary: "Wants a professional founder portrait."
  });
  try {
    const result = await classifyPersonalBrandCommand("Make me a professional founder portrait.");
    assert.equal(result.mode, "founder_portrait");
    assert.equal(result.tone_hint, "professional");
    assert.equal(result.memory_action, "none");
  } finally {
    mock.restore();
  }
});

test("classifyPersonalBrandCommand: 'I don't dress like that. Remember it.' classifies as a real memory_action, not a one-off", async () => {
  const mock = mockCloudflareOnce({
    mode: null,
    memory_action: "remember_avoid",
    memory_category: "clothing_style",
    memory_text: "that outfit",
    use_digital_twin: false,
    use_voice: false,
    suppress_voice: false,
    target_platform: null,
    content_format_hint: null,
    tone_hint: null,
    summary: "Doesn't want to be dressed like that again."
  });
  try {
    const result = await classifyPersonalBrandCommand("I don't dress like that. Remember it.");
    assert.equal(result.memory_action, "remember_avoid");
    assert.equal(result.memory_category, "clothing_style");
  } finally {
    mock.restore();
  }
});

test("classifyPersonalBrandCommand: 'Turn this into a YouTube Short' sets content_format_hint to short", async () => {
  const mock = mockCloudflareOnce({
    mode: null,
    memory_action: "none",
    memory_category: null,
    memory_text: null,
    use_digital_twin: false,
    use_voice: false,
    suppress_voice: false,
    target_platform: "youtube",
    content_format_hint: "short",
    tone_hint: null,
    summary: "Wants this as a YouTube Short."
  });
  try {
    const result = await classifyPersonalBrandCommand("Turn this into a YouTube Short.");
    assert.equal(result.content_format_hint, "short");
    assert.equal(result.target_platform, "youtube");
  } finally {
    mock.restore();
  }
});

test("classifyPersonalBrandCommand: 'Don't use my voice' sets suppress_voice, not use_voice", async () => {
  const mock = mockCloudflareOnce({
    mode: null,
    memory_action: "none",
    memory_category: null,
    memory_text: null,
    use_digital_twin: false,
    use_voice: false,
    suppress_voice: true,
    target_platform: null,
    content_format_hint: null,
    tone_hint: null,
    summary: "Explicitly doesn't want voice used."
  });
  try {
    const result = await classifyPersonalBrandCommand("Don't use my voice.");
    assert.equal(result.suppress_voice, true);
    assert.equal(result.use_voice, false);
  } finally {
    mock.restore();
  }
});

test("classifyPersonalBrandCommand: an unrecognized mode/platform/format from the model falls back to null/'none', never garbage", async () => {
  const mock = mockCloudflareOnce({
    mode: "not_a_real_mode",
    memory_action: "not_a_real_action",
    target_platform: "myspace",
    content_format_hint: "smoke_signal",
    tone_hint: "sarcastic",
    summary: "x"
  });
  try {
    const result = await classifyPersonalBrandCommand("some message");
    assert.equal(result.mode, null);
    assert.equal(result.memory_action, "none");
    assert.equal(result.target_platform, null);
    assert.equal(result.content_format_hint, null);
    assert.equal(result.tone_hint, null);
  } finally {
    mock.restore();
  }
});

test("classifyPersonalBrandCommand: returns null (never throws) on a provider failure", async () => {
  const mock = mockCloudflareThrow();
  try {
    const result = await classifyPersonalBrandCommand("make me a founder portrait");
    assert.equal(result, null);
  } finally {
    mock.restore();
  }
});

test("classifyPersonalBrandCommand: returns null for an empty message without ever calling the model", async () => {
  const result = await classifyPersonalBrandCommand("   ");
  assert.equal(result, null);
});

test("MEMORY_ACTIONS is the exact closed vocabulary", () => {
  assert.deepEqual([...MEMORY_ACTIONS], ["remember_like", "remember_avoid", "forget", "none"]);
});
