import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

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
test.afterEach(() => {
  delete process.env.HEYGEN_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
});

function event(action, body, { method = "POST", qs = {} } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { action, ...qs },
    headers: {},
    body: JSON.stringify({ action, ...body })
  };
}

// ── set_content_disclosure ──────────────────────────────────────────────

test("set_content_disclosure: requires super_admin", async () => {
  const client = createFakeSupabaseClient([{ data: { user_id: "u1", role: "support", active: true }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("set_content_disclosure", { shop_id: "shop-1", platform_variant_id: "variant-1" }));
  assert.equal(res.statusCode, 403);
});

test("set_content_disclosure: 404s when the variant doesn't exist for this shop, never guesses", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: null, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("set_content_disclosure", { shop_id: "shop-1", platform_variant_id: "variant-1" }));
  assert.equal(res.statusCode, 404);
});

test("set_content_disclosure: computes ai_disclosure_required from the platform's real policy, never trusts a caller-supplied flag", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "variant-1", platform: "tiktok" }, error: null }, // variant lookup
    { data: { id: "variant-1", platform: "tiktok", ai_disclosure_required: true, disclosure_method: "native_label", disclosure_applied: true, disclosure_policy_version: "tiktok-ai-labeling-2026" }, error: null }, // update
    { data: null, error: null } // writeCommandAudit insert
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(
    event("set_content_disclosure", {
      shop_id: "shop-1",
      platform_variant_id: "variant-1",
      avatar_used: true,
      disclosure_applied: true,
      // Attempted spoof — must be ignored; the server recomputes this.
      ai_disclosure_required: false
    })
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.determination.required, true);
  const updateCall = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall.payload.ai_disclosure_required, true, "server-computed value must win over any caller-supplied flag");
});

test("set_content_disclosure: no AI flags -> disclosure not required, even if the caller claims disclosure_applied", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "variant-1", platform: "facebook" }, error: null },
    { data: { id: "variant-1", platform: "facebook", ai_disclosure_required: false }, error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("set_content_disclosure", { shop_id: "shop-1", platform_variant_id: "variant-1", human_edited: true }));
  const body = JSON.parse(res.body);
  assert.equal(body.determination.required, false);
});

// ── run_publishing_queue: fail-closed disclosure gate ──────────────────

test("run_publishing_queue: a job whose disclosure is required but not applied settles to 'failed' WITHOUT ever calling the social provider", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: [{ id: "job-1" }], error: null }, // claimDueJobs: candidate select
    { data: [{ id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", status: "running", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }], error: null }, // claimDueJobs: atomic claim
    { data: { id: "variant-1", platform: "tiktok", caption: "hi", scheduled_at: null, ai_disclosure_required: true, disclosure_applied: false }, error: null }, // variant lookup
    { data: null, error: null }, // publishing_jobs update (failure path)
    { data: null, error: null } // platform_variants update (failure path)
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("run_publishing_queue", { shop_id: "shop-1" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.results[0].outcome, "failed");
  // Two marketing_publishing_jobs updates now happen per job: the claim
  // step (status:"running", no last_error_code) and this outcome update —
  // take the last matching call, not the first.
  const jobUpdate = client.calls.filter((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update")).pop();
  assert.equal(jobUpdate.payload.last_error_code, "fatal");
  assert.match(jobUpdate.payload.last_error, /disclosure/i);
});

test("run_publishing_queue: a job whose disclosure was applied proceeds to the (still not-live) provider exactly as before this pass", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: [{ id: "job-1" }], error: null },
    { data: [{ id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", status: "running", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }], error: null },
    { data: { id: "variant-1", platform: "tiktok", caption: "hi", scheduled_at: null, ai_disclosure_required: true, disclosure_applied: true }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("run_publishing_queue", { shop_id: "shop-1" }));
  const body = JSON.parse(res.body);
  assert.equal(body.results[0].outcome, "failed");
  // Two marketing_publishing_jobs updates now happen per job: the claim
  // step (status:"running", no last_error_code) and this outcome update —
  // take the last matching call, not the first.
  const jobUpdate = client.calls.filter((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update")).pop();
  assert.equal(jobUpdate.payload.last_error_code, "not_live", "must reach the pre-existing not-live path, not the disclosure gate");
});

test("run_publishing_queue: a job with no disclosure requirement at all is unaffected — baseline not-live behavior preserved exactly", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: [{ id: "job-1" }], error: null },
    { data: [{ id: "job-1", shop_id: "shop-1", platform_variant_id: "variant-1", status: "running", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString() }], error: null },
    { data: { id: "variant-1", platform: "facebook", caption: "hi", scheduled_at: null }, error: null }, // no disclosure columns at all — older-shape row
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("run_publishing_queue", { shop_id: "shop-1" }));
  const body = JSON.parse(res.body);
  // Two marketing_publishing_jobs updates now happen per job: the claim
  // step (status:"running", no last_error_code) and this outcome update —
  // take the last matching call, not the first.
  const jobUpdate = client.calls.filter((c) => c.table === "marketing_publishing_jobs" && c.ops.some((op) => op[0] === "update")).pop();
  assert.equal(jobUpdate.payload.last_error_code, "not_live");
  assert.equal(body.results[0].outcome, "failed");
});

// ── personal_brand_concept_to_content_item: disclosure fields at creation ──
// Launch-blocker fix (Blocker 1): this insert used to leave every
// disclosure column at its DB fail-open default. It now computes them
// from the concept's own known AI-provenance (uses_ai_clone) at insert
// time, the same moment the variant rows are created.

test("personal_brand_concept_to_content_item: a non-clone image handoff sets ai_disclosure_required=true (generative image) on every inserted variant", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "asset-1", asset_type: "founder_concept", content: { headline: "Meet the founder", body: "..." } }, error: null }, // asset lookup
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "idea" }, error: null }, // content_items insert
    {
      data: [
        { id: "v-1", platform: "linkedin" },
        { id: "v-2", platform: "facebook" },
        { id: "v-3", platform: "instagram" }
      ],
      error: null
    }, // platform_variants insert
    { data: null, error: null } // writeCommandAudit insert
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(
    event("personal_brand_concept_to_content_item", { shop_id: "shop-1", asset_id: "asset-1", mode: "founder_portrait", uses_ai_clone: false })
  );
  assert.equal(res.statusCode, 201);
  const variantInsert = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "insert"));
  assert.ok(variantInsert, "expected a marketing_platform_variants insert");
  for (const row of variantInsert.payload) {
    assert.equal(row.ai_disclosure_required, true, `platform "${row.platform}" must be marked disclosure-required for a founder-concept image`);
    assert.equal(row.generative_image_used, true);
    assert.equal(row.avatar_used, false);
    assert.equal(row.voice_used, false);
    assert.ok(row.disclosure_checked_at, "must be explicitly checked at insert time, not left unset");
  }
});

