import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyHeygenWebhookSignature } from "../netlify/functions/_shared/creative-ai/heygen-webhook-verify.js";

const SECRET = "whsec_test_secret";
const NOW = 1_800_000_000; // fixed unix seconds for deterministic tests

function sign(body, secret = SECRET) {
  return createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex");
}

test("verifyHeygenWebhookSignature: accepts a correctly-signed, fresh payload", () => {
  const body = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: "vid-1" } });
  const result = verifyHeygenWebhookSignature({
    rawBody: body,
    signatureHeader: sign(body),
    timestampHeader: String(NOW),
    secret: SECRET,
    now: NOW
  });
  assert.equal(result.valid, true);
});

test("verifyHeygenWebhookSignature: rejects a body signed with the wrong secret", () => {
  const body = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: "vid-1" } });
  const result = verifyHeygenWebhookSignature({
    rawBody: body,
    signatureHeader: sign(body, "wrong_secret"),
    timestampHeader: String(NOW),
    secret: SECRET,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("verifyHeygenWebhookSignature: rejects a tampered body (signature was computed over the original)", () => {
  const originalBody = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: "vid-1" } });
  const signature = sign(originalBody);
  const tamperedBody = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: "vid-ATTACKER" } });
  const result = verifyHeygenWebhookSignature({
    rawBody: tamperedBody,
    signatureHeader: signature,
    timestampHeader: String(NOW),
    secret: SECRET,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("verifyHeygenWebhookSignature: rejects a stale timestamp outside the skew window", () => {
  const body = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: "vid-1" } });
  const staleTimestamp = NOW - 301;
  const result = verifyHeygenWebhookSignature({
    rawBody: body,
    signatureHeader: sign(body),
    timestampHeader: String(staleTimestamp),
    secret: SECRET,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "timestamp_out_of_range");
});

test("verifyHeygenWebhookSignature: accepts a timestamp right at the edge of the skew window", () => {
  const body = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: "vid-1" } });
  const result = verifyHeygenWebhookSignature({
    rawBody: body,
    signatureHeader: sign(body),
    timestampHeader: String(NOW - 300),
    secret: SECRET,
    now: NOW
  });
  assert.equal(result.valid, true);
});

test("verifyHeygenWebhookSignature: rejects when the endpoint secret is missing — never verifies against nothing", () => {
  const body = "{}";
  const result = verifyHeygenWebhookSignature({ rawBody: body, signatureHeader: "abc", timestampHeader: String(NOW), secret: "", now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "missing_endpoint_secret");
});

test("verifyHeygenWebhookSignature: rejects a missing signature header", () => {
  const result = verifyHeygenWebhookSignature({ rawBody: "{}", signatureHeader: "", timestampHeader: String(NOW), secret: SECRET, now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "missing_signature_header");
});

test("verifyHeygenWebhookSignature: rejects a missing timestamp header", () => {
  const result = verifyHeygenWebhookSignature({ rawBody: "{}", signatureHeader: "abc", timestampHeader: "", secret: SECRET, now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "missing_timestamp_header");
});

test("verifyHeygenWebhookSignature: rejects a non-numeric timestamp", () => {
  const result = verifyHeygenWebhookSignature({ rawBody: "{}", signatureHeader: "abc", timestampHeader: "not-a-number", secret: SECRET, now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid_timestamp");
});

test("verifyHeygenWebhookSignature: accepts an optional 'sha256=' scheme prefix on the signature header", () => {
  const body = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: "vid-1" } });
  const result = verifyHeygenWebhookSignature({
    rawBody: body,
    signatureHeader: `sha256=${sign(body)}`,
    timestampHeader: String(NOW),
    secret: SECRET,
    now: NOW
  });
  assert.equal(result.valid, true);
});

test("verifyHeygenWebhookSignature: rejects a malformed (non-hex) signature without throwing", () => {
  // Node's Buffer.from(str, "hex") is lenient — it decodes as far as it can
  // rather than throwing on an invalid character, so this lands on the
  // ordinary length/timing-safe mismatch path (still correctly rejected),
  // not the malformed_signature guard (kept in the source as a defensive
  // fallback for a genuinely-throwing decode, which never fires here).
  const result = verifyHeygenWebhookSignature({
    rawBody: "{}",
    signatureHeader: "not-hex-zzz",
    timestampHeader: String(NOW),
    secret: SECRET,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.ok(["signature_mismatch", "malformed_signature"].includes(result.reason));
});

test("verifyHeygenWebhookSignature: works against a real Buffer body, not just a string", () => {
  const bodyStr = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: "vid-1" } });
  const bodyBuffer = Buffer.from(bodyStr, "utf8");
  const result = verifyHeygenWebhookSignature({
    rawBody: bodyBuffer,
    signatureHeader: sign(bodyStr),
    timestampHeader: String(NOW),
    secret: SECRET,
    now: NOW
  });
  assert.equal(result.valid, true);
});
