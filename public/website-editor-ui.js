(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

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
          <button type="button" class="secondary" id="editorUndo">Undo</button>
          <button type="button" class="secondary" id="editorRedo">Redo</button>
          <button type="button" class="secondary" id="editorSave">Save draft</button>
          <button type="button" class="secondary" id="editorPreviewDesktop">Desktop</button>
          <button type="button" class="secondary" id="editorPreviewTablet">Tablet</button>
          <button type="button" class="secondary" id="editorPreviewMobile">Mobile</button>
          <button type="button" class="primary" id="editorPublish">Publish (approved)</button>
        </div>
        <div id="editorCanvas" class="editor-canvas" data-preview="desktop"></div>
        <p id="editorStatus" class="subtle" aria-live="polite"></p>
      </div>`
    );

    const history = createHistory();
    let project = null;
    let homePage = null;
    let sections = [];

    async function loadProject() {
      const d = await api("get_project");
      project = d.project;
      homePage = (d.pages || []).find((p) => p.slug === "home") || { slug: "home", title: "Home", sections: [] };
      sections = [...(homePage.sections || [])].sort((a, b) => a.order - b.order);
      history.reset({ sections });
      renderCanvas();
    }

    function renderCanvas() {
      const canvas = root.querySelector("#editorCanvas");
      canvas.innerHTML = sections
        .map(
          (s, idx) => `<article class="editor-section" data-id="${esc(s.id)}" draggable="true">
            <div class="editor-section-tools">
              <button type="button" class="secondary" data-move="up" data-id="${esc(s.id)}" aria-label="Move section up">↑</button>
              <button type="button" class="secondary" data-move="down" data-id="${esc(s.id)}" aria-label="Move section down">↓</button>
              <button type="button" class="secondary" data-dup="${esc(s.id)}">Duplicate</button>
              <button type="button" class="secondary" data-hide="${esc(s.id)}">${s.hidden ? "Show" : "Hide"}</button>
              <button type="button" class="secondary" data-del="${esc(s.id)}">Delete</button>
            </div>
            <span class="subtle">${esc(s.type)} · #${idx + 1}</span>
            <div class="editable" contenteditable="true" data-section="${esc(s.id)}" data-path="title">${esc(s.props?.title || s.props?.text || "Click to edit text")}</div>
            <button type="button" class="secondary" data-image="${esc(s.id)}">Replace image</button>
          </article>`
        )
        .join("");
    }

    root.querySelector("#editorSave")?.addEventListener("click", async () => {
      syncTextEdits();
      await api("save_page", { page: { ...homePage, sections } });
      live("Draft saved.");
      root.querySelector("#editorStatus").textContent = "Draft saved.";
    });

    root.querySelector("#editorPublish")?.addEventListener("click", async () => {
      syncTextEdits();
      await api("save_page", { page: { ...homePage, sections } });
      try {
        await api("publish", { approved: true, saved: true, lily_draft: false });
        live("Site published.");
        window.toast?.("Website published");
      } catch (e) {
        root.querySelector("#editorStatus").textContent = e.message;
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

    ["Desktop", "Tablet", "Mobile"].forEach((mode) => {
      root.querySelector(`#editorPreview${mode}`)?.addEventListener("click", () => {
        root.querySelector("#editorCanvas").dataset.preview = mode.toLowerCase();
        root.querySelector("#editorCanvas").style.maxWidth = mode === "Mobile" ? "390px" : mode === "Tablet" ? "768px" : "100%";
        live(`${mode} preview.`);
      });
    });

    root.querySelector("#editorCanvas")?.addEventListener("click", async (e) => {
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
    });
  }

  function load() {
    const page = document.getElementById("websitePage");
    if (page) mountEditor(page);
  }

  window.BloomWebsiteEditor = { load, mountEditor };
})();
