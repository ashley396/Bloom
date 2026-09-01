import test from "node:test";
import assert from "node:assert/strict";
import { loadRecentContentHistory, loadRecentContent, buildRecentContentGroundingBrief } from "../netlify/functions/_shared/marketing-recent-content-grounding.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Batch 5 ("Repair recent-content diversity + brand-memory learning"),
// Part A/B/C/F/G: loadRecentContentHistory is the one real source of truth
// for "what has this shop actually been publishing" — published preferred,
// approved as fallback, rejected/failed/canceled/undecided excluded,
// deduplicated by content item, structured (not just caption strings).

function variant(overrides = {}) {
  return {
    id: overrides.id || "variant-1",
    content_item_id: overrides.content_item_id || "item-1",
    platform: overrides.platform || "facebook",
    caption: overrides.caption ?? "A real caption.",
    asset_id: overrides.asset_id === undefined ? "asset-1" : overrides.asset_id,
    status: overrides.status || "published",
    published_at: overrides.published_at ?? "2026-08-20T00:00:00Z",
    created_at: overrides.created_at || "2026-08-19T00:00:00Z"
  };
}

function item(overrides = {}) {
  return { id: overrides.id || "item-1", status: overrides.status || "approved", updated_at: overrides.updated_at || "2026-08-19T00:00:00Z" };
}

function asset(overrides = {}) {
  return {
    id: overrides.id || "asset-1",
    asset_type: overrides.asset_type || "social_copy",
    status: overrides.status || "completed",
    content: overrides.content || { body: "A real caption.", cta: "Order now" }
  };
}

// Part P #1/#2: published preferred, approved used only when published is insufficient.
test("loadRecentContentHistory: a published post and an approved-but-not-yet-published post both surface, published first", async () => {
  const client = createFakeSupabaseClient([
    {
      data: [
        variant({ id: "v1", content_item_id: "item-published", caption: "Published post.", status: "published", published_at: "2026-08-20T00:00:00Z", asset_id: "asset-1" }),
        variant({ id: "v2", content_item_id: "item-approved", caption: "Approved but not published yet.", status: "pending", published_at: null, created_at: "2026-08-21T00:00:00Z", asset_id: "asset-2" })
      ],
      error: null
    },
    { data: [item({ id: "item-published", status: "approved" }), item({ id: "item-approved", status: "approved" })], error: null },
    { data: [asset({ id: "asset-1" }), asset({ id: "asset-2", content: { body: "Approved but not published yet.", cta: "Order now" } })], error: null }
  ]);
  const { entries } = await loadRecentContentHistory(client, "shop-1");
  assert.equal(entries.length, 2);
  assert.equal(entries[0].contentItemId, "item-published", "Part A: published content ranks ahead of merely-approved content, even when the approved one is chronologically newer");
  assert.equal(entries[1].contentItemId, "item-approved");
});

test("loadRecentContentHistory: with no published history at all, approved content alone is used", async () => {
  const client = createFakeSupabaseClient([
    { data: [variant({ content_item_id: "item-1", status: "ready", published_at: null })], error: null },
    { data: [item({ id: "item-1", status: "scheduled" })], error: null },
    { data: [asset()], error: null }
  ]);
  const { entries } = await loadRecentContentHistory(client, "shop-1");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].contentItemId, "item-1");
});

// Part P #3: rejected (archived) content excluded.
test("loadRecentContentHistory: a rejected (archived) content item is excluded entirely", async () => {
  const client = createFakeSupabaseClient([
    { data: [variant({ content_item_id: "item-rejected", status: "published" })], error: null },
    { data: [item({ id: "item-rejected", status: "archived" })], error: null }
  ]);
  const { entries } = await loadRecentContentHistory(client, "shop-1");
  assert.deepEqual(entries, []);
});

// Undecided drafts (idea/generating/draft/in_review) must never teach
// Lily what the florist has been publishing.
test("loadRecentContentHistory: a still-in-review draft is excluded", async () => {
  const client = createFakeSupabaseClient([
    { data: [variant({ content_item_id: "item-draft", status: "pending" })], error: null },
    { data: [item({ id: "item-draft", status: "in_review" })], error: null }
  ]);
  const { entries } = await loadRecentContentHistory(client, "shop-1");
  assert.deepEqual(entries, []);
});

// Part P #4: failed content excluded — a failed publish attempt on this
// platform's variant, and a failed underlying asset, both excluded.
test("loadRecentContentHistory: a failed variant is excluded, even though its content item is approved", async () => {
  const client = createFakeSupabaseClient([
    { data: [variant({ content_item_id: "item-1", status: "failed" })], error: null },
    { data: [item({ id: "item-1", status: "approved" })], error: null }
  ]);
  const { entries } = await loadRecentContentHistory(client, "shop-1");
  assert.deepEqual(entries, []);
});

