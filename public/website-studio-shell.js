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
  const TABS = [
    { id: "start", label: "Get started" },
    { id: "editor", label: "Editor" },
    { id: "look", label: "Look & feel" }
  ];

  // Which already-mounted panel (by the class its own module gives it)
  // belongs in which tab.
  const PLACEMENT = {
    start: [".lily-wizard-shell", ".instant-wizard-shell"],
    editor: [".website-studio-v2", ".website-editor-shell"],
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
        (t) => `<div class="ws-shell-panel" id="wsPanel-${t.id}" data-panel="${t.id}" role="tabpanel" aria-labelledby="wsTab-${t.id}"></div>`
      ).join("")}
    `;
    root.insertBefore(shell, root.firstChild);
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
    if (!shell.dataset.tabPicked) {
      shell.dataset.tabPicked = "1";
      await pickDefaultTab(shell);
    }
  }

  window.BloomWebsiteStudioShell = { load, reorganize };
})();
