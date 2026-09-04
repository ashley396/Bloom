import test from "node:test";
import assert from "node:assert/strict";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";
import {
  attemptPremiumCreativeGeneration,
  resolveOpenAiAspectRatio,
  PREMIUM_CREATIVE_STATES
} from "../netlify/functions/_shared/marketing-premium-creative-orchestrator.js";
import { createOpenAiMarketingImageProvider } from "../netlify/functions/_shared/marketing-image-provider-openai.js";

// Hybrid Marketing Studio Batch 2 ("staging-only OpenAI routing"): the
// real server-side Premium AI Creative orchestration path — fully wired,
// tested entirely with mocked providers here (Part 5's own instruction:
// "the code path should be fully wired and testable with mocks" /
// "DO NOT ACTUALLY SEND A LIVE CALL YET"). No test in this file ever
// reaches a real network call — every provider is injected via
// `providerFactory`.

const CANONICAL_CONCEPT = Object.freeze({
  occasionCategory: "everyday_floral",
  sympathyClassification: "not_sympathy",
  promotionIntent: "not_promotion",
  factRequirements: [],
  objective: "sell",
  creativeFamily: "designed_flyer"
});
const CREATIVE_DIRECTION = Object.freeze({
  compositionFamily: "photo_dominant",
  imageScale: "dominant",
  paletteMood: "soft_pastel",
  visualMood: "bright_joyful",
  typographyPersonality: "clean_sans",
  ornamentalDensity: "light"
});
const STAGING_ENV = Object.freeze({ FLORISYN_ENV: "staging" });

function mockProvider(overrides = {}) {
  let lastGenerateArgs = null;
  const provider = {
    name: "openai",
    model: "gpt-image-2",
    configured: () => true,
    capabilities: () => ({ aspectRatios: ["1:1", "2:3", "3:2"], qualityTiers: ["low", "medium", "high"] }),
    estimateCost: ({ qualityTier = "medium" } = {}) => ({ cents: { low: 1, medium: 6, high: 22 }[qualityTier] ?? null, currency: "USD", cost_source: "openai_conservative_ceiling_estimate" }),
    generate: async (args) => {
      lastGenerateArgs = args;
      return { ok: true, url: "https://example.com/premium.png", actualCostCents: null, usage: null, costSource: undefined };
    },
    ...overrides
  };
  return { provider, getLastGenerateArgs: () => lastGenerateArgs };
}

// Required test #3/#20 area, #18/#19: environment guard blocks Premium
// unconditionally — a real production deploy (no FLORISYN_ENV at all)
// must never reach the provider, even if everything else would allow it.
test("Batch2 #18 production environment guard blocks Premium path even when the provider would otherwise be configured", async () => {
  const { provider } = mockProvider();
  const result = await attemptPremiumCreativeGeneration({
    client: createFakeSupabaseClient([]),
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: {}, // no FLORISYN_ENV at all — production-shaped
    providerFactory: () => provider
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.ENVIRONMENT_BLOCKED);
});

test("Batch2 #19 production Supabase guard blocks Premium path — a real Supabase project matching the configured production host is refused", async () => {
  const { provider } = mockProvider();
  const env = {
    FLORISYN_ENV: "staging",
    SUPABASE_URL: "https://sqdzaoxqlsgbphvlmfeb.supabase.co",
    PRODUCTION_SUPABASE_HOST: "sqdzaoxqlsgbphvlmfeb.supabase.co"
  };
  const result = await attemptPremiumCreativeGeneration({
    client: createFakeSupabaseClient([]),
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env,
    providerFactory: () => provider
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.ENVIRONMENT_BLOCKED);
  assert.ok(result.reasons.some((r) => r.includes("production project")));
});

test("a genuine staging environment with no production markers passes the guard", async () => {
  const { provider } = mockProvider();
  const client = createFakeSupabaseClient([{ data: { id: "usage-1" }, error: null }, { data: null, error: null }]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => provider
  });
  assert.equal(result.ok, true);
});

// Required test #4: feature ON + premium route + provider missing →
// controlled unavailable state (never a fabricated success, never a
// silent Cloudflare substitution).
test("Batch2 #4 provider not configured → PROVIDER_UNAVAILABLE, no usage reservation attempted", async () => {
  const client = createFakeSupabaseClient([]); // no responses queued — a reservation attempt would throw/mismatch
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => ({ configured: () => false })
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.PROVIDER_UNAVAILABLE);
  assert.deepEqual(client.calls, [], "no usage-ledger row may be written for a provider-configuration failure — Part 12: never deduct a credit here");
});