test("loadRecentContentHistory: a failed underlying asset is excluded", async () => {
  const client = createFakeSupabaseClient([
    { data: [variant({ content_item_id: "item-1", status: "published" })], error: null },
    { data: [item({ id: "item-1", status: "approved" })], error: null },
    { data: [asset({ status: "failed" })], error: null }
  ]);
  const { entries } = await loadRecentContentHistory(client, "shop-1");
  assert.deepEqual(entries, []);
});

// Part P #5: canceled excluded.
test("loadRecentContentHistory: a canceled variant is excluded", async () => {
  const client = createFakeSupabaseClient([
    { data: [variant({ content_item_id: "item-1", status: "canceled" })], error: null },
    { data: [item({ id: "item-1", status: "approved" })], error: null }
  ]);
  const { entries } = await loadRecentContentHistory(client, "shop-1");
  assert.deepEqual(entries, []);
});

// Part P #6/Part B: the same content item across two platforms counts once.
test("loadRecentContentHistory: the same content item published on two platforms is deduplicated to one entry", async () => {
  const client = createFakeSupabaseClient([
    {
      data: [
        variant({ id: "v-fb", content_item_id: "item-1", platform: "facebook", status: "published", published_at: "2026-08-20T00:00:00Z", asset_id: "asset-1" }),
        variant({ id: "v-ig", content_item_id: "item-1", platform: "instagram", status: "published", published_at: "2026-08-20T01:00:00Z", asset_id: "asset-1" })
      ],
      error: null
    },
    { data: [item({ id: "item-1", status: "approved" })], error: null },
    { data: [asset()], error: null }
  ]);
  const { entries } = await loadRecentContentHistory(client, "shop-1");
  assert.equal(entries.length, 1, "one underlying idea, two platform variants — must count once");
});

// Part P #16: shop-scoped.
test("loadRecentContentHistory: every query is scoped to the given shop_id", async () => {
  const client = createFakeSupabaseClient([
    { data: [variant()], error: null },
    { data: [item()], error: null },
    { data: [asset()], error: null }
  ]);
  await loadRecentContentHistory(client, "shop-42");
  for (const table of ["marketing_platform_variants", "marketing_content_items", "ai_generated_assets"]) {
    const call = client.calls.find((c) => c.table === table);
    assert.ok(call.ops.some((op) => op[0] === "eq" && op[1][0] === "shop_id" && op[1][1] === "shop-42"), `${table} query must be shop-scoped`);
  }
});

// Part P #17: excludeContentItemId prevents self-comparison.
test("loadRecentContentHistory: excludeContentItemId keeps the item currently being generated out of its own history", async () => {
  const client = createFakeSupabaseClient([
    {
      data: [
        variant({ content_item_id: "item-being-revised", caption: "This item's own prior caption." }),
        variant({ content_item_id: "item-other", caption: "A different real post.", asset_id: "asset-2" })
      ],
      error: null
    },
    { data: [item({ id: "item-other", status: "approved" })], error: null },
    { data: [asset({ id: "asset-2", content: { body: "A different real post." } })], error: null }
  ]);
  const { entries } = await loadRecentContentHistory(client, "shop-1", { excludeContentItemId: "item-being-revised" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].contentItemId, "item-other");
});

// Part P #18: canonical concept used when present.
test("loadRecentContentHistory: uses the asset's persisted canonical_concept fields directly when present", async () => {
  const concept = {
    version: 1,
    objective: "promotion",
    occasionCategory: "holiday_seasonal",
    primarySubjectClass: "mascot_or_character",
    ctaIntent: "order_now",
    creativeFamily: "designed_flyer",
    visualDirection: { photoStrategy: "subject_forward" },
    assetRoute: "ai_generated_photo"
  };
  const client = createFakeSupabaseClient([
    { data: [variant()], error: null },
    { data: [item()], error: null },
    { data: [asset({ content: { body: "A real caption.", canonical_concept: concept, template_id: "tpl-1" } })], error: null }
  ]);
  const { entries } = await loadRecentContentHistory(client, "shop-1");
  assert.equal(entries[0].objective, "promotion");
  assert.equal(entries[0].occasionCategory, "holiday_seasonal");
  assert.equal(entries[0].primarySubjectClass, "mascot_or_character");
  assert.equal(entries[0].ctaIntent, "order_now");
  assert.equal(entries[0].creativeFamily, "designed_flyer");
  assert.deepEqual(entries[0].visualDirection, { photoStrategy: "subject_forward" });
  assert.equal(entries[0].assetRoute, "ai_generated_photo");
  assert.equal(entries[0].templateFamily, "tpl-1");
});

