import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Priority 1 wiring: the compound_request action makes Lily's compound-
// request orchestrator (marketing-compound-orchestrator.js) actually
// reachable through the real admin API surface, not just importable.

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

function event(action, body, { method = "POST", qs = {} } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { action, ...qs },
    headers: {},
    body: JSON.stringify({ action, ...body })
  };
}

function installCloudflareRouter({ extraction, socialPost, videoConcept } = {}) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const userMessage = body.messages?.find((m) => m.role === "user")?.content || "";
    if (userMessage.includes("compound marketing request")) {
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(extraction) } }) };
    }
    if (userMessage.includes("ACTUAL, FINISHED social media post")) {
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(socialPost) } }) };
    }
    if (userMessage.includes("Plan a short-form marketing video")) {
      return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(videoConcept) } }) };
    }
    throw new Error(`unrecognized Cloudflare request: ${userMessage.slice(0, 120)}`);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

test("compound_request: requires a real message, never guesses a plan from an empty ask", async () => {
  const client = createFakeSupabaseClient([superAdminRow()]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("compound_request", { shop_id: "shop-1", message: "   " }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /message is required/);
});

test("compound_request: a non-super_admin caller is rejected before any orchestration runs", async () => {
  const client = createFakeSupabaseClient([{ data: { user_id: "u1", role: "support", active: true }, error: null }]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("compound_request", { shop_id: "shop-1", message: "Make me a post" }));
  assert.equal(res.statusCode, 403);
  assert.equal(client.calls.length, 1, "no shop/job query should have run before the role check failed");
});

test("compound_request: happy path — looks up the real shop timezone, runs the orchestrator, and audits the result with the real job id", async () => {
  const mock = installCloudflareRouter({
    extraction: {
      wants_image: false,
      wants_video: true,
      wants_digital_twin: false,
      platforms: ["facebook"],
      occasion: "wedding bouquet",
      inventory_grounded: false,
      budget_dollars: 10,
      schedule_relative_day: null,
      schedule_time_of_day: null,
      summary: "A wedding bouquet Reel concept for Facebook."
    },
    videoConcept: {
      concept: "A 15-second look at building a wedding bouquet.",
      script: "",
      scenes: ["0-3s: hands trimming stems — on-screen text: Wedding season is here"],
      captions: ["Book your wedding flowers today"],
      hashtags: ["#wedding"],
      suggested_length_seconds: 15
    },
    socialPost: {
      platform: "facebook",
      headline: "Wedding season is here",
      body: "Book your wedding flowers with us today.",
      cta: "Book now",
      visual_brief: "A finished wedding bouquet on a rustic table.",
      hashtags: ["#wedding"],
      asset_requirements: []
    }
  });
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { name: "Test Florals", timezone: "America/Chicago" }, error: null }, // shops lookup
    { data: null, error: null }, // idempotency dedup lookup — no recent duplicate
    { data: { id: "job-1" }, error: null }, // ai_execution_jobs insert
    { data: { marketing_monthly_budget_cents: null }, error: null }, // shop monthly-default budget lookup (budget_check, Priority 2) — none configured
    { data: null, error: null }, // Priority F: loadBrandBrain select — no learned Brand Brain yet
    { data: null, error: null }, // Lily Creative Style Learning: loadStyleMemory select (memoized alongside Brand Brain)
    { data: { id: "video-asset-1" }, error: null }, // ai_generated_assets insert (video concept)
    { data: { id: "content-1" }, error: null }, // marketing_content_items insert
    { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // marketing_platform_variants insert
    { data: { id: "job-1", status: "partially_completed" }, error: null } // ai_execution_jobs final update (video render is honestly blocked)
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));

  try {
    const res = await handler(event("compound_request", { shop_id: "shop-1", message: "Make me a wedding bouquet Reel concept for Facebook, budget $10." }));
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.job.id, "job-1");

    const shopCall = client.calls.find((c) => c.table === "shops");
    assert.ok(shopCall.ops.some((op) => op[0] === "eq" && op[1][0] === "id" && op[1][1] === "shop-1"));

    const jobInsertCall = client.calls.find((c) => c.table === "ai_execution_jobs" && c.payload?.job_type === "marketing_compound");
    assert.equal(jobInsertCall.payload.shop_id, "shop-1", "the orchestrator must run scoped to the requesting shop, not a hardcoded/default one");
    assert.equal(jobInsertCall.payload.created_by, "u1");

    const auditCall = client.calls.find((c) => c.table === "platform_admin_audit");
    assert.ok(auditCall, "compound_request must leave a real audit trail, same as every other admin mutation");
    assert.equal(auditCall.payload.action, "marketing_compound_request");
    assert.equal(auditCall.payload.shop_id, "shop-1");
    assert.equal(auditCall.payload.details.target_id, "job-1");
  } finally {
    mock.restore();
  }
});

test("compound_request: an extraction failure surfaces as a clean 400, not a 500 or a fabricated plan", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("provider unreachable");
  };
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { name: "Test Florals", timezone: "America/Chicago" }, error: null } // shops lookup
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  try {
    const res = await handler(event("compound_request", { shop_id: "shop-1", message: "asdkjfh" }));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /Could not understand/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("compound_request: a deduped result (identical recent request) is surfaced honestly and skips writing a second audit entry", async () => {
  const mock = installCloudflareRouter({
    extraction: {
      wants_image: true,
      wants_video: false,
      wants_digital_twin: false,
      platforms: ["facebook"],
      occasion: "wedding bouquet",
      inventory_grounded: false,
      budget_dollars: null,
      schedule_relative_day: null,
      schedule_time_of_day: null,
      summary: "A wedding bouquet post for Facebook."
    }
  });
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { name: "Test Florals", timezone: "America/Chicago" }, error: null }, // shops lookup
    {
      data: { id: "job-existing", status: "running", plan: [], result: null, error: null, title: "x", context: {}, created_at: new Date().toISOString() },
      error: null
    } // idempotency dedup lookup — a recent identical job
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  try {
    const res = await handler(event("compound_request", { shop_id: "shop-1", message: "Make a wedding bouquet post for Facebook." }));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.deduped, true);
    assert.equal(body.job.id, "job-existing");
    const auditCall = client.calls.find((c) => c.table === "platform_admin_audit");
    assert.equal(auditCall, undefined, "must not write a second audit entry for a no-op deduped call");
  } finally {
    mock.restore();
  }
});
