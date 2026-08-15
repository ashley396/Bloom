/** Bloom RC1.1 — visual website editor (pure). */

import { SECTION_TYPES, LAUNCH_MODES, switchThemePreserveContent, restorePageVersion, reorderSections } from "./bloom-instant-website.js";

export { SECTION_TYPES, reorderSections, restorePageVersion, switchThemePreserveContent, LAUNCH_MODES };

export const EDITOR_SECTION_TYPES = [
  ...SECTION_TYPES,
  "announcement_bar",
  "seasonal_feature",
  "faq",
  "custom_content"
];

const ALLOWED_TAGS = new Set(["p", "br", "strong", "em", "ul", "ol", "li", "a", "h2", "h3", "span"]);

export function sanitizeRichText(html = "") {
  let out = String(html)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/on\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
  out = out.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (m, tag) => {
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) return "";
    if (tag.toLowerCase() === "a") return m.replace(/href="([^"]*)"/i, (_, href) => {
      const safe = /^https?:\/\//i.test(href) || href.startsWith("/") || href.startsWith("mailto:") ? href : "#";
      return `href="${safe}" rel="noopener noreferrer"`;
    });
    return m;
  });
  return out.trim();
}

export function sanitizeUrl(url = "") {
  const u = String(url).trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u) || u.startsWith("/")) return u;
  return "";
}

export function applyTextEdit(section, path, value) {
  const next = structuredClone(section);
  const parts = path.split(".");
  let cur = next.props || (next.props = {});
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] || (cur[parts[i]] = {});
  cur[parts[parts.length - 1]] = sanitizeRichText(value);
  return next;
}

export function applyImageReplace(section, path, media) {
  const next = structuredClone(section);
  const parts = path.split(".");
  let cur = next.props || (next.props = {});
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] || (cur[parts[i]] = {});
  cur[parts[parts.length - 1]] = {
    url: sanitizeUrl(media.url),
    alt: String(media.alt || "").slice(0, 240),
    source: media.source || "shop_upload",
    license: media.license || "shop_owned",
    attribution: media.attribution || null,
    crop: media.crop || null
  };
  return next;
}

export function duplicateSection(section, sections) {
  const copy = { ...structuredClone(section), id: `${section.type}-${Date.now()}`, order: sections.length };
  return [...sections, copy].map((s, i) => ({ ...s, order: i }));
}

export function toggleSectionVisibility(section, visible) {
  return { ...section, hidden: visible === false };
}

export function deleteSectionWithConfirm(sections, id, confirmed = false) {
  if (!confirmed) return { sections, needsConfirmation: true };
  return { sections: sections.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })), needsConfirmation: false };
}

export function moveSectionKeyboard(sections, id, direction) {
  const list = [...sections].sort((a, b) => a.order - b.order);
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return sections;
  const to = direction === "up" ? idx - 1 : idx + 1;
  if (to < 0 || to >= list.length) return sections;
  return reorderSections(list, idx, to);
}

export function createEditHistory(max = 50) {
  const stack = [];
  let pointer = -1;
  return {
    push(state) {
      stack.splice(pointer + 1);
      stack.push(structuredClone(state));
      if (stack.length > max) stack.shift();
      else pointer += 1;
      return pointer;
    },
    undo() {
      if (pointer <= 0) return null;
      pointer -= 1;
      return structuredClone(stack[pointer]);
    },
    redo() {
      if (pointer >= stack.length - 1) return null;
      pointer += 1;
      return structuredClone(stack[pointer]);
    },
    reset(state) {
      stack.length = 0;
      pointer = -1;
      return this.push(state);
    },
    canUndo: () => pointer > 0,
    canRedo: () => pointer < stack.length - 1,
    announceAction(action) {
      return { live: "polite", message: `${action} completed.` };
    }
  };
}

export function publishRequiresApproval({ lilyDraft = false, approved = false, saved = true } = {}) {
  if (!saved) return { ok: false, error: "Save your draft before publishing." };
  if (lilyDraft && !approved) return { ok: false, error: "Lily changes require explicit approval." };
  if (!approved) return { ok: false, error: "Publish requires approval after preview." };
  return { ok: true };
}

