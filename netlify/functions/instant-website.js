import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail, requireRoles } from "./_shared/supabase.js";
import {
  buildSiteFromShopProfile,
  switchThemePreserveContent,
  reorderSections,
  restorePageVersion,
  computeWebsiteHealthScore,
  LAUNCH_MODES,
  lilyWebsiteDraftRequiresApproval
} from "./_shared/bloom-instant-website.js";
import {
  applyTextEdit,
  applyImageReplace,
  duplicateSection,
  toggleSectionVisibility,
  deleteSectionWithConfirm,
  moveSectionKeyboard,
  publishRequiresApproval,
  restoreThemeSettings
} from "./_shared/bloom-website-editor.js";
import { tenantIsolationCheck } from "./_shared/bloom-storefront-core.js";
import { buildWebsiteCatalogSeeds, shouldSeedWebsiteCatalog } from "./_shared/bloom-website-catalog-seed.js";
import { writeShopAudit } from "./_shared/production.js";

const ROLES = ["owner", "manager", "designer", "cashier"];

function missingTable(e) {
  return e?.code === "42P01";
}

async function loadShopProfile(client, shopId) {
  const { data, error } = await client.from("shops").select("*").eq("id", shopId).maybeSingle();
  if (error) throw error;
  return data || {};
}

