/**
 * Recent-content repetition awareness — Phase 2 rebuild, priority-4 gap.
 *
 * Real, live-found pattern this closes: nothing before this ever told a
 * generation call what this shop's OWN recent posts actually said, so
 * back-to-back "make today's post" requests could easily land on the same
 * opening line, the same joke, the same angle, week after week — there was
 * no mechanism to even notice, let alone avoid it.
 *
 * Deliberately narrow and honest: this loads exactly the shop's own real,
 * already-published caption text (marketing_platform_variants.caption —
 * the same column repointVariants() already writes on every generation,
 * no new table, no new write path) and hands the model a short "don't
 * repeat these" list. It never fabricates a theme or trend, never scores
 * "similarity," and never blocks a generation — it's a grounding hint the
 * model is asked to respect, the same soft-preference shape brand voice
 * and visual style summaries already use elsewhere in this file's sibling
 * modules. A shop with no prior posts yet (or with the read itself
 * failing) gets an honestly empty summary, never a guessed placeholder.
 */

const MAX_RECENT_CAPTIONS = 6;
const MAX_CAPTION_SNIPPET_CHARS = 140;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} shopId
 * @param {object} [opts]
 * @param {string|null} [opts.excludeContentItemId] - the content item
 *   currently being generated, if its own (possibly already-persisted)
 *   variant rows could otherwise show up in its own "recent posts" list —
 *   e.g. a revision re-generating a caption for the same item.
 * @returns {Promise<{recentCaptions: string[]}>}
 */
export async function loadRecentContent(client, shopId, { excludeContentItemId = null } = {}) {
  let query = client
    .from("marketing_platform_variants")
    .select("caption,content_item_id,created_at")
    .eq("shop_id", shopId)
    .not("caption", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_RECENT_CAPTIONS + 1); // +1 headroom in case the current item's own row is in the page and gets filtered client-side below
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return { recentCaptions: [] };
  const captions = data
    .filter((row) => (!excludeContentItemId || row.content_item_id !== excludeContentItemId) && row.caption && row.caption.trim())
    .slice(0, MAX_RECENT_CAPTIONS)
    .map((row) => row.caption.trim());
  return { recentCaptions: captions };
}

/**
 * Turns loadRecentContent()'s real captions into one prompt-ready
 * instruction — same "compose only what's real, null when there's
 * nothing" shape as this file's sibling grounding modules. Each caption is
 * shown only as a short snippet (never the full post) — the model needs
 * enough to recognize and avoid repeating an opening line or angle, not a
 * reason to quote a full prior post back.
 */
export function buildRecentContentGroundingBrief({ recentCaptions } = {}) {
  if (!Array.isArray(recentCaptions) || !recentCaptions.length) {
    return { summaryText: null, grounded: false };
  }
  const snippets = recentCaptions.map((c, i) => `${i + 1}) "${c.slice(0, MAX_CAPTION_SNIPPET_CHARS)}${c.length > MAX_CAPTION_SNIPPET_CHARS ? "…" : ""}"`);
  const summaryText = `This shop's own recent real posts, most recent first (never repeat their exact opening line, phrasing, or angle — write something genuinely different this time, even if the underlying occasion/topic is similar): ${snippets.join(" ")}`;
  return { summaryText, grounded: true };
}