test("personal_brand_concept_to_content_item: a Digital-Twin (uses_ai_clone) handoff sets avatar_used AND voice_used on every inserted variant", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "asset-1", asset_type: "founder_concept", content: { headline: "Meet the founder", body: "..." } }, error: null },
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "idea" }, error: null },
    { data: [{ id: "v-1", platform: "linkedin" }, { id: "v-2", platform: "facebook" }, { id: "v-3", platform: "instagram" }], error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(
    event("personal_brand_concept_to_content_item", { shop_id: "shop-1", asset_id: "asset-1", mode: "founder_portrait", uses_ai_clone: true })
  );
  assert.equal(res.statusCode, 201);
  const variantInsert = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "insert"));
  for (const row of variantInsert.payload) {
    assert.equal(row.avatar_used, true);
    assert.equal(row.voice_used, true);
    assert.equal(row.ai_disclosure_required, true);
    assert.equal(row.ai_content_type, "avatar_video");
  }
});

// ── clone_job_status: tenant isolation on the persisted job row ────────

test("clone_job_status: a persisted job belonging to a DIFFERENT shop is never trusted — falls through to the not-live/live path instead of leaking cross-tenant status", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "job-1", shop_id: "OTHER-SHOP", provider: "heygen", provider_job_id: "vid-1", status: "completed", result_url: "https://cdn.heygen.com/secret.mp4" }, error: null } // persisted lookup — wrong shop
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("clone_job_status", { shop_id: "shop-1" }, { method: "GET", qs: { job_id: "vid-1" } }));
  const body = JSON.parse(res.body);
  // Must NOT have returned the other shop's cached result — falls through
  // to the not-live provider path since no real keys are configured here.
  assert.notEqual(body.resultUrl, "https://cdn.heygen.com/secret.mp4");
  assert.match(body.note || "", /NOT LIVE/);
});

test("clone_job_status: a persisted job for the CORRECT shop is trusted and returned without a live poll", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "completed", result_url: "https://cdn.heygen.com/x.mp4" }, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("clone_job_status", { shop_id: "shop-1" }, { method: "GET", qs: { job_id: "vid-1" } }));
  const body = JSON.parse(res.body);
  assert.equal(body.status, "completed");
  assert.equal(body.resultUrl, "https://cdn.heygen.com/x.mp4");
  assert.equal(body.source, "webhook");
});

// ── preview_clone_profile: job correlation persistence ─────────────────

test("preview_clone_profile: a video-path result is persisted to marketing_clone_video_jobs for later webhook correlation", async () => {
  process.env.HEYGEN_API_KEY = "heygen-key";
  process.env.ELEVENLABS_API_KEY = "elevenlabs-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("text-to-speech")) return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
    if (String(url).includes("/v3/videos")) return { ok: true, json: async () => ({ data: { video_id: "vid-1" } }) };
    throw new Error(`unexpected fetch: ${url}`);
  };
  const client = createFakeSupabaseClient(
    [
      superAdminRow(),
      { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-1", status: "rendering" }, error: null } // recordCloneVideoJob insert
    ],
    { storage: createFakeSupabaseStorage() }
  );
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(
    event("preview_clone_profile", { shop_id: "shop-1", avatar_profile_id: "avatar-1", voice_profile_id: "voice-1", script: "Hello there" })
  );
  globalThis.fetch = originalFetch;

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.kind, "video");
  assert.equal(body.jobId, "vid-1");
  const insertCall = client.calls.find((c) => c.table === "marketing_clone_video_jobs" && c.ops.some((op) => op[0] === "insert"));
  assert.ok(insertCall, "expected a marketing_clone_video_jobs insert for job correlation");
  assert.equal(insertCall.payload.provider_job_id, "vid-1");
  assert.equal(insertCall.payload.shop_id, "shop-1");
});
