/**
 * Marketing Command Center — the connective layer over Email Campaigns,
 * Holiday Command Center, and (later) social/text/promotion content, so a
 * florist plans one campaign instead of juggling separate tools.
 */
(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const STATUSES = ["draft", "ready", "scheduled", "active", "completed", "paused"];
  const CHANNELS = [
    { value: "email", label: "Email" },
    { value: "holiday", label: "Holiday peak" },
    { value: "website", label: "Website" },
    { value: "social", label: "Social" },
    { value: "text", label: "Text" },
  ];

  let state = {
    loading: false,
    error: null,
    items: [],
    tab: "overview",
    audiences: null,
    audiencesLoading: false,
    audiencesError: null,
    formPrefill: null,
    lilyDrafting: false,
    lilyDraft: null,
    lilyError: null,
  };

  async function api(payload, method = "POST") {
    const fn = window.bloomMarketingApi || window.api;
    if (!fn) throw new Error("Sign in required.");
    if (method === "GET") return fn("marketing-campaigns");
    return fn("marketing-campaigns", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  async function fetchAudiences() {
    const fn = window.bloomMarketingApi || window.api;
    if (!fn) throw new Error("Sign in required.");
    return fn("marketing-campaigns?action=audiences");
  }

  /**
   * Lily drafts a campaign concept from real-but-non-identifying shop
   * context: shop name/style, up to 8 real product names/categories
   * (never a customer record), and — if the florist already opened
   * Audiences this visit — real segment labels and counts. Never a raw
   * customer name, email, phone, or address; smartAi's own payload
   * scrubbing only strips media/base64, so keeping PII out of `input` is
   * this function's job, not the transport's.
   */
  async function draftCampaignWithLily(idea) {
    const gen = window.smartAi;
    if (typeof gen !== "function") throw new Error("Lily is unavailable right now.");
    const shop = window.shopSettings || {};
    const productList = (window.products || [])
      .slice(0, 8)
      .map((p) => ({ name: p.name, category: p.category, price: p.price }));
    const audienceList = (state.audiences?.segments || [])
      .filter((s) => s.count > 0)
      .map((s) => ({ label: s.label, count: s.count }));
    const d = await gen({
      mode: "generate",
      persona: "Lily",
      task: `Act as Lily, Florisyn's warm, capable marketing director for a local flower shop. Draft a real, specific campaign concept for: ${idea}. Use the shop's own products and real audience segments where relevant. Never use generic phrases like "elevate your special occasion" or "where beauty meets elegance" — be concrete about products, timing, and the shop's own voice.`,
      input: {
        shop: { name: shop.name || "", style: shop.website_style || "", tagline: shop.tagline || "", city: shop.city || "" },
        products: productList,
        audiences: audienceList,
      },
      schema: {
        message: "one sweet, specific sentence about the concept",
        name: "campaign name, e.g. Mother's Day 2027",
        goal: "one specific, concrete goal — not generic",
        audience_note: "who this should target, using the real audience labels above if any fit",
        channels: "array from: email, holiday, website, social, text — only the ones that make sense",
      },
    });
    const raw = d?.result ?? d;
    return {
      message: raw?.message || "Here's a draft — review it and adjust anything before creating the campaign.",
      name: raw?.name || "",
      goal: raw?.goal || "",
      audience_note: raw?.audience_note || "",
      channels: Array.isArray(raw?.channels) ? raw.channels.filter((c) => CHANNELS.some((x) => x.value === c)) : [],
    };
  }

  function root() {
    return document.getElementById("marketingRoot");
  }

  function toast(msg) {
    window.toast?.(msg);
  }

  function goToPage(pageId) {
    if (window.FlorisynRouter?.navigateToPage) window.FlorisynRouter.navigateToPage(pageId);
    else window.showPage?.(pageId);
  }

  function overviewHtml() {
    const active = state.items.filter((c) => c.status === "active").length;
    const scheduled = state.items.filter((c) => c.status === "scheduled").length;
    const draft = state.items.filter((c) => c.status === "draft" || c.status === "ready").length;
    return `<div class="cards marketing-overview-cards">
      <article class="panel"><p class="eyebrow">ACTIVE</p><h2>${active}</h2><p class="subtle">Campaigns running right now</p></article>
      <article class="panel"><p class="eyebrow">SCHEDULED</p><h2>${scheduled}</h2><p class="subtle">Waiting on their start date</p></article>
      <article class="panel"><p class="eyebrow">DRAFT / READY</p><h2>${draft}</h2><p class="subtle">Still being put together</p></article>
    </div>
    <div class="panel">
      <p class="eyebrow">CHANNELS</p>
      <h3>Draft and schedule content in its own workspace</h3>
      <p class="subtle">A campaign plans the "what" and "when" — the actual email, peak window, or website changes still happen in their real tool, now linked back to the campaign.</p>
      <div class="card-actions">
        <button type="button" class="secondary" data-marketing-goto="emailCampaignsPage">Email Campaigns</button>
        <button type="button" class="secondary" data-marketing-goto="holidayPage">Holiday Command Center</button>
        <button type="button" class="secondary" data-marketing-goto="weddingsPage">Wedding Workflows</button>
      </div>
    </div>
    ${
      state.items.length === 0
        ? `<div class="panel"><h3>No campaigns yet</h3><p class="subtle">Start with the Campaigns tab — name it, set dates and an audience, and connect the channels you'll use.</p></div>`
        : `<div class="cards">${state.items.slice(0, 5).map(campaignCardHtml).join("")}</div>`
    }`;
  }

  function formHtml() {
    const channelBoxes = CHANNELS.map(
      (c) => `<label class="check"><input type="checkbox" name="channels" value="${esc(c.value)}"> ${esc(c.label)}</label>`
    ).join("");
    return `<form id="marketingCampaignForm" class="panel">
      <p class="eyebrow">NEW CAMPAIGN</p>
      <div class="two">
        <label>Campaign name<input name="name" required maxlength="120" placeholder="Mother's Day 2027"></label>
        <label>Goal<input name="goal" maxlength="200" placeholder="Sell out Designer's Choice arrangements"></label>
      </div>
      <div class="two">
        <label>Starts<input name="starts_on" type="date"></label>
        <label>Ends<input name="ends_on" type="date"></label>
      </div>
      <label>Audience<input name="audience_note" maxlength="500" placeholder="Past Mother's Day buyers, VIP customers"></label>
      <label>Notes<textarea name="notes" rows="2" maxlength="4000" placeholder="Anything else worth remembering about this campaign…"></textarea></label>
      <fieldset class="marketing-channel-fieldset"><legend>Channels</legend>${channelBoxes}</fieldset>
      <div class="card-actions"><button type="submit" class="primary">Create campaign</button></div>
    </form>`;
  }

  function campaignCardHtml(item) {
    const nextStatus = { draft: "ready", ready: "scheduled", scheduled: "active", active: "completed" }[item.status];
    const channels = (item.channels || []).map((c) => CHANNELS.find((x) => x.value === c)?.label || c).join(", ");
    return `<article class="panel" data-campaign-id="${esc(item.id)}">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">${esc(String(item.status || "").toUpperCase())}</p>
          <h3>${esc(item.name)}</h3>
          ${item.goal ? `<p class="subtle">${esc(item.goal)}</p>` : ""}
        </div>
      </div>
      ${item.starts_on || item.ends_on ? `<p class="subtle">${esc(item.starts_on || "?")} → ${esc(item.ends_on || "?")}</p>` : ""}
      ${item.audience_note ? `<p class="subtle">Audience: ${esc(item.audience_note)}</p>` : ""}
      ${channels ? `<p class="subtle">Channels: ${esc(channels)}</p>` : ""}
      <div class="card-actions">
        ${nextStatus ? `<button type="button" class="secondary" data-campaign-act="advance" data-next="${esc(nextStatus)}">Mark ${esc(nextStatus)}</button>` : ""}
        ${item.status === "paused" ? `<button type="button" class="secondary" data-campaign-act="resume">Resume</button>` : item.status !== "completed" ? `<button type="button" class="secondary" data-campaign-act="pause">Pause</button>` : ""}
        <button type="button" class="secondary" data-campaign-act="delete">Delete</button>
      </div>
    </article>`;
  }

  function lilyDraftHtml() {
    if (state.lilyDrafting) {
      return `<div class="panel" role="status"><p class="subtle">Lily is drafting a concept…</p></div>`;
    }
    if (state.lilyError) {
      return `<div class="panel" role="alert"><p class="subtle">${esc(state.lilyError)}</p></div>`;
    }
    if (!state.lilyDraft) {
      return `<div class="panel">
        <p class="eyebrow">LILY, MARKETING DIRECTOR</p>
        <h3>Tell Lily what you're planning</h3>
        <p class="subtle">Lily drafts a name, goal, audience, and channels from your real products and audience segments — nothing is created until you review and apply it.</p>
        <div class="card-actions"><button type="button" class="primary" id="marketingAskLily">Draft with Lily</button></div>
      </div>`;
    }
    const d = state.lilyDraft;
    return `<div class="panel">
      <p class="eyebrow">LILY'S DRAFT — REVIEW BEFORE USING</p>
      <p>${esc(d.message)}</p>
      <p><strong>${esc(d.name || "(no name suggested)")}</strong></p>
      ${d.goal ? `<p class="subtle">Goal: ${esc(d.goal)}</p>` : ""}
      ${d.audience_note ? `<p class="subtle">Audience: ${esc(d.audience_note)}</p>` : ""}
      ${d.channels.length ? `<p class="subtle">Channels: ${esc(d.channels.map((c) => CHANNELS.find((x) => x.value === c)?.label || c).join(", "))}</p>` : ""}
      <div class="card-actions">
        <button type="button" class="primary" id="marketingApplyLily">Apply to form</button>
        <button type="button" class="secondary" id="marketingDismissLily">Discard</button>
      </div>
    </div>`;
  }

  function campaignsTabHtml() {
    const list =
      state.items.length === 0
        ? `<div class="panel"><h3>No campaigns yet</h3><p class="subtle">Create your first campaign below.</p></div>`
        : `<div class="cards">${state.items.map(campaignCardHtml).join("")}</div>`;
    return `${lilyDraftHtml()}${formHtml()}${list}`;
  }

  function audiencesTabHtml() {
    if (state.audiencesLoading) return `<div class="panel" role="status"><p class="subtle">Building audiences from your real customers and orders…</p></div>`;
    if (state.audiencesError) {
      return `<div class="panel" role="alert"><h3>Couldn't build audiences</h3><p class="subtle">${esc(state.audiencesError)}</p><button type="button" class="secondary" id="marketingAudiencesRetry">Try again</button></div>`;
    }
    if (!state.audiences) return "";
    const { subscriberCount, segments } = state.audiences;
    if (subscriberCount === 0) {
      return `<div class="panel"><h3>No marketing subscribers yet</h3><p class="subtle">Audiences are built only from customers who explicitly opted in to marketing under Customers. Nobody has opted in yet, so every segment here is empty by design — not a bug.</p></div>`;
    }
    return `<div class="panel"><p class="eyebrow">CONSENT</p><p class="subtle">${subscriberCount} customer${subscriberCount === 1 ? "" : "s"} opted in to marketing. Every segment below is built only from that list — nobody who hasn't opted in ever appears here.</p></div>
    <div class="cards">
      ${segments
        .map(
          (s) => `<article class="panel" data-audience-key="${esc(s.key)}">
            <p class="eyebrow">${esc(s.label.toUpperCase())}</p>
            <h2>${s.count}</h2>
            <div class="card-actions"><button type="button" class="secondary" data-audience-use="${esc(s.key)}" ${s.count === 0 ? "disabled" : ""}>Use for a campaign</button></div>
          </article>`
        )
        .join("")}
    </div>`;
  }

  function render() {
    const el = root();
    if (!el) return;
    if (state.loading) {
      el.innerHTML = `<div class="panel" role="status"><p class="subtle">Loading Marketing…</p></div>`;
      return;
    }
    if (state.error) {
      el.innerHTML = `<div class="panel" role="alert"><h3>Something went wrong</h3><p class="subtle">${esc(state.error)}</p><button type="button" class="primary" id="marketingRetry">Try again</button></div>`;
      el.querySelector("#marketingRetry")?.addEventListener("click", () => load());
      return;
    }
    el.innerHTML = `<div class="marketing-tabs" role="tablist" aria-label="Marketing sections">
      <button type="button" class="marketing-tab${state.tab === "overview" ? " active" : ""}" data-marketing-tab="overview" role="tab" aria-selected="${state.tab === "overview"}">Overview</button>
      <button type="button" class="marketing-tab${state.tab === "campaigns" ? " active" : ""}" data-marketing-tab="campaigns" role="tab" aria-selected="${state.tab === "campaigns"}">Campaigns</button>
      <button type="button" class="marketing-tab${state.tab === "audiences" ? " active" : ""}" data-marketing-tab="audiences" role="tab" aria-selected="${state.tab === "audiences"}">Audiences</button>
    </div>
    <div class="marketing-tab-panel">${state.tab === "campaigns" ? campaignsTabHtml() : state.tab === "audiences" ? audiencesTabHtml() : overviewHtml()}</div>`;
    bind(el);
    if (state.tab === "campaigns" && state.formPrefill) {
      const form = el.querySelector("#marketingCampaignForm");
      const p = state.formPrefill;
      if (form) {
        if (p.name) form.elements.name.value = p.name;
        if (p.goal) form.elements.goal.value = p.goal;
        if (p.audience_note) form.elements.audience_note.value = p.audience_note;
        if (p.channels) form.querySelectorAll('input[name="channels"]').forEach((cb) => { cb.checked = p.channels.includes(cb.value) });
      }
      state.formPrefill = null;
    }
  }

  async function loadAudiences() {
    state.audiencesLoading = true;
    state.audiencesError = null;
    render();
    try {
      const d = await fetchAudiences();
      state.audiences = { subscriberCount: d.subscriberCount || 0, segments: d.segments || [] };
      state.audiencesLoading = false;
      render();
    } catch (err) {
      state.audiencesLoading = false;
      state.audiencesError = err.message || "Could not build audiences.";
      render();
    }
  }

  function bind(el) {
    el.querySelectorAll("[data-marketing-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tab = btn.getAttribute("data-marketing-tab");
        render();
        // Lazy-load on first visit — a florist who never opens Audiences
        // never pays for the customers+orders query.
        if (state.tab === "audiences" && !state.audiences && !state.audiencesLoading) loadAudiences();
      });
    });
    el.querySelector("#marketingAudiencesRetry")?.addEventListener("click", () => loadAudiences());
    el.querySelectorAll("[data-audience-use]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-audience-use");
        const seg = state.audiences?.segments.find((s) => s.key === key);
        if (!seg) return;
        state.formPrefill = { audience_note: `${seg.label} (${seg.count})` };
        state.tab = "campaigns";
        render();
      });
    });
    el.querySelectorAll("[data-marketing-goto]").forEach((btn) => {
      btn.addEventListener("click", () => goToPage(btn.getAttribute("data-marketing-goto")));
    });
    el.querySelector("#marketingAskLily")?.addEventListener("click", async () => {
      const idea = prompt("What are we planning? (e.g. Mother's Day, wedding season, sympathy)", "");
      if (idea === null || !idea.trim()) return;
      state.lilyDrafting = true;
      state.lilyError = null;
      render();
      try {
        state.lilyDraft = await draftCampaignWithLily(idea.trim());
      } catch (err) {
        state.lilyError = err.message || "Lily couldn't draft that right now.";
      }
      state.lilyDrafting = false;
      render();
    });
    el.querySelector("#marketingDismissLily")?.addEventListener("click", () => {
      state.lilyDraft = null;
      state.lilyError = null;
      render();
    });
    el.querySelector("#marketingApplyLily")?.addEventListener("click", () => {
      // Fills the form only — the florist still has to hit "Create
      // campaign" themselves. Lily never creates or publishes anything.
      const d = state.lilyDraft;
      if (!d) return;
      state.formPrefill = { name: d.name, goal: d.goal, audience_note: d.audience_note, channels: d.channels };
      toast("Lily's draft filled in the form below — review it, then create the campaign.");
      state.lilyDraft = null;
      render();
    });
    el.querySelector("#marketingCampaignForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        name: fd.get("name"),
        goal: fd.get("goal"),
        starts_on: fd.get("starts_on"),
        ends_on: fd.get("ends_on"),
        audience_note: fd.get("audience_note"),
        notes: fd.get("notes"),
        channels: fd.getAll("channels"),
      };
      try {
        await api({ action: "create", ...body });
        toast("Campaign created.");
        await load();
        state.tab = "campaigns";
        render();
      } catch (err) {
        toast(err.message || "Could not create campaign.");
      }
    });
    el.querySelectorAll("[data-campaign-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-campaign-id]")?.getAttribute("data-campaign-id");
        const act = btn.getAttribute("data-campaign-act");
        if (!id) return;
        try {
          if (act === "delete") {
            if (!confirm("Delete this campaign? Content already drafted under it (emails, holiday peaks) stays put.")) return;
            await api({ action: "delete", id });
          } else if (act === "advance") {
            await api({ action: "update", id, status: btn.getAttribute("data-next") });
          } else if (act === "pause") {
            await api({ action: "update", id, status: "paused" });
          } else if (act === "resume") {
            await api({ action: "update", id, status: "active" });
          }
          await load();
        } catch (err) {
          toast(err.message || "Campaign update failed.");
        }
      });
    });
  }

  async function load() {
    const el = root();
    if (!el) return;
    state.loading = true;
    state.error = null;
    render();
    try {
      const d = await api(null, "GET");
      state.items = d.items || [];
      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      state.error = err.message || "Could not load Marketing.";
      render();
    }
  }

  window.BloomMarketingCampaigns = { load };
})();