// Required test #3 (feature ON + premium route + provider configured →
// mocked OpenAI path) and #16 (mocked successful Premium generation
// records usage).
test("Batch2 #3/#16 provider configured, brief valid → real mocked generate() call, usage reserved then completed, never a fake success without a real url", async () => {
  const { provider, getLastGenerateArgs } = mockProvider();
  const client = createFakeSupabaseClient([
    { data: { id: "usage-1" }, error: null }, // reserveProviderCall insert
    { data: null, error: null } // completeProviderCall update
  ]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    contentItemId: "item-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    factSafeCopyPlan: { headline: "Spring is here!", body: "Call 606-506-4039 to order fresh spring bouquets." },
    verifiedShopBrandData: { name: "Lilies in Bloom", phone: "606-506-4039" },
    env: STAGING_ENV,
    providerFactory: () => provider
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.SUCCESS);
  assert.equal(result.result.backgroundImageUrl, "https://example.com/premium.png");
  assert.equal(result.result.engine, "premium_ai_creative");
  assert.equal(result.result.usageReservationId, "usage-1");

  const reserveInsert = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert"));
  assert.ok(reserveInsert, "reserveProviderCall must write a usage row BEFORE the provider call");
  const insertedPayload = reserveInsert.ops.find((op) => op[0] === "insert")[1][0];
  assert.equal(insertedPayload.provider, "openai");
  assert.equal(insertedPayload.operation, "premium_creative_image");
  assert.equal(insertedPayload.attempt_index, 0);
  assert.equal(insertedPayload.estimated_cost_cents, 6, "must use OpenAI's own conservative ceiling (6¢ for medium), never the generic Cloudflare-shaped estimate");
  // Batch 3 staging-acceptance fix: the cost_source COLUMN is a DB-
  // enforced two-state axis (marketing_generation_usage_cost_source_
  // check, live on staging: 'estimated' | 'provider_confirmed' only) —
  // OpenAI's own more specific methodology label lives in metadata
  // instead (see marketing-provider-usage.test.js's own dedicated
  // regression test for the real staging failure this fixes).
  assert.equal(insertedPayload.cost_source, "estimated");
  assert.equal(insertedPayload.metadata.cost_source_detail, "openai_conservative_ceiling_estimate");

  assert.ok(getLastGenerateArgs(), "generate() must actually have been called");
});

// Required test #17: failure records failed usage.
test("Batch2 #17 a real provider call failure records the reservation as failed, never as success", async () => {
  const { provider } = mockProvider({ generate: async () => ({ ok: false, error: "mock provider outage" }) });
  const client = createFakeSupabaseClient([
    { data: { id: "usage-2" }, error: null }, // reserveProviderCall insert
    { data: null, error: null } // failProviderCall update
  ]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => provider
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.PROVIDER_CALL_FAILED);
  const failUpdate = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "update"));
  assert.ok(failUpdate, "failProviderCall must mark the reservation row failed");
  const updatePayload = failUpdate.ops.find((op) => op[0] === "update")[1][0];
  assert.equal(updatePayload.status, "failed");
});

// Required test #11/#12/#13: fact-critical text (phone/date/time/price)
// is never delegated to the generative image as trusted text — only
// styleText reaches the prompt sent to the provider.
test("Batch2 #11/#12/#13 critical text stays deterministic: phone numbers and dates never appear in the prompt sent to the image provider", async () => {
  const { provider, getLastGenerateArgs } = mockProvider();
  const client = createFakeSupabaseClient([{ data: { id: "usage-3" }, error: null }, { data: null, error: null }]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    factSafeCopyPlan: {
      headline: "Spring is here!",
      body: "Call 606-506-4039 to order for delivery on 4/12.",
      caption: "Prices start at $35."
    },
    env: STAGING_ENV,
    providerFactory: () => provider
  });
  assert.equal(result.ok, true);
  assert.ok(!result.result.overlays.styleText.some((s) => s.text.includes("606-506-4039")), "a phone number must never land in styleText");
  assert.ok(result.result.overlays.deterministicText.some((s) => s.text.includes("606-506-4039")), "a phone number must be reserved for deterministic overlay");
  assert.ok(result.result.overlays.deterministicText.some((s) => s.text.includes("$35")));

  const promptSent = getLastGenerateArgs().prompt;
  assert.ok(!promptSent.includes("606-506-4039"), "the phone number must never appear in the text sent to the image provider");
  assert.ok(!promptSent.includes("4/12"), "the date must never appear in the text sent to the image provider");
  assert.ok(!promptSent.includes("$35"), "the price must never appear in the text sent to the image provider");
  assert.ok(promptSent.includes("Do not include any readable text"));
});