async function seedWebsiteCatalogIfEmpty(client, shopId) {
  try {
    const { count, error } = await client
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .is("deleted_at", null);
    if (error) throw error;
    if (!shouldSeedWebsiteCatalog(count)) return { seeded: 0, skipped: true };
    const seeds = buildWebsiteCatalogSeeds(shopId, { maxItems: 48 });
    for (const copy of seeds) {
      await client.from("products").insert({
        shop_id: shopId,
        name: copy.name,
        category: (copy.categories || [])[0] || "Everyday",
        description: copy.description,
        image_url: copy.primary_image?.url,
        price: copy.retail_price ?? copy.suggested_retail?.default ?? 0,
        active: true,
        available_online: true
      });
    }
    return { seeded: seeds.length };
  } catch (e) {
    if (missingTable(e)) return { seeded: 0, note: "Products table unavailable." };
    throw e;
  }
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (!["GET", "POST"].includes(event.httpMethod)) return methodNotAllowed();

  try {
    const ctx = await currentUser(event);
    requireRoles(ctx, ROLES);
    const { client, shopId, user } = ctx;
    const body = event.httpMethod === "GET" ? {} : bodyOf(event);
    const action = String(body.action || event.queryStringParameters?.action || "hub").toLowerCase();

    if (action === "launch_modes") {
      return json(200, { modes: LAUNCH_MODES });
    }

    if (action === "generate" || action === "wizard_generate") {
      const shop = { ...(await loadShopProfile(client, shopId)), ...(body.shop || {}) };
      const site = buildSiteFromShopProfile(shop, { launch_mode: body.launch_mode, status: "draft" });
      try {
        const { data: proj, error } = await client
          .from("bloom_website_projects")
          .upsert(
            {
              shop_id: shopId,
              launch_mode: site.project.launch_mode,
              theme_id: site.project.theme_id,
              status: "draft",
              temporary_url: site.project.temporary_url,
              theme_settings: site.theme_settings,
              seo_settings: site.seo,
              updated_at: new Date().toISOString()
            },
            { onConflict: "shop_id" }
          )
          .select("*")
          .single();
        if (error) throw error;
        for (const page of site.pages) {
          await client.from("bloom_website_pages").upsert(
            {
              shop_id: shopId,
              project_id: proj.id,
              slug: page.slug,
              title: page.title,
              visible: page.visible !== false,
              nav_order: site.navigation.findIndex((n) => n.page_id === page.id),
              template: page.template,
              content: page.content,
              sections: page.slug === "home" ? site.sections : [],
              updated_at: new Date().toISOString()
            },
            { onConflict: "project_id,slug" }
          );
        }
        await writeShopAudit(client, { shopId, userId: user.id, eventType: "website_generated", entityType: "website", entityId: proj.id, metadata: { launch_mode: site.project.launch_mode } });
        const catalog_seed = body.seed_catalog !== false ? await seedWebsiteCatalogIfEmpty(client, shopId) : { seeded: 0 };
        return json(201, { site, project_id: proj.id, catalog_seed });
      } catch (e) {
        if (missingTable(e)) return json(200, { site, note: "Apply RC1 migration to persist website project." });
        throw e;
      }
    }

    if (action === "get_project") {
      try {
        const { data: project } = await client.from("bloom_website_projects").select("*").eq("shop_id", shopId).maybeSingle();
        const { data: pages } = await client.from("bloom_website_pages").select("*").eq("shop_id", shopId).order("nav_order");
        return json(200, { project, pages: pages || [] });
      } catch (e) {
        if (missingTable(e)) {
          const shop = await loadShopProfile(client, shopId);
          const site = buildSiteFromShopProfile(shop);
          return json(200, { project: site.project, pages: site.pages, note: "In-memory fallback until migration applied." });
        }
        throw e;
      }
    }

    if (action === "save_page") {
      if (!tenantIsolationCheck(body.shop_id || shopId, shopId)) return json(403, { error: "Cross-shop edit denied." });
      const page = body.page;
      if (!page?.slug) return json(400, { error: "Page slug required." });
      try {
        const { data: proj } = await client.from("bloom_website_projects").select("id").eq("shop_id", shopId).maybeSingle();
        if (!proj) return json(404, { error: "Website project not found." });
        const { data: prev } = await client.from("bloom_website_pages").select("*").eq("project_id", proj.id).eq("slug", page.slug).maybeSingle();
        if (prev) {
          await client.from("bloom_website_page_versions").insert({
            shop_id: shopId,
            page_id: prev.id,
            snapshot: { content: prev.content, sections: prev.sections }
          });
        }
        await client.from("bloom_website_pages").upsert(
          {
            shop_id: shopId,
            project_id: proj.id,
            slug: page.slug,
            title: page.title,
            visible: page.visible !== false,
            nav_order: page.nav_order ?? 0,
            template: page.template || "custom",
            content: page.content || {},
            sections: page.sections || [],
            updated_at: new Date().toISOString()
          },
          { onConflict: "project_id,slug" }
        );
        return json(200, { saved: true });
      } catch (e) {
        if (missingTable(e)) return json(503, { error: "Website tables not migrated." });
        throw e;
      }
    }

    if (action === "edit_text") {
      const sections = body.sections || [];
      const idx = sections.findIndex((s) => s.id === body.section_id);
      if (idx < 0) return json(404, { error: "Section not found." });
      sections[idx] = applyTextEdit(sections[idx], body.path || "title", body.value || "");
      return json(200, { sections });
    }

    if (action === "edit_image") {
      const sections = body.sections || [];
      const idx = sections.findIndex((s) => s.id === body.section_id);
      if (idx < 0) return json(404, { error: "Section not found." });
      sections[idx] = applyImageReplace(sections[idx], body.path || "image", body.media || {});
      return json(200, { sections });
    }

    if (action === "move_section_keyboard") {
      const sections = moveSectionKeyboard(body.sections || [], body.section_id, body.direction);
      return json(200, { sections });
    }

    if (action === "duplicate_section") {
      const section = (body.sections || []).find((s) => s.id === body.section_id);
      if (!section) return json(404, { error: "Section not found." });
      return json(200, { sections: duplicateSection(section, body.sections || []) });
    }

    if (action === "toggle_section") {
      const sections = (body.sections || []).map((s) => (s.id === body.section_id ? toggleSectionVisibility(s, body.visible !== false) : s));
      return json(200, { sections });
    }

    if (action === "delete_section") {
      const result = deleteSectionWithConfirm(body.sections || [], body.section_id, body.confirmed);
      return json(200, result);
    }

    if (action === "switch_theme") {
      const shop = await loadShopProfile(client, shopId);
      let site = body.site;
      if (!site) {
        site = buildSiteFromShopProfile(shop);
      }
      const previousTheme = structuredClone(site.theme_settings || {});
      const updated = switchThemePreserveContent(site, body.launch_mode);
      if (body.persist && body.confirmed) {
        try {
          await client
            .from("bloom_website_projects")
            .update({
              launch_mode: updated.project.launch_mode,
              theme_id: updated.project.theme_id,
              theme_settings: updated.theme_settings,
              updated_at: new Date().toISOString()
            })
            .eq("shop_id", shopId);
        } catch (e) {
          if (!missingTable(e)) throw e;
        }
      }
      return json(200, { site: updated, previous_theme: previousTheme });
    }

    if (action === "restore_theme") {
      const current = body.site || buildSiteFromShopProfile(await loadShopProfile(client, shopId));
      const restored = restoreThemeSettings(body.previous_theme, current.theme_settings);
      return json(200, { theme_settings: restored.settings, restored: restored.restored });
    }

    if (action === "reorder_sections") {
      const sections = reorderSections(body.sections || [], Number(body.from), Number(body.to));
      return json(200, { sections });
    }

    if (action === "restore_version") {
      const page = restorePageVersion(body.page, body.version);
      return json(200, { page });
    }

    if (action === "health_score") {
      const score = computeWebsiteHealthScore(body.site || {}, body.products || []);
      return json(200, score);
    }

    if (action === "lily_draft") {
      return json(200, lilyWebsiteDraftRequiresApproval(body.draft));
    }

    if (action === "publish") {
      requireRoles(ctx, ["owner", "manager"]);
      const gate = publishRequiresApproval({ lilyDraft: body.lily_draft, approved: body.approved, saved: body.saved !== false });
      if (!gate.ok) return json(400, { error: gate.error });
      try {
        await client.from("bloom_website_projects").update({ status: "published", updated_at: new Date().toISOString() }).eq("shop_id", shopId);
      } catch (e) {
        if (missingTable(e)) return json(503, { error: "Website projects not migrated." });
        throw e;
      }
      return json(200, { published: true });
    }

    if (action === "commerce_settings") {
      requireRoles(ctx, ["owner", "manager"]);
      const settings = body.commerce_settings || body.settings || {};
      try {
        const { data, error } = await client
          .from("bloom_website_projects")
          .update({ commerce_settings: settings, updated_at: new Date().toISOString() })
          .eq("shop_id", shopId)
          .select("commerce_settings")
          .maybeSingle();
        if (error) throw error;
        return json(200, { commerce_settings: data?.commerce_settings || settings });
      } catch (e) {
        if (missingTable(e)) return json(503, { error: "Apply RC1.2 commerce migration for commerce_settings." });
        throw e;
      }
    }

    return json(200, { ok: true, actions: ["generate", "switch_theme", "publish", "health_score", "launch_modes", "commerce_settings"] });
  } catch (error) {
    return fail(error);
  }
}
