/**
 * Property schemas for Wix-style section inspector in Website Studio.
 */

export const SECTION_PROP_SCHEMAS = {
  hero: [
    { path: "title", label: "Headline", type: "text" },
    { path: "subtitle", label: "Subheadline", type: "text" },
    { path: "text", label: "Supporting text", type: "textarea" },
    { path: "cta", label: "Button label", type: "text" },
    { path: "image", label: "Hero image URL", type: "image" }
  ],
  featured_arrangements: [
    { path: "title", label: "Section title", type: "text" },
    { path: "collection", label: "Collection slug", type: "text" }
  ],
  product_collection: [
    { path: "title", label: "Section title", type: "text" },
    { path: "collection", label: "Collection slug", type: "text" }
  ],
  occasion_tiles: [
    { path: "title", label: "Section title", type: "text" },
    { path: "occasions", label: "Occasions (comma-separated)", type: "tags" }
  ],
  sympathy_feature: [
    { path: "title", label: "Title", type: "text" },
    { path: "text", label: "Description", type: "textarea" }
  ],
  wedding_feature: [
    { path: "title", label: "Title", type: "text" },
    { path: "text", label: "Description", type: "textarea" }
  ],
  delivery_area: [
    { path: "title", label: "Title", type: "text" },
    { path: "text", label: "Delivery copy", type: "textarea" }
  ],
  about_florist: [
    { path: "title", label: "Title", type: "text" },
    { path: "text", label: "About text", type: "textarea" }
  ],
  shop_hours: [
    { path: "title", label: "Title", type: "text" },
    { path: "hours", label: "Hours", type: "textarea" }
  ],
  cta_banner: [
    { path: "text", label: "Banner text", type: "textarea" },
    { path: "button", label: "Button label", type: "text" },
    { path: "action", label: "Link target", type: "select", options: ["shop", "contact"] }
  ],
  contact_form: [{ path: "title", label: "Title", type: "text" }],
  testimonials: [{ path: "title", label: "Title", type: "text" }],
  faq: [{ path: "title", label: "Title", type: "text" }],
  custom_text_image: [
    { path: "title", label: "Title", type: "text" },
    { path: "text", label: "Body", type: "textarea" },
    { path: "image", label: "Image URL", type: "image" }
  ]
};

export function schemaForSectionType(type) {
  return SECTION_PROP_SCHEMAS[type] || SECTION_PROP_SCHEMAS.custom_text_image;
}

export function getPropValue(section, path) {
  const parts = path.split(".");
  let cur = section?.props;
  for (const p of parts) cur = cur?.[p];
  if (path === "occasions" && Array.isArray(cur)) return cur.join(", ");
  if (path === "image" && cur && typeof cur === "object") return cur.url || "";
  return cur ?? "";
}

export function setPropValue(section, path, rawValue) {
  const next = structuredClone(section);
  next.props = next.props || {};
  if (path === "occasions") {
    next.props.occasions = String(rawValue)
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
    return next;
  }
  if (path === "image") {
    const prev = next.props.image;
    next.props.image =
      typeof prev === "object" && prev
        ? { ...prev, url: String(rawValue).trim() }
        : { url: String(rawValue).trim(), alt: next.props.title || "", source: "shop_upload" };
    return next;
  }
  next.props[path] = String(rawValue);
  return next;
}

export function reorderBlocksInSection(section, fromIndex, toIndex) {
  const blocks = section.content_blocks || defaultBlocksForType(section.type);
  const list = [...blocks];
  const [item] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, item);
  return { ...section, content_blocks: list.map((b, i) => ({ ...b, order: i })) };
}

function defaultBlocksForType(type) {
  if (type === "hero") {
    return [
      { id: "title", path: "title", label: "Headline", order: 0 },
      { id: "subtitle", path: "subtitle", label: "Subheadline", order: 1 },
      { id: "text", path: "text", label: "Text", order: 2 }
    ];
  }
  return [{ id: "title", path: "title", label: "Title", order: 0 }];
}
