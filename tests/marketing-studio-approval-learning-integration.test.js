import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Batch 5 ("Repair recent-content diversity + brand-memory learning"),
// Part H-O: the real approve_content wiring for the NEW deterministic
// approval_observations path, alongside the existing (unchanged)
// recordBrandSignal/recordApprovalSignal accumulation mechanics.

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
});
test.after(() => {
  process.env = { ...savedEnv };
});

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}
function baseDeps(client) {
  return { authenticate: async () => ({ user: { id: "u1" } }), createServerClient: () => client };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}

const SHORT_CAPTION = "Fresh flowers today, come see us!";

function approveQueue({ itemId = "item-1", decision = "approved", currentBrandPrefs = null, assets }) {
  return [
    superAdminRow(),
    { data: { id: itemId, status: "draft" }, error: null },
    { data: assets.map((a) => ({ asset_id: a.id })), error: null },
    { data: assets, error: null },
    { data: { id: itemId, status: decision === "approved" ? "approved" : "archived" }, error: null },
    { data: { preferences: currentBrandPrefs }, error: null }, // loadBrandBrain
    { data: null, error: null } // saveBrandBrain
  ];
}

// Part Q #26/#43: repeated real approvals promote a genuinely NEW inferred
// preference, and a SINGLE approval event never double-counts the same
// trait even when it's derivable from more than one linked asset.
test("approve_content: repeated real approvals of consistently short captions promote 'concise captions' to an ACTIVE inferred preference, never double-counted within one event", async () => {
  let currentPrefs = null;

  // Event 1: TWO assets in the same approval event both produce the same
  // 'concise captions' observation — must still increment evidence by 1.
  const client1 = createFakeSupabaseClient(
    approveQueue({
      itemId: "item-1",
      currentBrandPrefs: currentPrefs,
      assets: [
        { id: "asset-1a", content: { body: SHORT_CAPTION } },
        { id: "asset-1b", content: { body: "Short caption two, also brief." } }
      ]
    })
  );
  await createMarketingStudioHandler(baseDeps(client1))(event("approve_content", { shop_id: "shop-1", content_item_id: "item-1", decision: "approved" }));
  let saved = client1.calls.find((c) => c.table === "marketing_brand_brain" && c.ops.some((op) => op[0] === "upsert"));
  currentPrefs = saved.payload.preferences;
  let entry = currentPrefs.content_density.traits.find((t) => t.text === "concise captions");
  assert.equal(entry.evidence_count, 1, "two assets in ONE approval event naming the same trait must still count as exactly one observation");
  assert.equal(entry.active, false);

  // Event 2
  const client2 = createFakeSupabaseClient(approveQueue({ itemId: "item-2", currentBrandPrefs: currentPrefs, assets: [{ id: "asset-2", content: { body: SHORT_CAPTION } }] }));
  await createMarketingStudioHandler(baseDeps(client2))(event("approve_content", { shop_id: "shop-1", content_item_id: "item-2", decision: "approved" }));
  saved = client2.calls.find((c) => c.table === "marketing_brand_brain" && c.ops.some((op) => op[0] === "upsert"));
  currentPrefs = saved.payload.preferences;
  entry = currentPrefs.content_density.traits.find((t) => t.text === "concise captions");
  assert.equal(entry.evidence_count, 2);
  assert.equal(entry.active, false, "must not promote before real repetition — PROMOTE_THRESHOLD is 3");

  // Event 3 — the third real approval crosses PROMOTE_THRESHOLD.
  const client3 = createFakeSupabaseClient(approveQueue({ itemId: "item-3", currentBrandPrefs: currentPrefs, assets: [{ id: "asset-3", content: { body: SHORT_CAPTION } }] }));
  await createMarketingStudioHandler(baseDeps(client3))(event("approve_content", { shop_id: "shop-1", content_item_id: "item-3", decision: "approved" }));
  saved = client3.calls.find((c) => c.table === "marketing_brand_brain" && c.ops.some((op) => op[0] === "upsert"));
  currentPrefs = saved.payload.preferences;
  entry = currentPrefs.content_density.traits.find((t) => t.text === "concise captions");
  assert.equal(entry.evidence_count, 3);
  assert.equal(entry.active, true, "Part Q #26: three real repeated approvals must promote the inferred preference");
  assert.equal(entry.source, "inferred");
});

// Part Q #28/#29: one rejection weakens modestly and never bans outright;
// repeated rejection decays an inferred preference toward inactive.
test("approve_content: rejections weaken an inferred preference gradually — never a permanent ban from a single reject", async () => {
  let currentPrefs = { content_density: { traits: [{ text: "concise captions", polarity: "positive", source: "inferred", active: true, evidence_count: 3, last_signal_at: null }] } };

  for (const [i, expected] of [[1, { evidence: 2, active: true }], [2, { evidence: 1, active: true }], [3, { evidence: 0, active: false }]]) {
    const client = createFakeSupabaseClient(approveQueue({ itemId: `item-r${i}`, decision: "rejected", currentBrandPrefs: currentPrefs, assets: [{ id: `asset-r${i}`, content: { body: SHORT_CAPTION } }] }));
    await createMarketingStudioHandler(baseDeps(client))(event("approve_content", { shop_id: "shop-1", content_item_id: `item-r${i}`, decision: "rejected" }));
    const saved = client.calls.find((c) => c.table === "marketing_brand_brain" && c.ops.some((op) => op[0] === "upsert"));
    currentPrefs = saved.payload.preferences;
    const entry = currentPrefs.content_density.traits.find((t) => t.text === "concise captions");
    assert.equal(entry.evidence_count, expected.evidence, `after rejection #${i}`);
    assert.equal(entry.active, expected.active, `after rejection #${i}: Part Q #28 (one reject never bans outright) / #29 (repeated reject does decay it)`);
  }
});

