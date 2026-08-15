(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  let editorSelectPage = null;

  async function api(action, extra = {}) {
    return window.api("instant-website", { method: "POST", body: JSON.stringify({ action, ...extra }) });
  }

  function live(msg) {
    let r = document.getElementById("editorLiveRegion");
    if (!r) {
      r = document.createElement("div");
      r.id = "editorLiveRegion";
      r.className = "visually-hidden";
      r.setAttribute("aria-live", "polite");
      document.body.appendChild(r);
    }
    r.textContent = msg;
  }

  function mountEditor(root) {
    if (!root || root.querySelector(".website-editor-shell")) return;
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="website-editor-shell panel bloom-rc1-wizard">
        <p class="eyebrow">VISUAL EDITOR</p>
        <h2>Edit your website sections</h2>
        <div class="editor-toolbar card-actions">
          <label class="editor-add-section">Add section<select id="editorSectionType">
            <option value="hero">Hero</option>
            <option value="featured_arrangements">Featured arrangements</option>
            <option value="occasion_tiles">Occasion tiles</option>
            <option value="delivery_area">Delivery area</option>
            <option value="wedding_feature">Weddings and events</option>
            <option value="sympathy_feature">Sympathy</option>
            <option value="about_florist">About florist</option>
            <option value="shop_hours">Hours</option>
            <option value="contact_form">Contact form</option>
            <option value="cta_banner">Call to action</option>
          </select></label>
          <button type="button" class="secondary" id="editorAddSection">Add</button>
          <button type="button" class="secondary" id="editorUndo">Undo</button>
          <button type="button" class="secondary" id="editorRedo">Redo</button>
          <button type="button" class="secondary" id="editorSave">Save draft</button>
          <button type="button" class="secondary" id="editorOpenPreview">Open draft preview</button>
          <button type="button" class="secondary" id="editorPreviewDesktop">Desktop</button>
          <button type="button" class="secondary" id="editorPreviewTablet">Tablet</button>
          <button type="button" class="secondary" id="editorPreviewMobile">Mobile</button>
          <button type="button" class="primary" id="editorPublish">Publish (approved)</button>
        </div>
        <div class="editor-layout">
          <div id="editorCanvas" class="editor-canvas" data-preview="desktop"></div>
          <aside id="editorInspector" class="editor-inspector panel" aria-label="Section properties"></aside>
        </div>
        <p id="editorStatus" class="subtle" aria-live="polite"></p>
      </div>`
    );

    const history = createHistory();
    let project = null;
    let homePage = null;
    let allPages = [];
    let activeSlug = "home";
    let sections = [];
    let busy = false;
    let autosaveTimer = null;
    let selectedSectionId = null;

    function setBusy(next) {
      busy = !!next;
      ["editorSave", "editorPublish", "editorOpenPreview"].forEach((id) => {
        const btn = root.querySelector(`#${id}`);
        if (btn) btn.disabled = busy;
      });
    }

    function currentPage() {
      return allPages.find((p) => p.slug === activeSlug) || homePage;
    }

    function pagePayload() {
      const page = currentPage();
      return {
        page: { ...page, sections },
        expected_updated_at: page?.updated_at || null
      };
    }

    function rememberSavedPage(savedPage) {
      if (!savedPage) return;
      const idx = allPages.findIndex((p) => p.slug === (savedPage.slug || activeSlug));
      const merged = {
        ...(idx >= 0 ? allPages[idx] : homePage),
        id: savedPage.id,
        slug: savedPage.slug || activeSlug,
        updated_at: savedPage.updated_at || null
      };
      if (idx >= 0) allPages[idx] = merged;
      if (merged.slug === "home") homePage = merged;
      if (merged.slug === activeSlug) homePage = merged.slug === "home" ? merged : homePage;
    }

    function selectPage(slug) {
      if (slug === activeSlug) return;
      syncTextEdits();
      activeSlug = slug;
      const page = currentPage();
      sections = [...(page?.sections || [])].sort((a, b) => a.order - b.order);
      history.reset({ sections });
      renderCanvas();
      const status = root.querySelector("#editorStatus");
      status.textContent = `Editing ${page?.title || slug}.`;
    }

    function scheduleAutosave() {
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(async () => {
        if (busy) return;
        const status = root.querySelector("#editorStatus");
        try {
          syncTextEdits();
          const result = await api("save_page", pagePayload());
          if (result?.saved && result?.page?.id) {
            rememberSavedPage(result.page);
            status.textContent = "Draft autosaved.";
          }
        } catch {
          /* keep editing — user can save manually */
        }
      }, 2500);
    }

    async function loadProject() {
      const status = root.querySelector("#editorStatus");
      status.textContent = "Loading website draft…";
      setBusy(true);
      try {
        const d = await api("get_project");
        project = d.project;
        allPages = d.pages || [];
        homePage = allPages.find((p) => p.slug === "home") || { slug: "home", title: "Home", sections: [] };
        activeSlug = "home";
        sections = [...(homePage.sections || [])].sort((a, b) => a.order - b.order);
        history.reset({ sections });
        renderCanvas();
        status.textContent = sections.length ? "Draft ready." : "No sections yet — add content, then save draft.";
      } catch (e) {
        live("Website draft could not be loaded.");
        status.textContent = e.message || "Could not load website draft. Try again.";
        root.querySelector("#editorCanvas").innerHTML =
          `<div class="bloom-empty-state florisyn-empty-state"><p>Website draft could not be loaded.</p><p class="subtle">${esc(e.message || "Try again.")}</p></div>`;
      } finally {
        setBusy(false);
      }
    }

    function renderInspector() {
      const panel = root.querySelector("#editorInspector");
      const section = sections.find((s) => s.id === selectedSectionId) || null;
      window.BloomSectionInspector?.renderPanel(panel, section, {
        onChange(updated) {
          const idx = sections.findIndex((s) => s.id === updated.id);
          if (idx >= 0) sections[idx] = updated;
          pushHistory();
          renderCanvas();
          scheduleAutosave();
        },
        onReorderBlock(from, to) {
          const section = sections.find((s) => s.id === selectedSectionId);
          if (!section) return;
          const blocks = window.BloomSectionInspector.blockList(section);
          const order = blocks.map((b) => b.path);
          const [moved] = order.splice(from, 1);
          order.splice(to, 0, moved);
          live("Block order updated.");
        }
      });
    }

    function renderCanvas() {
      const canvas = root.querySelector("#editorCanvas");
      if (!sections.length) {
        canvas.innerHTML =
          `<div class="bloom-empty-state florisyn-empty-state"><p>No website sections yet.</p><p class="subtle">Save a draft after adding sections. Unpublished drafts never appear on your public storefront.</p></div>`;
        renderInspector();
        return;
      }
      canvas.innerHTML = sections
        .map(
          (s, idx) => `<article class="editor-section${s.id === selectedSectionId ? " selected" : ""}" data-id="${esc(s.id)}" draggable="true">
            <div class="editor-section-tools">
              <button type="button" class="secondary editor-select" data-select="${esc(s.id)}" aria-label="Edit section properties">Edit</button>
              <button type="button" class="secondary" data-move="up" data-id="${esc(s.id)}" aria-label="Move section up">↑</button>
              <button type="button" class="secondary" data-move="down" data-id="${esc(s.id)}" aria-label="Move section down">↓</button>
              <button type="button" class="secondary" data-dup="${esc(s.id)}">Duplicate</button>
              <button type="button" class="secondary" data-hide="${esc(s.id)}">${s.hidden ? "Show" : "Hide"}</button>
              <button type="button" class="secondary" data-del="${esc(s.id)}">Delete</button>
            </div>
            <span class="subtle">${esc(s.type)} · #${idx + 1}</span>
            <div class="editor-section-preview">${window.BloomSectionRenderer?.renderSection?.(s, { shop: "preview", shopName: window.shopSettings?.name || "Your Florist", products: [] }) || `<div class="editable" contenteditable="true" data-section="${esc(s.id)}" data-path="title">${esc(s.props?.title || s.props?.text || "Click to edit text")}</div>`}</div>
          </article>`
        )
        .join("");
      renderInspector();
    }

    function titleForType(type) {
      return String(type || "custom_text_image").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
    }

    function newSection(type) {
      const id = `${type || "section"}-${Date.now()}`;
      return {
        id,
        type: type || "custom_text_image",
        order: sections.length,
        props: {
          title: titleForType(type),
          text: "Click to edit this florist website section."
        }
      };
    }

    root.querySelector("#editorSave")?.addEventListener("click", async () => {
      if (busy) return;
      const status = root.querySelector("#editorStatus");
      status.textContent = "Saving draft…";
      setBusy(true);
      try {
        syncTextEdits();
        const result = await api("save_page", pagePayload());
        if (!result?.saved || !result?.page?.id) throw new Error("Website draft save could not be confirmed. Your changes remain in the editor.");
        rememberSavedPage(result.page);
        live("Draft saved.");
        status.textContent = "Draft saved.";
      } catch (e) {
        live("Draft was not saved.");
        status.textContent = e.message || "Could not save website draft. Try again.";
      } finally {
        setBusy(false);
      }
    });

    root.querySelector("#editorPublish")?.addEventListener("click", async () => {
      if (busy) return;
      const status = root.querySelector("#editorStatus");
      status.textContent = "Saving and publishing…";
      setBusy(true);
      try {
        syncTextEdits();
        const saved = await api("save_page", pagePayload());
        if (!saved?.saved || !saved?.page?.id) throw new Error("Website draft save could not be confirmed. Publishing was stopped.");
        rememberSavedPage(saved.page);
        let published;
        try {
          published = await api("publish", { approved: true, saved: true, lily_draft: false });
        } catch (e) {
          // Commerce-safety gate: the server blocks publish when required
          // launch-checklist items are missing (no products, no SEO, no
          // contact info, etc.) rather than letting a broken site go live
          // silently. Show exactly what's missing and let the florist
          // decide to fix it or publish anyway — never publish silently.
          if (e.code === "checklist_blocked") {
            const items = Array.isArray(e.items) ? e.items : [];
            const lines = items.map((i) => `• ${i.label}${i.fix ? ` — ${i.fix}` : ""}`).join("\n");
            const proceed = confirm(
              `This site isn't ready to publish yet:\n\n${lines}\n\nPublish anyway? You can fix these and republish later.`
            );
            if (!proceed) {
              status.textContent = "Publish stopped — nothing is live yet. Fix the items above and try again.";
              live("Publish stopped.");
              return;
            }
            published = await api("publish", { approved: true, saved: true, lily_draft: false, override_checklist: true });
          } else {
            throw e;
          }
        }
        if (!published?.published || published?.status !== "published") throw new Error("Website publish could not be confirmed. Your saved draft is safe.");
        live("Site published.");
        status.textContent = "Website published.";
        window.toast?.("Website published");
      } catch (e) {
        live("Website was not published.");
        status.textContent = e.message || "Could not save website draft. Try again.";
      } finally {
        setBusy(false);
      }
    });

    root.querySelector("#editorOpenPreview")?.addEventListener("click", async () => {
      if (busy) return;
      const status = root.querySelector("#editorStatus");
      status.textContent = "Opening draft preview…";
      setBusy(true);
      try {
        const preview = await window.api("storefront-public", {
          method: "POST",
          body: JSON.stringify({ action: "preview_token" })
        });
        if (!preview?.preview_url || !preview?.token) {
          throw new Error("Draft preview is unavailable. Save a draft and confirm preview is configured for this shop.");
        }
        window.open(preview.preview_url, "_blank", "noopener,noreferrer");
        live("Draft preview opened.");
        status.textContent = "Draft preview opened in a new tab.";
      } catch (e) {
        live("Draft preview could not be opened.");
        status.textContent = e.message || "Draft preview could not be opened. Missing preview secret or shop slug.";
      } finally {
        setBusy(false);
      }
    });

    root.querySelector("#editorUndo")?.addEventListener("click", () => {
      const prev = history.undo();
      if (prev) {
        sections = prev.sections;
        renderCanvas();
        live("Undo.");
      }
    });
    root.querySelector("#editorRedo")?.addEventListener("click", () => {
      const next = history.redo();
      if (next) {
        sections = next.sections;
        renderCanvas();
        live("Redo.");
      }
    });
    root.querySelector("#editorAddSection")?.addEventListener("click", () => {
      syncTextEdits();
      sections = [...sections, newSection(root.querySelector("#editorSectionType")?.value)].map((s, order) => ({ ...s, order }));
      pushHistory();
      renderCanvas();
      live("Section added.");
    });

    ["Desktop", "Tablet", "Mobile"].forEach((mode) => {
      root.querySelector(`#editorPreview${mode}`)?.addEventListener("click", () => {
        root.querySelector("#editorCanvas").dataset.preview = mode.toLowerCase();
        root.querySelector("#editorCanvas").style.maxWidth = mode === "Mobile" ? "390px" : mode === "Tablet" ? "768px" : "100%";
        live(`${mode} preview.`);
      });
    });

    root.querySelector("#editorCanvas")?.addEventListener("click", async (e) => {
      const selectBtn = e.target.closest("[data-select]");
      if (selectBtn) {
        selectedSectionId = selectBtn.dataset.select;
        renderCanvas();
        live("Section selected.");
        return;
      }
      const sec = e.target.closest(".editor-section");
      if (sec && !e.target.closest(".editor-section-tools")) {
        selectedSectionId = sec.dataset.id;
        renderCanvas();
      }
      const move = e.target.closest("[data-move]");
      if (move) {
        const id = move.dataset.id;
        const dir = move.dataset.move;
        const d = await api("move_section_keyboard", { sections, section_id: id, direction: dir });
        sections = d.sections;
        pushHistory();
        renderCanvas();
        live(`Section moved ${dir}.`);
        return;
      }
      if (e.target.closest("[data-dup]")) {
        const id = e.target.closest("[data-dup]").dataset.dup;
        const d = await api("duplicate_section", { sections, section_id: id });
        sections = d.sections;
        pushHistory();
        renderCanvas();
        return;
      }
      if (e.target.closest("[data-hide]")) {
        const id = e.target.closest("[data-hide]").dataset.hide;
        const s = sections.find((x) => x.id === id);
        const d = await api("toggle_section", { sections, section_id: id, visible: !!s?.hidden });
        sections = d.sections;
        pushHistory();
        renderCanvas();
        return;
      }
      if (e.target.closest("[data-del]")) {
        const id = e.target.closest("[data-del]").dataset.del;
        if (!confirm("Delete this section?")) return;
        const d = await api("delete_section", { sections, section_id: id, confirmed: true });
        sections = d.sections;
        pushHistory();
        renderCanvas();
        return;
      }
      if (e.target.closest("[data-image]")) {
        const id = e.target.closest("[data-image]").dataset.image;
        const url = prompt("Image URL (https or shop path):");
        if (!url) return;
        const alt = prompt("Alt text:") || "";
        const d = await api("edit_image", {
          sections,
          section_id: id,
          path: "image",
          media: { url, alt, source: "shop_upload", license: "shop_owned" }
        });
        sections = d.sections;
        pushHistory();
        renderCanvas();
        live("Image updated.");
      }
    });

    root.querySelector("#editorCanvas")?.addEventListener("dragstart", (e) => {
      const sec = e.target.closest(".editor-section");
      if (sec) e.dataTransfer.setData("text/plain", sec.dataset.id);
    });
    root.querySelector("#editorCanvas")?.addEventListener("dragover", (e) => e.preventDefault());
    root.querySelector("#editorCanvas")?.addEventListener("drop", async (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      const target = e.target.closest(".editor-section");
      if (!id || !target) return;
      const from = sections.findIndex((s) => s.id === id);
      const to = sections.findIndex((s) => s.id === target.dataset.id);
      if (from < 0 || to < 0) return;
      const d = await api("reorder_sections", { sections, from, to });
      sections = d.sections;
      pushHistory();
      renderCanvas();
      live("Section reordered.");
    });

    function syncTextEdits() {
      root.querySelectorAll(".editable[data-section]").forEach((el) => {
        const sid = el.dataset.section;
        const path = el.dataset.path || "title";
        const idx = sections.findIndex((s) => s.id === sid);
        if (idx < 0) return;
        sections[idx].props = sections[idx].props || {};
        sections[idx].props[path] = el.textContent.trim();
      });
      scheduleAutosave();
    }

    function pushHistory() {
      history.push({ sections: structuredClone(sections) });
    }

    function createHistory() {
      const stack = [];
      let pointer = -1;
      return {
        push(state) {
          stack.splice(pointer + 1);
          stack.push(state);
          pointer = stack.length - 1;
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
          this.push(state);
        }
      };
    }

    loadProject().catch((e) => {
      root.querySelector("#editorStatus").textContent = e.message;
      setBusy(false);
    });

    editorSelectPage = selectPage;
  }

  function load() {
    const page = document.getElementById("websitePage");
    if (page) mountEditor(page);
  }

  window.BloomWebsiteEditor = {
    load,
    mountEditor,
    selectPage: (slug) => editorSelectPage?.(slug)
  };
})();
