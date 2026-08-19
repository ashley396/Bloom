/**
 * Wix-style section property inspector for Website Studio editor.
 */
(function () {
  const SCHEMAS = {
    hero: [
      { path: "title", label: "Headline", type: "text" },
      { path: "subtitle", label: "Subheadline", type: "text" },
      { path: "text", label: "Supporting text", type: "textarea" },
      { path: "cta", label: "Button label", type: "text" },
      { path: "image", label: "Hero image URL", type: "image" }
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
      { path: "button", label: "Button label", type: "text" }
    ],
    featured_arrangements: [{ path: "title", label: "Section title", type: "text" }],
    product_collection: [{ path: "title", label: "Section title", type: "text" }],
    contact_form: [{ path: "title", label: "Title", type: "text" }],
    // The storefront renderer (lib/storefront/section-renderer.js) has always
    // supported these section types — this inspector just never had a
    // schema for them, so a florist who added one (once the "Add section"
    // dropdown offers them) had no way to edit their content.
    testimonials: [
      { path: "title", label: "Title", type: "text" },
      { path: "items", label: "Quotes (one per line: Quote — Author)", type: "quotes" }
    ],
    faq: [
      { path: "title", label: "Title", type: "text" },
      { path: "faqs", label: "Questions (one per line: Question | Answer)", type: "faqs" }
    ],
    instagram: [
      { path: "title", label: "Title", type: "text" },
      { path: "handle", label: "Instagram handle (without @)", type: "text" }
    ],
    newsletter: [
      { path: "title", label: "Title", type: "text" },
      { path: "text", label: "Description", type: "textarea" }
    ],
    map: [
      { path: "title", label: "Title", type: "text" },
      { path: "address", label: "Address", type: "text" }
    ],
    announcement_bar: [{ path: "text", label: "Announcement text", type: "textarea" }],
    seasonal_banner: [
      { path: "title", label: "Title", type: "text" },
      { path: "text", label: "Description", type: "textarea" }
    ],
    custom_text_image: [
      { path: "title", label: "Title", type: "text" },
      { path: "text", label: "Body", type: "textarea" },
      { path: "image", label: "Image URL", type: "image" }
    ]
  };

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function getVal(section, path) {
    if (path === "occasions") {
      const o = section?.props?.occasions;
      return Array.isArray(o) ? o.join(", ") : o || "";
    }
    if (path === "image") {
      const img = section?.props?.image;
      return typeof img === "object" ? img?.url || "" : img || "";
    }
    if (path === "items") {
      const items = section?.props?.items;
      if (!Array.isArray(items)) return "";
      return items.map((t) => `${t.quote || ""} — ${t.author || ""}`.replace(/^ — $/, "")).join("\n");
    }
    if (path === "faqs") {
      const faqs = section?.props?.faqs;
      if (!Array.isArray(faqs)) return "";
      return faqs.map((f) => `${f.q || ""} | ${f.a || ""}`.replace(/^ \| $/, "")).join("\n");
    }
    return section?.props?.[path] ?? "";
  }

  function setVal(section, path, value) {
    const s = structuredClone(section);
    s.props = s.props || {};
    if (path === "occasions") {
      s.props.occasions = String(value)
        .split(/[,;\n]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 8);
    } else if (path === "image") {
      const prev = s.props.image;
      s.props.image =
        typeof prev === "object" && prev
          ? { ...prev, url: value.trim() }
          : { url: value.trim(), alt: s.props.title || "", source: "shop_upload" };
    } else if (path === "items") {
      // Testimonials, one per line: "Quote text — Author Name". A line with
      // no " — " separator keeps the quote with no attributed author rather
      // than being dropped.
      s.props.items = String(value)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 12)
        .map((line) => {
          const idx = line.lastIndexOf(" — ");
          if (idx === -1) return { quote: line, author: "" };
          return { quote: line.slice(0, idx).trim(), author: line.slice(idx + 3).trim() };
        });
    } else if (path === "faqs") {
      s.props.faqs = String(value)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((line) => {
          const idx = line.indexOf("|");
          if (idx === -1) return { q: line, a: "" };
          return { q: line.slice(0, idx).trim(), a: line.slice(idx + 1).trim() };
        });
    } else {
      s.props[path] = value;
    }
    return s;
  }

  function blockList(section) {
    const type = section?.type;
    if (type === "hero") {
      return [
        { path: "title", label: "Headline" },
        { path: "subtitle", label: "Subheadline" },
        { path: "text", label: "Body" }
      ];
    }
    return [{ path: "title", label: "Title" }];
  }

  window.BloomSectionInspector = {
    schemaFor(type) {
      return SCHEMAS[type] || SCHEMAS.about_florist;
    },
    getVal,
    setVal,
    blockList,
    renderPanel(container, section, { onChange, onReorderBlock }) {
      if (!container) return;
      if (!section) {
        container.innerHTML = `<p class="subtle">Select a section to edit properties.</p>`;
        return;
      }
      const schema = SCHEMAS[section.type] || [{ path: "title", label: "Title", type: "text" }];
      const blocks = blockList(section);
      container.innerHTML = `
        <p class="eyebrow">SECTION</p>
        <h3>${esc(section.type.replace(/_/g, " "))}</h3>
        <p class="subtle editor-inspector-id">ID: ${esc(section.id)}</p>
        <div class="editor-block-list" id="editorBlockList">
          ${blocks
            .map(
              (b, i) =>
                `<div class="editor-block-row" draggable="true" data-block-idx="${i}" data-path="${esc(b.path)}">
                  <span class="editor-drag-handle" aria-hidden="true">⠿</span>
                  <label>${esc(b.label)}<input type="text" data-prop="${esc(b.path)}" value="${esc(getVal(section, b.path))}"></label>
                </div>`
            )
            .join("")}
        </div>
        <hr>
        <div class="editor-prop-fields">
          ${schema
            .map((f) => {
              const v = getVal(section, f.path);
              if (f.type === "textarea") return `<label>${esc(f.label)}<textarea data-prop="${esc(f.path)}" rows="2">${esc(v)}</textarea></label>`;
              if (f.type === "quotes" || f.type === "faqs") return `<label>${esc(f.label)}<textarea data-prop="${esc(f.path)}" rows="4">${esc(v)}</textarea></label>`;
              if (f.type === "tags") return `<label>${esc(f.label)}<input data-prop="${esc(f.path)}" value="${esc(v)}"></label>`;
              if (f.type === "image") return `<label>${esc(f.label)}<input data-prop="${esc(f.path)}" value="${esc(v)}" placeholder="https://…"></label>`;
              return `<label>${esc(f.label)}<input data-prop="${esc(f.path)}" value="${esc(v)}"></label>`;
            })
            .join("")}
        </div>`;

      container.querySelectorAll("[data-prop]").forEach((input) => {
        input.addEventListener("input", () => {
          onChange?.(setVal(section, input.dataset.prop, input.value));
        });
      });

      const list = container.querySelector("#editorBlockList");
      let dragIdx = null;
      list?.querySelectorAll(".editor-block-row").forEach((row) => {
        row.addEventListener("dragstart", (e) => {
          dragIdx = Number(row.dataset.blockIdx);
          e.dataTransfer.setData("text/plain", String(dragIdx));
        });
        row.addEventListener("dragover", (e) => e.preventDefault());
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          const to = Number(row.dataset.blockIdx);
          if (dragIdx == null || dragIdx === to) return;
          onReorderBlock?.(dragIdx, to);
        });
      });
    }
  };
})();
