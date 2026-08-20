import test from "node:test";
import assert from "node:assert/strict";
import { planJob, runJob, retryJobStep } from "../netlify/functions/_shared/ai-orchestrator.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

const TINY_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

/** One mock that answers every Cloudflare call this suite makes — text
 * generation (classify/social-post/website-section/video schemas all read
 * from this one superset object) and the flux image model, branched by
 * URL. Mirrors the real shape of each schema closely enough that every
 * caller's own required-field check passes. */
function mockAllCloudflareCalls() {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  const textResult = {
    platform: "facebook",
    headline: "Homecoming season is here!",
    body: "Order your Homecoming corsage or boutonniere by Wednesday for guaranteed Friday pickup.",
    cta: "Order by Wednesday",
    visual_brief: "A red spray rose corsage on a wrist, shot in natural light.",
    hashtags: ["#homecoming"],
    asset_requirements: [],
    subheadline: "Corsages and boutonnieres for this year's dance.",
    cta_label: "Order Homecoming Flowers",
    concept: "A quick behind-the-counter look at building a corsage.",
    script: "",
    scenes: ["0-3s: hands selecting a spray rose from the cooler"],
    captions: ["Order by Wednesday"],
    suggested_length_seconds: 15
  };
  globalThis.fetch = async (url) => {
    if (String(url).includes("flux-1-schnell")) {
      return { ok: true, json: async () => ({ result: { image: TINY_JPEG_BASE64 } }) };
    }
    return { ok: true, json: async () => ({ success: true, result: { response: JSON.stringify(textResult) } }) };
  };
  return {
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

function makeClient(rowResponses, { storage } = {}) {
  return createFakeSupabaseClient(rowResponses, {
    storage: storage || createFakeSupabaseStorage({ publicUrl: (path) => `https://fake.storage/website-media/${path}` })
  });
}

/** The fake client's queued `data` is whatever the test hands it — it
 * doesn't simulate a real UPDATE echoing back what was written. Real
 * verification of "what the orchestrator actually computed" reads the
 * recorded update payload instead, which is real: runJob builds it from
 * the plan it actually executed, not from a mock. */
function jobUpdatePayload(client) {
  const call = client.calls.find((c) => c.table === "ai_execution_jobs" && c.ops.some(([op]) => op === "update"));
  return call?.payload;
}

test("planJob: 'create a Facebook post' plans a single post step plus an optional image — never a bare navigate", () => {
  const routed = { action_type: "create", domain: "marketing", channels: ["facebook"], occasion: "Homecoming", audience: "students and parents", summary: "x" };
  const steps = planJob(routed, { requestText: "Create a Facebook post..." });
  assert.equal(steps.length, 2);
  assert.equal(steps[0].tool, "marketing.createSocialPost");
  assert.equal(steps[0].channel, "facebook");
  assert.equal(steps[0].optional, false);
  assert.equal(steps[1].tool, "creative.generateImage");
  assert.equal(steps[1].optional, true);
});

test("planJob: a multi-channel campaign plans a campaign + a post per channel + a website section + image — never collapses to one navigate step", () => {
  const routed = { action_type: "campaign", domain: "marketing", channels: ["facebook", "website"], occasion: "Homecoming", audience: "students and parents", summary: "x" };
  const steps = planJob(routed, { requestText: "Make a campaign for Facebook and my website..." });
  const tools = steps.map((s) => s.tool);
  assert.deepEqual(tools, [
    "marketing.createCampaign",
    "marketing.createSocialPost",
    "creative.generateImage",
    "marketing.createWebsiteSectionDraft"
  ]);
  assert.equal(steps.find((s) => s.tool === "marketing.createSocialPost").channel, "facebook");
  // The old bug was the literal word "website" hijacking the whole plan
  // into a bare navigate with zero content — assert that never happens.
  assert.ok(!tools.includes("website.update"));
  assert.ok(!steps.some((s) => s.tool?.includes("navigate")));
});

test("planJob: a video request plans a script/storyboard step, never a claim of a finished video", () => {
  const routed = { action_type: "video", domain: "marketing", channels: ["instagram"], occasion: "Prom", audience: null, summary: "x" };
  const steps = planJob(routed, { requestText: "Make a Reel for prom" });
  assert.equal(steps[0].tool, "marketing.createVideoConcept");
});

test("TEST 1 (from the AI-OS spec): 'Create a Facebook post telling high school kids and parents to get their Homecoming orders in.' produces a finished, formatted, persisted post — not a paraphrase, not raw JSON", async () => {
  const mock = mockAllCloudflareCalls();
  try {
    const client = makeClient([
      { data: { id: "job-1", status: "running", plan: [] }, error: null }, // job insert
      { data: { id: "asset-post-1" }, error: null }, // social post asset insert
      { data: { id: "media-1" }, error: null }, // website_media insert (image)
      { data: { id: "asset-image-1" }, error: null }, // image asset insert
      { data: { id: "job-1", status: "completed" }, error: null } // job update
    ]);
    const routed = { action_type: "create", domain: "marketing", channels: ["facebook"], occasion: "Homecoming", audience: "high school students and parents", summary: "Write a Facebook post about Homecoming orders." };

    const ran = await runJob(client, {
      shopId: "shop-1",
      userId: "user-1",
      persona: "Lily",
      routed,
      requestText: "Create a Facebook post telling high school kids and parents to get their Homecoming orders in.",
      shop: { name: "Test Blooms" },
      inventory: [{ name: "Freedom rose" }]
    });

    assert.equal(ran.ok, true);
    const payload = jobUpdatePayload(client);
    assert.equal(payload.status, "completed");
    const postStep = payload.result.steps.find((s) => s.tool === "marketing.createSocialPost");
    assert.equal(postStep.status, "completed");
    // A real, structured, finished post — never a paraphrase of the request.
    assert.ok(!postStep.result.content.body.toLowerCase().includes("create a facebook post"));
    assert.match(postStep.result.content.body, /order/i);
    assert.equal(postStep.result.content.platform, "facebook");
    const imageStep = payload.result.steps.find((s) => s.tool === "creative.generateImage");
    assert.equal(imageStep.status, "completed");
    assert.match(imageStep.result.url, /^https:\/\/fake\.storage\//);

    // Persisted, not chat-transcript-only: ai_generated_assets got real inserts.
    const assetInserts = client.calls.filter((c) => c.table === "ai_generated_assets" && c.ops.some(([op]) => op === "insert"));
    assert.equal(assetInserts.length, 2); // post + image
  } finally {
    mock.restore();
  }
});

test("TEST 2 (from the AI-OS spec): 'Make a campaign for Facebook and my website...' creates a real campaign record with Facebook + website channels, real messaging, a real post, a real image, and website content — not a navigate, not a saved date, not raw JSON", async () => {
  const mock = mockAllCloudflareCalls();
  try {
    const client = makeClient([
      { data: { id: "job-2", status: "running", plan: [] }, error: null }, // job insert
      { data: { id: "campaign-1", name: "Homecoming campaign", channels: ["social", "website"] }, error: null }, // campaign insert
      { data: { id: "asset-post-1" }, error: null }, // facebook post asset
      { data: { id: "media-1" }, error: null }, // website_media insert (image)
      { data: { id: "asset-image-1" }, error: null }, // image asset
      { data: { id: "project-1" }, error: null }, // bloom_website_projects select — a project already exists
      { data: { id: "page-1", sections: [{ id: "hero-1", type: "hero", order: 0 }], content: {} }, error: null }, // bloom_website_pages select — a real home page already exists
      { data: { id: "version-1" }, error: null }, // bloom_website_page_versions insert (undo snapshot)
      { data: { id: "page-1", slug: "home", updated_at: "2026-08-20T00:00:00Z" }, error: null }, // bloom_website_pages update
      { data: null, error: null }, // audit_events insert (writeShopAudit, fire-and-forget)
      { data: { id: "asset-website-1" }, error: null }, // website section asset
      { data: { id: "job-2", status: "completed", campaign_id: "campaign-1" }, error: null } // job update
    ]);
    const routed = {
      action_type: "campaign",
      domain: "marketing",
      channels: ["facebook", "website"],
      occasion: "Homecoming",
      audience: "high school students and parents",
      summary: "Build a Homecoming campaign for Facebook and the website."
    };

    const ran = await runJob(client, {
      shopId: "shop-1",
      userId: "user-1",
      persona: "Lily",
      routed,
      requestText: "Make a campaign for Facebook and my website telling high school kids and parents to get their Homecoming orders in.",
      shop: { name: "Test Blooms" },
      inventory: [{ name: "Freedom rose" }]
    });

    assert.equal(ran.ok, true);
    const payload = jobUpdatePayload(client);
    assert.equal(payload.status, "completed");
    assert.equal(payload.campaign_id, "campaign-1");

    const campaignStep = payload.result.steps.find((s) => s.tool === "marketing.createCampaign");
    assert.equal(campaignStep.status, "completed");

    const postStep = payload.result.steps.find((s) => s.tool === "marketing.createSocialPost");
    assert.equal(postStep.status, "completed");
    assert.ok(postStep.result.content.body.length > 0);

    const websiteStep = payload.result.steps.find((s) => s.tool === "marketing.createWebsiteSectionDraft");
    assert.equal(websiteStep.status, "completed");
    assert.ok(websiteStep.result.content.headline.length > 0);
    // Actually applied to the shop's real Website Builder X draft, not just generated text.
    assert.equal(websiteStep.result.applied, true);
    assert.equal(websiteStep.result.content.appliedToDraft, true);
    assert.equal(websiteStep.result.content.appliedToLivePage, false);

    const imageStep = payload.result.steps.find((s) => s.tool === "creative.generateImage");
    assert.equal(imageStep.status, "completed");

    // The real marketing_campaigns table actually got a row, with both channels.
    const campaignInsert = client.calls.find((c) => c.table === "marketing_campaigns");
    assert.ok(campaignInsert);
    assert.deepEqual(campaignInsert.payload.channels.sort(), ["social", "website"]);
    assert.equal(campaignInsert.payload.shop_id, "shop-1");

    // The website draft's home page actually got updated — a real hero
    // section carrying the finished image URL, appended alongside the
    // existing section rather than replacing it, and a version snapshot
    // was taken first so the change is undoable.
    const versionInsert = client.calls.find((c) => c.table === "bloom_website_page_versions" && c.ops.some(([op]) => op === "insert"));
    assert.ok(versionInsert);
    const pageUpdate = client.calls.find((c) => c.table === "bloom_website_pages" && c.ops.some(([op]) => op === "update"));
    assert.ok(pageUpdate);
    assert.equal(pageUpdate.payload.sections.length, 2);
    const heroSection = pageUpdate.payload.sections.find((s) => s.type === "hero" && s.id !== "hero-1");
    assert.ok(heroSection);
    assert.match(heroSection.props.image, /^https:\/\/fake\.storage\//);
    assert.ok(heroSection.props.title.length > 0);
  } finally {
    mock.restore();
  }
});

test("Execution state: a required step failing downgrades the job to partially_completed, preserving the steps that succeeded", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async (url) => {
    call += 1;
    if (String(url).includes("flux-1-schnell")) {
      return { ok: true, json: async () => ({ result: { image: TINY_JPEG_BASE64 } }) };
    }
    // First text call (the campaign step doesn't call the model at all —
    // it's a direct DB insert) succeeds; simulate the post-copy call itself
    // failing so we can verify partial-failure bookkeeping.
    return { ok: false, status: 503, json: async () => ({ errors: [{ message: "model overloaded" }] }) };
  };
  try {
    const client = makeClient([
      { data: { id: "job-3", status: "running", plan: [] }, error: null }, // job insert
      { data: { id: "campaign-2", channels: ["social"] }, error: null }, // campaign insert
      { data: { id: "asset-fail-1" }, error: null }, // failed-post asset insert (still persisted, status:'failed')
      { data: { id: "asset-fail-image" }, error: null }, // failed-image asset insert
      { data: { id: "job-3", status: "partially_completed" }, error: null } // job update
    ]);
    const routed = { action_type: "campaign", domain: "marketing", channels: ["facebook"], occasion: "Homecoming", audience: null, summary: "x" };
    const ran = await runJob(client, { shopId: "shop-1", userId: "user-1", persona: "Lily", routed, requestText: "campaign", shop: {}, inventory: [] });

    assert.equal(ran.ok, true);
    const payload = jobUpdatePayload(client);
    assert.equal(payload.status, "partially_completed");
    const campaignStep = payload.result.steps.find((s) => s.tool === "marketing.createCampaign");
    assert.equal(campaignStep.status, "completed");
    const postStep = payload.result.steps.find((s) => s.tool === "marketing.createSocialPost");
    assert.equal(postStep.status, "failed");
    assert.match(postStep.error, /overloaded/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retryJobStep: re-running one failed step never touches the other steps' already-completed results", async () => {
  const mock = mockAllCloudflareCalls();
  try {
    const existingJob = {
      id: "job-4",
      shop_id: "shop-1",
      job_type: "create",
      title: "Homecoming post",
      request_text: "Create a Facebook post about Homecoming",
      campaign_id: null,
      result: { steps: [] },
      plan: [
        { id: "post_facebook", tool: "marketing.createSocialPost", channel: "facebook", label: "Write the facebook post", optional: false, status: "completed", result: { asset_id: "kept-1", content: { body: "already written, do not touch" } }, error: null },
        { id: "image", tool: "creative.generateImage", label: "Generate the matching image", optional: true, status: "failed", result: null, error: "model overloaded" }
      ]
    };
    const client = makeClient([
      { data: existingJob, error: null }, // load job
      { data: { id: "media-retry-1" }, error: null }, // website_media insert on retry
      { data: { id: "asset-retry-1" }, error: null }, // ai_generated_assets insert on retry
      { data: { ...existingJob, status: "completed" }, error: null } // job update
    ]);

    const retried = await retryJobStep(client, { shopId: "shop-1", userId: "user-1", persona: "Lily", jobId: "job-4", stepId: "image" });
    assert.equal(retried.ok, true);
    const payload = jobUpdatePayload(client);
    const postStep = payload.result.steps.find((s) => s.id === "post_facebook");
    // Untouched — retrying "image" never re-ran or altered the post step.
    assert.equal(postStep.status, "completed");
    assert.equal(postStep.result.content.body, "already written, do not touch");
    const imageStep = payload.result.steps.find((s) => s.id === "image");
    assert.equal(imageStep.status, "completed");
  } finally {
    mock.restore();
  }
});

test("retryJobStep: an unknown step id fails clearly instead of silently no-opping", async () => {
  const client = makeClient([{ data: { id: "job-5", shop_id: "shop-1", plan: [{ id: "post_facebook", tool: "marketing.createSocialPost" }] }, error: null }]);
  const result = await retryJobStep(client, { shopId: "shop-1", jobId: "job-5", stepId: "not_a_real_step" });
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/i);
});
