import test from "node:test";
import assert from "node:assert/strict";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";
import {
  attemptPremiumCreativeGeneration,
  PREMIUM_CREATIVE_STATES,
  PREMIUM_CREATIVE_REASON_CODES
} from "../netlify/functions/_shared/marketing-premium-creative-orchestrator.js";

// Batch 3 staging-acceptance fix ("STRICT EVIDENCE MODE — durable runtime
// trace"): pins attemptPremiumCreativeGeneration()'s own nested
// `diagnostic` object across every real gate it can hit — the durable,
// Supabase-readable replacement for Netlify function logs this account
// has already found impractical to retrieve (Function log UI reports "No
// results found" even over a 2-day range). Every test here exercises the
// REAL function, never a hand-built diagnostic object.

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
// A fake, obviously-not-real secret value injected into the env this
// orchestrator reads — used ONLY to prove no persisted diagnostic ever
// contains it (Part 3/15), never a real credential.
const FAKE_SECRET = "sk-test-FAKE-SECRET-VALUE-not-a-real-key-00000000000000";
const STAGING_ENV = Object.freeze({ FLORISYN_ENV: "staging", OPENAI_API_KEY: FAKE_SECRET });

function mockProvider(overrides = {}) {
  const provider = {
    name: "openai",
    model: "gpt-image-2",
    configured: () => true,
    capabilities: () => ({ aspectRatios: ["1:1", "2:3", "3:2"], qualityTiers: ["low", "medium", "high"] }),
    estimateCost: ({ qualityTier = "medium" } = {}) => ({ cents: { low: 1, medium: 6, high: 22 }[qualityTier] ?? null, currency: "USD", cost_source: "openai_conservative_ceiling_estimate" }),
    generate: async () => ({ ok: true, status: 200, url: "https://example.com/premium.png", actualCostCents: null, usage: null, costSource: undefined }),
    ...overrides
  };
  return provider;
}

/** Every diagnostic-carrying result, whatever else differs, must never
 * contain the fake secret string anywhere in its serialized form. */
function assertNoSecret(result) {
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(FAKE_SECRET), "no persisted/returned diagnostic may ever contain the OPENAI_API_KEY value");
  assert.ok(!serialized.includes("Authorization"), "no persisted/returned diagnostic may ever contain a raw Authorization header");
  assert.ok(!serialized.includes("Bearer "), "no persisted/returned diagnostic may ever contain a raw bearer token");
}

// #4 (matrix item 4: preview guard fails).
test("diagnostic: preview guard failure — environment.preview_guard_ok false, orchestrator reason preview_guard_failed, provider never touched", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: { OPENAI_API_KEY: FAKE_SECRET }, // no FLORISYN_ENV — production-shaped, must fail the guard
    providerFactory: () => mockProvider()
  });
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.ENVIRONMENT_BLOCKED);
  const d = result.diagnostic;
  assert.equal(d.environment.preview_guard_ok, false);
  assert.ok(Array.isArray(d.environment.preview_guard_errors) && d.environment.preview_guard_errors.length > 0);
  assert.equal(d.provider.configured, null, "the provider gate never ran — must not be fabricated as false");
  assert.equal(d.usage.reservation_attempted, false);
  assert.equal(d.execution.provider_generate_entered, false, "matrix item 17: generate() must never be entered before a reservation");
  assert.equal(d.orchestrator.status, PREMIUM_CREATIVE_STATES.ENVIRONMENT_BLOCKED);
  assert.equal(d.orchestrator.reason, PREMIUM_CREATIVE_REASON_CODES.PREVIEW_GUARD_FAILED, "must be the specific code, never a vague 'failed'");
  assertNoSecret(result);
});

// #5.
test("diagnostic: provider not configured — provider.selected true, provider.configured false, reason provider_not_configured", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => ({ configured: () => false })
  });
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.PROVIDER_UNAVAILABLE);
  const d = result.diagnostic;
  assert.equal(d.environment.preview_guard_ok, true);
  assert.equal(d.provider.selected, true, "a real (if unconfigured) provider object was returned by the factory");
  assert.equal(d.provider.configured, false);
  assert.equal(d.usage.reservation_attempted, false);
  assert.equal(d.execution.provider_generate_entered, false);
  assert.equal(d.orchestrator.reason, PREMIUM_CREATIVE_REASON_CODES.PROVIDER_NOT_CONFIGURED);
  assert.deepEqual(client.calls, [], "a provider-configuration failure must never write a usage row");
  assertNoSecret(result);
});

