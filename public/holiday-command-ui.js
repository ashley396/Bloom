(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  let state = { loading: false, error: null, items: [], showForm: false };

  async function api(method, body) {
    const fn = window.bloomHolidayApi || window.api;
    if (!fn) throw new Error("Sign in required.");
    if (method === "GET") return fn("holiday-command");
    return fn("holiday-command", { method, body: JSON.stringify(body || {}) });
  }

  function root() {
    return document.getElementById("holidayRoot");
  }

  function toast(msg) {
    window.toast?.(msg);
  }

  function renderLoading(el) {
    el.innerHTML = `<div class="panel" role="status"><p class="subtle">Loading Holiday Command Center…</p></div>`;
  }

  function renderError(el, message) {
    el.innerHTML = `<div class="panel" role="alert"><h3>Something went wrong</h3><p class="subtle">${esc(message)}</p><button type="button" class="primary" id="holidayRetry">Try again</button></div>`;
    el.querySelector("#holidayRetry")?.addEventListener("click", () => load());
  }

  function capacityBadge(cap) {
    const level = cap?.level || "none";
    const label = cap?.message || "";
    return `<span class="badge ${level === "critical" || level === "paused" ? "warn" : ""}">${esc(label)}</span>`;
  }

  function formHtml() {
    return `<form id="holidayPeakForm" class="panel">
      <p class="eyebrow">NEW PEAK WINDOW</p>
      <div class="two">
        <label>Holiday / peak name<input name="name" required maxlength="120" placeholder="Valentine's Day"></label>
        <label>Status<select name="status"><option value="planning">Planning</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label>
      </div>
      <div class="two">
        <label>Starts<input name="starts_on" type="date" required></label>
        <label>Ends<input name="ends_on" type="date" required></label>
      </div>
      <div class="three">
        <label>Capacity target (orders)<input name="target_orders" type="number" min="0" step="1" value="50"></label>
        <label>Current orders<input name="current_orders" type="number" min="0" step="1" value="0"></label>
        <label>Alert at %<input name="alert_threshold" type="number" min="0" max="100" step="1" value="80"></label>
      </div>
      <label>Staff notes<textarea name="staff_notes" rows="2" maxlength="2000" placeholder="Cutoff times, designer coverage, delivery blackouts…"></textarea></label>
      <div class="card-actions"><button type="submit" class="primary">Add peak</button></div>
    </form>`;
  }

  function itemHtml(item) {
    const paused = item.is_paused || item.status === "paused";
    return `<article class="panel" data-holiday-id="${esc(item.id)}">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">${esc(String(item.status || "").toUpperCase())}</p>
          <h3>${esc(item.name)}</h3>
          <p class="subtle">${esc(item.starts_on)} → ${esc(item.ends_on)}</p>
        </div>
        ${capacityBadge(item.capacity)}
      </div>
      <p class="subtle">Orders ${esc(item.current_orders)} / ${esc(item.target_orders)} · Alert ${esc(item.alert_threshold)}%</p>
      ${item.staff_notes ? `<p>${esc(item.staff_notes)}</p>` : ""}
      <div class="card-actions">
        <button type="button" class="secondary" data-holiday-act="bump">+1 order</button>
        <button type="button" class="secondary" data-holiday-act="pause">${paused ? "Resume orders" : "Pause orders"}</button>
        <button type="button" class="secondary" data-holiday-act="delete">Remove</button>
      </div>
    </article>`;
  }

  function render() {
    const el = root();
    if (!el) return;
    if (state.loading) return renderLoading(el);
    if (state.error) return renderError(el, state.error);
    const list =
      state.items.length === 0
        ? `<div class="panel"><h3>No holiday peaks yet</h3><p class="subtle">Add Valentine’s, Mother’s Day, or local peak windows to track capacity and pause intake.</p></div>`
        : state.items.map(itemHtml).join("");
    el.innerHTML = `<div class="card-actions" style="margin-bottom:12px"><button type="button" class="primary" id="holidayShowFormBtn">+ Add new Holiday</button></div>${state.showForm ? formHtml() : ""}<div class="cards" id="holidayList">${list}</div>`;
    bind(el);
  }

  function bind(el) {
    el.querySelector("#holidayShowFormBtn")?.addEventListener("click", () => {
      state.showForm = true;
      render();
    });
    el.querySelector("#holidayPeakForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      body.target_orders = Number(body.target_orders || 0);
      body.current_orders = Number(body.current_orders || 0);
      body.alert_threshold = Number(body.alert_threshold || 80);
      try {
        await api("POST", body);
        toast("Holiday peak added.");
        state.showForm = false;
        await load();
      } catch (err) {
        toast(err.message || "Could not save peak.");
      }
    });
    el.querySelectorAll("[data-holiday-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest("[data-holiday-id]");
        const id = card?.getAttribute("data-holiday-id");
        const act = btn.getAttribute("data-holiday-act");
        const item = state.items.find((x) => x.id === id);
        if (!id || !item) return;
        try {
          if (act === "delete") {
            if (!confirm("Remove this holiday peak?")) return;
            await api("DELETE", { id });
            toast("Peak removed.");
          } else if (act === "pause") {
            const next = !(item.is_paused || item.status === "paused");
            // Only send is_paused — it's independent of status now.
            // Hardcoding status:"active"/"paused" here used to clobber a
            // peak's real status (e.g. "planning") on every pause/resume,
            // even for a peak that hadn't started yet.
            await api("PATCH", { id, is_paused: next });
            toast(next ? "Orders paused for this peak." : "Orders resumed.");
          } else if (act === "bump") {
            await api("PATCH", { id, current_orders: Number(item.current_orders || 0) + 1 });
          }
          await load();
        } catch (err) {
          toast(err.message || "Update failed.");
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
      const d = await api("GET");
      state.items = d.items || [];
      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      state.error = err.message || "Could not load Holiday Command Center.";
      render();
    }
  }

  window.BloomHolidayCommand = { load };
})();
