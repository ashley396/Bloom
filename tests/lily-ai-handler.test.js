import test from "node:test";
import assert from "node:assert/strict";
import { buildResponseMessage, cloudflareChat, personaDisabled } from "../netlify/functions/lily-ai.js";

test("buildResponseMessage: pre-confirmation text asks the florist to confirm", () => {
  const permission = { allowed: true };
  const planned = { requiresConfirmation: true, label: "add 3 hydrangeas to inventory" };
  const text = buildResponseMessage({ intent: "inventory.add" }, permission, planned, false);
  assert.match(text, /confirm/i);
  assert.match(text, /add 3 hydrangeas to inventory/);
});

test("buildResponseMessage: post-confirmation text does not ask the florist to confirm again", () => {
  const permission = { allowed: true };
  const planned = { requiresConfirmation: true, label: "add 3 hydrangeas to inventory" };
  const before = buildResponseMessage({ intent: "inventory.add" }, permission, planned, false);
  const after = buildResponseMessage({ intent: "inventory.add" }, permission, planned, true);
  assert.notEqual(after, before);
  assert.doesNotMatch(after, /confirm below/i);
  assert.match(after, /add 3 hydrangeas to inventory/);
});

test("buildResponseMessage: denied permission always wins regardless of confirmed flag", () => {
  const permission = { allowed: false };
  const planned = { requiresConfirmation: true, label: "delete a customer" };
  assert.match(buildResponseMessage({ intent: "x" }, permission, planned, true), /does not allow this action/);
  assert.match(buildResponseMessage({ intent: "x" }, permission, planned, false), /does not allow this action/);
});

test("buildResponseMessage: general chat with no planned action returns null (caller fills in AI answer)", () => {
  const permission = { allowed: true };
  assert.equal(buildResponseMessage({ intent: "general.chat" }, permission, null, false), null);
});

test("cloudflareChat: returns null without network calls when AI is not configured", async () => {
  const original = { account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_AI_API_TOKEN };
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_AI_API_TOKEN;
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  };
  try {
    const answer = await cloudflareChat("lily", "What roses do I have?", { shop: {}, inventory: [], recent_orders: [], deliveries: [] });
    assert.equal(answer, null);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (original.account !== undefined) process.env.CLOUDFLARE_ACCOUNT_ID = original.account;
    if (original.token !== undefined) process.env.CLOUDFLARE_AI_API_TOKEN = original.token;
  }
});

test("cloudflareChat: routes through the shared sanitized provider (BLOCKED_KEY scrubbed, single call site)", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ success: true, result: { response: "Here's what I see in your cooler." } })
    };
  };
  try {
    const answer = await cloudflareChat(
      "lily",
      "What flowers do I have on hand?",
      {
        shop: { name: "Test Blooms", logo_url: "data:image/png;base64,AAAA" },
        inventory: [{ name: "Rose", quantity: 10 }],
        recent_orders: [],
        deliveries: []
      }
    );
    assert.equal(answer, "Here's what I see in your cooler.");
    // The bespoke pre-refactor path sent shop context verbatim, including any
    // logo_url data URL. The shared provider's BLOCKED_KEY scrubbing must
    // strip it before it ever reaches the AI request body.
    const userMessage = sentBody.messages.find((m) => m.role === "user").content;
    assert.doesNotMatch(userMessage, /data:image\/png;base64,AAAA/);
    // The system prompt still carries Lily's identity plus the extra privacy
    // guardrail specific to a live business-context chat turn.
    const systemMessage = sentBody.messages.find((m) => m.role === "system").content;
    assert.match(systemMessage, /Lily/);
    assert.match(systemMessage, /private employee and customer information/i);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_AI_API_TOKEN;
  }
});

// ai_shop_profiles was written at onboarding (step 4, "Meet Lily and Rose")
// and never read anywhere — a florist's real "how should your shop sound?"
// answer was silently discarded. cloudflareChat now turns it into an actual
// system-prompt instruction, not just JSON the model may ignore.
test("cloudflareChat: a shop's onboarding voice/notes (ai_shop_profiles) reach the system prompt as real instructions", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ success: true, result: { response: "Sounds lovely, darling." } }) };
  };
  try {
    await cloudflareChat("lily", "What should I feature this week?", {
      shop: { name: "Test Blooms" },
      inventory: [],
      recent_orders: [],
      deliveries: [],
      ai_profile: {
        shop_tone: "luxury, polished, elegant",
        delivery_notes: "We do not deliver on Sundays.",
        marketing_notes: "We prefer a luxury voice and feature hydrangeas."
      }
    });
    const systemMessage = sentBody.messages.find((m) => m.role === "system").content;
    assert.match(systemMessage, /luxury, polished, elegant/);
    assert.match(systemMessage, /do not deliver on Sundays/);
    assert.match(systemMessage, /feature hydrangeas/);
    // The privacy guardrail must still be present alongside the shop voice, not replaced by it.
    assert.match(systemMessage, /private employee and customer information/i);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_AI_API_TOKEN;
  }
});

test("cloudflareChat: a shop that never customized its voice gets no extra system-prompt line (no ai_profile row)", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ success: true, result: { response: "Sure thing." } }) };
  };
  try {
    await cloudflareChat("lily", "What's in stock?", { shop: {}, inventory: [], recent_orders: [], deliveries: [], ai_profile: null });
    const systemMessage = sentBody.messages.find((m) => m.role === "system").content;
    assert.equal(systemMessage.trim().split("\n").filter((l) => /voice|delivery notes|marketing/i.test(l)).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_AI_API_TOKEN;
  }
});

// personaDisabled: honors ai_shop_profiles.lily_enabled/rose_enabled — a
// column that's been in the schema since baseline but was never checked
// anywhere, meaning a disabled persona would still answer as normal.
test("personaDisabled: only an explicit false disables — missing/undefined never does", () => {
  assert.equal(personaDisabled("lily", null), false, "no profile row (not onboarded / table unreachable) must not disable");
  assert.equal(personaDisabled("lily", {}), false, "missing field must not disable");
  assert.equal(personaDisabled("lily", { lily_enabled: true }), false);
  assert.equal(personaDisabled("rose", { rose_enabled: true }), false);
});

test("personaDisabled: an explicit false on the matching column disables that persona only", () => {
  assert.equal(personaDisabled("lily", { lily_enabled: false, rose_enabled: true }), true);
  assert.equal(personaDisabled("rose", { lily_enabled: false, rose_enabled: true }), false);
  assert.equal(personaDisabled("rose", { lily_enabled: true, rose_enabled: false }), true);
  assert.equal(personaDisabled("lily", { lily_enabled: true, rose_enabled: false }), false);
});

test("personaDisabled: persona name is case-insensitive, same as normalizePersona elsewhere", () => {
  assert.equal(personaDisabled("Lily", { lily_enabled: false }), true);
  assert.equal(personaDisabled("LILY", { lily_enabled: false }), true);
});

test("personaDisabled: Daisy/Bud are never gated by lily_enabled/rose_enabled", () => {
  assert.equal(personaDisabled("daisy", { lily_enabled: false, rose_enabled: false }), false);
  assert.equal(personaDisabled("bud", { lily_enabled: false, rose_enabled: false }), false);
});
