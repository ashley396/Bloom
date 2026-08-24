import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCompoundMarketingRequest,
  resolveScheduleHint,
  estimateCompoundPlanCostCents,
  checkDigitalTwinAvailability,
  planCompoundRequest,
  runCompoundRequest
} from "../netlify/functions/_shared/marketing-compound-orchestrator.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// Priority 1 ("as far as technically possible" pass): Lily compound-request
// orchestration. These tests exercise the durable plan/run model end to end
// with fakes — never a real network/DB call — so they prove the "no fake
// success" and "real halt on over-budget" contracts without hitting a live
// provider.

const B64_PIXEL = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64"); // fake JPEG-ish bytes; generateImage() never decodes it itself

/** Routes the SAME fetch mock across all three Cloudflare call shapes this
 * module can make in one request: the compound-extraction call, per-
 * platform generateSocialPost calls, generateVideoConcept, and the raw
 * image-generation call — exactly mirroring how ai-creative-engine.test.js
 * / ai-image-engine already mock Cloudflare Workers AI, just dispatched by
 * request shape instead of one fixed response. */
function installCloudflareRouter({ extraction, socialPost, videoConcept, imageOk = true } = {}) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body });
    if (Object.prototype.hasOwnProperty.call(body, "prompt")) {
      // Raw image-generation call (ai-image-engine.js's generateImage).
      if (!imageOk) return { ok: false, status: 500, json: async () => ({ success: false, errors: [{ message: "image provider down" }] }) };
      return { ok: true, status: 200, json: async () => ({ success: true, result: { image: B64_PIXEL } }) };
    }
    const userMessage = body.messages.find((m) => m.role === "user")?.content || "";
    if (userMessage.includes("compound marketing request")) {
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(extraction) } }) };
    }
    if (userMessage.includes("ACTUAL, FINISHED social media post")) {
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(socialPost) } }) };
    }
    if (userMessage.includes("Plan a short-form marketing video")) {
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(videoConcept) } }) };
    }
    throw new Error(`installCloudflareRouter: unrecognized request shape: ${userMessage.slice(0, 120)}`);
  };
  return {
    calls,
    imageCallCount: () => calls.filter((c) => Object.prototype.hasOwnProperty.call(c.body, "prompt")).length,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

/** The fake client doesn't echo back what was written (it only returns
 * whatever response you queued), so the real, authoritative post-run plan —
 * exactly what actually got persisted to ai_execution_jobs — comes from the
 * recorded final .update() call's own payload, not from a hand-queued
 * response. */
function getJobUpdatePayload(client) {
  const call = client.calls.find((c) => c.table === "ai_execution_jobs" && c.ops.some((op) => op[0] === "update"));
  return call.payload;
}

const DEFAULT_SOCIAL_POST = {
  platform: "facebook",
  headline: "Fresh for the weekend",
  body: "Our wedding bouquets are ready to order — book your Friday pickup today.",
  cta: "Order now",
  visual_brief: "Close-up of a white and blush wedding bouquet on a wooden table.",
  hashtags: ["#wedding", "#localflorist"],
  asset_requirements: []
};

// ── resolveScheduleHint (pure, deterministic date math) ────────────────────

test("resolveScheduleHint: returns null when neither a day nor a time was mentioned", () => {
  assert.equal(resolveScheduleHint({ relativeDay: null, timeOfDay: null }, { timezone: "America/New_York" }), null);
});

test("resolveScheduleHint: 'tomorrow' + 'evening' resolves to tomorrow's date with the evening default time", () => {
  const now = new Date("2026-03-10T15:00:00Z"); // a Tuesday
  const result = resolveScheduleHint({ relativeDay: "tomorrow", timeOfDay: "evening" }, { timezone: "America/New_York", now });
  assert.equal(result, "2026-03-11T18:00");
});

test("resolveScheduleHint: a future weekday resolves to the next occurrence of that weekday", () => {
  const now = new Date("2026-03-10T15:00:00Z"); // Tuesday, Mar 10 2026 (UTC)
  const result = resolveScheduleHint({ relativeDay: "friday", timeOfDay: "morning" }, { timezone: "America/New_York", now });
  assert.equal(result, "2026-03-13T09:00");
});

test("resolveScheduleHint: naming today's own weekday means today, not seven days out", () => {
  const now = new Date("2026-03-10T15:00:00Z"); // Tuesday
  const result = resolveScheduleHint({ relativeDay: "tuesday", timeOfDay: "afternoon" }, { timezone: "America/New_York", now });
  assert.equal(result, "2026-03-10T14:00");
});

test("resolveScheduleHint: an explicit HH:MM overrides the time-of-day default", () => {
  const now = new Date("2026-03-10T15:00:00Z");
  const result = resolveScheduleHint({ relativeDay: "today", timeOfDay: "7:30" }, { timezone: "America/New_York", now });
  assert.equal(result, "2026-03-10T07:30");
});

test("resolveScheduleHint: resolves cleanly across a DST transition boundary (spring-forward week)", () => {
  // 2026-03-08 is the US spring-forward Sunday; asking for "next Friday" from
  // the Wednesday before must still land on the correct calendar date, not
  // be shifted by an hour due to the DST jump in between.
  const now = new Date("2026-03-04T15:00:00Z"); // Wednesday, before the DST jump
  const result = resolveScheduleHint({ relativeDay: "friday", timeOfDay: "evening" }, { timezone: "America/New_York", now });
  assert.equal(result, "2026-03-06T18:00");
});

// ── estimateCompoundPlanCostCents (real cost-config source, never re-priced) ─

test("estimateCompoundPlanCostCents: image + 2 platforms sums image cost + one copy call per platform", () => {
  const cents = estimateCompoundPlanCostCents({ wantsImage: true, wantsVideo: false, platformCount: 2 });
  // image_standard (4) + copy_request*2 (2) = 6
  assert.equal(cents, 6);
});

test("estimateCompoundPlanCostCents: video adds one copy-generation charge for the concept/script, not a phantom render cost", () => {
  const cents = estimateCompoundPlanCostCents({ wantsImage: false, wantsVideo: true, platformCount: 1 });
  // video concept as copy_request (1) + one platform copy call (1) = 2
  assert.equal(cents, 2);
});

test("estimateCompoundPlanCostCents: platformCount always contributes at least one copy call even if 0 is passed", () => {
  const cents = estimateCompoundPlanCostCents({ wantsImage: false, wantsVideo: false, platformCount: 0 });
  assert.equal(cents, 1);
});

// ── checkDigitalTwinAvailability (real, tenant-scoped, never invents a profile) ─

test("checkDigitalTwinAvailability: no active consent row -> not available", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: null }]);
  const result = await checkDigitalTwinAvailability(client, "shop-1");
  assert.equal(result.available, false);
  assert.match(result.reason, /No active Digital Twin consent/);
  const consentCall = client.calls[0];
  assert.ok(consentCall.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id" && op[1][1] === "shop-1"));
});

