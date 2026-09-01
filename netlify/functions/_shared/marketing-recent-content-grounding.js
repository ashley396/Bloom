/**
 * Recent-content repetition awareness.
 *
 * Batch 5 ("Repair recent-content diversity + brand-memory learning")
 * rebuild of a real, live-found gap: the original version of this module
 * (Phase 2 rebuild, priority-4 gap) loaded ANY recent
 * marketing_platform_variants row with a caption, regardless of whether
 * the content item behind it was ever actually approved or published —
 * meaning a rejected idea, a still-in-review draft, or an abandoned
 * intermediate retry could sit in Lily's own "don't repeat this" list
 * right alongside what the florist actually put in front of customers.
 * That taught Lily to avoid repeating drafts she herself rejected, not to
 * recognize what she's actually been publishing.
 *
 * Part A/B/C of the Batch 5 spec: this is now the one place that
 * - prioritizes real PUBLISHED content, falling back to real APPROVED
 *   content only when published history is insufficient (Part A);
 * - excludes rejected/archived, failed, canceled, and any content item
 *   that never reached a real decision (idea/generating/draft/in_review)
 *   (Part A);
 * - deduplicates by content_item_id, so the same underlying post never
 *   counts twice just because it has a Facebook AND an Instagram variant
 *   (Part B);
 * - returns STRUCTURED diversity signals (Part C), built from Batch 4's
 *   persisted canonical_concept when present, with a deterministic
 *   text-derived fallback for older content that predates it (Part F) —
 *   never a second, competing concept schema.
 *
 * Still no new table: everything here reads the same
 * marketing_platform_variants.caption / marketing_content_items.status /
 * ai_generated_assets.content columns every other Marketing Studio route
 * already reads and writes. Every query stays shop-scoped.
 */

import { classifyOccasionCategory, classifyPrimarySubjectClass, classifyCtaIntent, deriveCreativeFamily } from "./marketing-canonical-concept.js";

// Part G: the bounded history window. The prior version of this module
// capped itself at 6 raw caption rows; this version needs to survive
// filtering out ineligible items AND collapsing cross-platform duplicates
// down to one entry per content item, so it starts from a wider —  but
// still small, bounded, shop-scoped — raw candidate pool (CANDIDATE_POOL_
// SIZE) before settling on the final HISTORY_LIMIT structured entries. 8
// deduped real posts is comfortably enough to catch back-to-back-to-back
// repetition (the actual failure mode this exists to catch) without
// reading anywhere near a shop's full history; 30 raw variant rows is
// enough headroom that a normal shop's real recent activity (a handful of
// content items x a few platforms each) still yields a full 8 after
// dedup, even with some items excluded for never having been decided on.
const HISTORY_LIMIT = 8;
const CANDIDATE_POOL_SIZE = 30;
const MAX_CAPTION_SNIPPET_CHARS = 140;

// Part A: a content item in one of these statuses never reached a real
// decision (idea/generating/draft/in_review) or was actively rejected
// (archived — see resolveApprovalDecision in marketing-content-planner.js,
// where a "rejected" review decision moves a content item to 'archived',
// not a separate 'rejected' status) — never a source of "what the florist
// has been publishing."
const EXCLUDED_ITEM_STATUSES = new Set(["idea", "generating", "draft", "in_review", "archived"]);
// A specific platform variant's own publish attempt that failed or was
// canceled is never real published proof, even when its content item is
// otherwise approved — the item's OTHER platform variant may still count.
const EXCLUDED_VARIANT_STATUSES = new Set(["failed", "canceled"]);
// A failed or quarantined asset was never a real, shippable result —
// excluded the same way approve_content's own contentApprovalBlockReason
// already treats these states as unreal.
const EXCLUDED_ASSET_STATUSES = new Set(["failed", "quarantined"]);

export function normalizeOpeningPattern(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
}

export function normalizeCaptionText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildConceptFingerprint({ objective, occasionCategory, primarySubjectClass, ctaIntent, creativeFamily }) {
  return [objective, occasionCategory, primarySubjectClass, ctaIntent, creativeFamily].map((v) => v || "_").join("|");
}

/**
 * Part F: builds this history entry's structured concept fields from the
 * asset's persisted canonical_concept (Batch 4) when present — reusing it
 * verbatim, never re-deriving anything Batch 4 already decided. Only for
 * OLDER content created before canonical_concept existed does this fall
 * back to the same deterministic classifiers Batch 4 itself uses, run
 * directly over the legacy content fields (never free-form AI text).
 */
function buildHistoryEntry({ variant, asset, at }) {
  const content = asset?.content || {};
  const concept = content.canonical_concept || null;
  const captionText = variant.caption || content.body || "";
  const objective = concept?.objective ?? content.objective ?? null;
  const occasionCategory = concept?.occasionCategory ?? classifyOccasionCategory({ objective, isSympathy: false });
  const primarySubjectClass = concept?.primarySubjectClass ?? classifyPrimarySubjectClass(content.creative_brief?.primary_subject || content.visual_brief || null);
  const ctaIntent = concept?.ctaIntent ?? classifyCtaIntent(content.cta || "");
  const creativeFamily = concept?.creativeFamily ?? deriveCreativeFamily({ assetType: asset?.asset_type || null });
  return {
    contentItemId: variant.content_item_id,
    platform: variant.platform,
    publishedOrApprovedAt: at,
    objective,
    occasionCategory,
    primarySubjectClass,
    captionOpeningPattern: normalizeOpeningPattern(captionText),
    normalizedCaptionText: normalizeCaptionText(captionText),
    ctaIntent,
    creativeFamily,
    visualDirection: concept?.visualDirection ?? null,
    assetRoute: concept?.assetRoute ?? null,
    templateFamily: content.template_id || null,
    ctaText: normalizeCaptionText(content.cta || ""),
    conceptFingerprint: buildConceptFingerprint({ objective, occasionCategory, primarySubjectClass, ctaIntent, creativeFamily }),
    // Kept for the legacy prompt-grounding snippet (buildRecentContent
    // GroundingBrief below) — never used by the deterministic evaluator.
    captionSnippet: captionText
  };
}