/** Persist a contiguous order index so public and editor reads agree. */
export function normalizeSectionOrder(sections = []) {
  return [...(sections || [])]
    .map((s, i) => ({
      s,
      i,
      order: Number.isFinite(Number(s?.order)) ? Number(s.order) : Number.POSITIVE_INFINITY
    }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map(({ s }, i) => ({ ...s, order: i }));
}

/**
 * Optimistic concurrency for draft saves.
 * When the client sends a known base timestamp that no longer matches the DB row, reject.
 */
export function assertPageNotStale({ expectedUpdatedAt, currentUpdatedAt } = {}) {
  if (!expectedUpdatedAt) return { ok: true };
  if (!currentUpdatedAt) return { ok: true };
  const expected = String(expectedUpdatedAt);
  const current = String(currentUpdatedAt);
  if (expected === current) return { ok: true };
  return {
    ok: false,
    code: "stale_draft",
    error: "This draft changed elsewhere. Reload the latest version before saving again."
  };
}

/** Confirm theme persistence returned the expected theme id and settings payload. */
export function confirmThemePersistence(project, expected = {}) {
  if (!project) return { ok: false, error: "Create a website draft before changing its theme." };
  if (expected.theme_id != null && project.theme_id !== expected.theme_id) {
    return { ok: false, error: "Theme change could not be confirmed. Your current design remains safe." };
  }
  if (expected.theme_settings != null) {
    const got = JSON.stringify(project.theme_settings ?? null);
    const want = JSON.stringify(expected.theme_settings ?? null);
    if (got !== want) {
      return { ok: false, error: "Theme settings could not be confirmed. Your current design remains safe." };
    }
  }
  return { ok: true };
}

export function themeGalleryCard(mode, shopContent = {}) {
  return {
    id: mode.id,
    label: mode.label,
    palette: mode.palette,
    fontPair: mode.fontPair,
    recommendedCollections: ["Everyday", "Birthday", "Sympathy", "Weddings"],
    previews: {
      desktop: true,
      tablet: true,
      mobile: true,
      usesShopContent: !!shopContent.name
    }
  };
}

export function restoreThemeSettings(previous, current) {
  if (!previous) return { restored: false, settings: current };
  return { restored: true, settings: { ...current, ...previous } };
}

export function autosaveDraftKey(shopId) {
  return `bloom_website_draft_${shopId}`;
}

export function validateMediaForPublish(media = {}) {
  if (!media.url) return { ok: false, error: "Image URL required." };
  if (media.license === "unlicensed") return { ok: false, error: "Unlicensed media cannot be published." };
  if (media.source === "master_library" && media.review_status !== "approved") {
    return { ok: false, error: "Master library media requires approved license." };
  }
  return { ok: true };
}

// ---- Whole-page CRUD (pure helpers; instant-website.js does the DB I/O) ----

function baseSlugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** Pick a slug that doesn't collide with any existing page in the project. */
export function nextUniqueSlug(desired, existingSlugs = []) {
  const taken = new Set(existingSlugs);
  const base = baseSlugify(desired) || "page";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * "home" is a structural requirement, not just another page — the storefront
 * root, the editor's default page, and the publish checklist all key off the
 * literal slug "home". Every florist site must always have exactly one.
 */
export const HOMEPAGE_SLUG = "home";

export function buildNewPage({ title, template = "custom", existingSlugs = [], navOrder = 0 } = {}) {
  const cleanTitle = String(title || "").trim().slice(0, 80) || "New page";
  const slug = nextUniqueSlug(cleanTitle, existingSlugs);
  return {
    slug,
    title: cleanTitle,
    visible: true,
    nav_order: navOrder,
    template,
    content: {},
    sections: []
  };
}

/** New pages start hidden from nav so a duplicate never silently appears on the live site. */
export function duplicatePageContent(page, existingSlugs = []) {
  const slug = nextUniqueSlug(`${page.slug}-copy`, existingSlugs);
  return {
    slug,
    title: `${page.title} (Copy)`.slice(0, 80),
    visible: false,
    nav_order: (page.nav_order ?? 0) + 1,
    template: page.template || "custom",
    content: structuredClone(page.content || {}),
    sections: structuredClone(page.sections || []).map((s, i) => ({ ...s, id: `${s.type || "section"}-${Date.now()}-${i}`, order: i }))
  };
}

/**
 * Guard whole-page deletion the same way section deletion is guarded
 * (explicit confirmed flag), plus two structural rules sections don't need:
 * never delete the homepage, and never delete the last remaining page.
 */
export function guardPageDeletion({ slug, pages = [], confirmed = false } = {}) {
  if (slug === HOMEPAGE_SLUG) return { ok: false, error: "The Home page can't be deleted — hide it or edit its content instead." };
  if (pages.length <= 1) return { ok: false, error: "A website needs at least one page." };
  if (!pages.some((p) => p.slug === slug)) return { ok: false, error: "Page not found." };
  if (!confirmed) return { ok: false, needsConfirmation: true };
  return { ok: true };
}

/** Renaming changes the display title only — the slug (and therefore any
 * shared/indexed URL) never changes silently through a rename. */
export function sanitizePageTitle(title) {
  const clean = String(title || "").trim().slice(0, 80);
  if (!clean) return { ok: false, error: "Page name can't be empty." };
  return { ok: true, title: clean };
}

/** Bulk nav_order assignment from an ordered list of slugs. */
export function reorderPages(pages = [], orderedSlugs = []) {
  const orderIndex = new Map(orderedSlugs.map((slug, i) => [slug, i]));
  return [...pages]
    .map((p) => ({ ...p, nav_order: orderIndex.has(p.slug) ? orderIndex.get(p.slug) : p.nav_order ?? 0 }))
    .sort((a, b) => a.nav_order - b.nav_order);
}