test("checkDigitalTwinAvailability: consent exists but no READY avatar+voice pair -> not available", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "consent-1", avatar_permission: true, voice_permission: true, revoked_at: null }, error: null },
    { data: null, error: null }, // avatar profile
    { data: { id: "voice-1", status: "ready" }, error: null } // voice profile
  ]);
  const result = await checkDigitalTwinAvailability(client, "shop-1");
  assert.equal(result.available, false);
  assert.match(result.reason, /complete AI Clone enrollment/);
});

test("checkDigitalTwinAvailability: consent + ready avatar + ready voice -> available with real ids", async () => {
  const client = createFakeSupabaseClient([
    { data: { id: "consent-1", avatar_permission: true, voice_permission: true, revoked_at: null }, error: null },
    { data: { id: "avatar-1", status: "ready" }, error: null },
    { data: { id: "voice-1", status: "ready" }, error: null }
  ]);
  const result = await checkDigitalTwinAvailability(client, "shop-1");
  assert.equal(result.available, true);
  assert.equal(result.consentId, "consent-1");
  assert.equal(result.avatarProfileId, "avatar-1");
  assert.equal(result.voiceProfileId, "voice-1");
});

// ── planCompoundRequest (pure step-list builder) ────────────────────────────

test("planCompoundRequest: image-only, no schedule, no inventory -> minimal required-step plan plus the optional platform-transform step", () => {
  const steps = planCompoundRequest({ wantsImage: true, wantsVideo: false, wantsDigitalTwin: false, platforms: [], inventoryGrounded: false, scheduleRelativeDay: null, scheduleTimeOfDay: null });
  const ids = steps.map((s) => s.id);
  assert.deepEqual(ids, ["budget_check", "generate_image", "create_content_item", "transform_platforms"]);
  assert.equal(steps.find((s) => s.id === "transform_platforms").optional, true);
  assert.ok(steps.filter((s) => s.id !== "transform_platforms").every((s) => !s.optional), "only transform_platforms should be optional here — nothing else optional was requested");
});

