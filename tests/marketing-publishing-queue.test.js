import test from "node:test";
import assert from "node:assert/strict";
import {
  computeBackoffSeconds,
  classifyPublishFailure,
  nextJobStateAfterFailure,
  isJobDue,
  buildIdempotencyKey,
  requiresAiDisclosure
} from "../netlify/functions/_shared/marketing-publishing-queue.js";
import { SOCIAL_NOT_LIVE } from "../netlify/functions/_shared/marketing-social-providers.js";

test("computeBackoffSeconds doubles each attempt and is capped at 6 hours", () => {
  assert.equal(computeBackoffSeconds(1), 60);
  assert.equal(computeBackoffSeconds(2), 120);
  assert.equal(computeBackoffSeconds(3), 240);
  assert.equal(computeBackoffSeconds(20), 6 * 60 * 60, "must never exceed the 6-hour cap");
});

test("computeBackoffSeconds never returns something below the base delay, even for attempt 0 or negative input", () => {
  assert.equal(computeBackoffSeconds(0), 60);
  assert.equal(computeBackoffSeconds(-5), 60);
});

test("classifyPublishFailure: a SOCIAL_NOT_LIVE error is classified 'not_live', never retried as if it were transient", () => {
  const err = new Error("nope");
  err.code = SOCIAL_NOT_LIVE;
  assert.equal(classifyPublishFailure(err), "not_live");
});

test("classifyPublishFailure: a 400/422 is 'fatal' — bad content, not a network blip", () => {
  assert.equal(classifyPublishFailure({ statusCode: 400 }), "fatal");
  assert.equal(classifyPublishFailure({ statusCode: 422 }), "fatal");
});

test("classifyPublishFailure: anything unrecognized defaults to 'transient' — the safe default is to retry, not silently drop", () => {
  assert.equal(classifyPublishFailure({ statusCode: 503 }), "transient");
  assert.equal(classifyPublishFailure(new Error("network blip")), "transient");
  assert.equal(classifyPublishFailure(null), "transient");
});

test("nextJobStateAfterFailure: a not_live failure settles to 'failed' immediately — no backoff loop against a provider that doesn't exist", () => {
  const next = nextJobStateAfterFailure({ attempts: 0, maxAttempts: 5, kind: "not_live" });
  assert.equal(next.status, "failed");
  assert.equal(next.attempts, 1);
  assert.equal(next.delaySeconds, null);
});

test("nextJobStateAfterFailure: a fatal failure also settles to 'failed' immediately", () => {
  const next = nextJobStateAfterFailure({ attempts: 0, maxAttempts: 5, kind: "fatal" });
  assert.equal(next.status, "failed");
});

test("nextJobStateAfterFailure: a transient failure under max_attempts requeues with backoff", () => {
  const next = nextJobStateAfterFailure({ attempts: 1, maxAttempts: 5, kind: "transient" });
  assert.equal(next.status, "queued");
  assert.equal(next.attempts, 2);
  assert.equal(next.delaySeconds, computeBackoffSeconds(2));
});

test("nextJobStateAfterFailure: a transient failure that exhausts max_attempts goes to dead_letter, never silently vanishes", () => {
  const next = nextJobStateAfterFailure({ attempts: 4, maxAttempts: 5, kind: "transient" });
  assert.equal(next.attempts, 5);
  assert.equal(next.status, "dead_letter");
  assert.equal(next.delaySeconds, null);
});

test("isJobDue: a queued job whose next_attempt_at has passed is due", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  assert.equal(isJobDue({ status: "queued", next_attempt_at: "2026-09-01T11:00:00Z" }, now), true);
});

test("isJobDue: a queued job scheduled in the future is not due yet", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  assert.equal(isJobDue({ status: "queued", next_attempt_at: "2026-09-01T13:00:00Z" }, now), false);
});

test("isJobDue: a job in any non-queued status is never due, regardless of its next_attempt_at", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  for (const status of ["running", "succeeded", "failed", "dead_letter", "canceled"]) {
    assert.equal(isJobDue({ status, next_attempt_at: "2026-09-01T11:00:00Z" }, now), false, `status ${status} must never be due`);
  }
});

test("isJobDue: a malformed/missing next_attempt_at is never due rather than throwing", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  assert.equal(isJobDue({ status: "queued", next_attempt_at: null }, now), false);
  assert.equal(isJobDue({ status: "queued", next_attempt_at: "not a date" }, now), false);
  assert.equal(isJobDue(null, now), false);
});

test("buildIdempotencyKey is deterministic and namespaced per variant", () => {
  assert.equal(buildIdempotencyKey("abc-123"), "variant:abc-123");
  assert.equal(buildIdempotencyKey("abc-123"), buildIdempotencyKey("abc-123"));
});

// Launch-blocker fix (Blocker 1): this used to check its own hardcoded
// 3-platform allowlist that disagreed with disclosure-policy.js's real
// policy table (which requires disclosure on all 7 platforms for AI
// content, Pinterest and Google Business Profile included, just with
// lower-confidence/unconfirmed mechanisms — see PLATFORM_DISCLOSURE_POLICY).
// requiresAiDisclosure() now delegates to the one authoritative source,
// so it must agree with it for every platform, not just Meta/TikTok.
test("requiresAiDisclosure: true for every supported platform when content is real AI-generated content", () => {
  assert.equal(requiresAiDisclosure("facebook", true), true);
  assert.equal(requiresAiDisclosure("instagram", true), true);
  assert.equal(requiresAiDisclosure("tiktok", true), true);
  assert.equal(requiresAiDisclosure("linkedin", true), true);
  assert.equal(requiresAiDisclosure("pinterest", true), true, "Pinterest's Gen-AI-label policy requires disclosure too, even though its API mechanism is unconfirmed — that's a mechanism gap, not a requirement exemption");
  assert.equal(requiresAiDisclosure("google_business", true), true);
  assert.equal(requiresAiDisclosure("youtube", true), true);
});

test("requiresAiDisclosure: never flags disclosure for content that was NOT AI-generated, on any platform", () => {
  assert.equal(requiresAiDisclosure("facebook", false), false);
  assert.equal(requiresAiDisclosure("pinterest", false), false);
});
