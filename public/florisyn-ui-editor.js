/**
 * Florisyn Admin visual editors — Design Mode + Image Edit Mode + voice uploads.
 * Visual-only JSON overrides. No operational / payment / auth / query code.
 */
(function () {
  const STORAGE_KEY = "florisyn_design_overrides_v1";
  const PUBLISHED_URL = "/florisyn-design-overrides.json";
  const MAX_VOICE_BYTES = 3.5 * 1024 * 1024;
  const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;

  const PERSONAS = ["Lily", "Rose", "Daisy", "Bud"];
  const TEXT_SAFE_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "SPAN", "LABEL", "B", "STRONG", "SMALL", "EM", "A", "LI", "FIGCAPTION", "BUTTON"]);
  const FORBIDDEN_TEXT_SELECTOR_RE =
    /(?:^|[\s>+~])(html|body|main|aside|nav|form|section|article|header|footer|dialog)(?:$|[\s.[:#>])|#adminApp\b|#adminAuth\b|#ownerSetup\b|#uiDesignModeRoot\b|#uiDesignModeView\b|#florisynDesignBar\b|#florisynDesignInspector\b|\.shell\b|\.admin-shell\b|\.view\b|\.page\b|\.sidebar\b|\.workspace\b|\.panel\b|\.florisyn-design-admin-panel\b/i;
  const FORBIDDEN_SHELL_SELECTOR_RE =
    /#adminApp\b|#adminAuth\b|#ownerSetup\b|#uiDesignModeRoot\b|#uiDesignModeView\b|^(body|html|main)$/i;

  const emptyDoc = () => ({
    version: 1,
    updatedAt: null,
    cssVars: {},
    texts: {},
    styles: {},
    images: {},
    layout: {},
    library: [],
    characters: {
      Lily: { name: "", title: "", blurb: "" },
      Rose: { name: "", title: "", blurb: "" },
      Daisy: { name: "", title: "", blurb: "" },
      Bud: { name: "", title: "", blurb: "" }
    },
    voices: { Lily: null, Rose: null, Daisy: null, Bud: null }
  });

  function isForbiddenTextSelector(sel) {
    const raw = String(sel || "").trim();
    if (!raw) return true;
    if (raw === "*" || raw === ":root") return true;
    return FORBIDDEN_TEXT_SELECTOR_RE.test(raw);
  }

  function isSafeTextTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest("#florisynDesignBar, #florisynDesignInspector, dialog, script, style")) return false;
    if (el.matches("input,textarea,select,img,svg,video,canvas,iframe,table,ul,ol")) return false;
    if (!TEXT_SAFE_TAGS.has(el.tagName)) return false;
    // Allow simple phrasing children only — never flatten structured UI.
    if (el.children.length === 0) return true;
    return [...el.children].every((child) => TEXT_SAFE_TAGS.has(child.tagName) && child.children.length === 0);
  }

  function sanitizeDesignDoc(raw) {
    const base = emptyDoc();
    const next = raw && typeof raw === "object" ? raw : {};
    const texts = {};
    Object.entries(next.texts || {}).forEach(([sel, value]) => {
      if (isForbiddenTextSelector(sel)) return;
      if (typeof value !== "string") return;
      texts[sel] = value;
    });
    const styles = {};
    Object.entries(next.styles || {}).forEach(([sel, rules]) => {
      if (!sel || FORBIDDEN_SHELL_SELECTOR_RE.test(sel)) return;
      if (!rules || typeof rules !== "object") return;
      styles[sel] = rules;
    });
    const layout = {};
    Object.entries(next.layout || {}).forEach(([sel, rules]) => {
      if (!sel || FORBIDDEN_SHELL_SELECTOR_RE.test(sel)) return;
      layout[sel] = rules;
    });
    const images = {};
    Object.entries(next.images || {}).forEach(([sel, src]) => {
      if (!sel || FORBIDDEN_SHELL_SELECTOR_RE.test(sel)) return;
      images[sel] = src;
    });
    return {
      ...base,
      cssVars: next.cssVars && typeof next.cssVars === "object" ? next.cssVars : {},
      version: 1,
      updatedAt: next.updatedAt || null,
      texts,
      styles,
      layout,
      images,
      voices: { ...base.voices, ...(next.voices || {}) },
      characters: PERSONAS.reduce(
        (acc, p) => ({ ...acc, [p]: { ...base.characters[p], ...(next.characters?.[p] || {}) } }),
        { ...base.characters, ...(next.characters || {}) }
      ),
      library: Array.isArray(next.library) ? next.library : []
    };
  }

  function ensureAdminDesignRoot() {
    const view = document.getElementById("uiDesignModeView");
    if (!view) return document.getElementById("uiDesignModeRoot");
    let root = document.getElementById("uiDesignModeRoot");
    if (!root || !view.contains(root)) {
      view.innerHTML = '<div id="uiDesignModeRoot"></div>';
      root = document.getElementById("uiDesignModeRoot");
    }
    return root;
  }

  function restoreAdminDesignPanel() {
    if (!hasAdminSession() || document.getElementById("adminApp")?.hidden) return false;
    const root = ensureAdminDesignRoot();
    if (!root) return false;
    mountAdminPanel(root);
    return true;
  }

  let doc = emptyDoc();
  let selected = null;
  let dragState = null;
  let mode = null; // 'design' | 'image' | null
  let styleEl = null;
  let barEl = null;
  let inspectorEl = null;

  function hasAdminSession() {
    try {
      const raw = localStorage.getItem("bloom_admin_session");
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed?.accessToken || parsed?.access_token || parsed?.user);
    } catch {
      return false;
    }
  }

  function toast(msg) {
    if (typeof window.toast === "function") return window.toast(msg);
    const el = document.getElementById("adminToast") || document.getElementById("toast");
    if (!el) return;
    el.hidden = false;
    el.textContent = String(msg || "");
    clearTimeout(window.__florisynDesignToast);
    window.__florisynDesignToast = setTimeout(() => {
      el.hidden = true;
    }, 2800);
  }

  function selectorFor(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const edit = el.getAttribute("data-florisyn-edit") || el.getAttribute("data-florisyn-image");
    if (edit) return `[data-florisyn-edit="${CSS.escape(edit)}"], [data-florisyn-image="${CSS.escape(edit)}"]`.split(", ")[el.hasAttribute("data-florisyn-image") ? 1 : 0];
    if (el.getAttribute("data-florisyn-image")) return `[data-florisyn-image="${CSS.escape(el.getAttribute("data-florisyn-image"))}"]`;
    if (el.classList?.contains("daisy-dock-btn")) return ".daisy-dock-btn img, .daisy-dock-btn";
    if (el.matches?.(".assistant-mini-dock img")) {
      const btn = el.closest("button");
      const label = btn?.querySelector("b")?.textContent?.trim() || "dock";
      return `.assistant-mini-dock button[title="${CSS.escape(label)}"] img, .assistant-mini-dock button b`;
    }
    if (el.classList?.contains("rose-portrait")) return ".assistant-portrait.rose-portrait, .rose-welcome-card img";
    if (el.classList?.contains("lily-portrait")) return ".assistant-portrait.lily-portrait, .lily-suggestion-card img";
    if (el.id === "appLogo") return "#appLogo";
    const page = el.closest?.(".page, .view, body");
    if (el.tagName === "IMG" && page) {
      const imgs = [...page.querySelectorAll("img")];
      const nth = imgs.indexOf(el) + 1;
      const pageId = page.id ? `#${CSS.escape(page.id)}` : page.classList?.contains("view") ? `.view.active` : "body";
      return `${pageId} img:nth-of-type(${Math.max(1, nth)})`;
    }
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (!parent) return tag;
    const idx = [...parent.children].indexOf(el) + 1;
    const parentSel = selectorFor(parent) || "body";
    return `${parentSel} > ${tag}:nth-child(${idx})`;
  }

  function imageSelectorFor(img) {
    if (!img) return null;
    if (!img.getAttribute("data-florisyn-image")) {
      const key = img.id || img.getAttribute("alt") || img.getAttribute("src")?.slice(-24) || `img-${Date.now()}`;
      img.setAttribute("data-florisyn-image", String(key).replace(/\W+/g, "-").slice(0, 48));
    }
    return `[data-florisyn-image="${CSS.escape(img.getAttribute("data-florisyn-image"))}"]`;
  }

  function loadLocal() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (parsed && typeof parsed === "object") {
        return {
          ...emptyDoc(),
          ...parsed,
          voices: { ...emptyDoc().voices, ...(parsed.voices || {}) },
          characters: {
            ...emptyDoc().characters,
            ...(parsed.characters || {}),
            Lily: { ...emptyDoc().characters.Lily, ...(parsed.characters?.Lily || {}) },
            Rose: { ...emptyDoc().characters.Rose, ...(parsed.characters?.Rose || {}) },
            Daisy: { ...emptyDoc().characters.Daisy, ...(parsed.characters?.Daisy || {}) }
          },
          library: Array.isArray(parsed.library) ? parsed.library : []
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  async function loadPublished() {
    try {
      const res = await fetch(`${PUBLISHED_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return null;
      const parsed = await res.json();
      if (parsed && typeof parsed === "object") {
        return {
          ...emptyDoc(),
          ...parsed,
          voices: { ...emptyDoc().voices, ...(parsed.voices || {}) },
          characters: {
            ...emptyDoc().characters,
            ...(parsed.characters || {}),
            Lily: { ...emptyDoc().characters.Lily, ...(parsed.characters?.Lily || {}) },
            Rose: { ...emptyDoc().characters.Rose, ...(parsed.characters?.Rose || {}) },
            Daisy: { ...emptyDoc().characters.Daisy, ...(parsed.characters?.Daisy || {}) }
          },
          library: Array.isArray(parsed.library) ? parsed.library : []
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function persist(next) {
    doc = sanitizeDesignDoc({
      ...next,
      updatedAt: new Date().toISOString()
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    applyOverrides(doc);
    document.dispatchEvent(new CustomEvent("florisyn-design-overrides-changed", { detail: doc }));
    return doc;
  }

  function ensureStyleEl() {
    if (styleEl && styleEl.isConnected) return styleEl;
    styleEl = document.getElementById("florisynDesignOverrideStyle");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "florisynDesignOverrideStyle";
      document.head.appendChild(styleEl);
    }
    return styleEl;
  }

  function cssFromStyles(styles = {}) {
    return Object.entries(styles)
      .map(([sel, rules]) => {
        if (!sel || !rules || typeof rules !== "object") return "";
        const body = Object.entries(rules)
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v};`)
          .join("");
        return body ? `${sel}{${body}}` : "";
      })
      .join("\n");
  }

  function applyCssVars(vars = {}) {
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => {
      if (!k) return;
      if (v == null || v === "") root.style.removeProperty(k);
      else root.style.setProperty(k, v);
    });
  }

  function applyTexts(texts = {}) {
    Object.entries(texts).forEach(([sel, value]) => {
      if (!sel || isForbiddenTextSelector(sel)) return;
      if (typeof value !== "string") return;
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        return;
      }
      nodes.forEach((el) => {
        if (el.matches("input,textarea,select")) {
          el.value = value;
          return;
        }
        if (!isSafeTextTarget(el)) return;
        el.textContent = value;
      });
    });
  }

  function applyImages(images = {}) {
    Object.entries(images).forEach(([sel, src]) => {
      if (!sel) return;
      document.querySelectorAll(sel).forEach((el) => {
        if (src === null || src === "") {
          if (el.tagName === "IMG") {
            el.removeAttribute("src");
            el.hidden = true;
            el.dataset.florisynImageRemoved = "1";
          } else el.style.backgroundImage = "none";
          return;
        }
        if (el.tagName === "IMG") {
          el.hidden = false;
          el.src = src;
          delete el.dataset.florisynImageRemoved;
        } else el.style.backgroundImage = `url("${String(src).replace(/"/g, '\\"')}")`;
      });
    });
  }

  function applyLayout(layout = {}) {
    Object.entries(layout).forEach(([sel, rules]) => {
      if (!sel || !rules) return;
      document.querySelectorAll(sel).forEach((el) => {
        if (rules.order != null) el.style.order = String(rules.order);
        if (rules.transform) el.style.transform = rules.transform;
        if (rules.alignSelf) el.style.alignSelf = rules.alignSelf;
        if (rules.justifySelf) el.style.justifySelf = rules.justifySelf;
        if (rules.margin) el.style.margin = rules.margin;
      });
    });
  }


  function applyCharacters(characters = {}) {
    PERSONAS.forEach((persona) => {
      const c = characters?.[persona] || {};
      document.querySelectorAll(`[data-florisyn-character="${persona}"]`).forEach((btn) => {
        const nameEl = btn.querySelector("b, strong");
        const titleEl = btn.querySelector("small");
        if (c.name && nameEl) nameEl.textContent = c.name;
        if (c.title && titleEl) titleEl.textContent = c.title;
      });
      if (c.blurb) {
        document.querySelectorAll(`[data-florisyn-character-blurb="${persona}"]`).forEach((el) => {
          el.textContent = c.blurb;
        });
      }
    });
  }

  function applyOverrides(source = doc) {
    applyCssVars(source.cssVars || {});
    ensureStyleEl().textContent = cssFromStyles(source.styles || {});
    applyTexts(source.texts || {});
    applyImages(source.images || {});
    applyLayout(source.layout || {});
    applyCharacters(source.characters || {});
  }

  function markEditableHints() {
    document.querySelectorAll(".assistant-mini-dock button, .daisy-dock-btn, .rose-welcome-card, .lily-suggestion-card, .pos-workspace, #productPadGrid, #greeting, .card, .pad").forEach((el, i) => {
      if (el.closest("#uiDesignModeRoot, #florisynDesignBar, #florisynDesignInspector, #adminAuth, #ownerSetup")) return;
      if (!el.getAttribute("data-florisyn-edit")) el.setAttribute("data-florisyn-edit", `edit-${i}`);
    });
    document.querySelectorAll(".assistant-mini-dock button, .daisy-dock-btn").forEach((btn) => {
      const name = btn.querySelector("b, strong")?.textContent?.trim();
      if (PERSONAS.includes(name)) {
        btn.setAttribute("data-florisyn-character", name);
        const titleEl = btn.querySelector("small");
        if (titleEl && !titleEl.getAttribute("data-florisyn-edit")) titleEl.setAttribute("data-florisyn-edit", `char-title-${name}`);
      }
    });
    const roseBlurb = document.querySelector(".rose-welcome-card .welcome-subline, .rose-welcome-card p.subtle, .rose-tip p");
    if (roseBlurb) roseBlurb.setAttribute("data-florisyn-character-blurb", "Rose");
    const lilyBlurb = document.querySelector(".lily-suggestion-card p, .lily-profile small, #aiStudioPage .ai-message.assistant p");
    if (lilyBlurb) lilyBlurb.setAttribute("data-florisyn-character-blurb", "Lily");
    const daisyBlurb = document.querySelector(".daisy-dock-btn small");
    if (daisyBlurb && !daisyBlurb.getAttribute("data-florisyn-character-blurb")) {
      /* title uses small; blurb optional via character panel only */
    }
    document.querySelectorAll("img").forEach((img, i) => {
      if (!img.getAttribute("data-florisyn-image")) {
        const key = img.id || img.alt || `auto-${i}`;
        img.setAttribute("data-florisyn-image", String(key).replace(/\W+/g, "-").slice(0, 48) || `img-${i}`);
      }
    });
  }

  function enableInlineTextEditing() {
    document.querySelectorAll("h1,h2,h3,h4,p,span,label,b,strong,small,[data-florisyn-edit]").forEach((el) => {
      if (el.closest("#florisynDesignBar, #florisynDesignInspector, #uiDesignModeRoot, dialog, script, style")) return;
      if (el.matches("input,textarea,select,img,button,a,nav")) return;
      if (el.children.length > 3) return;
      el.setAttribute("contenteditable", "true");
      el.dataset.florisynInline = "1";
    });
  }

  function disableInlineTextEditing() {
    document.querySelectorAll('[contenteditable="true"][data-florisyn-inline="1"]').forEach((el) => {
      el.removeAttribute("contenteditable");
      delete el.dataset.florisynInline;
    });
  }

  function commitInlineText(el) {
    if (!el || mode !== "design") return;
    if (!isSafeTextTarget(el)) return;
    const sel = selectorFor(el);
    if (!sel || isForbiddenTextSelector(sel)) return;
    const text = el.textContent || "";
    const next = structuredClone(doc);
    next.texts = next.texts || {};
    next.texts[sel] = text;
    persist(next);
  }

  function onInlineBlur(e) {
    const el = e.target?.closest?.('[contenteditable="true"][data-florisyn-inline="1"]');
    if (!el) return;
    commitInlineText(el);
  }

  function onInlineDblClick(e) {
    if (mode !== "design") return;
    if (e.target.closest("#florisynDesignBar, #florisynDesignInspector")) return;
    const el = e.target.closest("h1,h2,h3,h4,p,span,label,b,strong,small,[data-florisyn-edit]");
    if (!el || el.matches("img,input,textarea,select")) return;
    el.setAttribute("contenteditable", "true");
    el.dataset.florisynInline = "1";
    el.focus();
  }

  function setSelected(el) {
    document.querySelectorAll(".florisyn-design-selected").forEach((n) => n.classList.remove("florisyn-design-selected"));
    selected = el || null;
    if (selected) selected.classList.add("florisyn-design-selected");
    renderInspector();
  }

  function currentSel() {
    if (!selected) return null;
    return mode === "image" || selected.tagName === "IMG" ? imageSelectorFor(selected) : selectorFor(selected);
  }

  function libraryHtml() {
    const items = doc.library || [];
    if (!items.length) return `<p class="subtle">Your library is empty. Upload images below to build it.</p>`;
    return `<div class="florisyn-image-library">${items
      .map(
        (item, idx) =>
          `<button type="button" data-lib-pick="${idx}" title="${String(item.name || "Library image").replace(/"/g, "&quot;")}"><img src="${item.dataUrl}" alt=""></button>`
      )
      .join("")}</div>`;
  }

  function renderInspector() {
    if (!inspectorEl) return;
    if (!selected) {
      inspectorEl.hidden = true;
      return;
    }
    inspectorEl.hidden = false;
    const sel = currentSel() || "";
    const cs = getComputedStyle(selected);
    const isImg = selected.tagName === "IMG" || mode === "image";

    if (isImg) {
      const src = selected.tagName === "IMG" ? selected.getAttribute("src") || "" : "";
      inspectorEl.innerHTML = `
        <h2>Image editor</h2>
        <p class="subtle">${sel.replace(/</g, "&lt;")}</p>
        <label>Image URL<input id="fdImgUrl" type="url" value="${src.replace(/"/g, "&quot;")}"></label>
        <label>Upload new image<input id="fdImgFile" type="file" accept="image/*"></label>
        <p class="subtle">Ashley image library</p>
        ${libraryHtml()}
        <label>Add to library<input id="fdLibFile" type="file" accept="image/*"></label>
        <div class="florisyn-design-row">
          <label>Width (px)<input id="fdW" type="number" min="16" step="1" value="${parseInt(cs.width, 10) || ""}"></label>
          <label>Height (px)<input id="fdH" type="number" min="16" step="1" value="${parseInt(cs.height, 10) || ""}"></label>
        </div>
        <div class="florisyn-design-row">
          <label>Crop fit
            <select id="fdFit">
              <option value="cover" ${cs.objectFit === "cover" ? "selected" : ""}>cover</option>
              <option value="contain" ${cs.objectFit === "contain" ? "selected" : ""}>contain</option>
              <option value="fill" ${cs.objectFit === "fill" ? "selected" : ""}>fill</option>
              <option value="none" ${cs.objectFit === "none" ? "selected" : ""}>none</option>
            </select>
          </label>
          <label>Focal point
            <select id="fdPos">
              <option>center center</option>
              <option>center 18%</option>
              <option>center top</option>
              <option>left center</option>
              <option>right center</option>
              <option>center bottom</option>
            </select>
          </label>
        </div>
        <div class="florisyn-design-row">
          <label>Margin<input id="fdMar" type="number" step="1" value="${parseInt(cs.marginTop, 10) || 0}"></label>
          <label>Align
            <select id="fdAlign">
              <option value="">Default</option>
              <option>flex-start</option>
              <option>center</option>
              <option>flex-end</option>
            </select>
          </label>
        </div>
        <p class="subtle">Drag the image to nudge placement. Changes are visual only.</p>
        <div class="actions">
          <button type="button" id="fdApply">Apply & save</button>
          <button type="button" class="secondary" id="fdRemoveImg">Remove image</button>
          <button type="button" class="secondary" id="fdClear">Clear override</button>
        </div>`;
      const posSel = inspectorEl.querySelector("#fdPos");
      if (posSel) {
        const cur = cs.objectPosition || "center center";
        [...posSel.options].forEach((o) => {
          if (o.value === cur || o.textContent === cur) o.selected = true;
        });
      }
      inspectorEl.querySelector("#fdApply")?.addEventListener("click", applyImageInspector);
      inspectorEl.querySelector("#fdRemoveImg")?.addEventListener("click", removeSelectedImage);
      inspectorEl.querySelector("#fdClear")?.addEventListener("click", clearSelectedOverride);
      inspectorEl.querySelector("#fdImgFile")?.addEventListener("change", (e) => replaceSelectedWithFile(e.target.files?.[0]));
      inspectorEl.querySelector("#fdLibFile")?.addEventListener("change", (e) => addLibraryFile(e.target.files?.[0], true));
      inspectorEl.querySelectorAll("[data-lib-pick]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const item = doc.library?.[Number(btn.dataset.libPick)];
          if (item?.dataUrl) replaceSelectedWithSrc(item.dataUrl);
        });
      });
      return;
    }

    const text = selected.matches("input,textarea,select,img") ? "" : selected.textContent?.trim() || "";
    const bgImage = (cs.backgroundImage || "").includes("url(")
      ? ((cs.backgroundImage.match(/url\(["']?(.*?)["']?\)/) || [])[1] || "")
      : "";
    inspectorEl.innerHTML = `
      <h2>Edit element</h2>
      <p class="subtle">${sel.replace(/</g, "&lt;")}</p>
      <label>Text<textarea id="fdText" rows="3">${text.replace(/</g, "&lt;")}</textarea></label>
      <div class="florisyn-design-row">
        <label>Text color<input id="fdColor" type="color" value="${rgbToHex(cs.color)}"></label>
        <label>Background color<input id="fdBg" type="color" value="${rgbToHex(cs.backgroundColor)}"></label>
      </div>
      <label>Background image URL<input id="fdBgUrl" type="url" value="${String(bgImage).replace(/"/g, "&quot;")}" placeholder="https://… or leave blank"></label>
      <label>Upload background image<input id="fdBgFile" type="file" accept="image/*"></label>
      <p class="subtle">Ashley image library</p>
      ${libraryHtml()}
      <div class="florisyn-design-row">
        <label>Padding / panel spacing<input id="fdPad" type="number" min="0" step="1" value="${parseInt(cs.paddingTop, 10) || 0}"></label>
        <label>Gap<input id="fdGap" type="number" min="0" step="1" value="${parseInt(cs.gap, 10) || 0}"></label>
      </div>
      <div class="florisyn-design-row">
        <label>Margin<input id="fdMar" type="number" step="1" value="${parseInt(cs.marginTop, 10) || 0}"></label>
        <label>Width (px)<input id="fdW" type="number" min="0" step="1" value="${parseInt(cs.width, 10) || ""}"></label>
      </div>
      <div class="florisyn-design-row">
        <label>Align
          <select id="fdJustify">
            <option value="">Default</option>
            <option>flex-start</option>
            <option>center</option>
            <option>flex-end</option>
            <option>space-between</option>
          </select>
        </label>
        <label>Text align
          <select id="fdTextAlign">
            <option value="">Default</option>
            <option>left</option>
            <option>center</option>
            <option>right</option>
          </select>
        </label>
      </div>
      <label>Sidebar / section position
        <select id="fdSidePos">
          <option value="">Default</option>
          <option value="row">Content left · sidebar right</option>
          <option value="row-reverse">Sidebar left · content right</option>
          <option value="column">Stack vertical</option>
          <option value="column-reverse">Stack reverse</option>
        </select>
      </label>
      <p class="subtle">Drag to nudge placement. Double-click text to edit inline. Visual overrides only.</p>
      <div class="actions">
        <button type="button" id="fdApply">Apply & save</button>
        <button type="button" class="secondary" id="fdClear">Clear override</button>
      </div>`;
    const sideSel = inspectorEl.querySelector("#fdSidePos");
    if (sideSel) {
      const cur = cs.flexDirection || "";
      [...sideSel.options].forEach((o) => {
        if (o.value && o.value === cur) o.selected = true;
      });
    }
    const justSel = inspectorEl.querySelector("#fdJustify");
    if (justSel) {
      const cur = cs.justifyContent || "";
      [...justSel.options].forEach((o) => {
        if (o.value && o.value === cur) o.selected = true;
      });
    }
    const taSel = inspectorEl.querySelector("#fdTextAlign");
    if (taSel) {
      const cur = cs.textAlign || "";
      [...taSel.options].forEach((o) => {
        if (o.value && o.value === cur) o.selected = true;
      });
    }
    inspectorEl.querySelector("#fdApply")?.addEventListener("click", applyDesignInspector);
    inspectorEl.querySelector("#fdClear")?.addEventListener("click", clearSelectedOverride);
    inspectorEl.querySelector("#fdBgFile")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!/^image\//i.test(file.type)) return toast("Choose an image file");
      if (file.size > MAX_IMAGE_BYTES) return toast("Image must be under 2.5 MB");
      const reader = new FileReader();
      reader.onload = () => {
        const urlInput = inspectorEl.querySelector("#fdBgUrl");
        if (urlInput) urlInput.value = reader.result;
      };
      reader.readAsDataURL(file);
    });
    inspectorEl.querySelectorAll("[data-lib-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = doc.library?.[Number(btn.dataset.libPick)];
        const urlInput = inspectorEl.querySelector("#fdBgUrl");
        if (item?.dataUrl && urlInput) urlInput.value = item.dataUrl;
      });
    });
  }

  function rgbToHex(input) {
    const m = String(input || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return "#1a2b48";
    return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  }

  function applyDesignInspector() {
    const sel = currentSel();
    if (!sel || !selected) return toast("Select an element first");
    const next = structuredClone(doc);
    next.styles = next.styles || {};
    next.texts = next.texts || {};
    next.styles[sel] = { ...(next.styles[sel] || {}) };
    const text = inspectorEl.querySelector("#fdText")?.value;
    if (typeof text === "string" && isSafeTextTarget(selected) && !isForbiddenTextSelector(sel)) {
      next.texts[sel] = text;
      selected.textContent = text;
    } else if (typeof text === "string" && text !== (selected.textContent || "") && !isSafeTextTarget(selected)) {
      toast("Text edits are only for labels and headings — not whole panels");
    }
    const color = inspectorEl.querySelector("#fdColor")?.value;
    const bg = inspectorEl.querySelector("#fdBg")?.value;
    const bgUrl = String(inspectorEl.querySelector("#fdBgUrl")?.value || "").trim();
    const pad = inspectorEl.querySelector("#fdPad")?.value;
    const gap = inspectorEl.querySelector("#fdGap")?.value;
    const mar = inspectorEl.querySelector("#fdMar")?.value;
    const w = inspectorEl.querySelector("#fdW")?.value;
    const justify = inspectorEl.querySelector("#fdJustify")?.value;
    const textAlign = inspectorEl.querySelector("#fdTextAlign")?.value;
    const sidePos = inspectorEl.querySelector("#fdSidePos")?.value;
    if (color) next.styles[sel].color = color;
    if (bg) next.styles[sel].background = bg;
    if (bgUrl) {
      next.styles[sel].backgroundImage = `url("${bgUrl.replace(/"/g, "")}")`;
      next.styles[sel].backgroundSize = "cover";
      next.styles[sel].backgroundPosition = "center";
      next.styles[sel].backgroundRepeat = "no-repeat";
    } else {
      delete next.styles[sel].backgroundImage;
      delete next.styles[sel].backgroundSize;
      delete next.styles[sel].backgroundPosition;
      delete next.styles[sel].backgroundRepeat;
    }
    if (pad !== undefined && pad !== "") next.styles[sel].padding = `${pad}px`;
    if (gap !== undefined && gap !== "") next.styles[sel].gap = `${gap}px`;
    if (mar !== undefined && mar !== "") next.styles[sel].margin = `${mar}px`;
    if (w) next.styles[sel].width = `${w}px`;
    if (justify) next.styles[sel].justifyContent = justify;
    else delete next.styles[sel].justifyContent;
    if (textAlign) next.styles[sel].textAlign = textAlign;
    else delete next.styles[sel].textAlign;
    if (sidePos) {
      next.styles[sel].display = "flex";
      next.styles[sel].flexDirection = sidePos;
    } else {
      delete next.styles[sel].flexDirection;
    }
    persist(next);
    toast("Visual change applied");
  }

  function applyImageInspector() {
    const sel = currentSel();
    if (!sel || !selected) return toast("Select an image first");
    const next = structuredClone(doc);
    next.styles = next.styles || {};
    next.images = next.images || {};
    next.styles[sel] = next.styles[sel] || {};
    const url = inspectorEl.querySelector("#fdImgUrl")?.value?.trim();
    if (url) {
      next.images[sel] = url;
      if (selected.tagName === "IMG") {
        selected.hidden = false;
        selected.src = url;
      }
    }
    const w = inspectorEl.querySelector("#fdW")?.value;
    const h = inspectorEl.querySelector("#fdH")?.value;
    const fit = inspectorEl.querySelector("#fdFit")?.value;
    const pos = inspectorEl.querySelector("#fdPos")?.value;
    const mar = inspectorEl.querySelector("#fdMar")?.value;
    const align = inspectorEl.querySelector("#fdAlign")?.value;
    if (w) next.styles[sel].width = `${w}px`;
    if (h) next.styles[sel].height = `${h}px`;
    if (fit) next.styles[sel].objectFit = fit;
    if (pos) next.styles[sel].objectPosition = pos;
    if (mar !== undefined && mar !== "") next.styles[sel].margin = `${mar}px`;
    if (align) next.styles[sel].alignSelf = align;
    persist(next);
    toast("Image visuals saved");
  }

  function clearSelectedOverride() {
    const sel = currentSel();
    if (!sel) return;
    const next = structuredClone(doc);
    delete next.styles?.[sel];
    delete next.texts?.[sel];
    delete next.images?.[sel];
    delete next.layout?.[sel];
    persist(next);
    toast("Override cleared");
    renderInspector();
  }

  function removeSelectedImage() {
    const sel = currentSel();
    if (!sel || !selected) return;
    const next = structuredClone(doc);
    next.images = next.images || {};
    next.images[sel] = "";
    if (selected.tagName === "IMG") {
      selected.removeAttribute("src");
      selected.hidden = true;
    }
    persist(next);
    toast("Image removed");
    renderInspector();
  }

  function replaceSelectedWithSrc(src) {
    const sel = currentSel();
    if (!sel || !selected || !src) return;
    const next = structuredClone(doc);
    next.images = next.images || {};
    next.images[sel] = src;
    if (selected.tagName === "IMG") {
      selected.hidden = false;
      selected.src = src;
    }
    persist(next);
    toast("Image replaced instantly");
    renderInspector();
  }

  function replaceSelectedWithFile(file) {
    if (!file) return;
    if (!/^image\//i.test(file.type)) return toast("Choose an image file");
    if (file.size > MAX_IMAGE_BYTES) return toast("Image must be under 2.5 MB");
    const reader = new FileReader();
    reader.onload = () => replaceSelectedWithSrc(reader.result);
    reader.readAsDataURL(file);
  }

  function addLibraryFile(file, alsoApply) {
    if (!file) return;
    if (!/^image\//i.test(file.type)) return toast("Choose an image file");
    if (file.size > MAX_IMAGE_BYTES) return toast("Image must be under 2.5 MB");
    const reader = new FileReader();
    reader.onload = () => {
      const next = structuredClone(doc);
      next.library = Array.isArray(next.library) ? next.library : [];
      next.library.unshift({
        id: `lib-${Date.now()}`,
        name: file.name,
        dataUrl: reader.result,
        updatedAt: new Date().toISOString()
      });
      next.library = next.library.slice(0, 60);
      persist(next);
      toast("Added to Ashley image library");
      if (alsoApply) replaceSelectedWithSrc(reader.result);
      else {
        renderInspector();
        refreshAdminLibrary();
      }
    };
    reader.readAsDataURL(file);
  }

  function removeLibraryItem(id) {
    const next = structuredClone(doc);
    next.library = (next.library || []).filter((x) => x.id !== id);
    persist(next);
    refreshAdminLibrary();
    renderInspector();
  }

  function onPointerDown(e) {
    if (!mode) return;
    if (e.target.closest("#florisynDesignBar, #florisynDesignInspector")) return;

    let el = null;
    if (mode === "image") {
      el = e.target.closest("img, [data-florisyn-image]");
      if (el && el.tagName !== "IMG") el = el.querySelector("img") || el;
    } else {
      el = e.target.closest("h1,h2,h3,h4,p,span,label,img,button,a,.card,.atelier-kpi,.pad,.product-pad,.rose-welcome-card,.lily-suggestion-card,.pos-workspace,.assistant-mini-dock button,.hero,[data-florisyn-edit],[data-assistant],[data-florisyn-character]");
      if (el && el.closest("#uiDesignModeRoot, #adminAuth, #ownerSetup")) {
        // In Admin Design Mode studio, only allow leaf text/image targets — never whole panels.
        el = e.target.closest("h1,h2,h3,h4,p,span,label,img,button,small,b,strong");
      }
    }
    if (!el || el.closest("dialog")) return;
    // Allow inline text caret when already contenteditable and not starting a drag.
    if (mode === "design" && e.target.isContentEditable && e.detail >= 2) {
      setSelected(el);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setSelected(el);
    dragState = { el, startX: e.clientX, startY: e.clientY, origX: 0, origY: 0 };
    const transform = el.style.transform || "";
    const m = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    if (m) {
      dragState.origX = Number(m[1]);
      dragState.origY = Number(m[2]);
    }
    document.body.classList.add("florisyn-design-dragging");
  }

  function onPointerMove(e) {
    if (!dragState?.el) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (Math.abs(dx) + Math.abs(dy) < 3) return;
    const x = dragState.origX + dx;
    const y = dragState.origY + dy;
    dragState.el.style.transform = `translate(${x}px, ${y}px)`;
    dragState.moved = true;
    dragState.x = x;
    dragState.y = y;
  }

  function onPointerUp() {
    if (!dragState?.el) return;
    document.body.classList.remove("florisyn-design-dragging");
    if (dragState.moved) {
      const sel = mode === "image" ? imageSelectorFor(dragState.el) : selectorFor(dragState.el);
      if (sel) {
        const next = structuredClone(doc);
        next.layout = next.layout || {};
        next.layout[sel] = {
          ...(next.layout[sel] || {}),
          transform: `translate(${dragState.x || 0}px, ${dragState.y || 0}px)`
        };
        persist(next);
        toast("Placement saved");
      }
    }
    dragState = null;
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    // UTC-based date stamp — export timestamps aren't schedule-critical
    // like an order/expense date, but keep the local calendar day for
    // consistency with the rest of the app's date handling.
    const now = new Date();
    const localDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    a.download = `florisyn-design-overrides-${localDateStr}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Visual config JSON downloaded");
  }

  function importJsonFile(file) {
    if (!file) return;
    if (!/\.json$/i.test(file.name || "") && file.type && file.type !== "application/json") {
      return toast("Please choose a .json design file");
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("object required");
        }
        // Never let import flatten Admin / florist shell markup.
        persist(sanitizeDesignDoc(parsed));
        restoreAdminDesignPanel();
        if (mode === "design") {
          markEditableHints();
          enableInlineTextEditing();
          ensureBar();
        } else if (mode === "image") {
          markEditableHints();
          ensureBar();
        }
        toast("Design config imported and applied");
        refreshVoiceCards();
        refreshAdminLibrary();
      } catch {
        toast("That file is not valid design JSON");
      }
    };
    reader.readAsText(file);
  }

  function resetDesignOverrides() {
    localStorage.removeItem(STORAGE_KEY);
    doc = emptyDoc();
    applyOverrides(doc);
    if (restoreAdminDesignPanel()) {
      toast("Design overrides cleared — Admin layout restored");
      return;
    }
    toast("Design overrides cleared");
  }

  function setVoice(persona, voice) {
    const next = structuredClone(doc);
    next.voices = next.voices || {};
    next.voices[persona] = voice;
    persist(next);
    document.dispatchEvent(new CustomEvent("florisyn-custom-voices-changed", { detail: next.voices }));
  }

  function uploadVoice(persona, file) {
    if (!PERSONAS.includes(persona) || !file) return;
    if (!/^audio\//i.test(file.type) && !/\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(file.name || "")) {
      return toast("Upload an audio file (mp3, wav, ogg, m4a)");
    }
    if (file.size > MAX_VOICE_BYTES) return toast("Voice file must be under 3.5 MB");
    const reader = new FileReader();
    reader.onload = () => {
      setVoice(persona, { name: file.name, type: file.type || "audio/mpeg", dataUrl: reader.result, updatedAt: new Date().toISOString() });
      toast(`${persona} voice uploaded`);
      refreshVoiceCards();
    };
    reader.readAsDataURL(file);
  }

  function playVoice(persona) {
    const voice = doc.voices?.[persona];
    if (!voice?.dataUrl) return toast(`No custom ${persona} voice uploaded yet`);
    new Audio(voice.dataUrl).play().catch(() => toast(`Could not play ${persona} voice`));
  }

  function clearVoice(persona) {
    setVoice(persona, null);
    toast(`${persona} custom voice removed`);
    refreshVoiceCards();
  }

  function refreshVoiceCards() {
    PERSONAS.forEach((persona) => {
      const meta = document.querySelector(`[data-voice-meta="${persona}"]`);
      if (!meta) return;
      const voice = doc.voices?.[persona];
      meta.textContent = voice?.name ? `Current: ${voice.name}` : "No custom voice uploaded";
    });
  }

  function refreshAdminLibrary() {
    const host = document.getElementById("ashleyImageLibraryAdmin");
    if (!host) return;
    const items = doc.library || [];
    host.innerHTML = items.length
      ? items
          .map(
            (item) => `<figure>
              <img src="${item.dataUrl}" alt="">
              <figcaption><span>${String(item.name || "Image").slice(0, 18)}</span>
              <button type="button" class="secondary" data-lib-del="${item.id}">Remove</button></figcaption>
            </figure>`
          )
          .join("")
      : `<p class="subtle">No library images yet.</p>`;
    host.querySelectorAll("[data-lib-del]").forEach((btn) => {
      btn.addEventListener("click", () => removeLibraryItem(btn.dataset.libDel));
    });
  }

  function ensureBar() {
    if (barEl) barEl.remove();
    barEl = document.createElement("div");
    barEl.id = "florisynDesignBar";
    const label = mode === "image" ? "Image Edit Mode" : "Design Mode";
    barEl.innerHTML = `
      <span class="florisyn-design-status">${label}</span>
      <button type="button" id="fdSave">Save visuals</button>
      <button type="button" class="secondary" id="fdExport">Download JSON</button>
      <label class="florisyn-design-file secondary">Import JSON<input id="fdImport" type="file" accept="application/json,.json" hidden></label>
      ${mode === "image" ? `<label class="florisyn-design-file secondary">Add to library<input id="fdBarLib" type="file" accept="image/*" hidden></label>` : ""}
      <button type="button" class="secondary" id="fdReset">Reset visuals</button>
      <button type="button" class="secondary" id="fdExit">Exit ${label}</button>`;
    document.body.appendChild(barEl);
    barEl.querySelector("#fdSave")?.addEventListener("click", () => {
      persist(doc);
      exportJson();
      toast("Saved locally and downloaded JSON config");
    });
    barEl.querySelector("#fdExport")?.addEventListener("click", exportJson);
    barEl.querySelector("#fdImport")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) importJsonFile(file);
      e.target.value = "";
    });
    barEl.querySelector("#fdBarLib")?.addEventListener("change", (e) => {
      addLibraryFile(e.target.files?.[0], false);
      e.target.value = "";
    });
    barEl.querySelector("#fdReset")?.addEventListener("click", () => resetDesignOverrides());
    barEl.querySelector("#fdExit")?.addEventListener("click", () => exitAllModes());
    return barEl;
  }

  function ensureInspector() {
    if (inspectorEl) return inspectorEl;
    inspectorEl = document.createElement("aside");
    inspectorEl.id = "florisynDesignInspector";
    inspectorEl.hidden = true;
    document.body.appendChild(inspectorEl);
    return inspectorEl;
  }

  function exitAllModes(options = {}) {
    const wasOn = Boolean(mode);
    mode = null;
    document.body.classList.remove("florisyn-design-mode", "florisyn-image-edit-mode", "florisyn-design-dragging");
    disableInlineTextEditing();
    setSelected(null);
    barEl?.remove();
    barEl = null;
    inspectorEl?.remove();
    inspectorEl = null;
    localStorage.removeItem("florisyn_design_mode");
    localStorage.removeItem("florisyn_image_edit_mode");
    if (wasOn && !options.silent) toast("Editor off");
  }

  function enterDesignMode() {
    if (!hasAdminSession()) {
      toast("Sign in to Florisyn Admin first");
      return false;
    }
    exitAllModes({ silent: true });
    mode = "design";
    document.body.classList.add("florisyn-design-mode");
    markEditableHints();
    enableInlineTextEditing();
    ensureBar();
    ensureInspector();
    localStorage.setItem("florisyn_design_mode", "1");
    toast("Design Mode on — visuals only");
    return true;
  }

  function enterImageEditMode() {
    if (!hasAdminSession()) {
      toast("Sign in to Florisyn Admin first");
      return false;
    }
    exitAllModes({ silent: true });
    mode = "image";
    document.body.classList.add("florisyn-image-edit-mode");
    markEditableHints();
    ensureBar();
    ensureInspector();
    localStorage.setItem("florisyn_image_edit_mode", "1");
    toast("Image Edit Mode on — click any photo to replace it");
    return true;
  }

  function exitDesignMode() {
    if (mode === "design") exitAllModes();
  }

  function exitImageEditMode() {
    if (mode === "image") exitAllModes();
  }

  function mountAdminPanel(root) {
    if (!root) return;
    root.innerHTML = `
      <article class="panel florisyn-design-admin-panel">
        <p class="eyebrow">ASHLEY VISUAL STUDIO</p>
        <h2>UI Design Mode</h2>
        <p class="subtle">Edit Florisyn visuals only — text, spacing, colors, images, layout, and character voices on Admin and every florist OS page. Never changes payments, access gates, staff PIN, Website Studio logic, or database queries.</p>
        <div class="actions">
          <button type="button" id="adminEnterDesign">Enter Design Mode (this Admin page)</button>
          <button type="button" class="secondary" id="adminExitDesign">Exit Design Mode</button>
          <a class="secondary" href="/?florisynDesign=1" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;text-decoration:none">Edit all florist pages in Design Mode</a>
        </div>
      </article>
      <article class="panel florisyn-design-admin-panel image-mode-card" style="margin-top:16px">
        <p class="eyebrow">IMAGE STUDIO</p>
        <h2>Image Edit Mode</h2>
        <p class="subtle">Click any photo on screen, remove it, upload a replacement, or pick from your library. Adjust size, crop, spacing, alignment, and placement. Visual changes only.</p>
        <div class="actions">
          <button type="button" id="adminEnterImage">Enter Image Edit Mode</button>
          <button type="button" class="secondary" id="adminExitImage">Exit Image Edit Mode</button>
          <a class="secondary" href="/?florisynImageEdit=1" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;text-decoration:none">Open florist app in Image Edit Mode</a>
          <button type="button" class="secondary" id="adminExportDesign">Download design JSON</button>
          <label class="file-btn secondary">Import design JSON<input id="adminImportDesign" type="file" accept="application/json,.json" hidden></label>
          <button type="button" class="secondary" id="adminResetDesign">Reset visuals</button>
        </div>
        <h3 style="margin-top:18px">Ashley image library</h3>
        <p class="subtle">Upload images here, then reuse them anywhere in Image Edit Mode.</p>
        <div class="actions">
          <label class="file-btn secondary">Upload to library<input id="adminLibUpload" type="file" accept="image/*" hidden multiple></label>
        </div>
        <div id="ashleyImageLibraryAdmin" class="library-admin-grid"></div>
      </article>
      <article class="panel florisyn-design-admin-panel" style="margin-top:16px">
        <h2>Brand colors</h2>
        <p class="subtle">Visual CSS variables only — applied instantly, saved in design JSON.</p>
        <div class="florisyn-design-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label>Ink<input id="adminCssInk" type="color" value="${rgbToHex(getComputedStyle(document.documentElement).getPropertyValue("--ink") || "#1a2b48")}"></label>
          <label>Accent<input id="adminCssAccent" type="color" value="${rgbToHex(getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#c45c68")}"></label>
          <label>Surface<input id="adminCssSurface" type="color" value="${rgbToHex(getComputedStyle(document.documentElement).getPropertyValue("--surface") || "#f7f1ea")}"></label>
          <label>Panel<input id="adminCssPanel" type="color" value="${rgbToHex(getComputedStyle(document.documentElement).getPropertyValue("--panel") || "#ffffff")}"></label>
        </div>
        <div class="actions" style="margin-top:12px">
          <button type="button" id="adminSaveCssVars">Save brand colors</button>
        </div>
      </article>
      <article class="panel florisyn-design-admin-panel" style="margin-top:16px">
        <h2>Character text & personality</h2>
        <p class="subtle">Edit Lily, Rose, Daisy, and Bud display name, title, and personality blurb. Visual copy only.</p>
        <div class="voice-upload-grid">
          ${PERSONAS.map((p) => {
            const c = doc.characters?.[p] || {};
            return `<div class="voice-card" data-character-card="${p}">
              <h3>${p}</h3>
              <label>Name<input data-char-name="${p}" type="text" value="${String(c.name || "").replace(/"/g, "&quot;")}" placeholder="${p}"></label>
              <label>Title<input data-char-title="${p}" type="text" value="${String(c.title || "").replace(/"/g, "&quot;")}" placeholder="Title / role"></label>
              <label>Personality blurb<textarea data-char-blurb="${p}" rows="3" placeholder="Short personality line">${String(c.blurb || "").replace(/</g, "&lt;")}</textarea></label>
            </div>`;
          }).join("")}
        </div>
        <div class="actions" style="margin-top:12px">
          <button type="button" id="adminSaveCharacters">Save character text</button>
        </div>
      </article>
      <article class="panel florisyn-design-admin-panel" style="margin-top:16px">
        <h2>Character voices</h2>
        <p class="subtle">Upload custom audio for Lily, Rose, Daisy, and Bud (mp3/wav/ogg/m4a, under 3.5 MB). Stored in this browser for local preview only — Daisy speaks only from her uploaded sample; Lily, Rose, and Bud's real spoken replies use their Florisyn cloud voice, unaffected by this upload.</p>
        <div class="voice-upload-grid">
          ${PERSONAS.map(
            (p) => `<div class="voice-card" data-voice-card="${p}">
              <h3>${p}</h3>
              <p class="subtle" data-voice-meta="${p}">No custom voice uploaded</p>
              <div class="actions">
                <label class="file-btn secondary">Upload ${p} voice<input data-voice-file="${p}" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm" hidden></label>
                <button type="button" class="secondary" data-voice-play="${p}">Play</button>
                <button type="button" class="secondary" data-voice-clear="${p}">Remove</button>
              </div>
            </div>`
          ).join("")}
        </div>
      </article>`;

    root.querySelector("#adminEnterDesign")?.addEventListener("click", () => enterDesignMode());
    root.querySelector("#adminExitDesign")?.addEventListener("click", () => exitDesignMode());
    root.querySelector("#adminEnterImage")?.addEventListener("click", () => enterImageEditMode());
    root.querySelector("#adminExitImage")?.addEventListener("click", () => exitImageEditMode());
    root.querySelector("#adminExportDesign")?.addEventListener("click", exportJson);
    root.querySelector("#adminImportDesign")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) importJsonFile(file);
      e.target.value = "";
    });
    root.querySelector("#adminResetDesign")?.addEventListener("click", () => resetDesignOverrides());
    root.querySelector("#adminLibUpload")?.addEventListener("change", (e) => {
      [...(e.target.files || [])].forEach((file) => addLibraryFile(file, false));
      e.target.value = "";
    });
    root.querySelector("#adminSaveCssVars")?.addEventListener("click", () => {
      const next = structuredClone(doc);
      next.cssVars = next.cssVars || {};
      const ink = root.querySelector("#adminCssInk")?.value;
      const accent = root.querySelector("#adminCssAccent")?.value;
      const surface = root.querySelector("#adminCssSurface")?.value;
      const panel = root.querySelector("#adminCssPanel")?.value;
      if (ink) next.cssVars["--ink"] = ink;
      if (accent) next.cssVars["--accent"] = accent;
      if (surface) next.cssVars["--surface"] = surface;
      if (panel) next.cssVars["--panel"] = panel;
      persist(next);
      toast("Brand colors saved");
    });
    root.querySelector("#adminSaveCharacters")?.addEventListener("click", () => {
      const next = structuredClone(doc);
      next.characters = next.characters || emptyDoc().characters;
      PERSONAS.forEach((p) => {
        next.characters[p] = {
          name: String(root.querySelector(`[data-char-name="${p}"]`)?.value || "").trim(),
          title: String(root.querySelector(`[data-char-title="${p}"]`)?.value || "").trim(),
          blurb: String(root.querySelector(`[data-char-blurb="${p}"]`)?.value || "").trim()
        };
      });
      persist(next);
      toast("Character text saved");
    });
    PERSONAS.forEach((p) => {
      root.querySelector(`[data-voice-file="${p}"]`)?.addEventListener("change", (e) => {
        uploadVoice(p, e.target.files?.[0]);
        e.target.value = "";
      });
      root.querySelector(`[data-voice-play="${p}"]`)?.addEventListener("click", () => playVoice(p));
      root.querySelector(`[data-voice-clear="${p}"]`)?.addEventListener("click", () => clearVoice(p));
    });
    refreshVoiceCards();
    refreshAdminLibrary();
  }

  function getCustomVoice(persona) {
    return doc.voices?.[persona] || null;
  }

  async function playCustomVoice(persona) {
    const voice = getCustomVoice(persona);
    if (!voice?.dataUrl) return false;
    try {
      await new Audio(voice.dataUrl).play();
      return true;
    } catch {
      return false;
    }
  }

  function tryMountAdminPanel() {
    if (!hasAdminSession()) return;
    if (document.getElementById("adminApp")?.hidden) return;
    restoreAdminDesignPanel();
  }

  async function boot() {
    const published = await loadPublished();
    const local = loadLocal();
    doc = sanitizeDesignDoc(local || published || emptyDoc());
    // Drop previously saved shell-flattening text overrides that broke Admin.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    applyOverrides(doc);

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("focusout", onInlineBlur, true);
    document.addEventListener("dblclick", onInlineDblClick, true);
    document.addEventListener("florisyn-admin-authenticated", tryMountAdminPanel);

    const params = new URLSearchParams(location.search);
    if (hasAdminSession()) {
      if (params.get("florisynImageEdit") === "1" || localStorage.getItem("florisyn_image_edit_mode") === "1") enterImageEditMode();
      else if (params.get("florisynDesign") === "1" || localStorage.getItem("florisyn_design_mode") === "1") enterDesignMode();
    }

    // Only mount Admin visual studio after Admin shell is authenticated.
    tryMountAdminPanel();
  }

  window.FlorisynUiEditor = {
    enterDesignMode,
    exitDesignMode,
    enterImageEditMode,
    exitImageEditMode,
    toggleDesignMode: () => (mode === "design" ? (exitDesignMode(), false) : enterDesignMode()),
    toggleImageEditMode: () => (mode === "image" ? (exitImageEditMode(), false) : enterImageEditMode()),
    applyOverrides,
    persist,
    getDoc: () => structuredClone(doc),
    getCustomVoice,
    playCustomVoice,
    uploadVoice,
    mountAdminPanel,
    hasAdminSession,
    STORAGE_KEY
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
