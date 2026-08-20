import test from "node:test";
import assert from "node:assert/strict";
import { buildResponseMessage, cloudflareChat, personaDisabled, formatJobResponse, shouldDelegate, formatDelegatedAnswer, resolveJobPersona } from "../netlify/functions/lily-ai.js";

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

test("formatJobResponse: a completed post job reads as a real formatted preview, never a JSON.stringify dump", () => {
  const job = {
    status: "completed",
    result: {
      steps: [
        {
          tool: "marketing.createSocialPost",
          status: "completed",
          result: {
            content: {
              platform: "facebook",
              headline: "Homecoming season is here!",
              body: "Order your Homecoming corsage by Wednesday for Friday pickup.",
              cta: "Order by Wednesday",
              hashtags: ["#homecoming"]
            }
          }
        },
        { tool: "creative.generateImage", status: "completed", result: { url: "https://fake.storage/x.jpg" } }
      ]
    }
  };
  const text = formatJobResponse(job);
  assert.doesNotMatch(text, /^\s*\{/); // never opens like a raw JSON object
  assert.doesNotMatch(text, /"headline":|"body":|"cta":/); // never leaks raw field names
  assert.match(text, /Order your Homecoming corsage/);
  assert.match(text, /#homecoming/);
  assert.match(text, /draft/i); // presented as a reviewable draft, not a fait accompli
});

test("formatJobResponse: a completed campaign job names the campaign, the post, and the website section — never just a navigate", () => {
  const job = {
    status: "completed",
    result: {
      steps: [
        { tool: "marketing.createCampaign", status: "completed", result: { campaign_id: "c1" } },
        { tool: "marketing.createSocialPost", status: "completed", result: { content: { platform: "facebook", body: "Order your Homecoming flowers today.", headline: "", cta: "", hashtags: [] } } },
        { tool: "marketing.createWebsiteSectionDraft", status: "completed", result: { content: { headline: "Homecoming Flowers, Ready When You Are", subheadline: "", cta_label: "Order now" } } }
      ]
    }
  };
  const text = formatJobResponse(job);
  assert.match(text, /Campaign created/i);
  assert.match(text, /Facebook post/i);
  assert.match(text, /Website section/i);
  assert.doesNotMatch(text, /^\s*\{/);
});

test("formatJobResponse: a video job states rendering is unavailable, never claims a finished video", () => {
  const job = {
    status: "completed",
    result: { steps: [{ tool: "marketing.createVideoConcept", status: "completed", result: { content: { concept: "A quick behind-the-counter look." } } }] }
  };
  const text = formatJobResponse(job);
  assert.match(text, /rendering not connected/i);
});

test("formatJobResponse: a partial failure names what failed and preserves the rest, never silently drops it", () => {
  const job = {
    status: "partially_completed",
    result: {
      steps: [
        { tool: "marketing.createSocialPost", status: "completed", result: { content: { platform: "facebook", body: "Order today.", headline: "", cta: "", hashtags: [] } } },
        { tool: "creative.generateImage", status: "failed", label: "Generate the matching image", error: "model overloaded" }
      ]
    }
  };
  const text = formatJobResponse(job);
  assert.match(text, /Order today/);
  assert.match(text, /couldn't finish/i);
  assert.match(text, /retry/i);
  assert.match(text, /model overloaded/);
});

// AI-OS Wave 4: real programmatic delegation for domain-owner questions
// (business/reports questions are Rose's, no matter who's active).

test("shouldDelegate: a reports question asked of Bud delegates to Rose, the domain owner", () => {
  const owner = shouldDelegate({
    persona: "Bud",
    intentDomain: "reports",
    permission: { allowed: true },
    planned: { tier: "READ", type: "navigate", navigate: "reportsPage" }
  });
  assert.equal(owner, "Rose");
});

test("shouldDelegate: a coach/business question asked of Daisy delegates to Rose", () => {
  const owner = shouldDelegate({ persona: "Daisy", intentDomain: "coach", permission: { allowed: true }, planned: null });
  assert.equal(owner, "Rose");
});

test("shouldDelegate: never delegates when Rose herself is already the one asked", () => {
  const owner = shouldDelegate({ persona: "Rose", intentDomain: "reports", permission: { allowed: true }, planned: null });
  assert.equal(owner, null);
});

test("shouldDelegate: never delegates a domain with no structured owner (fuzzy open chat stays suggest-only)", () => {
  const owner = shouldDelegate({ persona: "Bud", intentDomain: "general", permission: { allowed: true }, planned: null });
  assert.equal(owner, null);
});

test("shouldDelegate: never delegates when the florist's role doesn't have permission at all", () => {
  const owner = shouldDelegate({ persona: "Bud", intentDomain: "reports", permission: { allowed: false }, planned: null });
  assert.equal(owner, null);
});

test("shouldDelegate: never delegates mid-confirmation — swapping personas would break the pending-action resend", () => {
  const owner = shouldDelegate({
    persona: "Bud",
    intentDomain: "reports",
    permission: { allowed: true },
    planned: { requiresConfirmation: true, label: "do something" }
  });
  assert.equal(owner, null);
});

test("formatDelegatedAnswer: plainly attributes the answer to who actually wrote it, never lets one persona's voice pass as another's", () => {
  const text = formatDelegatedAnswer("Rose", "Bud", "Focus on your top 3 margin arrangements this week.");
  assert.match(text, /Bud brought in Rose/);
  assert.match(text, /Focus on your top 3 margin arrangements/);
});

// AI-OS Wave 5: job-producing requests (runJob) execute as their real
// domain author, not necessarily the persona the florist is chatting with.

test("resolveJobPersona: a marketing job asked of Bud is authored by Lily, Florisyn's creative director", () => {
  const result = resolveJobPersona("Bud", "marketing");
  assert.equal(result.author, "Lily");
  assert.equal(result.delegated, true);
});

test("resolveJobPersona: a marketing job asked of Daisy is also authored by Lily", () => {
  const result = resolveJobPersona("Daisy", "marketing");
  assert.equal(result.author, "Lily");
  assert.equal(result.delegated, true);
});

test("resolveJobPersona: a marketing job Lily is already asked to do is never reported as delegated to herself", () => {
  const result = resolveJobPersona("Lily", "marketing");
  assert.equal(result.author, "Lily");
  assert.equal(result.delegated, false);
});

test("resolveJobPersona: a domain with no declared job owner falls back to whoever's actually chatting, never an invented author", () => {
  const result = resolveJobPersona("Bud", "support");
  assert.equal(result.author, "Bud");
  assert.equal(result.delegated, false);
});
