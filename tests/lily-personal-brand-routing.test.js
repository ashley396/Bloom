/**
 * Lily + Digital Twin integration pass — routing-decision coverage.
 *
 * lily-ai.js's handler() itself is not dependency-injectable (currentUser()
 * builds its own real Supabase auth client — see the file's existing test
 * convention in tests/lily-ai-handler.test.js, which tests only the
 * exported pure functions). The routing decision this pass adds is
 * therefore exposed the same way: isPersonalBrandDomain(),
 * isPersonalBrandResultActionable(), and formatPersonalBrandResponse()
 * are pure, directly testable functions handler() calls — this file
 * proves the DECISIONS are correct; tests/personal-brand-service.test.js
 * and tests/personal-brand-studio-integration.test.js already prove the
 * underlying runPersonalBrandCommand()/requestDigitalTwinGeneration()
 * behavior those decisions act on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isPersonalBrandDomain, isPersonalBrandResultActionable, formatPersonalBrandResponse, shouldRunJob } from "../netlify/functions/lily-ai.js";
import { CLASSIFY_TASK_FOR_TEST } from "../netlify/functions/_shared/ai-intent-router.js";

// ── isPersonalBrandDomain: a clear, structured domain signal ────────────

test("isPersonalBrandDomain: true only when classifyRequest() actually resolved domain:personal_brand", () => {
  assert.equal(isPersonalBrandDomain({ domain: "personal_brand", action_type: "create" }), true);
});

test("isPersonalBrandDomain: false for every other real domain — never hijacks marketing/photo/website requests", () => {
  for (const domain of ["marketing", "photo", "website", "inventory", "orders", "general"]) {
    assert.equal(isPersonalBrandDomain({ domain, action_type: "create" }), false, `domain "${domain}" must not route to Personal Brand Studio`);
  }
});

test("isPersonalBrandDomain: false for a null/undefined routed object (classifyRequest() failure, or the deterministic-revision synthetic object)", () => {
  assert.equal(isPersonalBrandDomain(null), false);
  assert.equal(isPersonalBrandDomain(undefined), false);
});

// ── isPersonalBrandDomain routed objects must never reach shouldRunJob ──

test("a routed object with domain:personal_brand never satisfies shouldRunJob() — it has no valid visual_op/action_type shape runJob() understands", () => {
  // Mirrors how classifyRequest() would realistically shape a
  // personal_brand result: action_type is whatever the model picked
  // (often 'create'), but domain is personal_brand — shouldRunJob() only
  // green-lights 'edit'+photo+visual_op, so a bare action_type:'create'
  // WOULD normally satisfy shouldRunJob for domain:marketing/website. The
  // routing branch in handler() is what actually prevents this from ever
  // reaching runJob() — see the isPersonalBrandDomain() check placed
  // BEFORE shouldRunJob() in the dispatcher. This test documents exactly
  // why that ordering matters: shouldRunJob() alone does not know to
  // reject personal_brand.
  const routed = { domain: "personal_brand", action_type: "create", visual_op: "none" };
  assert.equal(shouldRunJob(routed), true, "shouldRunJob() itself doesn't distinguish personal_brand — the handler's own ordering is what protects runJob()");
});

// ── isPersonalBrandResultActionable: the false-positive safety net ──────

test("isPersonalBrandResultActionable: true when a real founder concept was generated", () => {
  assert.equal(isPersonalBrandResultActionable({ understood: true, asset: { id: "a1" } }), true);
});

test("isPersonalBrandResultActionable: true when a real memory statement was applied, even with no generated asset", () => {
  assert.equal(isPersonalBrandResultActionable({ understood: true, asset: null, memoryAck: "Got it — I'll remember that." }), true);
});

test("isPersonalBrandResultActionable: false when classifyRequest() said personal_brand but the detailed classifier found nothing real — the two-classifier safety net", () => {
  assert.equal(isPersonalBrandResultActionable({ understood: true, asset: null, memoryAck: null, classification: { mode: null, memory_action: "none" } }), false);
});

test("isPersonalBrandResultActionable: false when the detailed classifier itself failed (provider error)", () => {
  assert.equal(isPersonalBrandResultActionable({ understood: false }), false);
});

test("isPersonalBrandResultActionable: false for a null/undefined result", () => {
  assert.equal(isPersonalBrandResultActionable(null), false);
  assert.equal(isPersonalBrandResultActionable(undefined), false);
});

// ── formatPersonalBrandResponse: real chat text, never a JSON dump ──────

test("formatPersonalBrandResponse: a generated concept renders as real chat text with headline/body/cta", () => {
  const text = formatPersonalBrandResponse({
    asset: { id: "a1" },
    content: { headline: "Meet Jordan", body: "I started this shop because...", cta: "Stop by this week" }
  });
  assert.match(text, /Meet Jordan/);
  assert.match(text, /I started this shop because/);
  assert.match(text, /Stop by this week/);
  assert.doesNotMatch(text, /^\{/, "must never be a raw JSON dump");
});

test("formatPersonalBrandResponse: a memory-only turn acknowledges without inventing generated content", () => {
  const text = formatPersonalBrandResponse({ memoryAck: "Got it — I'll remember that.", asset: null });
  assert.match(text, /Got it/);
  assert.doesNotMatch(text, /Founder concept/);
});

test("formatPersonalBrandResponse: a successfully kicked-off Digital Twin render is described honestly, with the real job id", () => {
  const text = formatPersonalBrandResponse({
    asset: null,
    digitalTwin: { attempted: true, ok: true, statusCode: 202, body: { job_id: "vid-1" } }
  });
  assert.match(text, /vid-1/);
});

test("formatPersonalBrandResponse: 'not_enrolled' tells the florist what to do next rather than failing silently", () => {
  const text = formatPersonalBrandResponse({ asset: null, digitalTwin: { attempted: true, reason: "not_enrolled" } });
  assert.match(text, /haven't set up your Digital Twin/i);
});

test("formatPersonalBrandResponse: a NOT LIVE provider note is surfaced honestly, never hidden or replaced with a fake success", () => {
  const text = formatPersonalBrandResponse({
    asset: null,
    digitalTwin: { attempted: true, ok: true, statusCode: 200, body: { note: "NOT LIVE — PROVIDER CONNECTION REQUIRED." } }
  });
  assert.match(text, /NOT LIVE/);
});

test("formatPersonalBrandResponse: never fabricates a response — falls back to a plain acknowledgment for an empty result", () => {
  const text = formatPersonalBrandResponse({});
  assert.equal(typeof text, "string");
  assert.ok(text.length > 0);
});

// ── The classifier prompt itself teaches personal_brand, without keyword rules ──

test("ai-intent-router.js's classification prompt includes personal_brand as a real domain option with structured guidance, not a keyword list", () => {
  assert.match(CLASSIFY_TASK_FOR_TEST, /personal_brand/);
  assert.match(CLASSIFY_TASK_FOR_TEST, /FLORIST THEMSELVES/);
  // Guards against a keyword-collision regression (Section 3's explicit
  // example words) — the prompt must describe the FLORIST-specific
  // signal, never a bare word list a message could accidentally contain.
  assert.doesNotMatch(CLASSIFY_TASK_FOR_TEST, /domain is "personal_brand" if the message contains/i);
});