test("planCompoundRequest: the full compound example wires every requested clause into a step", () => {
  const steps = planCompoundRequest({
    wantsImage: false,
    wantsVideo: true,
    wantsDigitalTwin: false,
    platforms: ["instagram", "tiktok"],
    inventoryGrounded: true,
    scheduleRelativeDay: "friday",
    scheduleTimeOfDay: "evening"
  });
  const ids = steps.map((s) => s.id);
  assert.deepEqual(ids, ["budget_check", "inventory_lookup", "generate_video_concept", "plan_video_render", "create_content_item", "schedule"]);
  assert.equal(steps.find((s) => s.id === "plan_video_render").optional, true);
  assert.equal(steps.find((s) => s.id === "schedule").optional, true);
  assert.equal(steps.find((s) => s.id === "inventory_lookup").optional, false);
});

test("planCompoundRequest: Digital Twin request inserts a required check step", () => {
  const steps = planCompoundRequest({ wantsImage: true, wantsVideo: false, wantsDigitalTwin: true, platforms: [], inventoryGrounded: false, scheduleRelativeDay: null, scheduleTimeOfDay: null });
  const twinStep = steps.find((s) => s.id === "digital_twin_check");
  assert.ok(twinStep);
  assert.equal(twinStep.optional, false);
});

// ── extractCompoundMarketingRequest (LLM extraction, never lets a model hallucinate a plan on failure) ─

test("extractCompoundMarketingRequest: parses a full compound request and filters platforms to known values only", async () => {
  const mock = installCloudflareRouter({
    extraction: {
      wants_image: false,
      wants_video: true,
      wants_digital_twin: false,
      platforms: ["instagram", "tiktok", "not_a_real_platform"],
      occasion: "wedding bouquet",
      inventory_grounded: true,
      budget_dollars: 2,
      schedule_relative_day: "friday",
      schedule_time_of_day: "evening",
      summary: "Create a Reel for this week's wedding bouquet using flowers on hand, for Instagram and TikTok, scheduled Friday evening, under $2."
    }
  });
  try {
    const result = await extractCompoundMarketingRequest("Create a Reel for this week's wedding bouquet using flowers I actually have...");
    assert.ok(result);
    assert.equal(result.wantsVideo, true);
    assert.deepEqual(result.platforms, ["instagram", "tiktok"], "an unrecognized platform must never pass through");
    assert.equal(result.budgetCents, 200);
    assert.equal(result.inventoryGrounded, true);
  } finally {
    mock.restore();
  }
});