// #6 (provider resolution fails entirely — nothing in the registry at all).
test("diagnostic: provider resolution fails (nothing selected) — provider.selected false, reason provider_unavailable", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => null
  });
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.PROVIDER_UNAVAILABLE);
  const d = result.diagnostic;
  assert.equal(d.provider.selected, false);
  assert.equal(d.provider.configured, false);
  assert.equal(d.orchestrator.reason, PREMIUM_CREATIVE_REASON_CODES.PROVIDER_UNAVAILABLE);
  assertNoSecret(result);
});

test("diagnostic: brief cannot be built — reason brief_build_failed, still no reservation attempted", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: null,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => mockProvider()
  });
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.BRIEF_UNAVAILABLE);
  const d = result.diagnostic;
  assert.equal(d.provider.configured, true, "the provider gate DID run and pass — brief failure is downstream of it");
  assert.equal(d.usage.reservation_attempted, false);
  assert.equal(d.orchestrator.reason, PREMIUM_CREATIVE_REASON_CODES.BRIEF_BUILD_FAILED);
  assertNoSecret(result);
});

test("diagnostic: unsupported quality tier — reason cost_estimate_failed", async () => {
  const client = createFakeSupabaseClient([]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    qualityTier: "ultra",
    env: STAGING_ENV,
    // Matches the real provider adapter's own estimateCost() contract
    // (marketing-image-provider-openai.js): an unrecognized quality tier
    // returns null outright, never an object with a null `cents` field.
    providerFactory: () => mockProvider({ estimateCost: () => null })
  });
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.PROVIDER_UNAVAILABLE);
  assert.equal(result.diagnostic.orchestrator.reason, PREMIUM_CREATIVE_REASON_CODES.COST_ESTIMATE_FAILED);
  assertNoSecret(result);
});

// #7/#8 (reservation attempted; reservation fails).
test("diagnostic: reservation attempted and fails — usage.reservation_attempted true, reservation_id null, status insert_failed, generate never entered", async () => {
  // The exact real shape of the PROVEN staging failure (trace_id
  // 71d67575-53dc-42bc-9b67-0764847fbb8b): a check_violation from
  // Postgres, not a generic unlabeled error.
  const client = createFakeSupabaseClient([
    { data: null, error: { message: "violates check constraint \"marketing_generation_usage_cost_source_check\"", code: "23514" } }
  ]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => mockProvider()
  });
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.RESERVATION_FAILED);
  const d = result.diagnostic;
  assert.equal(d.usage.reservation_attempted, true, "matrix item 7: a reservation attempt must be recorded even when it fails");
  assert.equal(d.usage.reservation_id, null);
  assert.equal(d.usage.reservation_status, "insert_failed");
  assert.equal(d.usage.reservation_error_code, "check_violation", "the specific, safe DB-derived reason must be persisted — never left as just 'insert_failed'");
  assert.equal(d.execution.provider_generate_entered, false, "matrix item 17: provider.generate() must never execute without a successful reservation");
  assert.equal(d.orchestrator.reason, PREMIUM_CREATIVE_REASON_CODES.RESERVATION_FAILED);
  assertNoSecret(result);
});

// #9/#10 (provider.generate entered; provider call fails — network/request failure shape).
test("diagnostic: provider.generate entered, request-level failure (no HTTP response) — reason provider_request_failed", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "usage-req-fail" }, error: null }, // reservation insert
    { data: null, error: null } // failProviderCall update
  ]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => mockProvider({ generate: async () => ({ ok: false, stage: "provider", status: null, error: "OpenAI image generation request failed: fetch failed" }) })
  });
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.PROVIDER_CALL_FAILED);
  const d = result.diagnostic;
  assert.equal(d.usage.reservation_attempted, true);
  assert.equal(d.usage.reservation_id, "usage-req-fail");
  assert.equal(d.usage.reservation_status, "failed");
  assert.equal(d.execution.provider_generate_entered, true, "matrix item 9: generate() was actually entered");
  assert.equal(d.execution.provider_result_ok, false);
  assert.equal(d.execution.provider_http_status, null, "a real network-level failure has no HTTP status to report — honestly null, never fabricated");
  assert.equal(d.orchestrator.reason, PREMIUM_CREATIVE_REASON_CODES.PROVIDER_REQUEST_FAILED);
  assertNoSecret(result);
});