/**
 * The one real recent-content history load — structured (Part C),
 * published-preferred/approved-fallback (Part A), deduplicated by
 * content_item_id (Part B), shop-scoped and bounded (Part G).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} shopId
 * @param {object} [opts]
 * @param {string|null} [opts.excludeContentItemId] - the content item
 *   currently being generated/revised, if its own (possibly
 *   already-persisted) rows could otherwise show up in its own history.
 * @param {number} [opts.limit]
 * @returns {Promise<{entries: object[]}>}
 */
export async function loadRecentContentHistory(client, shopId, { excludeContentItemId = null, limit = HISTORY_LIMIT } = {}) {
  const variantsResult = await client
    .from("marketing_platform_variants")
    .select("id,content_item_id,platform,caption,asset_id,status,published_at,created_at")
    .eq("shop_id", shopId)
    .not("caption", "is", null)
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_POOL_SIZE);
  if (variantsResult.error || !Array.isArray(variantsResult.data)) return { entries: [] };

  const variants = variantsResult.data.filter(
    (v) => (!excludeContentItemId || v.content_item_id !== excludeContentItemId) && v.caption && v.caption.trim() && !EXCLUDED_VARIANT_STATUSES.has(v.status)
  );
  if (!variants.length) return { entries: [] };

  const itemIds = [...new Set(variants.map((v) => v.content_item_id))];
  const itemsResult = await client.from("marketing_content_items").select("id,status,updated_at").eq("shop_id", shopId).in("id", itemIds);
  if (itemsResult.error || !Array.isArray(itemsResult.data)) return { entries: [] };
  const itemById = new Map(itemsResult.data.map((i) => [i.id, i]));

  // Part A: a variant only ever counts when its content item genuinely
  // reached approval/publication — never idea/generating/draft/in_review
  // (no real decision yet) or archived (actively rejected).
  const eligible = variants.filter((v) => {
    const item = itemById.get(v.content_item_id);
    return item && !EXCLUDED_ITEM_STATUSES.has(item.status);
  });
  if (!eligible.length) return { entries: [] };

  const assetIds = [...new Set(eligible.map((v) => v.asset_id).filter(Boolean))];
  let assetById = new Map();
  if (assetIds.length) {
    const assetsResult = await client.from("ai_generated_assets").select("id,asset_type,status,content").in("id", assetIds).eq("shop_id", shopId);
    if (!assetsResult.error && Array.isArray(assetsResult.data)) {
      assetById = new Map(assetsResult.data.filter((a) => !EXCLUDED_ASSET_STATUSES.has(a.status)).map((a) => [a.id, a]));
    }
  }

  // Part A (tier): published beats approved/scheduled-but-not-yet-
  // published. Part B (dedupe): one entry per content_item_id — the best
  // (lowest tier, then most recent) variant for that item wins.
  const byItem = new Map();
  for (const v of eligible) {
    let asset = null;
    if (v.asset_id) {
      asset = assetById.get(v.asset_id);
      if (!asset) continue; // asset missing or excluded (failed/quarantined)
    }
    const tier = v.status === "published" ? 1 : 2;
    const at = v.published_at || v.created_at;
    const existing = byItem.get(v.content_item_id);
    if (!existing || tier < existing.tier || (tier === existing.tier && at > existing.at)) {
      byItem.set(v.content_item_id, { variant: v, asset, tier, at });
    }
  }

  const deduped = [...byItem.values()].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.at > b.at ? -1 : a.at < b.at ? 1 : 0;
  });

  return { entries: deduped.slice(0, limit).map(buildHistoryEntry) };
}

/**
 * Legacy shape, still used by the soft prompt-grounding hint below:
 * just the caption strings, most recent first.
 */
export async function loadRecentContent(client, shopId, { excludeContentItemId = null } = {}) {
  const { entries } = await loadRecentContentHistory(client, shopId, { excludeContentItemId });
  return { recentCaptions: entries.map((e) => e.captionSnippet).filter(Boolean) };
}

/**
 * Turns loadRecentContent()'s real captions into one prompt-ready
 * instruction — same "compose only what's real, null when there's
 * nothing" shape as this file's sibling grounding modules. Each caption is
 * shown only as a short snippet (never the full post) — the model needs
 * enough to recognize and avoid repeating an opening line or angle, not a
 * reason to quote a full prior post back. This is a soft hint for the
 * model's own prompt — the deterministic diversity evaluator
 * (marketing-content-diversity.js) is what actually enforces anything.
 */
export function buildRecentContentGroundingBrief({ recentCaptions } = {}) {
  if (!Array.isArray(recentCaptions) || !recentCaptions.length) {
    return { summaryText: null, grounded: false };
  }
  const snippets = recentCaptions.map((c, i) => `${i + 1}) "${c.slice(0, MAX_CAPTION_SNIPPET_CHARS)}${c.length > MAX_CAPTION_SNIPPET_CHARS ? "…" : ""}"`);
  const summaryText = `This shop's own recent real posts, most recent first (never repeat their exact opening line, phrasing, or angle — write something genuinely different this time, even if the underlying occasion/topic is similar): ${snippets.join(" ")}`;
  return { summaryText, grounded: true };
}
