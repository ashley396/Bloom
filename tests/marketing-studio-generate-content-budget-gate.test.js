import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Priority 8 wiring: generate_content now enforces a caller-supplied
// monthly budget cap BEFORE any real generation call, when one is given.

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

test("generate_content: no budget_cap_cents and no shop default -> unaffected, exact pre-existing behavior (a shop-cap lookup runs, but never queries usage)", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "idea" }, error: null }, // content item lookup
    { data: [], error: null }, // variants lookup
    { data: { marketing_monthly_budget_cents: null }, error: null }, // shop default lookup — none configured
    // No usage-sum response queued — a call to it here would consume this
    // slot as a placeholder and desync every call after it; the test
    // failing downstream (from a wrong-shaped response) is itself proof
    // the budget check ran when it must not have.
    { data: null, error: null }, // content_items update -> generating
    { data: { name: "Test Florals" }, error: null } // shopRow — a real shop must be verified before any generation
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  // photo_choice: "generate" — an image_post with an ordinary brief would
  // otherwise short-circuit into the needs_photo_choice prompt before the
  // budget gate this test is actually exercising ever runs.
  const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", photo_choice: "generate" }));
  // Cloudflare isn't mocked here, so the real generation call itself will
  // fail — that's fine, this test only cares that NO budget-usage select
  // ran before it (i.e. the gate correctly resolved to "unlimited", not
  // that generation succeeded).
  assert.equal(res.statusCode, 400);
  const usageSelectCall = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "select"));
  assert.equal(usageSelectCall, undefined, "neither a shop default nor a per-request cap is set — no usage-spend check should ever run");
});

test("generate_content: an image_post over budget is refused before the status is even flipped to 'generating' — zero spend past the halt", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "idea" }, error: null },
    { data: [], error: null }, // variants lookup
    { data: { marketing_monthly_budget_cents: null }, error: null }, // no shop default — the request's own cap governs
    { data: [{ estimated_cost_cents: 196 }], error: null } // this month's committed spend so far
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", budget_cap_cents: 200, photo_choice: "generate" }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.match(body.error, /over the \$2\.00 budget cap/);
  assert.equal(body.would_be_cents, 201); // 196 + 1(copy) + 4(image) = 201 — over the 200-cent cap
  const statusUpdateCall = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
  assert.equal(statusUpdateCall, undefined, "the item must never be flipped to 'generating' once the budget gate refuses the request");
});

test("generate_content: a text_post is priced without the image cost — the gate must reflect what would actually be billed, not a flat guess", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "idea" }, error: null },
    { data: [], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: [{ estimated_cost_cents: 199 }], error: null } // only 1 cent of headroom — enough for copy-only (1 cent), not image+copy
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", budget_cap_cents: 200 }));
  // text_post costs only 1 cent (copy) here -> 199 + 1 = 200 -> exactly at
  // the cap -> allowed -> proceeds into real generation (which then fails
  // for an unrelated reason: no Cloudflare mock). The key assertion is
  // that it got PAST the budget gate, unlike the image_post case above.
  assert.notEqual(res.statusCode, undefined);
  const usageSelectCall = client.calls.find((c) => c.table === "marketing_generation_usage" && c.ops.some((op) => op[0] === "select"));
  assert.ok(usageSelectCall, "the budget check must still have run");
  const statusUpdateCall = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
  assert.ok(statusUpdateCall, "a text_post within budget must be allowed to proceed to the generating lock, unlike the over-budget image_post case");
});

// Real gap an independent review found in the "ask each time" photo-choice
// feature: photo_choice "upload" never calls recordUsage("image", ...) —
// a real photo the florist supplies herself costs nothing to generate —
// so this estimate must not charge for it either, or a shop close to its
// cap could have a genuinely free upload wrongly refused as over budget.
test("generate_content: an image_post with photo_choice 'upload' is priced WITHOUT the image cost — a real uploaded photo is free, unlike AI generation", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "idea" }, error: null },
    { data: [], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: [{ estimated_cost_cents: 199 }], error: null } // only 1 cent of headroom — enough for copy-only, not image+copy
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  // Same 199-cent committed spend and 200-cent cap as the AI-generation
  // case above (which is correctly refused at 201) — but this time with
  // photo_choice "upload": 199 + 1(copy) = 200 -> exactly at the cap ->
  // allowed, proving the image line item was genuinely skipped, not just
  // coincidentally under budget.
  const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", budget_cap_cents: 200, photo_choice: "upload", photo_data_url: "data:image/jpeg;base64,ZmFrZQ==" }));
  assert.notEqual(res.statusCode, 400, `a free photo upload must never be refused as over budget: ${res.body}`);
  const statusUpdateCall = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
  assert.ok(statusUpdateCall, "an upload within the copy-only budget must be allowed to proceed to the generating lock");
});