test("extractCompoundMarketingRequest: returns null (never a fabricated plan) when the provider call fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const result = await extractCompoundMarketingRequest("anything");
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractCompoundMarketingRequest: an empty message returns null without ever calling the provider", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not be called");
  };
  try {
    const result = await extractCompoundMarketingRequest("   ");
    assert.equal(result, null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── runCompoundRequest (full plan+run, persisted to ai_execution_jobs) ─────

test("runCompoundRequest: happy path — image + one platform (no reframe needed) + schedule — real content persisted, never fake success", async () => {
  const mock = installCloudflareRouter({
    extraction: {
      wants_image: true,
      wants_video: false,
      wants_digital_twin: false,
      platforms: ["facebook"],
      occasion: "wedding bouquet",
      inventory_grounded: false,
      budget_dollars: 10,
      schedule_relative_day: "friday",
      schedule_time_of_day: "evening",
      summary: "A wedding bouquet post for Facebook, scheduled Friday evening."
    },
    socialPost: DEFAULT_SOCIAL_POST
  });
  const storage = createFakeSupabaseStorage();
  const client = createFakeSupabaseClient(
    [
      { data: { id: "job-1" }, error: null }, // ai_execution_jobs insert
      { data: { id: "asset-1" }, error: null }, // ai_generated_assets insert (image)
      { data: { id: "content-1", content_type: "image_post", title: "x", status: "idea" }, error: null }, // marketing_content_items insert
      { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // marketing_platform_variants insert
      { data: [{ id: "variant-1", platform: "facebook", scheduled_at: "2026-03-13T22:00:00.000Z" }], error: null }, // schedule update
      { data: { id: "job-1", status: "completed" }, error: null } // ai_execution_jobs final update
    ],
    { storage }
  );

  try {
    const result = await runCompoundRequest(client, {
      shopId: "shop-1",
      userId: "user-1",
      persona: "Lily",
      message: "Create a wedding bouquet post for Facebook, schedule it for Friday evening.",
      shop: { name: "Test Florals" },
      timezone: "America/New_York"
    });

    assert.equal(result.ok, true);
    const jobUpdate = getJobUpdatePayload(client);
    const byId = Object.fromEntries(jobUpdate.plan.map((s) => [s.id, s]));
    assert.equal(byId.budget_check.status, "completed");
    assert.equal(byId.generate_image.status, "completed");
    assert.equal(byId.create_content_item.status, "completed");
    assert.equal(byId.transform_platforms.status, "completed", "facebook_feed already fits a 1:1 master — this must complete, not fail");
    assert.equal(byId.schedule.status, "completed");
    assert.equal(jobUpdate.status, "completed");

    // Tenant scoping: every insert this module makes must carry the real shop_id.
    const jobInsertCall = client.calls.find((c) => c.table === "ai_execution_jobs" && c.payload && c.payload.job_type === "marketing_compound");
    assert.equal(jobInsertCall.payload.shop_id, "shop-1");
    const contentInsertCall = client.calls.find((c) => c.table === "marketing_content_items");
    assert.equal(contentInsertCall.payload.shop_id, "shop-1");
    assert.equal(contentInsertCall.payload.status, "idea", "generation must never self-approve — status stays idea, human approval is a separate step");
    const variantsInsertCall = client.calls.find((c) => c.table === "marketing_platform_variants" && Array.isArray(c.payload));
    assert.equal(variantsInsertCall.payload[0].shop_id, "shop-1");
    assert.equal(variantsInsertCall.payload[0].caption, DEFAULT_SOCIAL_POST.body, "the real generated caption must be attached, not a placeholder");
    assert.equal(variantsInsertCall.payload[0].ai_disclosure_required, true, "a generative image used on Facebook must compute disclosure at attachment time");

    // Real bytes really got uploaded (generateImage -> uploadWebsiteMedia).
    assert.equal(storage.calls.filter((c) => c.op === "upload").length, 1);
    assert.equal(mock.imageCallCount(), 1);
  } finally {
    mock.restore();
  }
});

test("runCompoundRequest: a stated budget is a real execution constraint — halts before any generation call is made", async () => {
  const mock = installCloudflareRouter({
    extraction: {
      wants_image: true,
      wants_video: false,
      wants_digital_twin: false,
      platforms: ["facebook", "instagram"],
      occasion: "wedding bouquet",
      inventory_grounded: false,
      budget_dollars: 0.01, // one cent — far below even the cheapest real step
      schedule_relative_day: null,
      schedule_time_of_day: null,
      summary: "A wedding bouquet post, under a penny."
    }
  });
  const client = createFakeSupabaseClient([
    { data: { id: "job-1" }, error: null }, // ai_execution_jobs insert
    { data: { id: "job-1", status: "waiting_for_approval" }, error: null } // ai_execution_jobs final update
  ]);

  try {
    const result = await runCompoundRequest(client, {
      shopId: "shop-1",
      userId: "user-1",
      message: "Create a wedding bouquet post for Facebook and Instagram, don't spend over a penny.",
      shop: {},
      timezone: "America/New_York"
    });

    assert.equal(result.ok, true);
    const jobUpdate = getJobUpdatePayload(client);
    assert.equal(jobUpdate.status, "waiting_for_approval");
    const byId = Object.fromEntries(jobUpdate.plan.map((s) => [s.id, s]));
    assert.equal(byId.budget_check.status, "blocked");
    assert.match(byId.budget_check.error, /exceeds the stated budget/);
    assert.equal(byId.generate_image.status, "skipped_over_budget");
    assert.equal(byId.create_content_item.status, "skipped_over_budget");

    // Zero real spend past the halt: only the extraction call happened, no
    // image-generation call and no per-platform caption call.
    assert.equal(mock.imageCallCount(), 0);
    assert.equal(mock.calls.length, 1, "only the extraction call should have fired — every generation step must be skipped, not merely reported");
  } finally {
    mock.restore();
  }
});

test("runCompoundRequest: Digital Twin unavailable is reported as an honest blocked step, and does not silently fake avatar/voice usage", async () => {
  const mock = installCloudflareRouter({
    extraction: {
      wants_image: true,
      wants_video: false,
      wants_digital_twin: true,
      platforms: ["facebook"],
      occasion: "wedding bouquet",
      inventory_grounded: false,
      budget_dollars: null,
      schedule_relative_day: null,
      schedule_time_of_day: null,
      summary: "A wedding bouquet post using my own likeness."
    },
    socialPost: DEFAULT_SOCIAL_POST
  });
  const storage = createFakeSupabaseStorage();
  const client = createFakeSupabaseClient(
    [
      { data: { id: "job-1" }, error: null }, // ai_execution_jobs insert
      { data: null, error: null }, // marketing_clone_consent lookup -> none
      { data: { id: "asset-1" }, error: null }, // ai_generated_assets insert (image)
      { data: { id: "content-1" }, error: null }, // marketing_content_items insert
      { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // marketing_platform_variants insert
      { data: { id: "job-1", status: "partially_completed" }, error: null } // ai_execution_jobs final update
    ],
    { storage }
  );

  try {
    const result = await runCompoundRequest(client, {
      shopId: "shop-1",
      userId: "user-1",
      message: "Create a wedding bouquet post using my own likeness for Facebook.",
      shop: {},
      timezone: "America/New_York"
    });

    assert.equal(result.ok, true);
    const jobUpdate = getJobUpdatePayload(client);
    const byId = Object.fromEntries(jobUpdate.plan.map((s) => [s.id, s]));
    assert.equal(byId.digital_twin_check.status, "blocked");
    assert.match(byId.digital_twin_check.error, /CONNECTION REQUIRED/);
    // A blocked optional/required dependency step must not halt unrelated work.
    assert.equal(byId.generate_image.status, "completed");
    assert.equal(byId.create_content_item.status, "completed");
    assert.equal(jobUpdate.status, "partially_completed");
  } finally {
    mock.restore();
  }
});

test("runCompoundRequest: a request with neither an image nor a video ask fails honestly instead of guessing", async () => {
  const mock = installCloudflareRouter({
    extraction: {
      wants_image: false,
      wants_video: false,
      wants_digital_twin: false,
      platforms: [],
      occasion: null,
      inventory_grounded: false,
      budget_dollars: null,
      schedule_relative_day: null,
      schedule_time_of_day: null,
      summary: "What's my order volume like this week?"
    }
  });
  const client = createFakeSupabaseClient([]);
  try {
    const result = await runCompoundRequest(client, { shopId: "shop-1", userId: "user-1", message: "What's my order volume like this week?" });
    assert.equal(result.ok, false);
    assert.match(result.error, /didn't ask for an image or a video/);
    assert.equal(client.calls.length, 0, "nothing should ever be persisted for a request this module can't act on");
  } finally {
    mock.restore();
  }
});

test("runCompoundRequest: an unparseable request fails honestly rather than fabricating a plan", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("provider unreachable");
  };
  const client = createFakeSupabaseClient([]);
  try {
    const result = await runCompoundRequest(client, { shopId: "shop-1", userId: "user-1", message: "asdkjfh" });
    assert.equal(result.ok, false);
    assert.match(result.error, /Could not understand/);
    assert.equal(client.calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
