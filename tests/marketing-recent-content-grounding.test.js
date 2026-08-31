import test from "node:test";
import assert from "node:assert/strict";
import { loadRecentContent, buildRecentContentGroundingBrief } from "../netlify/functions/_shared/marketing-recent-content-grounding.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// Phase 2 rebuild, priority-4 gap: recent-content repetition awareness.
// Real gap this closes: nothing before this ever told a generation call
// what this shop's own recent posts actually said, so back-to-back
// requests could land on the same opening line week after week with no
// mechanism to even notice.

test("loadRecentContent: returns this shop's real recent captions, newest first, scoped to shop_id", async () => {
  const client = createFakeSupabaseClient([
    {
      data: [
        { caption: "Fresh peonies just arrived!", content_item_id: "item-2", created_at: "2026-08-20T00:00:00Z" },
        { caption: "Our roses are looking gorgeous today.", content_item_id: "item-1", created_at: "2026-08-18T00:00:00Z" }
      ],
      error: null
    }
  ]);
  const result = await loadRecentContent(client, "shop-1");
  assert.deepEqual(result.recentCaptions, ["Fresh peonies just arrived!", "Our roses are looking gorgeous today."]);
  const query = client.calls.find((c) => c.table === "marketing_platform_variants");
  const shopFilter = query.ops.find((op) => op[0] === "eq" && op[1][0] === "shop_id");
  assert.deepEqual(shopFilter[1], ["shop_id", "shop-1"]);
});

test("loadRecentContent: excludes the content item currently being generated, so a revision never sees its own prior caption", async () => {
  const client = createFakeSupabaseClient([
    {
      data: [
        { caption: "This item's own prior caption.", content_item_id: "item-being-revised", created_at: "2026-08-20T00:00:00Z" },
        { caption: "A genuinely different, older post.", content_item_id: "item-other", created_at: "2026-08-18T00:00:00Z" }
      ],
      error: null
    }
  ]);
  const result = await loadRecentContent(client, "shop-1", { excludeContentItemId: "item-being-revised" });
  assert.deepEqual(result.recentCaptions, ["A genuinely different, older post."]);
});

test("loadRecentContent: filters out blank/null captions and caps at 6", async () => {
  const rows = [
    { caption: "", content_item_id: "a", created_at: "2026-08-20T00:00:00Z" },
    { caption: null, content_item_id: "b", created_at: "2026-08-19T00:00:00Z" },
    ...Array.from({ length: 8 }, (_, i) => ({ caption: `Post number ${i}`, content_item_id: `c${i}`, created_at: `2026-08-${18 - i}T00:00:00Z` }))
  ];
  const client = createFakeSupabaseClient([{ data: rows, error: null }]);
  const result = await loadRecentContent(client, "shop-1");
  assert.equal(result.recentCaptions.length, 6, "never more than 6 recent captions, even when more real rows exist");
  assert.ok(!result.recentCaptions.some((c) => !c), "no blank/null caption ever survives into the list");
});

test("loadRecentContent: a real DB error degrades to an honestly empty list, never throws", async () => {
  const client = createFakeSupabaseClient([{ data: null, error: { message: "db down" } }]);
  const result = await loadRecentContent(client, "shop-1");
  assert.deepEqual(result.recentCaptions, []);
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
