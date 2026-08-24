import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}
function supportRow() {
  return { data: { user_id: "u1", role: "support", active: true }, error: null };
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
  delete globalThis.__pbFetchRestore;
});

function event(action, body, { method = "POST", qs = {} } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { action, ...qs },
    headers: {},
    body: JSON.stringify({ action, ...body })
  };
}

function mockCloudflare(jsonResult) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(jsonResult) } }) });
  return () => {
    globalThis.fetch = originalFetch;
  };
}

// ── Profile fields ───────────────────────────────────────────────────────

test("get_personal_brand_profile: a shop with no row yet gets honest defaults, exists:false", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: null, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("get_personal_brand_profile", { shop_id: "shop-1" }, { method: "GET" }));
  const body = JSON.parse(res.body);
  assert.equal(body.exists, false);
  assert.equal(body.profile.display_name, "");
  assert.equal(body.style_summary, "");
});

test("update_personal_brand_profile: requires super_admin", async () => {
  const client = createFakeSupabaseClient([supportRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("update_personal_brand_profile", { shop_id: "shop-1", fields: { display_name: "Jordan" } }));
  assert.equal(res.statusCode, 403);
});

test("update_personal_brand_profile: saves real fields for the correct shop", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { display_name: "Jordan Lee", founder_title: "Owner" }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("update_personal_brand_profile", { shop_id: "shop-1", fields: { display_name: "Jordan Lee", founder_title: "Owner" } }));
  assert.equal(res.statusCode, 200);
  const upsertCall = client.calls.find((c) => c.ops.some((op) => op[0] === "upsert"));
  assert.equal(upsertCall.payload.display_name, "Jordan Lee");
});

// ── Preferences (explicit/inferred learning engine) ─────────────────────

test("update_personal_brand_preferences: writes an explicit statement immediately, at full strength", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: null, error: null }, // load: no row yet
    { data: null, error: null } // save upsert
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(
    event("update_personal_brand_preferences", { shop_id: "shop-1", updates: [{ category: "clothing_style", text: "black apron", polarity: "positive" }] })
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.match(body.style_summary, /black apron/);
  const upsertCall = client.calls.find((c) => c.ops.some((op) => op[0] === "upsert"));
  assert.equal(upsertCall.payload.preferences.clothing_style.traits[0].source, "explicit");
});

test("forget_personal_brand_trait: removes a specific trait outright", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    {
      data: { preferences: { clothing_style: { traits: [{ text: "black apron", polarity: "positive", source: "explicit", active: true, evidence_count: 1 }] } } },
      error: null
    },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("forget_personal_brand_trait", { shop_id: "shop-1", category: "clothing_style", text: "black apron" }));
  const body = JSON.parse(res.body);
  assert.equal(body.preferences.clothing_style.traits.length, 0);
});

test("reset_personal_brand_preferences: clears every learned trait, requires super_admin", async () => {
  const deniedClient = createFakeSupabaseClient([supportRow()]);
  const deniedHandler = createMarketingStudioHandler(baseDeps(deniedClient));
  const denied = await deniedHandler(event("reset_personal_brand_preferences", { shop_id: "shop-1" }));
  assert.equal(denied.statusCode, 403);

  const client = createFakeSupabaseClient([superAdminRow(), { data: null, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("reset_personal_brand_preferences", { shop_id: "shop-1" }));
  const body = JSON.parse(res.body);
  assert.equal(body.style_summary, "");
});

test("record_personal_brand_signal: repeated Approve promotes a candidate trait after real repetition, never on the first signal", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(
    event("record_personal_brand_signal", { shop_id: "shop-1", signal: "approved", traits: [{ category: "lighting", text: "warm window light", polarity: "positive" }] })
  );
  const body = JSON.parse(res.body);
  assert.equal(body.style_summary, "", "one approval must not be enough to promote a preference");
});

// ── Reference photo library (consent, tenant isolation) ─────────────────

test("upload_personal_brand_reference_photo: refuses without explicit consented_to_store", async () => {
  const client = createFakeSupabaseClient([superAdminRow()], { storage: createFakeSupabaseStorage() });
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("upload_personal_brand_reference_photo", { shop_id: "shop-1", data_url: "data:image/jpeg;base64,xx", consented_to_store: false }));
  assert.equal(res.statusCode, 400);
});

