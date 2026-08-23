/**
 * Section 9 acceptance case: "Lily, make a funny 'warning before you meet
 * me' founder post about me."
 *
 * The directive is explicit that Ashley is only the internal example —
 * "Another florist should receive content based on THEIR Personal Brand
 * Profile." This test proves exactly that: it drives the real
 * personal_brand_command workflow for TWO different, fictional shops with
 * different profiles/traits, and asserts each shop's generated concept is
 * grounded in ITS OWN profile data — never a hard-coded Ashley-specific
 * example, and never cross-contaminated between shops.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}
function baseDeps(client) {
  return {
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client
  };
}
let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
});
test.after(() => {
  process.env = { ...savedEnv };
});

function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}

/**
 * Mocks the Cloudflare Workers AI endpoint with two responses in order:
 * the classifier call, then the concept-generation call. Also captures
 * every request body sent, so the test can assert on what was actually
 * handed to the model — the real proof of per-shop grounding.
 */
function mockLilyWorkflow({ classification, concept }) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const sentBodies = [];
  const queue = [classification, concept];
  globalThis.fetch = async (url, opts) => {
    sentBodies.push(JSON.parse(opts.body));
    const next = queue.shift();
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(next) } }) };
  };
  return { sentBodies, restore: () => (globalThis.fetch = originalFetch) };
}

const WARNING_CLASSIFICATION = {
  mode: "humorous_personality",
  memory_action: "none",
  memory_category: null,
  memory_text: null,
  use_digital_twin: false,
  use_voice: false,
  suppress_voice: false,
  target_platform: null,
  content_format_hint: null,
  tone_hint: "humorous",
  summary: "Wants a funny 'warning before you meet me' founder post."
};

test("acceptance: 'warning before you meet me' resolves to humorous_personality mode with the tone hint carried through", async () => {
  const mock = mockLilyWorkflow({
    classification: WARNING_CLASSIFICATION,
    concept: {
      headline: "WARNING before you meet Riley",
      body: "Ambitious. Detail-oriented. Will absolutely notice if your stems are cut at the wrong angle.",
      cta: "Come find out for yourself",
      visual_brief: "A cheeky handwritten warning sign propped on the counter",
      founder_presence_brief: "Riley behind the counter, arms crossed, playful smirk, denim work apron",
      hashtags: ["#meetthefounder", "#florist"]
    }
  });
  const client = createFakeSupabaseClient([
    superAdminRow(),
    {
      data: {
        display_name: "Riley Chen",
        founder_title: "Owner",
        founder_story: "",
        professional_casual_balance: "casual",
        humor_level: "playful",
        preferences: {
          personality_descriptors: { traits: [{ text: "ambitious", polarity: "positive", source: "explicit", active: true, evidence_count: 1 }] }
        }
      },
      error: null
    },
    { data: { id: "asset-riley-1", asset_type: "founder_concept" }, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  try {
    const res = await handler(event("personal_brand_command", { shop_id: "shop-riley", message: "Lily, make a funny 'warning before you meet me' founder post about me." }));
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.classification.mode, "humorous_personality");
    assert.equal(body.classification.tone_hint, "humorous");
    assert.match(body.content.headline, /Riley/);

    // The actual grounding proof: the second call's prompt (concept
    // generation) must carry THIS shop's own name/traits, and the
    // structured context selection (mode -> promptGuidance, tone ->
    // humor guidance) must both be present.
    const conceptPromptCall = mock.sentBodies[1];
    const userMessage = conceptPromptCall.messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /Riley Chen/);
    assert.match(userMessage, /ambitious/);
    assert.match(userMessage, /Humorous \/ Personality/i);
    assert.match(userMessage, /genuinely funny/i);
  } finally {
    mock.restore();
  }
});

test("acceptance: a SECOND, different florist gets content grounded in THEIR OWN profile — never Ashley's or the first shop's data", async () => {
  const mock = mockLilyWorkflow({
    classification: WARNING_CLASSIFICATION,
    concept: {
      headline: "WARNING before you meet Priya",
      body: "Calm under pressure. Will out-plan you on delivery logistics before 7am.",
      cta: "Say hello at the shop",
      visual_brief: "Priya at the design table surrounded by garden roses",
      founder_presence_brief: "Priya mid-arrangement, focused expression, hair pulled back",
      hashtags: ["#meetthefounder"]
    }
  });
  const client = createFakeSupabaseClient([
    superAdminRow(),
    {
      data: {
        display_name: "Priya Nair",
        founder_title: "Founder & Designer",
        founder_story: "",
        professional_casual_balance: "professional",
        humor_level: "light",
        preferences: {
          personality_descriptors: { traits: [{ text: "unflappable under pressure", polarity: "positive", source: "explicit", active: true, evidence_count: 1 }] }
        }
      },
      error: null
    },
    { data: { id: "asset-priya-1", asset_type: "founder_concept" }, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  try {
    const res = await handler(event("personal_brand_command", { shop_id: "shop-priya", message: "Lily, make a funny 'warning before you meet me' founder post about me." }));
    const body = JSON.parse(res.body);
    assert.match(body.content.headline, /Priya/);
    assert.doesNotMatch(body.content.headline, /Riley/, "must never leak the other shop's name");
    assert.doesNotMatch(body.content.headline, /Ashley/i, "must never be hard-coded to the internal example");

    const conceptPromptCall = mock.sentBodies[1];
    const userMessage = conceptPromptCall.messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /Priya Nair/);
    assert.match(userMessage, /unflappable under pressure/);
    assert.doesNotMatch(userMessage, /Riley/);
    assert.doesNotMatch(userMessage, /ambitious/, "must not carry over the first shop's traits");
  } finally {
    mock.restore();
  }
});

test("acceptance: no shop's profile data or founder story is ever hard-coded into the source code itself", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  // marketing-studio.js is deliberately excluded here — it's a large,
  // pre-existing shared file whose header comments legitimately name
  // Ashley/Florisyn as the founding beta tenant (access-control context,
  // predating this pass), which is a different thing from hard-coding her
  // personal traits into a generation prompt. The three files below are
  // where Personal Brand Studio's actual prompt-building logic lives, and
  // that is where a hard-coded example would be a real bug.
  const files = [
    "netlify/functions/_shared/creative-ai/personal-brand-concept.js",
    "netlify/functions/_shared/creative-ai/personal-brand-intent.js",
    "netlify/functions/_shared/creative-ai/personal-brand-modes.js"
  ];
  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.doesNotMatch(source, /ashley/i, `${relativePath} must never hard-code the internal example florist's name`);
  }
});
