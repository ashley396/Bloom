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

  let state = { loading: false, error: null, items: [], tab: "overview" };

  async function api(payload, method = "POST") {
    const fn = window.bloomMarketingApi || window.api;
    if (!fn) throw new Error("Sign in required.");
    if (method === "GET") return fn("marketing-campaigns");
    return fn("marketing-campaigns", { method: "POST", body: JSON.stringify(payload || {}) });
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

  function campaignsTabHtml() {
    const list =
      state.items.length === 0
        ? `<div class="panel"><h3>No campaigns yet</h3><p class="subtle">Create your first campaign below.</p></div>`
        : `<div class="cards">${state.items.map(campaignCardHtml).join("")}</div>`;
    return `${formHtml()}${list}`;
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
    </div>
    <div class="marketing-tab-panel">${state.tab === "campaigns" ? campaignsTabHtml() : overviewHtml()}</div>`;
    bind(el);
  }

  function bind(el) {
    el.querySelectorAll("[data-marketing-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tab = btn.getAttribute("data-marketing-tab");
        render();
      });
    });
    el.querySelectorAll("[data-marketing-goto]").forEach((btn) => {
      btn.addEventListener("click", () => goToPage(btn.getAttribute("data-marketing-goto")));
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