// Required test #14/#15: exact-layout generation and provider-config
// failures never consume a Premium Design credit — proven here as "no
// usage row is EVER written unless the attempt reaches a real generate()
// call," which is exactly what the entitlement counter (marketing-
// premium-design-entitlement.js) counts.
test("Batch2 #14/#15 no usage row is written when the environment guard or provider-configured check fails — nothing here can consume a Premium Design credit", async () => {
  const envBlockedClient = createFakeSupabaseClient([]);
  await attemptPremiumCreativeGeneration({ client: envBlockedClient, shopId: "shop-1", canonicalConcept: CANONICAL_CONCEPT, creativeDirection: CREATIVE_DIRECTION, env: {}, providerFactory: () => mockProvider().provider });
  assert.deepEqual(envBlockedClient.calls, []);

  const providerUnavailableClient = createFakeSupabaseClient([]);
  await attemptPremiumCreativeGeneration({
    client: providerUnavailableClient,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => ({ configured: () => false })
  });
  assert.deepEqual(providerUnavailableClient.calls, []);
});

test("resolveOpenAiAspectRatio maps Florisyn's own named dimensions to the closest GPT-Image-2-supported ratio", () => {
  assert.equal(resolveOpenAiAspectRatio({ width: 1080, height: 1080 }), "1:1");
  assert.equal(resolveOpenAiAspectRatio({ width: 1080, height: 1920 }), "2:3");
  assert.equal(resolveOpenAiAspectRatio({ width: 1200, height: 630 }), "3:2");
});

// Batch 3 staging-acceptance fix ("FIX THE PROVEN OPENAI USAGE
// RESERVATION FAILURE"): a genuine end-to-end regression test through
// the REAL OpenAI provider adapter (createOpenAiMarketingImageProvider,
// not a hand-built mock) — its own real estimateCost() is what actually
// produced the "openai_conservative_ceiling_estimate" cost_source that
// broke every real staging reservation. Only `fetch` is mocked (no real
// network call); every other real function in the chain — the real
// provider's configured()/estimateCost()/generate(), the real
// reserveProviderCall()/completeProviderCall() — runs for real.
test("Batch3 end-to-end (real provider adapter, real cost config, real reservation helper): a full Premium Creative attempt succeeds after the reservation fix", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }] })
  });
  try {
    const provider = createOpenAiMarketingImageProvider({ OPENAI_API_KEY: "sk-test-not-a-real-key" });
    const storage = createFakeSupabaseStorage({});
    const client = createFakeSupabaseClient(
      [
        { data: { id: "usage-e2e-1" }, error: null }, // reserveProviderCall insert
        { data: null, error: null } // completeProviderCall update
      ],
      { storage }
    );
    const result = await attemptPremiumCreativeGeneration({
      client,
      shopId: "shop-1",
      contentItemId: "item-1",
      canonicalConcept: CANONICAL_CONCEPT,
      creativeDirection: CREATIVE_DIRECTION,
      factSafeCopyPlan: { headline: "Spring is here!", body: "Fresh seasonal blooms, arranged with care." },
      verifiedShopBrandData: { name: "Lilies in Bloom" },
      env: { FLORISYN_ENV: "staging", OPENAI_API_KEY: "sk-test-not-a-real-key" },
      providerFactory: () => provider
    });
    assert.equal(result.ok, true, `expected a real success through the fixed reservation path: ${JSON.stringify(result)}`);
    assert.equal(result.state, PREMIUM_CREATIVE_STATES.SUCCESS);
    assert.equal(result.result.provider, "openai");
    assert.equal(result.result.model, "gpt-image-2");

    const reserveInsert = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert"));
    const insertedPayload = reserveInsert.ops.find((op) => op[0] === "insert")[1][0];
    assert.equal(insertedPayload.cost_source, "estimated", "must be DB-legal — this is the exact real fix for the proven staging failure");
    assert.equal(insertedPayload.metadata.cost_source_detail, "openai_conservative_ceiling_estimate");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("attemptPremiumCreativeGeneration refuses a brief it cannot build (missing canonicalConcept) without ever reaching the provider", async () => {
  const { provider, getLastGenerateArgs } = mockProvider();
  const client = createFakeSupabaseClient([]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: null,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => provider
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.BRIEF_UNAVAILABLE);
  assert.equal(getLastGenerateArgs(), null);
});
