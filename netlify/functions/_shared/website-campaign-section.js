/**
 * Applies a campaign's AI-generated website content onto the shop's real
 * Website Builder X draft (AI-OS Wave 3) — the piece Wave 1 deliberately
 * left unfinished: generateWebsiteSectionDraft() produced ready content,
 * but nothing wrote it into a real page. This does, using the exact same
 * building blocks instant-website.js's own save_page action uses
 * (insertGeneratedSection, normalizeSectionOrder, a version snapshot for
 * undo) — never publishing anything: bloom_website_pages is always the
 * draft layer, and going live still requires the florist's own separate
 * "publish" action in Website Studio, unchanged by this.
 */
import { insertGeneratedSection } from "./bloom-website-editor.js";
import { writeShopAudit } from "./production.js";

const HOMEPAGE_SLUG = "home";

/**
 * @returns {ok:true, applied:true, page} when the section was added to the
 *          shop's home page draft; {ok:true, applied:false, reason} when
 *          there's no website project yet to apply it to (not an error —
 *          not every shop has started Website Builder X); {ok:false,
 *          error} on a real failure.
 */
export async function applyGeneratedWebsiteSection(client, { shopId, userId, section }) {
  const { data: project, error: projectError } = await client
    .from("bloom_website_projects")
    .select("id")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (projectError) return { ok: false, error: projectError.message };
  if (!project) {
    return { ok: true, applied: false, reason: "This shop hasn't started a Website Builder X draft yet, so there's nothing to add the section to." };
  }

  const { data: page, error: pageError } = await client
    .from("bloom_website_pages")
    .select("*")
    .eq("project_id", project.id)
    .eq("slug", HOMEPAGE_SLUG)
    .maybeSingle();
  if (pageError) return { ok: false, error: pageError.message };
  if (!page) {
    return { ok: true, applied: false, reason: "No home page found on this website draft yet." };
  }

  // Same undo safety net save_page gives a manual edit — a florist can
  // always get back the page as it was before Lily added this section.
  const { error: versionError } = await client
    .from("bloom_website_page_versions")
    .insert({ shop_id: shopId, page_id: page.id, snapshot: { content: page.content, sections: page.sections } });
  if (versionError) return { ok: false, error: versionError.message };

  const sections = insertGeneratedSection(page.sections || [], section);
  const { data: saved, error: saveError } = await client
    .from("bloom_website_pages")
    .update({ sections, updated_at: new Date().toISOString() })
    .eq("id", page.id)
    .select("id,slug,updated_at")
    .single();
  if (saveError) return { ok: false, error: saveError.message };

  await writeShopAudit(client, {
    shopId,
    userId,
    eventType: "website_page_saved",
    entityType: "website_page",
    entityId: saved.id,
    metadata: { slug: saved.slug, source: "ai_campaign_section" }
  });

  return { ok: true, applied: true, page: saved };
}

/** Maps the creative engine's website-section content shape onto the
 * existing "hero" section type — the only section type in Website Builder
 * X's schema with all of headline/subheadline/body/cta/image, so this
 * reuses real, already-supported fields rather than inventing a new
 * section type the editor can't render. */
export function buildWebsiteSectionPayload(content = {}, { imageUrl } = {}) {
  return {
    type: "hero",
    props: {
      title: content.headline || "",
      subtitle: content.subheadline || "",
      text: content.body || "",
      cta: content.cta_label || "",
      image: imageUrl || null
    }
  };
}