// #10 (provider call fails — a real HTTP response that was invalid/empty).
test("diagnostic: provider.generate entered, a real HTTP response was invalid — reason provider_response_invalid, real status persisted", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "usage-resp-fail" }, error: null }, { data: null, error: null }]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => mockProvider({ generate: async () => ({ ok: false, stage: "provider", status: 400, error: "OpenAI image generation returned no image data." }) })
  });
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.PROVIDER_CALL_FAILED);
  const d = result.diagnostic;
  assert.equal(d.execution.provider_http_status, 400);
  assert.equal(d.orchestrator.reason, PREMIUM_CREATIVE_REASON_CODES.PROVIDER_RESPONSE_INVALID);
  assertNoSecret(result);
});

// A real upload-stage failure (a genuinely different reason than a bad
// provider response — the image came back fine, Florisyn's own storage
// write is what failed).
test("diagnostic: provider.generate entered, the durable upload step failed — reason provider_upload_failed", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "usage-upload-fail" }, error: null }, { data: null, error: null }]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => mockProvider({ generate: async () => ({ ok: false, stage: "upload", status: 200, error: "permission denied for table platform_admins" }) })
  });
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.PROVIDER_CALL_FAILED);
  assert.equal(result.diagnostic.orchestrator.reason, PREMIUM_CREATIVE_REASON_CODES.PROVIDER_UPLOAD_FAILED);
  assertNoSecret(result);
});

// #11 (provider call succeeds).
test("diagnostic: provider call succeeds — full nested diagnostic honestly reflects a real success, reservation_status actual", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "usage-success" }, error: null }, { data: null, error: null }]);
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    env: STAGING_ENV,
    providerFactory: () => mockProvider()
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, PREMIUM_CREATIVE_STATES.SUCCESS);
  const d = result.diagnostic;
  assert.equal(d.environment.preview_guard_ok, true);
  assert.equal(d.provider.selected, true);
  assert.equal(d.provider.configured, true);
  assert.equal(d.provider.model, "gpt-image-2");
  assert.equal(d.usage.reservation_attempted, true);
  assert.equal(d.usage.reservation_id, "usage-success");
  assert.equal(d.usage.reservation_status, "actual");
  assert.equal(d.execution.provider_generate_entered, true);
  assert.equal(d.execution.provider_result_ok, true);
  assert.equal(d.execution.provider_http_status, 200);
  assert.equal(d.orchestrator.status, PREMIUM_CREATIVE_STATES.SUCCESS);
  assert.equal(d.orchestrator.reason, PREMIUM_CREATIVE_REASON_CODES.PREMIUM_SUCCESS);
  assertNoSecret(result);
});

// Matrix item 16: trace_id connects the asset and the usage-ledger row.
// The orchestrator doesn't own the persisted asset's diagnostic object
// (marketing-studio.js does — see its own trace_id field), but it IS the
// one place that writes the usage-ledger row, so this pins that the SAME
// traceId a caller supplies is exactly what lands in that row's
// trace_id column, and echoed back on the result — never a different or
// regenerated id partway through.
test("diagnostic: the caller's traceId is the exact value written to the usage-ledger row and echoed on a real success", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "usage-trace" }, error: null }, { data: null, error: null }]);
  const traceId = "trace-abc-123";
  const result = await attemptPremiumCreativeGeneration({
    client,
    shopId: "shop-1",
    canonicalConcept: CANONICAL_CONCEPT,
    creativeDirection: CREATIVE_DIRECTION,
    traceId,
    env: STAGING_ENV,
    providerFactory: () => mockProvider()
  });
  assert.equal(result.result.traceId, traceId);
  const reserveInsert = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert"));
  const insertedPayload = reserveInsert.ops.find((op) => op[0] === "insert")[1][0];
  assert.equal(insertedPayload.trace_id, traceId, "the exact same traceId used by the caller must be the one persisted on the usage row");
});

test("diagnostic: never contains the real OPENAI_API_KEY value across every failure branch (matrix item 15)", async () => {
  const branches = [
    { env: { OPENAI_API_KEY: FAKE_SECRET }, providerFactory: () => mockProvider() }, // env blocked
    { env: STAGING_ENV, providerFactory: () => ({ configured: () => false }) }, // provider unavailable
    { env: STAGING_ENV, providerFactory: () => mockProvider(), canonicalConcept: null } // brief unavailable
  ];
  for (const branch of branches) {
    const client = createFakeSupabaseClient([]);
    const result = await attemptPremiumCreativeGeneration({
      client,
      shopId: "shop-1",
      canonicalConcept: branch.canonicalConcept ?? CANONICAL_CONCEPT,
      creativeDirection: CREATIVE_DIRECTION,
      env: branch.env,
      providerFactory: branch.providerFactory
    });
    assertNoSecret(result);
  }
});
