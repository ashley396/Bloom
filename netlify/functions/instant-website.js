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
import { buildPublishedSeoBundle } from "../../../lib/seo/published-site-seo.js";
import { buildPublishChecklist, validatePageSeoUpdate } from "../../../lib/website-studio/publish-checklist.js";
import {
  buildDnsInstructions,
  verifyDomainDns,
  mergeDomainStatus,
  normalizeDomain
} from "../../../lib/website-studio/domain-verification.js";
import { LILY_INTERVIEW_STEPS, buildWizardPayload } from "../../../lib/website-studio/lily-interview.js";
import {
  applyTextEdit,
  applyImageReplace,
  duplicateSection,
  toggleSectionVisibility,
  deleteSectionWithConfirm,
  moveSectionKeyboard,
  publishRequiresApproval,
  restoreThemeSettings,
  normalizeSectionOrder,
  assertPageNotStale,
  confirmThemePersistence
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
    const rows = seeds.map((copy) => ({
        shop_id: shopId,
        name: copy.name,
        category: (copy.categories || [])[0] || "Everyday",
        description: copy.description,
        image_url: copy.primary_image?.url,
        price: copy.retail_price ?? copy.suggested_retail?.default ?? 0,
        active: true,
        available_online: true
      }));
    const { error: insertError } = await client.from("products").insert(rows);
    if (insertError) throw insertError;
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
      const site = buildSiteFromShopProfile(shop, {
        launch_mode: body.launch_mode,
        status: "draft",
        brief: body.brief || body.florist_brief || {}
      });
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
        const pageRows = site.pages.map((page) => ({
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
            }));
        const { error: pageError } = await client
          .from("bloom_website_pages")
          .upsert(pageRows, { onConflict: "project_id,slug" });
        if (pageError) throw pageError;
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
        const { data: project, error: projectError } = await client.from("bloom_website_projects").select("*").eq("shop_id", shopId).maybeSingle();
        if (projectError) throw projectError;
        let pagesQuery = client.from("bloom_website_pages").select("*").eq("shop_id", shopId).order("nav_order");
        if (project?.id) pagesQuery = pagesQuery.eq("project_id", project.id);
        const { data: pages, error: pagesError } = await pagesQuery;
        if (pagesError) throw pagesError;
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
        const { data: proj, error: projectError } = await client.from("bloom_website_projects").select("id").eq("shop_id", shopId).maybeSingle();
        if (projectError) throw projectError;
        if (!proj) return json(404, { error: "Website project not found." });
        const { data: prev, error: previousError } = await client.from("bloom_website_pages").select("*").eq("project_id", proj.id).eq("slug", page.slug).maybeSingle();
        if (previousError) throw previousError;
        const expectedUpdatedAt = body.expected_updated_at || page.updated_at || body.base_updated_at || null;
        const stale = assertPageNotStale({ expectedUpdatedAt, currentUpdatedAt: prev?.updated_at });
        if (!stale.ok) return json(409, { error: stale.error, code: stale.code || "stale_draft" });
        if (prev) {
          const { error: versionError } = await client.from("bloom_website_page_versions").insert({
            shop_id: shopId,
            page_id: prev.id,
            snapshot: { content: prev.content, sections: prev.sections }
          });
          if (versionError) throw versionError;
        }
        const sections = normalizeSectionOrder(page.sections || []);
        const { data: savedPage, error: saveError } = await client.from("bloom_website_pages").upsert(
          {
            shop_id: shopId,
            project_id: proj.id,
            slug: page.slug,
            title: page.title,
            visible: page.visible !== false,
            nav_order: page.nav_order ?? 0,
            template: page.template || "custom",
            content: page.content || {},
            sections,
            updated_at: new Date().toISOString()
          },
          { onConflict: "project_id,slug" }
        ).select("id,slug,updated_at").single();
        if (saveError) throw saveError;
        if (!savedPage) return json(503, { error: "Website draft save could not be confirmed. Your editor remains open." });
        await writeShopAudit(client, {
          shopId,
          userId: user.id,
          eventType: "website_page_saved",
          entityType: "website_page",
          entityId: savedPage.id,
          metadata: { slug: savedPage.slug }
        });
        return json(200, { saved: true, page: savedPage });
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
          const { data: project, error } = await client
            .from("bloom_website_projects")
            .update({
              launch_mode: updated.project.launch_mode,
              theme_id: updated.project.theme_id,
              theme_settings: updated.theme_settings,
              updated_at: new Date().toISOString()
            })
            .eq("shop_id", shopId)
            .select("id,launch_mode,theme_id,theme_settings")
            .maybeSingle();
          if (error) throw error;
          if (!project) return json(404, { error: "Create a website draft before changing its theme." });
          const confirmed = confirmThemePersistence(project, {
            theme_id: updated.project.theme_id,
            theme_settings: updated.theme_settings
          });
          if (!confirmed.ok) {
            return json(503, {
              error: confirmed.error || "Theme change could not be confirmed. Your current design remains safe."
            });
          }
        } catch (e) {
          if (missingTable(e)) return json(503, { error: "Website projects not migrated." });
          throw e;
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

    if (action === "publish_checklist") {
      const shop = await loadShopProfile(client, shopId);
      let project = body.project;
      let pages = body.pages || [];
      if (!project) {
        const { data: proj } = await client.from("bloom_website_projects").select("*").eq("shop_id", shopId).maybeSingle();
        project = proj;
        if (!pages.length && proj?.id) {
          const { data: pageRows } = await client.from("bloom_website_pages").select("*").eq("shop_id", shopId).eq("project_id", proj.id).order("nav_order");
          pages = pageRows || [];
        }
      }
      const checklist = buildPublishChecklist({
        project,
        pages,
        products: body.products || [],
        commerce: project?.commerce_settings || body.commerce || {},
        shop,
        seo: project?.seo_settings || body.seo || {}
      });
      return json(200, checklist);
    }

    if (action === "update_seo") {
      requireRoles(ctx, ["owner", "manager", "designer"]);
      const siteSeo = body.seo_settings || body.seo || {};
      if (siteSeo.meta_description && siteSeo.meta_description.length > 160) {
        return json(400, { error: "Meta description must be 160 characters or fewer." });
      }
      try {
        const visiblePages = (body.pages || []).filter((p) => p.visible !== false && p.slug);
        const shop = await loadShopProfile(client, shopId);
        const seo_settings =
          Object.keys(siteSeo).length > 5
            ? { ...siteSeo, published_at: new Date().toISOString() }
            : buildPublishedSeoBundle(shop, visiblePages.length ? visiblePages : [{ slug: "home", visible: true }], {
                env: process.env,
                preview: false
              });
        if (body.seo_title) seo_settings.title = String(body.seo_title).slice(0, 70);
        if (body.meta_description) seo_settings.meta_description = String(body.meta_description).slice(0, 160);
        if (body.og_image) seo_settings.og_image = body.og_image;
        const { data, error } = await client
          .from("bloom_website_projects")
          .update({ seo_settings, updated_at: new Date().toISOString() })
          .eq("shop_id", shopId)
          .select("id,seo_settings")
          .maybeSingle();
        if (error) throw error;
        if (!data) return json(404, { error: "Create a website draft before editing SEO." });
        await writeShopAudit(client, {
          shopId,
          userId: user.id,
          eventType: "website_seo_updated",
          entityType: "website",
          entityId: data.id,
          metadata: { source: "website_studio" }
        });
        return json(200, { seo_settings: data.seo_settings });
      } catch (e) {
        if (missingTable(e)) return json(503, { error: "Website projects not migrated." });
        throw e;
      }
    }

    if (action === "update_page_seo") {
      requireRoles(ctx, ROLES);
      const slug = body.slug || body.page?.slug;
      if (!slug) return json(400, { error: "Page slug required." });
      const seo_title = body.seo_title ?? body.page?.content?.seo_title ?? "";
      const meta_description = body.meta_description ?? body.page?.content?.meta_description ?? "";
      const v = validatePageSeoUpdate({ seo_title, meta_description });
      if (!v.valid) return json(400, { error: v.errors[0] });
      try {
        const { data: proj, error: projectError } = await client.from("bloom_website_projects").select("id").eq("shop_id", shopId).maybeSingle();
        if (projectError) throw projectError;
        if (!proj) return json(404, { error: "Website project not found." });
        const { data: page, error: pageError } = await client
          .from("bloom_website_pages")
          .select("*")
          .eq("project_id", proj.id)
          .eq("slug", slug)
          .maybeSingle();
        if (pageError) throw pageError;
        if (!page) return json(404, { error: "Page not found." });
        const content = { ...(page.content || {}), seo_title: String(seo_title).slice(0, 70), meta_description: String(meta_description).slice(0, 160) };
        const { data: saved, error: saveError } = await client
          .from("bloom_website_pages")
          .update({ content, updated_at: new Date().toISOString() })
          .eq("id", page.id)
          .select("id,slug,content,updated_at")
          .single();
        if (saveError) throw saveError;
        return json(200, { page: saved });
      } catch (e) {
        if (missingTable(e)) return json(503, { error: "Website tables not migrated." });
        throw e;
      }
    }

    if (action === "lily_draft") {
      return json(200, lilyWebsiteDraftRequiresApproval(body.draft));
    }

    if (action === "lily_interview_steps") {
      return json(200, { steps: LILY_INTERVIEW_STEPS });
    }

    if (action === "lily_wizard_generate") {
      const payload = buildWizardPayload(body.answers || body);
      const shop = { ...(await loadShopProfile(client, shopId)), ...(body.shop || {}) };
      const site = buildSiteFromShopProfile(shop, {
        launch_mode: payload.launch_mode,
        status: "draft",
        brief: payload.brief
      });
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
              commerce_settings: payload.commerce_settings,
              updated_at: new Date().toISOString()
            },
            { onConflict: "shop_id" }
          )
          .select("*")
          .single();
        if (error) throw error;
        const pageRows = site.pages.map((page) => ({
          shop_id: shopId,
          project_id: proj.id,
          slug: page.slug,
          title: page.title,
          visible: page.visible !== false,
          nav_order: site.navigation.findIndex((n) => n.page_id === page.id),
          template: page.template,
          content: page.content,
          sections: page.slug === "home" ? site.sections : page.sections || [],
          updated_at: new Date().toISOString()
        }));
        const { error: pageError } = await client.from("bloom_website_pages").upsert(pageRows, { onConflict: "project_id,slug" });
        if (pageError) throw pageError;
        await writeShopAudit(client, {
          shopId,
          userId: user.id,
          eventType: "lily_website_generated",
          entityType: "website",
          entityId: proj.id,
          metadata: { launch_mode: payload.launch_mode, source: "lily_interview" }
        });
        const catalog_seed = body.seed_catalog !== false ? await seedWebsiteCatalogIfEmpty(client, shopId) : { seeded: 0 };
        return json(201, { site, project_id: proj.id, catalog_seed, interview_complete: true });
      } catch (e) {
        if (missingTable(e)) return json(200, { site, note: "Apply RC1 migration to persist website project." });
        throw e;
      }
    }

    if (action === "domain_instructions") {
      const shop = await loadShopProfile(client, shopId);
      const domain = normalizeDomain(body.domain || shop.custom_domain || "");
      if (!domain) return json(400, { error: "Enter a domain to connect." });
      return json(200, buildDnsInstructions(domain, shop));
    }

    if (action === "connect_domain") {
      requireRoles(ctx, ["owner", "manager"]);
      const domain = normalizeDomain(body.domain || "");
      if (!domain) return json(400, { error: "Enter a valid domain." });
      const shop = await loadShopProfile(client, shopId);
      const instructions = buildDnsInstructions(domain, shop);
      const domain_status = mergeDomainStatus(shop.domain_status || {}, { verified: false }, domain);
      try {
        const { data, error } = await client
          .from("shops")
          .update({ custom_domain: domain, domain_status, updated_at: new Date().toISOString() })
          .eq("id", shopId)
          .select("id,custom_domain,domain_status,slug")
          .single();
        if (error) throw error;
        await writeShopAudit(client, {
          shopId,
          userId: user.id,
          eventType: "domain_connect_requested",
          entityType: "shop",
          entityId: shopId,
          metadata: { domain }
        });
        return json(200, { shop: data, instructions });
      } catch (e) {
        if (missingTable(e)) return json(503, { error: "Shops table unavailable." });
        throw e;
      }
    }

    if (action === "verify_domain") {
      requireRoles(ctx, ["owner", "manager"]);
      const shop = await loadShopProfile(client, shopId);
      const domain = normalizeDomain(body.domain || shop.custom_domain || "");
      if (!domain) return json(400, { error: "No custom domain configured." });
      const verification = await verifyDomainDns(domain);
      const domain_status = mergeDomainStatus(shop.domain_status || {}, verification, domain);
      try {
        const { data, error } = await client
          .from("shops")
          .update({ domain_status, updated_at: new Date().toISOString() })
          .eq("id", shopId)
          .select("id,custom_domain,domain_status")
          .single();
        if (error) throw error;
        if (verification.verified) {
          await writeShopAudit(client, {
            shopId,
            userId: user.id,
            eventType: "domain_verified",
            entityType: "shop",
            entityId: shopId,
            metadata: { domain, records: verification.records }
          });
        }
        return json(200, { verified: verification.verified, domain_status: data.domain_status, verification });
      } catch (e) {
        if (missingTable(e)) return json(503, { error: "Shops table unavailable." });
        throw e;
      }
    }

    if (action === "publish") {
      requireRoles(ctx, ["owner", "manager"]);
      const gate = publishRequiresApproval({ lilyDraft: body.lily_draft, approved: body.approved, saved: body.saved !== false });
      if (!gate.ok) return json(400, { error: gate.error });
      try {
        const shop = await loadShopProfile(client, shopId);
        const { data: existing, error: loadError } = await client
          .from("bloom_website_projects")
          .select("id,status")
          .eq("shop_id", shopId)
          .maybeSingle();
        if (loadError) throw loadError;
        if (!existing) return json(404, { error: "Create and save a website draft before publishing." });

        let pages = [];
        const { data: pageRows, error: pagesError } = await client
          .from("bloom_website_pages")
          .select("*")
          .eq("shop_id", shopId)
          .eq("project_id", existing.id)
          .order("nav_order");
        if (pagesError) throw pagesError;
        pages = pageRows || [];
        const visiblePages = pages.filter((p) => p.visible !== false);
        const seo_settings = buildPublishedSeoBundle(shop, visiblePages, { env: process.env, preview: false });

        const { data: project, error } = await client
          .from("bloom_website_projects")
          .update({ status: "published", seo_settings, updated_at: new Date().toISOString() })
          .eq("shop_id", shopId)
          .select("id,status,seo_settings")
          .maybeSingle();
        if (error) throw error;
        if (!project) return json(404, { error: "Create and save a website draft before publishing." });
        if (project.status !== "published") return json(503, { error: "Website publish could not be confirmed. Your draft remains safe." });
        await writeShopAudit(client, {
          shopId,
          userId: user.id,
          eventType: "website_published",
          entityType: "website",
          entityId: project.id,
          metadata: { approved: true, source: "website_editor", seo_refreshed: true }
        });
        return json(200, {
          published: true,
          project_id: project.id,
          status: project.status,
          seo_settings: project.seo_settings,
          canonical_url: seo_settings.canonical_url
        });
      } catch (e) {
        if (missingTable(e)) return json(503, { error: "Website projects not migrated." });
        throw e;
      }
    }

    if (action === "commerce_settings") {
      requireRoles(ctx, ["owner", "manager"]);
      const settings = body.commerce_settings || body.settings || {};
      try {
        const { data, error } = await client
          .from("bloom_website_projects")
          .update({ commerce_settings: settings, updated_at: new Date().toISOString() })
          .eq("shop_id", shopId)
          .select("id,commerce_settings")
          .maybeSingle();
        if (error) throw error;
        if (!data) return json(404, { error: "Create a website draft before changing commerce settings." });
        return json(200, { commerce_settings: data.commerce_settings });
      } catch (e) {
        if (missingTable(e)) return json(503, { error: "Apply RC1.2 commerce migration for commerce_settings." });
        throw e;
      }
    }

    return json(200, {
      ok: true,
      actions: [
        "generate",
        "switch_theme",
        "publish",
        "health_score",
        "publish_checklist",
        "update_seo",
        "update_page_seo",
        "lily_interview_steps",
        "lily_wizard_generate",
        "domain_instructions",
        "connect_domain",
        "verify_domain",
        "launch_modes",
        "commerce_settings"
      ]
    });
  } catch (error) {
    return fail(error);
  }
}
