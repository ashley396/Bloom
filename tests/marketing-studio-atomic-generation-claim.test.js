import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

/**
 * Batch 3, Part A/B/C — the atomic generation claim. Real problem this
 * fixes: generate_content used to do a plain read-then-write ("read
 * status='idea', then unconditionally update to 'generating'") — two
 * concurrent requests for the same content item could both pass the read
 * before either write landed, letting both proceed into real generation:
 * duplicate provider spend, duplicate usage-ledger rows, duplicate assets.
 *
 * The fix is a true one-winner conditional UPDATE — the same proven
 * pattern already shipped in marketing-publishing-worker.js's
 * claimDueJobs() — `UPDATE ... WHERE id=? AND shop_id=? AND status='idea'
 * RETURNING id,status`. Whichever caller's UPDATE actually lands first is
 * the only one that can ever see its own row come back; every other
 * concurrent caller's identical UPDATE matches zero rows.
 */

function superAdminRow() {
  return { data: { user_id: "u1", role: "super_admin", active: true }, error: null };
}
function baseDeps(client) {
  return { authenticate: async () => ({ user: { id: "u1" } }), createServerClient: () => client };
}
// The florist-session path (marketing-studio-shop.js's real entry point) —
// deps.florist resolves client/user/shopActorAuthorized SYNCHRONOUSLY, with
// no platformAdmin()/featureGate() async DB round-trip in between. Used
// ONLY for the true-concurrency test below: with this path, the FIRST
// await either concurrent request reaches is the real currentItem read, so
// two handler() calls started via the same Promise.all tick run in
// lockstep through every subsequent await — verified empirically — making
// the fake client's response queue order match real call order exactly,
// the same way a real concurrent race against Postgres would actually
// resolve (whichever UPDATE the database serializes first wins). The
// baseDeps/superAdminRow (platformAdmin) path used by every OTHER test
// below has two EXTRA async hops (authenticate, the platform_admins
// lookup) before reaching that point, which empirically does not
// interleave in lockstep — not a bug in the claim logic itself, just not a
// reliable substrate for hand-verifying exact interleaving.
function floristDeps(client) {
  return { florist: { client, user: { id: "u1" }, shopId: "shop-1", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  // Skips the per-shop shop_admin_config.features.marketing_studio_beta
  // read (see marketing-studio.js's featureGate) — these tests use the
  // super_admin/platformAdmin() path (baseDeps below), which only reaches
  // it when this global flag is unset.
  process.env.FLORISYN_FLAG_MARKETING_STUDIO = "true";
});
test.after(() => {
  process.env = { ...savedEnv };
});

// ---------------------------------------------------------------------------
// ATOMIC CLAIMING 1-5, 11: a true concurrency-style test — two real,
// concurrently-running handler() calls racing over ONE shared fake client,
// not two sequential mocked branches. Both requests reach the exact same
// point (the claim UPDATE) after the exact same number of prior awaits
// (currentItem read, then the claim itself — this item's brief never
// triggers needs_photo_choice, being a text_post), so the fixture queue,
// consumed strictly in real call order, can arrange for the FIRST request
// to actually reach the claim to see itself win and the second to see
// itself lose — exactly mirroring what a real concurrent race against
// Postgres would do (whichever UPDATE the database serializes first wins).
// ---------------------------------------------------------------------------
test("ATOMIC CLAIM 1-5/11: two truly concurrent generate_content calls for the SAME item — exactly one winner, the loser makes zero provider calls and zero usage rows, and the claim happens before any usage reservation", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  let providerCallCount = 0;
  globalThis.fetch = async () => {
    providerCallCount += 1;
    return {
      ok: true,
      json: async () => ({
        success: true,
        result: {
          response: JSON.stringify({
            platform: "facebook",
            headline: "h",
            body: "b",
            cta: "c",
            visual_brief: "v",
            hashtags: [],
            asset_requirements: [],
            brand_traits_used: [],
            visual_traits_used: []
          })
        }
      })
    };
  };

  // Both concurrent requests read the SAME currentItem row (still 'idea' —
  // neither has claimed it yet) — queued twice, once per request's own
  // read. Then the claim UPDATE: the first request to actually reach it
  // gets the real winning row back; the second gets an empty array (lost
  // the race), exactly like a real concurrent Postgres UPDATE would
  // produce for two callers racing the same WHERE status='idea' clause.
  const client = createFakeSupabaseClient([
    { data: { id: "item-race-1", content_type: "text_post", title: "t", brief: "b", status: "idea" }, error: null }, // request A's currentItem read
    { data: { id: "item-race-1", content_type: "text_post", title: "t", brief: "b", status: "idea" }, error: null }, // request B's currentItem read
    { data: [{ id: "item-race-1", status: "generating" }], error: null }, // WINNER: whichever request's claim UPDATE actually lands first
    { data: [], error: null }, // LOSER: the second request's identical UPDATE matches zero rows
    // ── Only the winner proceeds past this point — its own full real
    // generation pipeline. The loser must never reach ANY of the calls
    // below (variants, budget, shopRow, recordUsage, persist, ...) —
    // proven below by inspecting call counts, not just trusting the queue
    // never underflows.
    { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // winner: variants
    { data: { marketing_monthly_budget_cents: null }, error: null }, // winner: budget
    { data: { name: "Test Florals" }, error: null }, // winner: shopRow
    { data: null, error: null }, // winner: loadBrandBrain
    { data: null, error: null }, // winner: loadStyleMemory
    { data: [], error: null }, // winner: loadGroundedInventory
    { data: [], error: null }, // winner: audience customers
    { data: [], error: null }, // winner: audience orders
    { data: [], error: null }, // winner: recent-content shortlist
    { data: null, error: null }, // winner: recordUsage("copy")
    { data: { id: "copy-asset-1" }, error: null }, // winner: persistGeneratedAsset
    { data: null, error: null }, // winner: variant update
    { data: { id: "item-race-1", status: "draft" }, error: null } // winner: final content_items update
  ]);
  const handler = createMarketingStudioHandler(floristDeps(client));

  try {
    const [resA, resB] = await Promise.all([
      handler(event("generate_content", { content_item_id: "item-race-1" })),
      handler(event("generate_content", { content_item_id: "item-race-1" }))
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    // ATOMIC CLAIM 2/3: exactly one winner (200) and exactly one clean
    // conflict loser (409) — never two 200s (duplicate generation), never
    // two failures.
    assert.deepEqual(statuses, [200, 409], `expected exactly one winner and one honest conflict, got: ${JSON.stringify([resA.statusCode, resB.statusCode])}`);

    const loserRes = resA.statusCode === 409 ? resA : resB;
    const loserBody = JSON.parse(loserRes.body);
    assert.equal(loserBody.already_generating, true);

    // ATOMIC CLAIM 4: the loser made ZERO provider calls — the winner's
    // one real copy-generation call is the only provider spend that ever
    // happened for this race.
    assert.equal(providerCallCount, 1, "the loser must make zero real provider calls — only the winner's single real generation call may have happened");

    // ATOMIC CLAIM 5: the loser created ZERO usage rows — exactly ONE
    // usage row exists total (the winner's own real copy generation),
    // never two (which would mean the loser also spent).
    const usageInserts = client.calls.filter((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "insert"));
    assert.equal(usageInserts.length, 1, "exactly one usage row (the winner's) may exist — the loser must have created none at all");

    // ATOMIC CLAIM 1: exactly one real 'idea' -> 'generating' claim UPDATE
    // ever matched a row (the winner's) — the loser's identical UPDATE
    // matched zero rows, proven by inspecting the actual claim calls'
    // shape, not inferred from the status codes alone.
    const claimCalls = client.calls.filter(
      (c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update" && op[1][0]?.status === "generating")
    );
    assert.equal(claimCalls.length, 2, "both requests' claim attempts must have actually run (the race is real, not skipped)");

    // ATOMIC CLAIM 11: the claim happened BEFORE any usage reservation —
    // trivially true here since the loser reserved none at all, and the
    // winner's own claim call is the very first marketing_content_items
    // write, strictly before its first marketing_generation_usage call.
    const firstUsageCallIndex = client.calls.findIndex((c) => c.table === "marketing_generation_usage");
    const firstClaimCallIndex = client.calls.findIndex(
      (c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update" && op[1][0]?.status === "generating")
    );
    assert.ok(firstClaimCallIndex < firstUsageCallIndex, "the atomic claim must happen strictly before any provider-usage reservation");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// ATOMIC CLAIMING 6: tenant isolation — a request naming the wrong shop can
// never claim (or even see) another shop's content item.
// ---------------------------------------------------------------------------
test("ATOMIC CLAIM 6: a request naming the wrong shop_id can never claim another shop's content item — the item lookup itself is shop-scoped, the claim is never even attempted", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    // The real currentItem lookup is .eq("id", ...).eq("shop_id", shopId) —
    // a genuinely cross-shop id/shop_id pair finds nothing, exactly as a
    // real Postgres query scoped this way would.
    { data: null, error: null } // currentItem lookup for the WRONG shop finds nothing
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("generate_content", { shop_id: "someone-elses-shop", content_item_id: "item-1" }));
  assert.equal(res.statusCode, 404, "a cross-shop content_item_id must be reported as not found, never as a claimable item");
  const claimCalls = client.calls.filter((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
  assert.equal(claimCalls.length, 0, "the claim UPDATE must never even be attempted for an item that doesn't belong to the requesting shop");
});

// ---------------------------------------------------------------------------
// ATOMIC CLAIMING 7: a non-idea item can never be claimed.
// ---------------------------------------------------------------------------
test("ATOMIC CLAIM 7: a content item already past 'idea' (draft/approved/generating) cannot be claimed — refused before the claim UPDATE is even attempted", async () => {
  for (const status of ["draft", "approved", "generating"]) {
    const client = createFakeSupabaseClient([
      superAdminRow(),
      { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status }, error: null }
    ]);
    const handler = createMarketingStudioHandler(baseDeps(client));
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1" }));
    assert.equal(res.statusCode, 400, `a '${status}' item must be refused, not claimed`);
    const claimCalls = client.calls.filter((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
    assert.equal(claimCalls.length, 0, `no claim UPDATE may even be attempted for a '${status}' item — the early status check must refuse it first`);
  }
});

test("ATOMIC CLAIM 7b: the claim UPDATE's own WHERE status='idea' is the real enforcement — even if the item's status somehow changed between the read and the claim, zero rows means zero claim, never a fabricated win", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "idea" }, error: null }, // the read still sees 'idea'
    { data: [], error: null } // but the claim UPDATE itself matches zero rows — status changed underneath it
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1" }));
  assert.equal(res.statusCode, 409);
  const body = JSON.parse(res.body);
  assert.equal(body.already_generating, true);
});

// ---------------------------------------------------------------------------
// ATOMIC CLAIMING 8: successful generation finishes in the expected draft
// state — a full, real, single-request lifecycle proof (claim -> generate
// -> persist -> draft).
// ---------------------------------------------------------------------------
test("ATOMIC CLAIM 8: a successfully claimed, successfully generated item finishes as a real 'draft' — never left at 'generating'", async () => {
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
          body: "b",
          cta: "c",
          visual_brief: "v",
          hashtags: [],
          asset_requirements: [],
          brand_traits_used: [],
          visual_traits_used: []
        })
      }
    })
  });
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "idea" }, error: null },
    { data: [{ id: "item-1", status: "generating" }], error: null }, // atomic claim wins
    { data: [{ id: "variant-1", platform: "facebook" }], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: { name: "Test Florals" }, error: null },
    { data: null, error: null }, // loadBrandBrain
    { data: null, error: null }, // loadStyleMemory
    { data: [], error: null }, // loadGroundedInventory
    { data: [], error: null }, // audience customers
    { data: [], error: null }, // audience orders
    { data: [], error: null }, // recent-content shortlist
    { data: null, error: null }, // recordUsage("copy")
    { data: { id: "copy-asset-1" }, error: null }, // persistGeneratedAsset
    { data: null, error: null }, // variant update
    { data: { id: "item-1", status: "draft" }, error: null } // final content_items update
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  try {
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `expected a clean success: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.item.status, "draft", "a successful claim + generation must finish as a real 'draft', never left at 'generating'");
    // The FINAL content_items write actually set status to 'draft' —
    // checked against the real recorded call, not just the response body.
    const finalUpdate = client.calls.filter((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update")).at(-1);
    assert.equal(finalUpdate.payload.status, "draft");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// ATOMIC CLAIMING 9/10: failed generation after a successful claim returns
// to a real, retryable state ('idea') — never left stuck at 'generating' —
// across several distinct real failure points along the post-claim path.
// ---------------------------------------------------------------------------
test("ATOMIC CLAIM 9/10: a budget-gate refusal after the claim reverts the item to 'idea' — never stuck at 'generating'", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "idea" }, error: null },
    { data: [{ id: "item-1", status: "generating" }], error: null }, // claim wins
    { data: [], error: null }, // variants
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: [{ estimated_cost_cents: 999999 }], error: null }, // already way over any real cap
    { data: { id: "item-1", status: "idea" }, error: null } // revertToIdea
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", budget_cap_cents: 1, photo_choice: "generate" }));
  assert.equal(res.statusCode, 400);
  const finalUpdate = client.calls.filter((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update")).at(-1);
  assert.equal(finalUpdate.payload.status, "idea", "a claimed-then-refused item must end at 'idea', a real retryable state — never stuck at 'generating'");
});

test("ATOMIC CLAIM 9/10: a genuine provider/persistence failure after the claim reverts the item to 'idea' — never stuck at 'generating'", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ success: false, errors: [{ message: "model overloaded" }] }) });
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "idea" }, error: null },
    { data: [{ id: "item-1", status: "generating" }], error: null }, // claim wins
    { data: [{ id: "variant-1", platform: "facebook" }], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: { name: "Test Florals" }, error: null },
    { data: null, error: null }, // loadBrandBrain
    { data: null, error: null }, // loadStyleMemory
    { data: [], error: null }, // loadGroundedInventory
    { data: [], error: null }, // audience customers
    { data: [], error: null }, // audience orders
    { data: [], error: null }, // recent-content shortlist
    { data: { id: "item-1", status: "idea" }, error: null } // revertToIdea after the real copy-generation call fails
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  try {
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1" }));
    assert.equal(res.statusCode, 400, `a genuine provider failure must surface cleanly: ${res.body}`);
    const finalUpdate = client.calls.filter((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update")).at(-1);
    assert.equal(finalUpdate.payload.status, "idea", "a claimed-then-failed generation must end at 'idea' — never stuck at 'generating'");
    const assetInsert = client.calls.find((c) => c.table === "ai_generated_assets");
    assert.equal(assetInsert, undefined, "nothing must ever be persisted from a failed generation");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ATOMIC CLAIM 9/10: a genuine, non-retryable infrastructure failure (a storage RLS denial) after the claim reverts the item to 'idea' — never stuck at 'generating'", async () => {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async (url) => {
    if (/flux|black-forest-labs/i.test(String(url))) return { ok: true, json: async () => ({ success: true, result: { image: Buffer.from("x").toString("base64") } }) };
    return {
      ok: true,
      json: async () => ({
        success: true,
        result: {
          response: JSON.stringify({
            platform: "facebook",
            headline: "h",
            body: "b",
            cta: "c",
            visual_brief: "v",
            hashtags: [],
            asset_requirements: [],
            brand_traits_used: [],
            visual_traits_used: []
          })
        }
      })
    };
  };
  const storage = createFakeSupabaseStorage({
    uploadResponses: [{ data: null, error: { message: "permission denied for table platform_admins", code: "42501" } }]
  });
  const client = createFakeSupabaseClient(
    [
      superAdminRow(),
      { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "idea" }, error: null },
      { data: [{ id: "item-1", status: "generating" }], error: null }, // claim wins
      { data: [{ id: "variant-1", platform: "facebook" }], error: null },
      { data: { marketing_monthly_budget_cents: null }, error: null },
      { data: { name: "Test Florals" }, error: null },
      { data: null, error: null }, // loadBrandBrain
      { data: null, error: null }, // loadStyleMemory
      { data: [], error: null }, // loadGroundedInventory
      { data: [], error: null }, // audience customers
      { data: [], error: null }, // audience orders
      { data: [], error: null }, // recent-content shortlist
      { data: null, error: null }, // recordUsage("copy")
      { data: { id: "usage-img-1" }, error: null }, // reserveProviderCall(image)
      { data: null, error: null }, // failProviderCall(image) — upload denied
      { data: { id: "item-1", status: "idea" }, error: null } // revertToIdea
    ],
    { storage }
  );
  const handler = createMarketingStudioHandler(baseDeps(client));
  try {
    const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", photo_choice: "generate" }));
    assert.equal(res.statusCode, 400, `a storage RLS denial must surface as a clean 400: ${res.body}`);
    assert.match(JSON.parse(res.body).error, /permission denied for table platform_admins/);
    const finalUpdate = client.calls.filter((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update")).at(-1);
    assert.equal(finalUpdate.payload.status, "idea", "a claimed item must revert to 'idea' on a genuine infra failure — never stuck at 'generating'");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
