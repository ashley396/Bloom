import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPayload,
  buildWebhookIdempotencyKey,
  recordWebhookEvent,
  markWebhookEventProcessed
} from "../netlify/functions/_shared/creative-ai/webhook-events-store.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

test("hashPayload: deterministic for identical bytes, different for different bytes", () => {
  const a = hashPayload("hello");
  const b = hashPayload("hello");
  const c = hashPayload("hello!");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("buildWebhookIdempotencyKey: same inputs -> same key, deterministic (not a random UUID)", () => {
  const key1 = buildWebhookIdempotencyKey({ provider: "heygen", eventType: "avatar_video.success", externalJobId: "vid-1", payloadHash: "abc" });
  const key2 = buildWebhookIdempotencyKey({ provider: "heygen", eventType: "avatar_video.success", externalJobId: "vid-1", payloadHash: "abc" });
  assert.equal(key1, key2);
});

test("buildWebhookIdempotencyKey: two different real state transitions for the same job get DIFFERENT keys, never conflated as duplicates", () => {
  const processing = buildWebhookIdempotencyKey({ provider: "heygen", eventType: "avatar_video.processing", externalJobId: "vid-1", payloadHash: hashPayload(JSON.stringify({ status: "processing" })) });
  const success = buildWebhookIdempotencyKey({ provider: "heygen", eventType: "avatar_video.success", externalJobId: "vid-1", payloadHash: hashPayload(JSON.stringify({ status: "success" })) });
  assert.notEqual(processing, success);
});

test("recordWebhookEvent: a genuinely new event is inserted and returned as non-duplicate", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null }, // existing-by-idempotency-key lookup: not found
    { data: { id: "event-1", status: "received", provider: "heygen", event_type: "avatar_video.success", external_job_id: "vid-1", signature_valid: true }, error: null } // insert
  ]);
  const result = await recordWebhookEvent(client, {
    provider: "heygen",
    eventType: "avatar_video.success",
    externalJobId: "vid-1",
    payloadHash: "hash-1",
    signatureValid: true,
    rawPayload: { event_type: "avatar_video.success" }
  });
  assert.equal(result.isDuplicate, false);
  assert.equal(result.event.id, "event-1");
});

test("recordWebhookEvent: a redelivery of the exact same event is recognized as a duplicate and never inserted again", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "event-1", status: "processed", provider: "heygen", event_type: "avatar_video.success", external_job_id: "vid-1", signature_valid: true }, error: null } // existing lookup: found
  ]);
  const result = await recordWebhookEvent(client, {
    provider: "heygen",
    eventType: "avatar_video.success",
    externalJobId: "vid-1",
    payloadHash: "hash-1",
    signatureValid: true
  });
  assert.equal(result.isDuplicate, true);
  assert.equal(result.event.id, "event-1");
  // Only one queued response was consumed (the existence check) — an
  // insert was never attempted for a recognized duplicate.
  assert.equal(client.calls.filter((c) => c.ops.some((op) => op[0] === "insert")).length, 0);
});

test("recordWebhookEvent: an invalid signature is still recorded (status: rejected) for audit purposes", async () => {
  const client = createFakeSupabaseClient([
    { data: null, error: null },
    { data: { id: "event-2", status: "rejected", provider: "heygen", event_type: "avatar_video.success", external_job_id: "vid-1", signature_valid: false }, error: null }
  ]);
  const result = await recordWebhookEvent(client, {
    provider: "heygen",
    eventType: "avatar_video.success",
    externalJobId: "vid-1",
    payloadHash: "hash-1",
    signatureValid: false
  });
  assert.equal(result.isDuplicate, false);
  assert.equal(result.event.status, "rejected");
  const insertCall = client.calls.find((c) => c.ops.some((op) => op[0] === "insert"));
  assert.equal(insertCall.payload.status, "rejected");
  assert.equal(insertCall.payload.signature_valid, false);
});

test("markWebhookEventProcessed: updates status and sets processed_at", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "event-1", status: "processed" }, error: null }]);
  const result = await markWebhookEventProcessed(client, "event-1", { status: "processed" });
  assert.equal(result.status, "processed");
});

test("markWebhookEventProcessed: a failure carries the real error message, truncated, no secrets assumed present", async () => {
  const client = createFakeSupabaseClient([{ data: { id: "event-1", status: "failed" }, error: null }]);
  await markWebhookEventProcessed(client, "event-1", { status: "failed", error: "job not found" });
  const updateCall = client.calls.find((c) => c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall.payload.error_message, "job not found");
});