// Part P #19: legacy content without canonical_concept still gets a safe
// fallback classification (Part F), from the same deterministic
// classifiers Batch 4 itself uses — never a second concept schema.
test("loadRecentContentHistory: legacy content with no canonical_concept still gets a real, deterministic fallback classification", async () => {
  const client = createFakeSupabaseClient([
    { data: [variant()], error: null },
    { data: [item()], error: null },
    { data: [asset({ asset_type: "image", content: { body: "Order a mascot bouquet today!", cta: "Call us", objective: "awareness", creative_brief: { primary_subject: "a mascot holding flowers" } } })], error: null }
  ]);
  const { entries } = await loadRecentContentHistory(client, "shop-1");
  assert.equal(entries[0].objective, "awareness");
  assert.equal(entries[0].primarySubjectClass, "mascot_or_character", "the fallback classifier must actually run over the legacy creative_brief text");
  assert.equal(entries[0].ctaIntent, "call_shop");
  assert.equal(entries[0].creativeFamily, "plain_photo_post");
  assert.equal(entries[0].visualDirection, null, "a legacy asset has no persisted visualDirection to fall back to — never invented");
});

test("loadRecentContentHistory: a real DB error degrades to an honestly empty history, never throws", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "db down" } }]);
  const { entries } = await loadRecentContentHistory(client, "shop-1");
  assert.deepEqual(entries, []);
});

test("loadRecentContentHistory: caps at the bounded history limit even when more real eligible posts exist", async () => {
  const variants = Array.from({ length: 20 }, (_, i) =>
    variant({ id: `v${i}`, content_item_id: `item-${i}`, caption: `Post number ${i}`, asset_id: `asset-${i}`, created_at: `2026-08-${String(20 - i).padStart(2, "0")}T00:00:00Z`, published_at: `2026-08-${String(20 - i).padStart(2, "0")}T00:00:00Z` })
  );
  const items = variants.map((v) => item({ id: v.content_item_id, status: "approved" }));
  const assets = variants.map((v) => asset({ id: v.asset_id, content: { body: v.caption } }));
  const client = createFakeSupabaseClient([{ data: variants, error: null }, { data: items, error: null }, { data: assets, error: null }]);
  const { entries } = await loadRecentContentHistory(client, "shop-1");
  assert.ok(entries.length <= 8, "the bounded history window must never exceed its documented limit");
});

// ── Legacy wrappers (still used by the soft prompt-grounding hint) ───────

test("loadRecentContent: derives plain caption strings from the same real, filtered history", async () => {
  const client = createFakeSupabaseClient([
    { data: [variant({ caption: "Fresh peonies just arrived!" })], error: null },
    { data: [item()], error: null },
    { data: [asset({ content: { body: "Fresh peonies just arrived!" } })], error: null }
  ]);
  const result = await loadRecentContent(client, "shop-1");
  assert.deepEqual(result.recentCaptions, ["Fresh peonies just arrived!"]);
});

test("buildRecentContentGroundingBrief: no recent captions at all (a brand-new shop) returns null, never an empty-list instruction", () => {
  const brief = buildRecentContentGroundingBrief({ recentCaptions: [] });
  assert.equal(brief.summaryText, null);
  assert.equal(brief.grounded, false);
});

test("buildRecentContentGroundingBrief: real captions produce a numbered, prompt-ready 'don't repeat this' instruction", () => {
  const brief = buildRecentContentGroundingBrief({ recentCaptions: ["Fresh peonies just arrived!", "Our roses are gorgeous today."] });
  assert.equal(brief.grounded, true);
  assert.match(brief.summaryText, /never repeat their exact opening line/);
  assert.match(brief.summaryText, /1\) "Fresh peonies just arrived!"/);
  assert.match(brief.summaryText, /2\) "Our roses are gorgeous today\."/);
});

test("buildRecentContentGroundingBrief: a long caption is shown only as a bounded snippet, never the full post text", () => {
  const longCaption = "A".repeat(500);
  const brief = buildRecentContentGroundingBrief({ recentCaptions: [longCaption] });
  assert.ok(brief.summaryText.length < 500, "the snippet must be meaningfully shorter than the full 500-char caption");
  assert.match(brief.summaryText, /…"/, "a truncated snippet must show it was cut, not silently end mid-word with no indication");
});