test("upload_personal_brand_reference_photo: stores real consent flags for a real shop", async () => {
  const client = createFakeSupabaseClient(
    [superAdminRow(), { data: { id: "photo-1", shop_id: "shop-1", allow_image_generation: true, allow_avatar_generation: false }, error: null }],
    { storage: createFakeSupabaseStorage() }
  );
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(
    event("upload_personal_brand_reference_photo", {
      shop_id: "shop-1",
      data_url: "data:image/jpeg;base64,xx",
      consented_to_store: true,
      allow_image_generation: true,
      label: "favorite_reference"
    })
  );
  assert.equal(res.statusCode, 201);
  const insertCall = client.calls.find((c) => c.table === "marketing_personal_brand_reference_photos" && c.ops.some((op) => op[0] === "insert"));
  assert.equal(insertCall.payload.consented_to_store, true);
  assert.equal(insertCall.payload.allow_image_generation, true);
  assert.equal(insertCall.payload.allow_avatar_generation, false);
  assert.equal(insertCall.payload.label, "favorite_reference");
});

test("update_personal_brand_reference_photo: 'do_not_use' label and revoke are both real, independent state changes", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { id: "photo-1", label: "do_not_use", revoked_at: "2026-08-25T00:00:00.000Z" }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("update_personal_brand_reference_photo", { shop_id: "shop-1", photo_id: "photo-1", label: "do_not_use", revoked: true }));
  assert.equal(res.statusCode, 200);
  const updateCall = client.calls.find((c) => c.ops.some((op) => op[0] === "update"));
  assert.equal(updateCall.payload.label, "do_not_use");
  assert.ok(updateCall.payload.revoked_at);
});

test("update_personal_brand_reference_photo: a photo belonging to a different shop 404s rather than leaking cross-tenant access", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: null, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("update_personal_brand_reference_photo", { shop_id: "shop-1", photo_id: "photo-owned-by-other-shop", revoked: true }));
  assert.equal(res.statusCode, 404);
});

test("delete_personal_brand_reference_photo: a real, separate action from revoke", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { id: "photo-1" }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("delete_personal_brand_reference_photo", { shop_id: "shop-1", photo_id: "photo-1" }));
  assert.equal(res.statusCode, 200);
  const deleteCall = client.calls.find((c) => c.ops.some((op) => op[0] === "delete"));
  assert.ok(deleteCall);
});

// ── Structured feedback ──────────────────────────────────────────────────

test("submit_personal_brand_feedback: rejects an unrecognized reason tag", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("submit_personal_brand_feedback", { shop_id: "shop-1", asset_id: "asset-1", reason: "not_a_real_reason" }));
  assert.equal(res.statusCode, 400);
});

test("submit_personal_brand_feedback: records a real reason against a real asset", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: { id: "fb-1", reason: "hair_wrong" }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("submit_personal_brand_feedback", { shop_id: "shop-1", asset_id: "asset-1", reason: "hair_wrong", note: "wrong style" }));
  assert.equal(res.statusCode, 201);
});

// ── Founder-concept generation ────────────────────────────────────────────

test("generate_personal_brand_concept: rejects an unknown mode", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("generate_personal_brand_concept", { shop_id: "shop-1", mode: "not_a_real_mode" }));
  assert.equal(res.statusCode, 400);
});

test("generate_personal_brand_concept: generates and persists a real founder_concept asset grounded in this shop's own profile", async () => {
  const restore = mockCloudflare({
    headline: "Meet Jordan",
    body: "I started this shop because flowers say what words can't.",
    cta: "Visit us this week",
    visual_brief: "Warm shop interior",
    founder_presence_brief: "Behind the counter, black apron, genuine smile",
    hashtags: ["#florist"]
  });
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { display_name: "Jordan Lee", preferences: {} }, error: null }, // loadPersonalBrandProfile
    { data: null, error: null }, // marketing_generation_usage insert
    { data: { id: "asset-1", asset_type: "founder_concept" }, error: null } // persistGeneratedAsset insert
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  try {
    const res = await handler(event("generate_personal_brand_concept", { shop_id: "shop-1", mode: "founder_portrait", message: "make me a founder portrait" }));
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.asset.asset_type, "founder_concept");
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets" && c.ops.some((op) => op[0] === "insert"));
    assert.equal(assetInsert.payload.asset_type, "founder_concept");
  } finally {
    restore();
  }
});

// ── Lily command entrypoint (Section 8) ──────────────────────────────────

test("personal_brand_command: 'I don't dress like that. Remember it.' writes a real memory update and does NOT generate anything (no mode)", async () => {
  const restore = mockCloudflare({
    mode: null,
    memory_action: "remember_avoid",
    memory_category: "clothing_style",
    memory_text: "that outfit",
    use_digital_twin: false,
    use_voice: false,
    suppress_voice: false,
    target_platform: null,
    content_format_hint: null,
    tone_hint: null,
    summary: "Doesn't want to be dressed like that again."
  });
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: null, error: null }, // load profile
    { data: null, error: null } // save preferences (memory write)
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  try {
    const res = await handler(event("personal_brand_command", { shop_id: "shop-1", message: "I don't dress like that. Remember it." }));
    const body = JSON.parse(res.body);
    assert.equal(body.understood, true);
    assert.equal(body.asset, null);
    assert.match(body.memory_ack, /remember/i);
    const upsertCall = client.calls.find((c) => c.ops.some((op) => op[0] === "upsert"));
    assert.equal(upsertCall.payload.preferences.clothing_style.traits[0].polarity, "negative");
  } finally {
    restore();
  }
});

