/**
 * Marketing Studio — florist-facing panel (Phase 1C of the "Florist-Facing
 * Marketing Studio + Lily Connected Intelligence" pass).
 *
 * Talks to netlify/functions/marketing-studio-shop.js — the real,
 * session-scoped entry point (Phase 1A/1B/1D), never the super_admin-only
 * marketing-studio endpoint or admin.html's own panel. This file is
 * deliberately a small, purpose-built subset of marketing-studio-admin.js:
 * it only ever calls the exact 11 actions that entry point allowlists
 * (status/get_brand_brain/get_visual_style/connections/usage_summary/
 * list_content/create_content_item/generate_content/revise_content/
 * revert_content_revision/approve_content) — no manual shop-ID entry field,
 * no platform-connect/publish/schedule/budget-config UI, because a florist
 * can't reach those actions here at all. The florist's shop is resolved
 * entirely server-side from their session (Phase 1A) — this file never
 * constructs or forwards that identifier itself.
 *
 * Every response is rendered as-is, including "NOT LIVE — PROVIDER
 * CONNECTION REQUIRED" notes — this file never invents a success state
 * the backend didn't actually report.
 */
(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const PLATFORMS = ["facebook", "instagram", "tiktok", "linkedin", "pinterest", "google_business", "youtube"];
  const PLATFORM_LABELS = {
    facebook: "Facebook",
    instagram: "Instagram",
    tiktok: "TikTok",
    linkedin: "LinkedIn",
    pinterest: "Pinterest",
    google_business: "Google Business",
    youtube: "YouTube"
  };
  const STATUS_LABELS = {
    idea: "Idea",
    generating: "Generating…",
    draft: "Draft — ready for your review",
    in_review: "In review",
    approved: "Approved",
    archived: "Rejected"
  };

  let state = { loading: true, error: null, items: [], status: null, brand: null, style: null, usage: null, busyId: null };

  function root() {
    return document.getElementById("marketingStudioRoot");
  }

  function toast(msg) {
    window.toast?.(msg);
  }

  async function studioApi(action, extra = {}) {
    const fn = window.bloomMarketingStudioApi || window.api;
    if (!fn) throw new Error("Sign in required.");
    const method = extra.method || "POST";
    const path = `marketing-studio-shop?action=${encodeURIComponent(action)}`;
    if (method === "GET") return fn(path, { method: "GET" });
    return fn(path, { method: "POST", body: JSON.stringify({ action, ...extra.body }) });
  }

  // Phase 14 ("Explainability"): the backend already computes and persists
  // exactly which real inventory rows and which learned Brand Brain/My
  // Style traits shaped this content (grounded_in_inventory/
  // brand_traits_used/visual_traits_used on the asset) — it just never
  // reached this screen before, so a florist reviewing a draft had no way
  // to see WHY Lily wrote what she wrote. Only ever renders what the
  // backend actually reported using; an item grounded in nothing shows no
  // note at all, never a fabricated one.
  function groundingHtml(c) {
    const parts = [];
    const inv = Array.isArray(c.grounded_in_inventory) ? c.grounded_in_inventory : [];
    if (inv.length) {
      parts.push(`real inventory (${inv.map((i) => esc(i.name)).join(", ")})`);
    }
    const traits = [...(Array.isArray(c.brand_traits_used) ? c.brand_traits_used : []), ...(Array.isArray(c.visual_traits_used) ? c.visual_traits_used : [])];
    if (traits.length) {
      parts.push(`your learned style (${traits.map((t) => esc(t.text)).join(", ")})`);
    }
    if (!parts.length) return "";
    return `<p class="subtle marketing-studio-grounding">Grounded in: ${parts.join(" · ")}</p>`;
  }

  function itemPreviewHtml(item) {
    const asset = item.asset;
    if (!asset || !asset.content) return "";
    const c = asset.content;
    const imgUrl = asset.asset_type === "image" ? c.url : null;
    const captionText = c.caption || c.body || c.script || c.concept || "";
    return `
      ${imgUrl ? `<img src="${esc(imgUrl)}" alt="" class="lily-job-image" loading="lazy">` : ""}
      ${captionText ? `<p>${esc(captionText)}</p>` : ""}
      ${Array.isArray(c.hashtags) && c.hashtags.length ? `<p class="subtle">${c.hashtags.map((h) => `#${esc(String(h).replace(/^#/, ""))}`).join(" ")}</p>` : ""}
      ${groundingHtml(c)}
    `;
  }

  function itemHtml(item) {
    const busy = state.busyId === item.id;
    const canGenerate = item.status === "idea";
    const canReview = item.status === "draft" || item.status === "in_review";
    const canUndo = canReview && Boolean(item.asset?.parent_asset_id);
    const platforms = (item.variants || []).map((v) => PLATFORM_LABELS[v.platform] || v.platform).join(", ");
    return `<article class="panel" data-ms-item="${esc(item.id)}">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">${esc(STATUS_LABELS[item.status] || item.status)}</p>
          <h3>${esc(item.title)}</h3>
          ${platforms ? `<p class="subtle">${esc(platforms)}</p>` : ""}
        </div>
      </div>
      <p class="subtle">${esc(item.brief)}</p>
      ${itemPreviewHtml(item)}
      <div class="card-actions">
        ${canGenerate ? `<button type="button" class="primary" data-ms-act="generate" ${busy ? "disabled" : ""}>${busy ? "Working…" : "Ask Lily to create it"}</button>` : ""}
        ${canReview ? `<button type="button" class="secondary" data-ms-act="revise" ${busy ? "disabled" : ""}>Ask Lily to change something</button>` : ""}
        ${canUndo ? `<button type="button" class="secondary" data-ms-act="revert" ${busy ? "disabled" : ""}>Undo last change</button>` : ""}
        ${canReview ? `<button type="button" class="primary" data-ms-act="approve" ${busy ? "disabled" : ""}>Approve</button>` : ""}
        ${canReview ? `<button type="button" class="secondary" data-ms-act="reject" ${busy ? "disabled" : ""}>Reject</button>` : ""}
      </div>
    </article>`;
  }

  function createFormHtml() {
    return `<form id="msCreateItemForm" class="panel">
      <p class="eyebrow">NEW POST</p>
      <h3>Tell Lily what to make</h3>
      <p class="subtle">Describe the arrangement or offer — Lily writes the caption and creates the image from your own brief. Nothing goes out until you approve it.</p>
      <label>What should this post be about?<textarea name="brief" required maxlength="2000" placeholder="e.g. I have 40 roses I need to sell — a bright, romantic bouquet post for Facebook"></textarea></label>
      <fieldset class="marketing-channel-fieldset">
        <legend>Where should this go?</legend>
        ${PLATFORMS.map((p, i) => `<label class="check"><input type="checkbox" name="platforms" value="${p}" ${i === 0 ? "checked" : ""}> ${esc(PLATFORM_LABELS[p])}</label>`).join("")}
      </fieldset>
      <div class="card-actions"><button type="submit" class="primary">Create draft</button></div>
    </form>`;
  }

  function statusNoteHtml() {
    if (!state.status) return "";
    return `<div class="panel" role="status"><p class="subtle">${esc(state.status.note || "")}</p></div>`;
  }

  function knownStyleHtml() {
    const brandSummary = state.brand?.summary;
    const styleSummary = state.style?.summary;
    if (!brandSummary && !styleSummary) return "";
    return `<div class="panel">
      <p class="eyebrow">WHAT LILY KNOWS ABOUT YOUR SHOP</p>
      ${brandSummary ? `<p class="subtle"><strong>Voice:</strong> ${esc(brandSummary)}</p>` : ""}
      ${styleSummary ? `<p class="subtle"><strong>Style:</strong> ${esc(styleSummary)}</p>` : ""}
    </div>`;
  }

  function budgetHtml() {
    const u = state.usage;
    if (!u || u.monthly_budget_cap_cents == null) return "";
    const cap = (u.monthly_budget_cap_cents / 100).toFixed(2);
    const remaining = u.monthly_remaining_cents != null ? (u.monthly_remaining_cents / 100).toFixed(2) : null;
    return `<div class="panel"><p class="eyebrow">MONTHLY AI BUDGET</p><p>$${remaining ?? "—"} remaining of a $${cap} monthly cap.</p></div>`;
  }

  function render() {
    const el = root();
    if (!el) return;
    if (state.loading) {
      el.innerHTML = `<div class="panel" role="status"><p class="subtle">Loading Marketing Studio…</p></div>`;
      return;
    }
    if (state.error) {
      el.innerHTML = `<div class="panel" role="alert"><h3>Something went wrong</h3><p class="subtle">${esc(state.error)}</p><button type="button" class="primary" id="msRetry">Try again</button></div>`;
      el.querySelector("#msRetry")?.addEventListener("click", () => load());
      return;
    }
    const list =
      state.items.length === 0
        ? `<div class="panel"><h3>No posts yet</h3><p class="subtle">Tell Lily what's in your shop and she'll draft the first one below.</p></div>`
        : state.items.map(itemHtml).join("");
    el.innerHTML = `${statusNoteHtml()}${knownStyleHtml()}${budgetHtml()}${createFormHtml()}<div class="cards">${list}</div>`;
    bind(el);
  }

  function bind(el) {
    el.querySelector("#msCreateItemForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      if (form.dataset.submitting === "1") return;
      form.dataset.submitting = "1";
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const fd = new FormData(form);
        const brief = String(fd.get("brief") || "").trim();
        const platforms = fd.getAll("platforms");
        if (!brief) {
          toast("Describe what you'd like Lily to create.");
          return;
        }
        await studioApi("create_content_item", { body: { brief, platforms } });
        toast("Draft created.");
        await load();
      } catch (err) {
        toast(err.message || "Could not create that post.");
      } finally {
        form.dataset.submitting = "";
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    el.querySelectorAll("[data-ms-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-ms-item]")?.getAttribute("data-ms-item");
        const act = btn.getAttribute("data-ms-act");
        if (!id || state.busyId) return;
        try {
          if (act === "generate") {
            state.busyId = id;
            render();
            await studioApi("generate_content", { body: { content_item_id: id } });
          } else if (act === "revise") {
            const instruction = prompt("What should Lily change?");
            if (!instruction || !instruction.trim()) return;
            state.busyId = id;
            render();
            await studioApi("revise_content", { body: { content_item_id: id, instruction: instruction.trim() } });
          } else if (act === "revert") {
            if (!confirm("Undo the last change and go back to the previous version?")) return;
            state.busyId = id;
            render();
            await studioApi("revert_content_revision", { body: { content_item_id: id } });
          } else if (act === "approve") {
            if (!confirm("Approve this post? Publishing itself still requires a connected platform.")) return;
            state.busyId = id;
            render();
            await studioApi("approve_content", { body: { content_item_id: id, decision: "approved" } });
          } else if (act === "reject") {
            if (!confirm("Reject this post?")) return;
            state.busyId = id;
            render();
            await studioApi("approve_content", { body: { content_item_id: id, decision: "rejected" } });
          }
          await load();
        } catch (err) {
          toast(err.message || "That didn't work.");
          state.busyId = null;
          render();
        }
      });
    });
  }

  async function load() {
    const el = root();
    if (!el) return;
    state.loading = true;
    state.error = null;
    state.busyId = null;
    render();
    try {
      const [status, brand, style, usage, content] = await Promise.all([
        studioApi("status", { method: "GET" }),
        studioApi("get_brand_brain", { method: "GET" }).catch(() => null),
        studioApi("get_visual_style", { method: "GET" }).catch(() => null),
        studioApi("usage_summary", { method: "GET" }).catch(() => null),
        studioApi("list_content", { method: "GET" })
      ]);
      state.status = status;
      state.brand = brand;
      state.style = style;
      state.usage = usage;
      state.items = content.items || [];
      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      state.error = err.message || "Could not load Marketing Studio.";
      render();
    }
  }

  window.BloomMarketingStudio = { load };
})();
