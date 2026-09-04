import test from "node:test";
import assert from "node:assert/strict";
import {
  reserveProviderCall,
  completeProviderCall,
  failProviderCall,
  calculateWorstCaseBoundedCostCents,
  classifyDatabaseErrorCode
} from "../netlify/functions/_shared/marketing-provider-usage.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";
import { estimateOpenAiImageCostCents } from "../netlify/functions/_shared/marketing-cost-config.js";

// Batch 2 ("Marketing image quality + provider cost accounting") — the one
// shared provider-usage ledger service every real, billable Marketing
// provider call goes through. Reuses the existing marketing_generation_usage
// table (never a second one) — see the additive migration extending it.

test("reserveProviderCall: fails closed when the insert itself fails — never returns ok:true for a write that didn't happen", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "insert failed" } }]);
  const result = await reserveProviderCall(client, { shopId: "shop-1", purpose: "image", unitType: "image", units: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /insert failed/);
});

test("reserveProviderCall: fails closed when the insert throws — an exception is never mistaken for 'no reservation needed'", async () => {
  const throwingClient = { from: () => { throw new Error("network down"); } };
  const result = await reserveProviderCall(throwingClient, { shopId: "shop-1", purpose: "image" });
  assert.equal(result.ok, false);
  assert.match(result.error, /network down/);
});

test("reserveProviderCall: requires shopId and purpose — never silently proceeds without them", async () => {
  const client = createFakeSupabaseClient([]);
  assert.equal((await reserveProviderCall(client, { purpose: "image" })).ok, false);
  assert.equal((await reserveProviderCall(client, { shopId: "shop-1" })).ok, false);
});

test("reserveProviderCall: writes an 'estimated' row with the estimated cost, attempt index, and trace/operation ids threaded through", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "usage-1" }, error: null }]);
  const result = await reserveProviderCall(client, {
    shopId: "shop-1",
    contentItemId: "item-1",
    purpose: "image",
    operation: "image_generation",
    unitType: "image",
    units: 1,
    traceId: "trace-1",
    operationId: "op-1",
    attemptIndex: 1
  });
  assert.equal(result.ok, true);
  assert.equal(result.usageId, "usage-1");
  const insert = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(insert.payload.status, "estimated");
  assert.equal(insert.payload.cost_source, "estimated");
  assert.equal(insert.payload.trace_id, "trace-1");
  assert.equal(insert.payload.operation_id, "op-1");
  assert.equal(insert.payload.attempt_index, 1);
  assert.ok(insert.payload.estimated_cost_cents > 0, "a real, positive estimate must be recorded up front");
});

// Batch 3 staging-acceptance fix ("FIX THE PROVEN OPENAI USAGE
// RESERVATION FAILURE"): PROVEN root cause of the real staging failure
// (trace_id 71d67575-53dc-42bc-9b67-0764847fbb8b) — the marketing_
// generation_usage.cost_source COLUMN's own CHECK constraint (confirmed
// live on staging: marketing_generation_usage_cost_source_check) only
// ever allows ('estimated', 'provider_confirmed'), but the real OpenAI
// Premium Creative call site passes costEstimate.cost_source straight
// through — literally the string "openai_conservative_ceiling_estimate"
// from marketing-cost-config.js's own estimateOpenAiImageCostCents() —
// which always violates that constraint. This is the exact real value,
// not a stand-in, run through the exact real function.
test("Batch3 reservation-failure fix: reserveProviderCall normalizes OpenAI's own real cost_source label to a DB-legal value and preserves the original in metadata", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "usage-openai-1" }, error: null }]);
  const realOpenAiCostSource = estimateOpenAiImageCostCents({ qualityTier: "medium" }).cost_source;
  assert.equal(realOpenAiCostSource, "openai_conservative_ceiling_estimate", "pin the real value this test is guarding against regressing");

  const result = await reserveProviderCall(client, {
    shopId: "shop-1",
    provider: "openai",
    model: "gpt-image-2",
    purpose: "image",
    operation: "premium_creative_image",
    unitType: "image",
    units: 1,
    estimatedCostCentsOverride: 6,
    costSource: realOpenAiCostSource,
    metadata: { aspectRatio: "1:1", qualityTier: "medium" }
  });
  assert.equal(result.ok, true, "the reservation must actually succeed — this is the fix for the proven staging failure");
  const insert = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(insert.payload.cost_source, "estimated", "the column must only ever receive a DB-legal value — never the provider-specific methodology label directly");
  assert.equal(insert.payload.metadata.cost_source_detail, "openai_conservative_ceiling_estimate", "the original, more specific label must be preserved, not silently dropped");
  // Everything else about the real payload is untouched by the fix.
  assert.equal(insert.payload.provider, "openai");
  assert.equal(insert.payload.model, "gpt-image-2");
  assert.equal(insert.payload.operation, "premium_creative_image");
  assert.equal(insert.payload.metadata.aspectRatio, "1:1", "the caller's own metadata fields must survive alongside the added detail, never be replaced");
});

test("Batch3 reservation-failure fix: an already-DB-legal costSource ('provider_confirmed') passes through unchanged, with no cost_source_detail added", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "usage-legal-1" }, error: null }]);
  const result = await reserveProviderCall(client, { shopId: "shop-1", purpose: "image", costSource: "provider_confirmed", metadata: { note: "x" } });
  assert.equal(result.ok, true);
  const insert = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(insert.payload.cost_source, "provider_confirmed");
  assert.equal(insert.payload.metadata.cost_source_detail, undefined, "no detail field is added when the caller's own value was already DB-legal");
  assert.equal(insert.payload.metadata.note, "x");
});

