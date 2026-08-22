(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const STATUSES = [
    "inquiry",
    "proposal",
    "booked",
    "in_production",
    "delivered",
    "closed",
  ];

  let state = { loading: false, error: null, items: [] };

  async function api(payload, method = "POST") {
    const fn = window.bloomWeddingsApi || window.api;
    if (!fn) throw new Error("Sign in required.");
    if (method === "GET") return fn("weddings");
    return fn("weddings", { method: "POST", body: JSON.stringify(payload || {}) });
  }

  function root() {
    return document.getElementById("weddingsRoot");
  }

  function toast(msg) {
    window.toast?.(msg);
  }

  function money(cents) {
    const n = Number(cents || 0) / 100;
    return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
  }

  const INSPIRATION_MAX_BYTES = 8 * 1024 * 1024;

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read that image."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  function formHtml() {
    const opts = STATUSES.map((s) => `<option value="${esc(s)}">${esc(s.replace(/_/g, " "))}</option>`).join("");
    return `<form id="weddingForm" class="panel">
      <p class="eyebrow">NEW WEDDING PROJECT</p>
      <div class="two">
        <label>Couple names<input name="couple_names" required maxlength="160" placeholder="Alex & Jordan"></label>
        <label>Status<select name="status">${opts}</select></label>
      </div>
      <div class="two">
        <label>Event date<input name="event_date" type="date"></label>
        <label>Budget ($)<input name="budget_dollars" type="number" min="0" step="1" value="0"></label>
      </div>
      <label>Venue<input name="venue" maxlength="200" placeholder="Garden estate / church / hotel"></label>
      <label>Notes<textarea name="notes" rows="2" maxlength="4000" placeholder="Style, palette, ceremony / reception needs…"></textarea></label>
      <p class="subtle">Optional: link an existing customer or order id from your shop (does not create a duplicate order).</p>
      <div class="two">
        <label>Customer id <span class="label-optional">Optional</span><input name="customer_id" placeholder="uuid"></label>
        <label>Order id <span class="label-optional">Optional</span><input name="order_id" placeholder="uuid"></label>
      </div>
      <div class="card-actions"><button type="submit" class="primary">Add wedding</button></div>
    </form>`;
  }

  function checklistHtml(item) {
    const rows = (item.checklist || [])
      .map(
        (c) => `<label class="check"><input type="checkbox" data-check-id="${esc(c.id)}" ${c.is_done ? "checked" : ""}> ${esc(c.title)}</label>`
      )
      .join("");
    return `<div class="wedding-checklist" data-wedding-check="${esc(item.id)}">
      <p class="eyebrow">CHECKLIST</p>
      ${rows || `<p class="subtle">No checklist items yet.</p>`}
      <div class="two">
        <input data-check-title placeholder="Add checklist item" maxlength="200">
        <button type="button" class="secondary" data-wedding-act="add-check">Add</button>
      </div>
    </div>`;
  }

  function inspirationHtml(item) {
    const photos = item.inspiration_photos || [];
    const thumbs = photos
      .map(
        (p) => `<figure class="inspiration-thumb">
          <img src="${esc(p.url)}" alt="${esc(p.caption || "Wedding inspiration photo")}" loading="lazy">
          ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}
          <button type="button" class="inspiration-remove" data-inspiration-remove="${esc(p.id)}" aria-label="Remove photo">&times;</button>
        </figure>`
      )
      .join("");
    return `<div class="wedding-inspiration">
      <p class="eyebrow">INSPIRATION BOARD</p>
      <div class="inspiration-grid">
        ${thumbs || `<p class="subtle">No inspiration photos yet. Add a few to start the mood board.</p>`}
      </div>
      <div class="two">
        <input type="text" data-inspiration-caption placeholder="Optional caption" maxlength="300">
        <label class="secondary inspiration-upload-btn">
          Add photo
          <input type="file" accept="image/*" data-inspiration-file hidden>
        </label>
      </div>
    </div>`;
  }

  function itemHtml(item) {
    const statusOpts = STATUSES.map(
      (s) =>
        `<option value="${esc(s)}" ${s === item.status ? "selected" : ""}>${esc(s.replace(/_/g, " "))}</option>`
    ).join("");
    return `<article class="panel" data-wedding-id="${esc(item.id)}">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">WEDDING</p>
          <h3>${esc(item.couple_names)}</h3>
          <p class="subtle">${item.event_date ? esc(item.event_date) : "Date TBD"}${item.venue ? ` · ${esc(item.venue)}` : ""}</p>
        </div>
        <strong>${esc(money(item.budget_cents))}</strong>
      </div>
      ${item.notes ? `<p>${esc(item.notes)}</p>` : ""}
      <label>Status<select data-wedding-status>${statusOpts}</select></label>
      ${checklistHtml(item)}
      ${inspirationHtml(item)}
      <div class="card-actions">
        <button type="button" class="secondary" data-wedding-act="delete">Remove</button>
      </div>
    </article>`;
  }

  function render() {
    const el = root();
    if (!el) return;
    if (state.loading) {
      el.innerHTML = `<div class="panel" role="status"><p class="subtle">Loading Wedding Workflows…</p></div>`;
      return;
    }
    if (state.error) {
      el.innerHTML = `<div class="panel" role="alert"><h3>Something went wrong</h3><p class="subtle">${esc(state.error)}</p><button type="button" class="primary" id="weddingsRetry">Try again</button></div>`;
      el.querySelector("#weddingsRetry")?.addEventListener("click", () => load());
      return;
    }
    const list =
      state.items.length === 0
        ? `<div class="panel"><h3>No wedding projects yet</h3><p class="subtle">Track inquiries through delivery without replacing your Orders workflow.</p></div>`
        : state.items.map(itemHtml).join("");
    el.innerHTML = `${formHtml()}<div class="cards">${list}</div>`;
    bind(el);
  }

  function bind(el) {
    el.querySelector("#weddingForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      if (form.dataset.submitting === "1") return;
      form.dataset.submitting = "1";
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      const dollars = Number(body.budget_dollars || 0);
      body.budget_cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
      delete body.budget_dollars;
      if (!body.customer_id) delete body.customer_id;
      if (!body.order_id) delete body.order_id;
      if (!body.event_date) delete body.event_date;
      try {
        await api({ action: "create", ...body });
        toast("Wedding project added.");
        await load();
      } catch (err) {
        toast(err.message || "Could not save wedding.");
      } finally {
        form.dataset.submitting = "";
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    el.querySelectorAll("[data-wedding-status]").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const id = sel.closest("[data-wedding-id]")?.getAttribute("data-wedding-id");
        if (!id) return;
        try {
          await api({ action: "update", id, status: sel.value });
          toast("Status updated.");
          await load();
        } catch (err) {
          toast(err.message || "Status update failed.");
        }
      });
    });

    el.querySelectorAll("[data-check-id]").forEach((cb) => {
      cb.addEventListener("change", async () => {
        try {
          await api({ action: "toggle_checklist", id: cb.getAttribute("data-check-id"), is_done: cb.checked });
        } catch (err) {
          toast(err.message || "Checklist update failed.");
          await load();
        }
      });
    });

    el.querySelectorAll("[data-wedding-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest("[data-wedding-id]");
        const id = card?.getAttribute("data-wedding-id");
        const act = btn.getAttribute("data-wedding-act");
        if (!id) return;
        try {
          if (act === "delete") {
            if (!confirm("Remove this wedding project?")) return;
            await api({ action: "delete", id });
            toast("Wedding removed.");
            await load();
          } else if (act === "add-check") {
            const input = card.querySelector("[data-check-title]");
            const title = String(input?.value || "").trim();
            if (!title) return;
            await api({ action: "add_checklist", wedding_id: id, title });
            await load();
          }
        } catch (err) {
          toast(err.message || "Update failed.");
        }
      });
    });

    el.querySelectorAll("[data-inspiration-file]").forEach((input) => {
      input.addEventListener("change", async () => {
        const card = input.closest("[data-wedding-id]");
        const wedding_id = card?.getAttribute("data-wedding-id");
        const file = input.files && input.files[0];
        if (!wedding_id || !file) return;
        if (file.size > INSPIRATION_MAX_BYTES) {
          toast("That photo is too large. Please choose one under 8 MB.");
          input.value = "";
          return;
        }
        const captionInput = card.querySelector("[data-inspiration-caption]");
        const caption = String(captionInput?.value || "").trim();
        try {
          const data_url = await fileToDataUrl(file);
          await api({
            action: "add_inspiration_photo",
            wedding_id,
            data_url,
            filename: file.name,
            caption,
          });
          toast("Inspiration photo added.");
          await load();
        } catch (err) {
          toast(err.message || "Could not add that photo.");
        } finally {
          input.value = "";
        }
      });
    });

    el.querySelectorAll("[data-inspiration-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-inspiration-remove");
        if (!id) return;
        if (!confirm("Remove this inspiration photo?")) return;
        try {
          await api({ action: "remove_inspiration_photo", id });
          toast("Photo removed.");
          await load();
        } catch (err) {
          toast(err.message || "Could not remove that photo.");
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
      state.error = err.message || "Could not load Wedding Workflows.";
      render();
    }
  }

  window.BloomWeddings = { load };
})();