// Part Q #33/#34/#35: learning only ever happens at the approval boundary
// — never from generation alone, a failed output, or an automatic retry.
test("generate_content: never touches Brand Brain or My Style — learning only happens at approve_content, never at generation time", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      result: {
        response: JSON.stringify({
          platform: "facebook",
          headline: "h",
          body: "A brand new, unique post about something specific today.",
          cta: "Visit us today",
          visual_brief: "v",
          hashtags: [],
          asset_requirements: [],
          brand_traits_used: [],
          visual_traits_used: []
        })
      }
    })
  });
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "A specific unique post today", status: "idea" }, error: null },
      { data: [{ id: "item-1", status: "generating" }], error: null },
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: null },
      { data: { id: "asset-1" }, error: null },
      { data: null, error: null },
      { data: { id: "item-1", status: "draft" }, error: null }
    ]);
    const handler = createMarketingStudioHandler({ florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } });
    const res = await handler({ httpMethod: "POST", queryStringParameters: { action: "generate_content" }, headers: {}, body: JSON.stringify({ action: "generate_content", content_item_id: "item-1" }) });
    assert.equal(res.statusCode, 200, res.body);
    // A generation call legitimately READS Brand Brain/My Style for prompt
    // grounding (loadGenerationGrounding) — that's not learning. What must
    // never happen outside a real approval is a WRITE (recordBrandSignal/
    // recordApprovalSignal's own upsert).
    assert.equal(
      client.calls.find((c) => c.table === "marketing_brand_brain" && c.ops.some((op) => op[0] === "upsert")),
      undefined,
      "Part Q #35: generation alone must never WRITE a learning signal to Brand Brain"
    );
    assert.equal(
      client.calls.find((c) => c.table === "ai_style_memory" && c.ops.some((op) => op[0] === "upsert")),
      undefined,
      "Part Q #35: generation alone must never WRITE a learning signal to My Style"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Part Q #39: an approval-signal write failure never fails the review
// decision itself, and is a real, structured, observable event (not a
// silently swallowed exception).
test("approve_content: a Brand Brain save failure still lets the real review decision succeed", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", status: "draft" }, error: null },
    { data: [{ asset_id: "asset-1" }], error: null },
    { data: [{ id: "asset-1", content: { body: SHORT_CAPTION } }], error: null },
    { data: { id: "item-1", status: "approved" }, error: null },
    { data: { preferences: null }, error: null }, // loadBrandBrain
    { data: null, error: { message: "db unavailable" } } // saveBrandBrain fails
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("approve_content", { shop_id: "shop-1", content_item_id: "item-1", decision: "approved" }));
  assert.equal(res.statusCode, 200, "a learning-signal write failure must never turn a real approval into a failure the florist sees");
  assert.equal(JSON.parse(res.body).item.status, "approved");
});

// Part Q #32: a rejected asset's observations never CREATE a brand-new
// positive learning entry — recordBrandSignal's own "rejected" branch is a
// no-op for a trait it has never seen before (idx === -1); this proves
// that holds true for the new deterministic approval_observations path,
// not just the old self-reported traits_used path it already covered.
test("approve_content: rejecting a brand-new (never-before-seen) trait creates no entry at all — no positive learning from a reject", async () => {
  const client = createFakeSupabaseClient(
    approveQueue({ itemId: "item-1", decision: "rejected", currentBrandPrefs: null, assets: [{ id: "asset-1", content: { body: SHORT_CAPTION } }] })
  );
  await createMarketingStudioHandler(baseDeps(client))(event("approve_content", { shop_id: "shop-1", content_item_id: "item-1", decision: "rejected" }));
  const saved = client.calls.find((c) => c.table === "marketing_brand_brain" && c.ops.some((op) => op[0] === "upsert"));
  assert.equal(saved.payload.preferences.content_density.traits.length, 0, "a reject on a trait never seen before must create nothing");
});

// Part Q #33/#34: a generation that fails outright (no safe fallback, the
// item reverts to idea) never persists any asset — there is nothing an
// approval could later learn from, and no learning write happens at
// generation time regardless.
test("generate_content: a generation that fails and reverts to idea never touches Brand Brain or My Style", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  try {
    const client = createFakeSupabaseClient([
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "A specific unique post today", status: "idea" }, error: null },
      { data: [{ id: "item-1", status: "generating" }], error: null },
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: { name: "Lilies in Bloom", phone: "606-506-4039" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: null }, // recordUsage("copy")
      { data: { id: "item-1", status: "idea" }, error: null } // revertToIdea
    ]);
    const handler = createMarketingStudioHandler({ florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } });
    const res = await handler({ httpMethod: "POST", queryStringParameters: { action: "generate_content" }, headers: {}, body: JSON.stringify({ action: "generate_content", content_item_id: "item-1" }) });
    assert.equal(res.statusCode, 400, "a real provider failure with no safe fallback must fail cleanly, not silently succeed");
    assert.equal(
      client.calls.find((c) => c.table === "marketing_brand_brain" && c.ops.some((op) => op[0] === "upsert")),
      undefined,
      "Part Q #33/#34: a failed generation must never WRITE a learning signal to Brand Brain"
    );
    assert.equal(
      client.calls.find((c) => c.table === "ai_style_memory" && c.ops.some((op) => op[0] === "upsert")),
      undefined,
      "Part Q #33/#34: a failed generation must never WRITE a learning signal to My Style"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