test("personal_brand_command: an unrecognized/failed classification returns understood:false without crashing", async () => {
  const restore = mockCloudflare(null);
  // Force the classifier's fetch to fail entirely so classifyPersonalBrandCommand returns null.
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  try {
    const res = await handler(event("personal_brand_command", { shop_id: "shop-1", message: "asdkjaslkdj" }));
    const body = JSON.parse(res.body);
    assert.equal(body.understood, false);
  } finally {
    restore();
  }
});

test("personal_brand_command: requires super_admin", async () => {
  const client = createFakeSupabaseClient([supportRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("personal_brand_command", { shop_id: "shop-1", message: "make me a founder portrait" }));
  assert.equal(res.statusCode, 403);
});

// ── Platform-variant planning ─────────────────────────────────────────────

test("plan_personal_brand_platform_variants: returns a real per-destination plan", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("plan_personal_brand_platform_variants", { shop_id: "shop-1", mode: "founder_portrait", platforms: ["instagram"] }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.plan[0].platform, "instagram");
  assert.ok(body.plan[0].destinations.some((d) => d.destination === "instagram_reels"));
});

// ── Marketing Studio handoff ──────────────────────────────────────────────

test("personal_brand_concept_to_content_item: 404s on an asset that isn't a founder_concept", async () => {
  const client = createFakeSupabaseClient([superAdminRow(), { data: null, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("personal_brand_concept_to_content_item", { shop_id: "shop-1", asset_id: "asset-1", mode: "founder_portrait" }));
  assert.equal(res.statusCode, 404);
});

test("personal_brand_concept_to_content_item: creates a real content_item + platform variants through the EXISTING pipeline", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "asset-1", asset_type: "founder_concept", content: { headline: "Meet Jordan", body: "...", founder_presence_brief: "..." } }, error: null },
    { data: { id: "item-1", content_type: "image_post", title: "Founder Portrait — Meet Jordan", brief: "...", status: "idea" }, error: null },
    { data: [{ id: "v1", platform: "linkedin" }, { id: "v2", platform: "facebook" }, { id: "v3", platform: "instagram" }], error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("personal_brand_concept_to_content_item", { shop_id: "shop-1", asset_id: "asset-1", mode: "founder_portrait" }));
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.item.status, "idea");
  assert.equal(body.variants.length, 3);
  const variantInsert = client.calls.find((c) => c.table === "marketing_platform_variants" && c.ops.some((op) => op[0] === "insert"));
  assert.deepEqual(variantInsert.payload.map((v) => v.platform).sort(), ["facebook", "instagram", "linkedin"]);
});

// ── Digital Twin handoff (Section 11) — consent-gated, never fakes delivery ──

test("request_personal_brand_digital_twin: refuses without a consent_id at all", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("request_personal_brand_digital_twin", { shop_id: "shop-1", asset_id: "asset-1", avatar_profile_id: "avatar-1", platform: "instagram" }));
  assert.equal(res.statusCode, 400);
});

test("request_personal_brand_digital_twin: refuses when the consent grant doesn't cover the requested platform", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "asset-1", asset_type: "founder_concept", content: {} }, error: null },
    { data: { id: "consent-1", avatar_permission: true, voice_permission: false, approved_usage: ["social_video"], approved_platforms: ["facebook"], revoked_at: null }, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(
    event("request_personal_brand_digital_twin", { shop_id: "shop-1", asset_id: "asset-1", avatar_profile_id: "avatar-1", consent_id: "consent-1", platform: "instagram" })
  );
  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.body);
  assert.match(body.error, /platform_not_approved/);
});

test("request_personal_brand_digital_twin: authorized but NOT LIVE — no keys configured — never fakes a render", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "asset-1", asset_type: "founder_concept", content: {} }, error: null },
    { data: { id: "consent-1", avatar_permission: true, voice_permission: false, approved_usage: ["social_video"], approved_platforms: ["instagram"], revoked_at: null }, error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(
    event("request_personal_brand_digital_twin", { shop_id: "shop-1", asset_id: "asset-1", avatar_profile_id: "avatar-1", consent_id: "consent-1", platform: "instagram" })
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.match(body.note, /NOT LIVE/);
});

test("request_personal_brand_digital_twin: a revoked consent row is refused even if its stored flags look permissive", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "asset-1", asset_type: "founder_concept", content: {} }, error: null },
    {
      data: { id: "consent-1", avatar_permission: true, voice_permission: true, approved_usage: ["social_video"], approved_platforms: ["instagram"], revoked_at: "2026-08-01T00:00:00.000Z" },
      error: null
    }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(
    event("request_personal_brand_digital_twin", { shop_id: "shop-1", asset_id: "asset-1", avatar_profile_id: "avatar-1", consent_id: "consent-1", platform: "instagram" })
  );
  assert.equal(res.statusCode, 403);
});

