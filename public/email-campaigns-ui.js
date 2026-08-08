(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  let state = { loading: false, error: null, items: [], send_enabled: false };

  async function api(payload, method = "POST") {
    const fn = window.bloomEmailCampaignsApi || window.api;
    if (!fn) throw new Error("Sign in required.");
    if (method === "GET") return fn("email-campaigns");
    return fn("email-campaigns", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  function root() {
    return document.getElementById("emailCampaignsRoot");
  }

  function toast(msg) {
    window.toast?.(msg);
  }

  function formHtml() {
    return `<form id="emailCampaignForm" class="panel">
      <p class="eyebrow">NEW CAMPAIGN DRAFT</p>
      <div class="two">
        <label>Campaign name<input name="name" required maxlength="120" placeholder="Mother's Day reminder"></label>
        <label>Subject<input name="subject" required maxlength="200" placeholder="Order early for Mother's Day"></label>
      </div>
      <label>Preview text<input name="preview_text" maxlength="240" placeholder="Shown in inbox previews"></label>
      <label>Audience note<input name="audience_note" maxlength="500" placeholder="VIP customers who opted in to marketing"></label>
      <label>Email body<textarea name="body_html" rows="4" maxlength="20000" placeholder="Write the email copy…"></textarea></label>
      <p class="subtle">Send stays off until your email domain pipeline is enabled. You can draft and schedule now.</p>
      <div class="card-actions"><button type="submit" class="primary">Save draft</button></div>
    </form>`;
  }

  function itemHtml(item) {
    return `<article class="panel" data-campaign-id="${esc(item.id)}">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">${esc(String(item.status || "").toUpperCase())}</p>
          <h3>${esc(item.name)}</h3>
          <p class="subtle">${esc(item.subject)}</p>
        </div>
      </div>
      ${item.audience_note ? `<p class="subtle">Audience: ${esc(item.audience_note)}</p>` : ""}
      ${item.scheduled_at ? `<p class="subtle">Scheduled: ${esc(item.scheduled_at)}</p>` : ""}
      ${item.sent_at ? `<p class="subtle">Sent: ${esc(item.sent_at)}</p>` : ""}
      <div class="card-actions">
        ${item.status === "draft" || item.status === "scheduled" ? `<button type="button" class="secondary" data-campaign-act="schedule">Schedule</button>` : ""}
        ${item.status !== "sent" && item.status !== "cancelled" ? `<button type="button" class="secondary" data-campaign-act="cancel">Cancel</button>` : ""}
        ${state.send_enabled && (item.status === "draft" || item.status === "scheduled") ? `<button type="button" class="primary" data-campaign-act="send">Mark sent</button>` : ""}
        <button type="button" class="secondary" data-campaign-act="delete">Delete</button>
      </div>
    </article>`;
  }

  function render() {
    const el = root();
    if (!el) return;
    if (state.loading) {
      el.innerHTML = `<div class="panel" role="status"><p class="subtle">Loading Email Campaigns…</p></div>`;
      return;
    }
    if (state.error) {
      el.innerHTML = `<div class="panel" role="alert"><h3>Something went wrong</h3><p class="subtle">${esc(state.error)}</p><button type="button" class="primary" id="emailCampaignsRetry">Try again</button></div>`;
      el.querySelector("#emailCampaignsRetry")?.addEventListener("click", () => load());
      return;
    }
    const list =
      state.items.length === 0
        ? `<div class="panel"><h3>No campaigns yet</h3><p class="subtle">Create a draft for holiday promos or win-back notes. Marketing still requires customer opt-in.</p></div>`
        : state.items.map(itemHtml).join("");
    el.innerHTML = `${formHtml()}<div class="cards">${list}</div>`;
    bind(el);
  }

  function bind(el) {
    el.querySelector("#emailCampaignForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      try {
        await api({ action: "create", ...body });
        toast("Campaign draft saved.");
        await load();
      } catch (err) {
        toast(err.message || "Could not save campaign.");
      }
    });
    el.querySelectorAll("[data-campaign-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-campaign-id]")?.getAttribute("data-campaign-id");
        const act = btn.getAttribute("data-campaign-act");
        if (!id) return;
        try {
          if (act === "delete") {
            if (!confirm("Delete this campaign?")) return;
            await api({ action: "delete", id });
          } else if (act === "cancel") {
            await api({ action: "cancel", id });
          } else if (act === "schedule") {
            const when = prompt("Schedule time (ISO or leave blank for now)", new Date().toISOString());
            if (when === null) return;
            await api({ action: "schedule", id, scheduled_at: when || new Date().toISOString() });
          } else if (act === "send") {
            if (!confirm("Mark this campaign as sent? (local stub — no external email yet)")) return;
            await api({ action: "send", id });
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
      state.send_enabled = Boolean(d.send_enabled);
      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      state.error = err.message || "Could not load Email Campaigns.";
      render();
    }
  }

  window.BloomEmailCampaigns = { load };
})();
