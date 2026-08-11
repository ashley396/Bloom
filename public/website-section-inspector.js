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
    contact_form: [{ path: "title", label: "Title", type: "text" }]
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