test("request_personal_brand_digital_twin: live path kicks off a real render and correlates the job, exactly matching preview_clone_profile's precedent", async () => {
  process.env.HEYGEN_API_KEY = "heygen-key";
  process.env.ELEVENLABS_API_KEY = "elevenlabs-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("text-to-speech")) return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
    if (String(url).includes("/v3/videos")) return { ok: true, json: async () => ({ data: { video_id: "vid-twin-1" } }) };
    throw new Error(`unexpected fetch: ${url}`);
  };
  const client = createFakeSupabaseClient(
    [
      superAdminRow(),
      { data: { id: "asset-1", asset_type: "founder_concept", content: { headline: "Meet Jordan", body: "...", founder_presence_brief: "..." } }, error: null },
      { data: { id: "consent-1", avatar_permission: true, voice_permission: true, approved_usage: ["social_video"], approved_platforms: ["instagram"], revoked_at: null }, error: null },
      { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-twin-1", status: "rendering" }, error: null } // recordCloneVideoJob insert
    ],
    { storage: createFakeSupabaseStorage() }
  );
  const handler = createMarketingStudioHandler(baseDeps(client));
  try {
    const res = await handler(
      event("request_personal_brand_digital_twin", {
        shop_id: "shop-1",
        asset_id: "asset-1",
        avatar_profile_id: "avatar-1",
        voice_profile_id: "voice-1",
        consent_id: "consent-1",
        platform: "instagram"
      })
    );
    assert.equal(res.statusCode, 202);
    const body = JSON.parse(res.body);
    assert.equal(body.job_id, "vid-twin-1");
    const jobInsert = client.calls.find((c) => c.table === "marketing_clone_video_jobs" && c.ops.some((op) => op[0] === "insert"));
    assert.equal(jobInsert.payload.provider_job_id, "vid-twin-1");
    assert.equal(jobInsert.payload.source, "content_generation");
    // The Digital Twin result lifecycle fix: the job row must carry every
    // field finalizeDigitalTwinJob() needs at completion time — the
    // source concept to link parent_asset_id to, the profiles/consent
    // used (for the completion-time re-check), and the target platform
    // (for the automatic content-item handoff).
    assert.equal(jobInsert.payload.source_asset_id, "asset-1");
    assert.equal(jobInsert.payload.avatar_profile_id, "avatar-1");
    assert.equal(jobInsert.payload.voice_profile_id, "voice-1");
    assert.equal(jobInsert.payload.consent_id, "consent-1");
    assert.equal(jobInsert.payload.platform, "instagram");
    assert.equal(jobInsert.payload.created_by, "u1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── clone_job_status poll fallback converges on the same finalization path ──

test("clone_job_status: a live poll that discovers completion (no webhook yet) runs the SAME finalizeDigitalTwinJob path a webhook would — real asset created", async () => {
  process.env.HEYGEN_API_KEY = "heygen-key";
  process.env.ELEVENLABS_API_KEY = "elevenlabs-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/v3/video/status")) {
      return { ok: true, json: async () => ({ data: { status: "completed", video_url: "https://cdn.heygen.com/polled.mp4" } }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-poll-1", status: "rendering" }, error: null }, // persisted lookup: still rendering (no webhook yet)
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-poll-1", status: "rendering", source_asset_id: null, consent_id: null, platform: null }, error: null }, // finalizeDigitalTwinJob -> getCloneVideoJob
    { data: { id: "job-1", shop_id: "shop-1", provider: "heygen", provider_job_id: "vid-poll-1", status: "completed", result_url: "https://cdn.heygen.com/polled.mp4", source_asset_id: null, avatar_profile_id: null, voice_profile_id: null, consent_id: null, usage: null, platform: null, created_by: null }, error: null }, // job update
    { data: { id: "asset-poll-1", asset_type: "video" }, error: null }, // persistGeneratedAsset insert
    { data: null, error: null }, // cost usage insert
    { data: { id: "job-1", resulting_asset_id: "asset-poll-1" }, error: null } // markCloneVideoJobFinalized
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  try {
    const res = await handler(event("clone_job_status", { shop_id: "shop-1" }, { method: "GET", qs: { job_id: "vid-poll-1" } }));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.source, "poll");
    assert.equal(body.terminal, true);
    assert.equal(body.assetCreated, true);
    assert.equal(body.assetId, "asset-poll-1");
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets");
    assert.equal(assetInsert.payload.content.video_url, "https://cdn.heygen.com/polled.mp4");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