// Priority F wiring: buildBrandSummary() existed and was documented as
// "handed to Lily's content-generation prompts" but nothing on this path
// ever actually loaded it before this fix — proven here by asserting the
// real, shop-scoped marketing_brand_brain read that now happens once the
// budget gate clears, before any generation call.
test("generate_content: a within-budget generation reads this shop's real Brand Brain before calling the model — not a settings-only, generation-blind feature", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "idea" }, error: null },
    { data: [], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: [{ estimated_cost_cents: 199 }], error: null },
    { data: null, error: null }, // content_items update -> generating
    { data: { name: "Test Florals" }, error: null } // shopRow
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", budget_cap_cents: 200 }));
  const brandBrainCall = client.calls.find((c) => c.table === "marketing_brand_brain" && c.ops.some((op) => op[0] === "select"));
  assert.ok(brandBrainCall, "generate_content must actually load this shop's Brand Brain before generating — the summary it produces is useless if never read");
  const shopEq = brandBrainCall.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
  assert.ok(shopEq, "the Brand Brain read must be scoped to the requesting shop — never a cross-shop style leak");
  assert.equal(shopEq[1][1], "shop-1");
});

// Lily Creative Style Learning: the shop's separate VISUAL style memory
// (ai-style-memory.js) must also actually be read on this path, not just
// documented — a florist could otherwise teach Lily "I like soft luxury
// backgrounds" via My Style and see zero effect on real visual briefs.
test("generate_content: a within-budget generation also reads this shop's real visual style memory (My Style), separately from Brand Brain", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "text_post", title: "t", brief: "b", status: "idea" }, error: null },
    { data: [], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: [{ estimated_cost_cents: 199 }], error: null },
    { data: null, error: null }, // content_items update -> generating
    { data: { name: "Test Florals" }, error: null } // shopRow
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", budget_cap_cents: 200 }));
  const styleCall = client.calls.find((c) => c.table === "ai_style_memory" && c.ops.some((op) => op[0] === "select"));
  assert.ok(styleCall, "generate_content must actually load this shop's My Style (visual) memory before generating");
  const shopEq = styleCall.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
  assert.ok(shopEq, "the My Style read must be scoped to the requesting shop — never a cross-shop style leak");
  assert.equal(shopEq[1][1], "shop-1");
});

test("generate_content: a budget check that itself fails (DB error) blocks the request rather than silently letting generation through", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "idea" }, error: null },
    { data: [], error: null },
    { data: { marketing_monthly_budget_cents: null }, error: null },
    { data: null, error: { message: "connection lost" } } // usage sum query fails
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", budget_cap_cents: 200, photo_choice: "generate" }));
  assert.equal(res.statusCode, 500);
  const statusUpdateCall = client.calls.find((c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update"));
  assert.equal(statusUpdateCall, undefined, "an unverifiable budget check must fail closed — never proceed to generation");
});

test("generate_content: a shop-level default cap alone (no per-request cap) is enforced as a real hard ceiling", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "idea" }, error: null },
    { data: [], error: null },
    { data: { marketing_monthly_budget_cents: 100 }, error: null }, // shop configured a real default
    { data: [{ estimated_cost_cents: 98 }], error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", photo_choice: "generate" })); // no per-request override at all
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.cap_source, "shop_default");
  assert.match(body.error, /shop's configured default/);
});

test("generate_content: a per-request cap can never be used to exceed the shop's configured hard cap", async () => {
  const client = createFakeSupabaseClient([
    superAdminRow(),
    { data: { id: "item-1", content_type: "image_post", title: "t", brief: "b", status: "idea" }, error: null },
    { data: [], error: null },
    { data: { marketing_monthly_budget_cents: 100 }, error: null },
    { data: [{ estimated_cost_cents: 98 }], error: null }
  ]);
  const handler = createMarketingStudioHandler(baseDeps(client));
  // Caller asks for a huge budget — the shop's real 100-cent cap still wins.
  const res = await handler(event("generate_content", { shop_id: "shop-1", content_item_id: "item-1", budget_cap_cents: 999999, photo_choice: "generate" }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.cap_cents, 100);
});