test("Batch3 reservation-failure fix: reserveProviderCall exposes a SAFE, specific errorCode derived from the real Postgres error — never raw SQL text", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "new row for relation \"marketing_generation_usage\" violates check constraint \"marketing_generation_usage_cost_source_check\"", code: "23514" } }]);
  const result = await reserveProviderCall(client, { shopId: "shop-1", purpose: "image", costSource: "openai_conservative_ceiling_estimate" });
  // Real defensive-depth: even if a caller somehow bypassed the
  // normalization above, the real DB error is still classified safely.
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "check_violation");
});

test("classifyDatabaseErrorCode maps real Postgres SQLSTATE codes to safe, specific reasons — never a raw code or message", () => {
  assert.equal(classifyDatabaseErrorCode({ code: "23502" }), "not_null_violation");
  assert.equal(classifyDatabaseErrorCode({ code: "23503" }), "foreign_key_violation");
  assert.equal(classifyDatabaseErrorCode({ code: "23505" }), "duplicate");
  assert.equal(classifyDatabaseErrorCode({ code: "23514" }), "check_violation");
  assert.equal(classifyDatabaseErrorCode({ code: "42501" }), "rls_denied");
  assert.equal(classifyDatabaseErrorCode({ code: "42703" }), "invalid_column");
  assert.equal(classifyDatabaseErrorCode({ code: "99999" }), "unknown_database_error");
  assert.equal(classifyDatabaseErrorCode(null), "unknown_database_error");
  assert.equal(classifyDatabaseErrorCode({}), "unknown_database_error");
});

test("Batch3 reservation-failure fix: Cloudflare's own existing accounting is completely unaffected — cost_source stays 'estimated' exactly as before", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "usage-cf-1" }, error: null }]);
  const result = await reserveProviderCall(client, { shopId: "shop-1", purpose: "image", unitType: "image", units: 1 });
  assert.equal(result.ok, true);
  const insert = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(insert.payload.provider, "cloudflare");
  assert.equal(insert.payload.cost_source, "estimated");
  assert.deepEqual(insert.payload.metadata, {}, "no detail field is ever added to the default Cloudflare-shaped call");
});

// COST 19: actual cost replaces estimate when the provider supplies one.
test("COST 19: completeProviderCall upgrades cost_source to provider_confirmed only when a real actualCostCents is supplied", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const result = await completeProviderCall(client, "usage-1", { providerRequestId: "req-1", actualCostCents: 7 });
  assert.equal(result.ok, true);
  const update = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "update"));
  assert.equal(update.payload.actual_cost_cents, 7);
  assert.equal(update.payload.status, "actual");
  assert.equal(update.payload.cost_source, "provider_confirmed", "a real provider-reported cost must be distinguishable from a mere estimate");
  assert.equal(update.payload.provider_request_id, "req-1");
});

test("COST 19b: completeProviderCall never upgrades cost_source when the provider gave no real cost figure — stays estimated, not silently promoted", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  await completeProviderCall(client, "usage-1", { providerRequestId: "req-1" });
  const update = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "update"));
  assert.equal(update.payload.cost_source, undefined, "no cost_source field is written at all when there's no real cost to reconcile — the row keeps its original 'estimated' value from reserveProviderCall");
  assert.equal(update.payload.status, undefined);
});

test("completeProviderCall requires a usageId and fails closed on a DB error", async () => {
  const missingId = await completeProviderCall(createFakeSupabaseClient([]), null, {});
  assert.equal(missingId.ok, false);
  const client = createFakeSupabaseClient([{ data: null, error: { message: "update failed" } }]);
  const result = await completeProviderCall(client, "usage-1", { providerRequestId: "req-1" });
  assert.equal(result.ok, false);
});

test("failProviderCall marks the row failed and records the real error message, never throws on a DB failure itself", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const result = await failProviderCall(client, "usage-1", { error: "permission denied for table platform_admins" });
  assert.equal(result.ok, true);
  const update = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "update"));
  assert.equal(update.payload.status, "failed");
  assert.match(update.payload.metadata.error, /permission denied for table platform_admins/);

  const throwingClient = { from: () => { throw new Error("db down"); } };
  const thrown = await failProviderCall(throwingClient, "usage-1", { error: "x" });
  assert.equal(thrown.ok, false);
});

// COST 14 / 22: worst-case bounded cost math — the figure a caller checks
// against remaining budget BEFORE any provider call, bounded by the real
// max attempts a corrective retry could actually spend, never just the
// best-case single-attempt cost.
test("COST 14: calculateWorstCaseBoundedCostCents sums every line item up to its own bound, not just one attempt of each", () => {
  const cents = calculateWorstCaseBoundedCostCents({ textCalls: 1, maxImageAttempts: 2, maxVisionInspections: 2 });
  // image_standard=4 * 2 attempts = 8, vision_request=1 * 2 inspections = 2,
  // copy_request=1 * 1 call = 1 -> 11 total, never just 4+1+1=6 (one
  // best-case attempt of each).
  assert.equal(cents, 11);
});

test("COST 22: a retry's worst-case cost is bounded, not unbounded — doubling maxImageAttempts doubles the image line item exactly, never more", () => {
  const oneAttempt = calculateWorstCaseBoundedCostCents({ maxImageAttempts: 1 });
  const twoAttempts = calculateWorstCaseBoundedCostCents({ maxImageAttempts: 2 });
  assert.equal(twoAttempts, oneAttempt * 2, "the bound must scale linearly and predictably with the real max attempts, never open-ended");
});

test("calculateWorstCaseBoundedCostCents returns 0 for a plan with no calls of a given kind — never invents a floor cost", () => {
  assert.equal(calculateWorstCaseBoundedCostCents({}), 0);
  assert.equal(calculateWorstCaseBoundedCostCents({ maxImageAttempts: 0, maxVisionInspections: 0, textCalls: 0 }), 0);
});
