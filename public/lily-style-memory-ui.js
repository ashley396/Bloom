/**
 * "My Style" — Settings → AI & Assistants panel for what Lily has learned
 * about this shop's visual style. A thin UI over ai-style-memory.js's
 * server actions (get/update/forget/reset) — see that file's docstring
 * for the learning rules this only displays and edits.
 *
 * Deliberately NOT a settings form the florist has to fill out up front —
 * every category starts empty and fills in from real conversation and
 * approved creations. This panel exists so there's a simple place to
 * review and correct what Lily picked up, per the shop-style-memory rule:
 * "Do not make the florist configure dozens of style settings manually."
 */
(function () {
  "use strict";

  // Presentational labels only — the server (ai-style-memory.js's
  // STYLE_CATEGORIES) is the source of truth for which categories exist;
  // this map just makes their keys read naturally. An unrecognized
  // category from the server still renders (falls back to its raw key
  // title-cased) rather than silently disappearing.
  const CATEGORY_LABELS = {
    background_style: "Background style",
    materials: "Materials & surfaces",
    lighting: "Lighting",
    colors: "Colors",
    mood: "Mood",
    typography: "Typography",
    flyer_style: "Flyer style",
    product_photo_style: "Product photo style",
    social_post_style: "Social post style",
    floral_decoration_level: "Floral decoration level",
    realism_level: "Realism level",
    general_avoid: "Always avoid"
  };
  const CATEGORY_ORDER = [
    "product_photo_style",
    "background_style",
    "materials",
    "lighting",
    "realism_level",
    "flyer_style",
    "typography",
    "floral_decoration_level",
    "social_post_style",
    "colors",
    "mood",
    "general_avoid"
  ];

  let ctx = { api: null, toast: null };
  let state = null; // last-loaded {categories, summary}

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  }

  async function callApi(body) {
    const fn = ctx.api || window.api;
    if (!fn) throw new Error("Florisyn isn't ready yet — try again in a moment.");
    return fn("ai-style-memory", { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined });
  }

  // Falls back to the app's own global toast() (a plain top-level function
  // in app.js, so it attaches to window automatically) so this panel works
  // whether or not init({toast}) was ever explicitly called.
  function notify(message) {
    (ctx.toast || window.toast)?.(message);
  }

  function categoryCard(category, group) {
    const active = group?.active || [];
    const learning = group?.learning || [];
    const label = CATEGORY_LABELS[category] || category.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase());
    const chips = active.length
      ? active
          .map(
            (t) =>
              `<span class="lily-style-chip${t.polarity === "negative" ? " lily-style-chip-negative" : ""}">${t.polarity === "negative" ? "🚫 " : ""}${esc(t.text)}<button type="button" class="lily-style-forget" data-category="${esc(category)}" data-text="${esc(t.text)}" title="Forget this preference">×</button></span>`
          )
          .join("")
      : `<span class="lily-style-empty">Nothing learned yet</span>`;
    const learningNote = learning.length
      ? `<p class="lily-style-learning">Still learning: ${learning.map((t) => esc(t.text)).join(", ")} — needs a few more approved creations before it becomes part of your style.</p>`
      : "";
    return `<div class="lily-style-card">
      <strong>${esc(label)}</strong>
      <div class="lily-style-chips">${chips}</div>
      ${learningNote}
    </div>`;
  }

  function render(root) {
    const host = root.querySelector("#lilyStyleMemoryHost") || root;
    if (!state) {
      host.innerHTML = `<p class="subtle">Loading your style…</p>`;
      return;
    }
    const cards = CATEGORY_ORDER.filter((c) => state.categories[c]).map((c) => categoryCard(c, state.categories[c])).join("");
    const extra = Object.keys(state.categories)
      .filter((c) => !CATEGORY_ORDER.includes(c))
      .map((c) => categoryCard(c, state.categories[c]))
      .join("");
    host.innerHTML = `
      <div class="lily-style-intro">
        <p class="eyebrow">LILY LEARNS YOUR STYLE</p>
        <h2>My Style</h2>
        <p class="subtle">Lily picks this up naturally — from what you tell her ("I like soft luxury backgrounds") and from the creations you save. Nothing here is required; review or correct it anytime.</p>
      </div>
      ${state.summary ? `<div class="lily-style-summary"><strong>What Lily currently uses:</strong> ${esc(state.summary)}</div>` : `<p class="subtle">Lily hasn't learned a style for your shop yet — chat with her about a few creations and it'll show up here.</p>`}
      <div class="lily-style-grid">${cards}${extra}</div>
      <div class="lily-style-add panel-inset">
        <strong>Tell Lily a preference</strong>
        <div class="two">
          <label>Category
            <select id="lilyStyleAddCategory">${CATEGORY_ORDER.map((c) => `<option value="${esc(c)}">${esc(CATEGORY_LABELS[c] || c)}</option>`).join("")}</select>
          </label>
          <label>Like or avoid
            <select id="lilyStyleAddPolarity"><option value="positive">I like this</option><option value="negative">Avoid this</option></select>
          </label>
        </div>
        <label>Describe it<input type="text" id="lilyStyleAddText" placeholder="e.g. soft luxury backgrounds, cream and blush colors"></label>
        <div class="card-actions">
          <button type="button" class="secondary" id="lilyStyleAddBtn">Add</button>
        </div>
      </div>
      <div class="card-actions">
        <button type="button" class="secondary" id="lilyStyleReset">Reset style</button>
      </div>`;

    host.querySelectorAll(".lily-style-forget").forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          state = await callApi({ action: "forget", category: btn.dataset.category, text: btn.dataset.text });
          render(root);
          notify("Forgot that preference.");
        } catch (err) {
          notify(err?.message || "Couldn't update that just now.");
          btn.disabled = false;
        }
      };
    });

    const addBtn = host.querySelector("#lilyStyleAddBtn");
    if (addBtn) {
      addBtn.onclick = async () => {
        const category = host.querySelector("#lilyStyleAddCategory").value;
        const polarity = host.querySelector("#lilyStyleAddPolarity").value;
        const textInput = host.querySelector("#lilyStyleAddText");
        const text = textInput.value.trim();
        if (!text) {
          notify("Describe the preference first.");
          return;
        }
        addBtn.disabled = true;
        try {
          state = await callApi({ action: "update", updates: [{ category, text, polarity }] });
          render(root);
          notify("Got it — saved to your style.");
        } catch (err) {
          notify(err?.message || "Couldn't save that just now.");
        } finally {
          addBtn.disabled = false;
        }
      };
    }

    const resetBtn = host.querySelector("#lilyStyleReset");
    if (resetBtn) {
      resetBtn.onclick = async () => {
        if (!window.confirm("Reset everything Lily has learned about your shop's style? This can't be undone.")) return;
        resetBtn.disabled = true;
        try {
          state = await callApi({ action: "reset" });
          render(root);
          notify("Style reset — Lily will start learning again from here.");
        } catch (err) {
          notify(err?.message || "Couldn't reset just now.");
        } finally {
          resetBtn.disabled = false;
        }
      };
    }
  }

  async function mountSettings(root) {
    if (!root) return;
    const host = root.querySelector("#lilyStyleMemoryHost");
    if (!host) return;
    render(root);
    try {
      state = await callApi(null);
      render(root);
    } catch {
      host.innerHTML = `<p class="subtle">Couldn't load your style right now — try again in a moment.</p>`;
    }
  }

  function init(options) {
    ctx = { api: null, toast: null, ...options };
  }

  window.BloomLilyStyleMemory = { init, mountSettings };
})();
