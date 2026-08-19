/**
 * Website Studio shell — organizes the five independent builder panels
 * (Lily quick start, Instant Website wizard, Theme gallery, Website Studio V2,
 * Website Editor) into one calm, tabbed surface instead of stacking all five
 * full panels on top of each other every time the page loads.
 *
 * Deliberately does NOT rewrite any of those five modules — it only moves
 * their already-mounted DOM nodes (by class name) into the right tab panel
 * after they mount, so none of their internal logic, listeners, or APIs
 * change. Safe, additive, reversible: delete this file and the five panels
 * go back to stacking exactly as before.
 */
(function () {
  const START_INTRO = `
    <div class="ws-shell-start-intro">
      <p class="eyebrow">WAYS TO START</p>
      <ol>
        <li><strong>Let Lily build it</strong> — answer a few questions, Lily drafts the whole site.</li>
        <li><button type="button" class="linklike" id="wsIntroTemplatesLink"><strong>Browse templates</strong></button> — pick a ready-made look, then customize it.</li>
        <li><button type="button" class="linklike" id="wsIntroBrandLink"><strong>Set your brand & header photo</strong></button> — shop name, colors, hero photo, and contact details.</li>
        <li><button type="button" class="linklike" id="wsIntroEditorLink"><strong>Build it yourself</strong></button> — start from a blank page in the Editor.</li>
      </ol>
    </div>`;

  const TABS = [
    { id: "start", label: "Get started" },
    { id: "brand", label: "Brand & photos" },
    { id: "editor", label: "Editor" },
    { id: "look", label: "Templates" }
  ];

  // Which already-mounted panel (by the class its own module gives it)
  // belongs in which tab. ".legacy-website-editor-shell" is the older,
  // still fully-functional standalone builder (brand info, hero photo
  // picker, shop details, save/preview) that predates this tab shell and
  // was never folded into it — it used to render unconditionally below
  // every tab, which is what made the page look like a jumbled mess of
  // two builders stacked on top of each other. Giving it its own tab
  // keeps it working exactly as-is while containing it properly.
  //
  // The "editor" tab is special-cased below (see buildEditorIde): it's
  // two separately-built, fully real, correctly-coordinated modules —
  // website-studio-v2.js (pages list + a read-only live-preview iframe +
  // SEO/domain settings) and website-editor-ui.js (the actual editable
  // section canvas + properties inspector), page-selection kept in sync
  // between them via window.BloomWebsiteEditor.selectPage(). Neither is
  // dead code. But both were simply stacked as two full-width cards, each
  // headed "VISUAL EDITOR", each with its own Desktop/Tablet/Mobile
  // toggle controlling a *different* thing (the preview iframe's width vs.
  // the editable canvas's width) — exactly the "jumbled" reading the
  // legacy-builder fix above already diagnosed once for the whole page.
  // buildEditorIde re-parents their pieces (still no logic changes) into
  // one Pages / Canvas / Properties+SEO layout instead of PLACEMENT.
  const PLACEMENT = {
    start: [".lily-wizard-shell", ".instant-wizard-shell"],
    brand: [".legacy-website-editor-shell"],
    look: [".theme-gallery-shell"]
  };

  async function api(action, extra = {}) {
    return window.api("instant-website", { method: "POST", body: JSON.stringify({ action, ...extra }) });
  }

  function buildShell(root) {
    if (root.querySelector(".ws-shell")) return root.querySelector(".ws-shell");
    const shell = document.createElement("div");
    shell.className = "ws-shell";
    shell.innerHTML = `
      <div class="ws-shell-tabs" role="tablist" aria-label="Website Studio">
        ${TABS.map(
          (t) => `<button type="button" class="ws-shell-tab" role="tab" id="wsTab-${t.id}" aria-controls="wsPanel-${t.id}" data-tab="${t.id}">${t.label}</button>`
        ).join("")}
      </div>
      ${TABS.map(
        (t) => `<div class="ws-shell-panel" id="wsPanel-${t.id}" data-panel="${t.id}" role="tabpanel" aria-labelledby="wsTab-${t.id}">${t.id === "start" ? START_INTRO : ""}</div>`
      ).join("")}
    `;
    root.insertBefore(shell, root.firstChild);
    // Wire the intro's "Browse templates" / "Build it yourself" links to
    // switch tabs, once — added because "I can't find the templates or how
    // to do it" was reported: templates lived under an unlabeled "Look &
    // feel" tab with no pointer to it from the first screen a florist sees.
    shell.querySelector("#wsIntroTemplatesLink")?.addEventListener("click", () => selectTab(shell, "look"));
    shell.querySelector("#wsIntroBrandLink")?.addEventListener("click", () => selectTab(shell, "brand"));
    shell.querySelector("#wsIntroEditorLink")?.addEventListener("click", () => selectTab(shell, "editor"));
    return shell;
  }

  function selectTab(shell, tabId) {
    TABS.forEach((t) => {
      const btn = shell.querySelector(`#wsTab-${t.id}`);
      const panel = shell.querySelector(`#wsPanel-${t.id}`);
      const active = t.id === tabId;
      if (btn) {
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
        btn.tabIndex = active ? 0 : -1;
      }
      if (panel) panel.hidden = !active;
    });
  }

  function wireTabs(shell) {
    if (shell.dataset.wired) return;
    shell.dataset.wired = "1";
    const tabsEl = shell.querySelector(".ws-shell-tabs");
    tabsEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (btn) selectTab(shell, btn.dataset.tab);
    });
    tabsEl.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const idx = TABS.findIndex((t) => shell.querySelector(`#wsTab-${t.id}`) === document.activeElement);
      if (idx < 0) return;
      const next = e.key === "ArrowRight" ? (idx + 1) % TABS.length : (idx - 1 + TABS.length) % TABS.length;
      const btn = shell.querySelector(`#wsTab-${TABS[next].id}`);
      btn?.focus();
      selectTab(shell, TABS[next].id);
    });
  }

  function reorganize(root, shell) {
    Object.entries(PLACEMENT).forEach(([tabId, selectors]) => {
      const panel = shell.querySelector(`#wsPanel-${tabId}`);
      if (!panel) return;
      selectors.forEach((sel) => {
        const node = root.querySelector(sel);
        // appendChild on an already-mounted node MOVES it (re-parents) —
        // this preserves its event listeners and internal state, it does
        // not clone or remount it.
        if (node && node.parentElement !== panel) panel.appendChild(node);
      });
    });
  }

  // Builds the "editor" tab's layout by re-parenting the two already-
  // mounted modules — same move-not-clone technique as reorganize() above.
  //
  // Important constraint that shaped this: website-studio-v2.js scopes
  // ALL of its own DOM lookups to its own `shell` (the .website-studio-v2
  // div it built) — e.g. shell.querySelector("#ws2SeoStatus"). Moving any
  // of its three child panels (.ws2-panel-pages/-canvas/-seo) OUT of that
  // div would silently break every one of its own event handlers for that
  // panel (querySelector scoped to `shell` stops finding a descendant
  // that's no longer inside it) — confirmed live: async loadProject()
  // failure crashed with "Cannot set properties of null" trying to reach
  // #ws2SeoStatus after an earlier draft of this function relocated it
  // out of v2's own shell. So v2's own pages | canvas | SEO grid stays
  // completely untouched here — only its "VISUAL EDITOR" eyebrow label
  // (on its read-only live-preview iframe column) is retexted to stop
  // reading as a second, competing editor.
  //
  // website-editor-ui.js's shell (the actual section canvas + toolbar +
  // properties inspector) has its own internal 2-column grid
  // (canvas | inspector) that needs real width to lay out — nesting it
  // inside v2's already-narrow middle grid column was tried and measured
  // live: the canvas track collapsed to ~96px (v2's own 3-column split
  // leaves little room, then the inspector's 240px floor eats most of
  // what's left), wrapping "Unpublished" as "Unpublis" / "hed". So it's
  // placed as its own full-width block below v2's bar instead — same
  // relative order as before this pass, just no longer double-labeled.
  function buildEditorIde(root, shell) {
    const panel = shell.querySelector("#wsPanel-editor");
    if (!panel) return;

    const v2 = root.querySelector(".website-studio-v2");
    const editorShell = root.querySelector(".website-editor-shell");
    if (v2 && v2.parentElement !== panel) panel.appendChild(v2);

    const canvasPanel = v2?.querySelector(".ws2-panel-canvas");
    if (canvasPanel) {
      const eyebrow = canvasPanel.querySelector("p.eyebrow");
      if (eyebrow && eyebrow.textContent.trim() === "VISUAL EDITOR") eyebrow.textContent = "READ-ONLY PREVIEW";
    }
    if (editorShell && editorShell.parentElement !== panel) panel.appendChild(editorShell);
  }

  async function pickDefaultTab(shell) {
    try {
      const d = await api("get_project");
      const hasContent = (d.pages || []).some((p) => (p.sections || []).length > 0);
      selectTab(shell, hasContent ? "editor" : "start");
    } catch {
      selectTab(shell, "start");
    }
  }

  async function load() {
    const root = document.getElementById("websitePage");
    if (!root) return;
    const shell = buildShell(root);
    wireTabs(shell);
    reorganize(root, shell);
    buildEditorIde(root, shell);
    if (!shell.dataset.tabPicked) {
      shell.dataset.tabPicked = "1";
      await pickDefaultTab(shell);
    }
  }

  window.BloomWebsiteStudioShell = { load, reorganize };
})();
