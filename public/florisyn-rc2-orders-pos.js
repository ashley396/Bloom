/**
 * Florisyn RC2 Phase 2 — Orders & POS Luxury Experience
 * UI-only enhancement: views, stationery cards, quick actions, drag-drop, POS preview.
 * Delegates to existing app.js handlers and APIs — no business logic changes.
 */
(function () {
  const STORAGE_VIEW = "florisyn_rc2_orders_view";
  const STORAGE_GROUP = "florisyn_rc2_orders_group";

  const COLUMN_TARGET_STATUS = {
    PENDING: "CONFIRMED",
    DESIGNING: "DESIGNING",
    READY: "READY",
    OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
    DELIVERED: "DELIVERED",
    COMPLETED: "COMPLETED",
    ON_HOLD: "ON_HOLD",
    ISSUE: "ISSUE",
    CANCELLED: "CANCELLED",
  };

  const ACTIVE_STATUSES = new Set([
    "NEW",
    "PENDING",
    "CONFIRMED",
    "DESIGNING",
    "READY",
    "PICKUP_READY",
    "OUT_FOR_DELIVERY",
  ]);

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const money = (n) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(n || 0));

  let state = {
    view: localStorage.getItem(STORAGE_VIEW) || "kanban",
    group: localStorage.getItem(STORAGE_GROUP) || "all",
    calendarMonth: new Date(),
    initialized: false,
    boardObserver: null,
    cartObserver: null,
  };

  function getOrders() {
    return Array.isArray(window.orders) ? window.orders : [];
  }

  function findOrder(id) {
    return getOrders().find((o) => o.id === id) || null;
  }

  function payView(o) {
    const total = Math.max(0, Number(o?.total || 0));
    const paid = Math.max(0, Number(o?.amount_paid || 0));
    let balance = o?.balance_due;
    if (balance == null) balance = Math.max(0, Math.round((total - paid) * 100) / 100);
    else balance = Math.max(0, Number(balance));
    let status = String(o?.payment_status || "UNPAID").trim().toUpperCase();
    if (status !== "REFUNDED") {
      if (balance <= 0 && total > 0 && paid >= total - 0.005) status = "PAID";
      else if (paid > 0 && balance > 0.005) status = "PARTIAL";
      else if (paid <= 0) status = "UNPAID";
    }
    return { total, paid, balance, status };
  }

  function isLate(o) {
    if (!o?.delivery_date) return false;
    const due = new Date(String(o.delivery_date).slice(0, 10));
    if (Number.isNaN(due.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    const status = String(o.status || "").toUpperCase();
    if (["DELIVERED", "COMPLETED", "CANCELLED"].includes(status)) return false;
    return due < today;
  }

  function isOverdue(o) {
    return isLate(o) && payView(o).status !== "PAID";
  }

  function timeBucket(o) {
    const w = String(o.delivery_window || o.delivery_time || "").toLowerCase();
    if (/morning|am\b|before\s*12|10|11/.test(w)) return "morning";
    if (/evening|pm\b|after\s*5|6|7|8/.test(w)) return "evening";
    if (/afternoon|12|1|2|3|4/.test(w)) return "afternoon";
    const h = new Date().getHours();
    if (h < 12) return "morning";
    if (h < 17) return "afternoon";
    return "evening";
  }

  function matchesGroup(o, group) {
    if (!group || group === "all") return true;
    const occ = String(o.occasion || "").toLowerCase();
    const notes = String(o.notes || "").toLowerCase();
    const priority = String(o.priority || "").toUpperCase();
    if (group === "morning" || group === "afternoon" || group === "evening") {
      return timeBucket(o) === group;
    }
    if (group === "rush") return priority === "RUSH" || priority === "VIP";
    if (group === "wedding") return /wedding/.test(occ);
    if (group === "funeral") return /funeral|sympathy/.test(occ);
    if (group === "standing") return /standing|weekly|recurring/.test(notes + " " + occ);
    if (group === "business") {
      return String(o.customer_type || "").toUpperCase() === "BUSINESS" || /business|corporate|account/.test(notes);
    }
    return true;
  }

  function filteredOrders() {
    return getOrders().filter((o) => matchesGroup(o, state.group));
  }

  function statusLabel(raw) {
    const s = String(raw || "PENDING").toUpperCase();
    const map = {
      NEW: "Pending",
      PENDING: "Pending",
      CONFIRMED: "Confirmed",
      DESIGNING: "Designing",
      READY: "Ready",
      PICKUP_READY: "Ready",
      OUT_FOR_DELIVERY: "Out",
      DELIVERED: "Delivered",
      COMPLETED: "Done",
      ON_HOLD: "Hold",
      ISSUE: "Issue",
      CANCELLED: "Cancelled",
    };
    return map[s] || s;
  }

  function fulfillmentLabel(o) {
    const f = String(o.fulfillment || "PICKUP").toUpperCase();
    return f === "DELIVERY" ? "Delivery" : "Pickup";
  }

  function thumbHtml(o) {
    const url = o.image_url || o.product_image || "";
    if (url) return `<img src="${esc(url)}" alt="" loading="lazy">`;
    return `<span class="rc2-card-thumb-placeholder" aria-hidden="true">✿</span>`;
  }

  function noteSnippet(o) {
    const n = o.notes || o.card_message || o.delivery_instructions || "";
    if (!n) return "";
    const t = String(n).trim();
    return t.length > 90 ? `${t.slice(0, 87)}…` : t;
  }

  function triggerClick(selector, root) {
    const el = (root || document).querySelector(selector);
    if (el) {
      el.click();
      return true;
    }
    return false;
  }

  async function patchOrderStatus(id, status) {
    if (!window.api) return;
    const card = document.querySelector(`[data-order-card="${CSS.escape(id)}"]`);
    card?.classList.add("is-moving");
    try {
      const result = await window.api("orders", {
        method: "PATCH",
        body: JSON.stringify({ id, status }),
      });
      if (Array.isArray(window.orders)) {
        const updated = result.item || {};
        window.orders = window.orders.map((o) =>
          o.id === id ? { ...o, ...updated, status: updated.status || status } : o,
        );
      }
      await window.loadOrders?.();
    } catch (e) {
      card?.classList.remove("is-moving");
      window.toast?.(e?.message || "Could not update order");
    }
  }

  async function duplicateOrder(o) {
    if (!window.api || !o) return;
    try {
      const payload = {
        customer_name: o.customer_name,
        customer_phone: o.customer_phone || "",
        customer_type: o.customer_type || "PERSONAL",
        payment_required: o.payment_required || "YES",
        recipient_name: o.recipient_name || o.customer_name,
        occasion: o.occasion || "",
        order_source: o.order_source || "Phone",
        arrangement_description: o.arrangement_description || "",
        notes: o.notes ? `Copy of ${o.order_number || "order"}. ${o.notes}` : `Copy of ${o.order_number || "order"}`,
        fulfillment: o.fulfillment || "PICKUP",
        delivery_date: new Date().toISOString().slice(0, 10),
        delivery_window: o.delivery_window || "",
        delivery_address: o.delivery_address || "",
        subtotal: Number(o.subtotal || 0),
        labor_charge: Number(o.labor_charge || 0),
        delivery_fee: Number(o.delivery_fee || 0),
        discount: Number(o.discount || 0),
        tax_rate: Number(o.tax_rate || 6),
        tax: Number(o.tax || 0),
        estimated_cost: Number(o.estimated_cost || 0),
        payment_status: "UNPAID",
        payment_method: null,
        amount_paid: 0,
        total_preview: Number(o.total || 0),
        designer: o.designer || "",
        priority: o.priority || "NORMAL",
      };
      await window.api("orders", { method: "POST", body: JSON.stringify(payload) });
      window.toast?.("Order duplicated");
      await window.loadOrders?.();
    } catch (e) {
      window.toast?.(e?.message || "Could not duplicate order");
    }
  }

  function buildQuickActions(o) {
    const phone = o.customer_phone || "";
    const id = o.id;
    const status = String(o.status || "").toUpperCase();
    const actions = [
      { label: "Edit", action: "edit" },
      { label: "Duplicate", action: "duplicate" },
      { label: "Print card", action: "card" },
      { label: "Print invoice", action: "invoice" },
    ];
    if (phone) {
      actions.push({ label: "Call", action: "call" });
      actions.push({ label: "Message", action: "message" });
    }
    actions.push({ label: "Assign designer", action: "assign" });
    if (!["READY", "PICKUP_READY", "DELIVERED", "COMPLETED"].includes(status)) {
      actions.push({ label: "Mark ready", action: "ready" });
    }
    if (!["DELIVERED", "COMPLETED"].includes(status)) {
      actions.push({ label: "Mark delivered", action: "delivered" });
    }
    return actions
      .map(
        (a) =>
          `<button type="button" data-rc2-action="${a.action}" data-order-id="${esc(id)}" aria-label="${esc(a.label)}">${esc(a.label)}</button>`,
      )
      .join("");
  }

  function enhanceCard(cardEl, o) {
    if (!cardEl || !o || cardEl.dataset.rc2Enhanced === "1") return;
    cardEl.dataset.rc2Enhanced = "1";
    cardEl.classList.add("rc2-stationery-card");
    cardEl.draggable = state.view === "kanban";

    const pv = payView(o);
    const late = isLate(o);
    const overdue = isOverdue(o);
    const rush = String(o.priority || "").toUpperCase() === "RUSH" || String(o.priority || "").toUpperCase() === "VIP";

    if (late) cardEl.classList.add("is-late");
    if (overdue) cardEl.classList.add("is-overdue");
    if (rush) cardEl.classList.add("is-rush");
    cardEl.dataset.rc2Group = [
      timeBucket(o),
      rush ? "rush" : "",
      /wedding/i.test(o.occasion || "") ? "wedding" : "",
      /funeral|sympathy/i.test(o.occasion || "") ? "funeral" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const notes = noteSnippet(o);
    const body = document.createElement("div");
    body.className = "rc2-card-body";
    body.innerHTML = `
      <div class="rc2-card-header">
        <div class="rc2-card-thumb">${thumbHtml(o)}</div>
        <div class="rc2-card-title-block">
          <h3>${esc(o.customer_name || "Customer")}</h3>
          <p class="rc2-card-customer">${esc(o.order_number || "Order")} · ${esc(o.occasion || "Floral")}</p>
          <div class="rc2-card-chips">
            <span class="rc2-card-chip">${esc(fulfillmentLabel(o))}</span>
            <span class="rc2-card-chip ${pv.status === "PAID" ? "is-pay-paid" : "is-pay-unpaid"}">${esc(pv.status)}</span>
            <span class="rc2-card-chip">${esc(statusLabel(o.status))}</span>
            ${rush ? '<span class="rc2-card-chip is-rush-chip">Rush</span>' : ""}
            ${late ? '<span class="rc2-card-chip is-late-chip">Late</span>' : ""}
          </div>
        </div>
      </div>
      <div class="rc2-card-meta-grid">
        <div><span>Designer</span><strong>${esc(o.designer || "Unassigned")}</strong></div>
        <div><span>Due</span><strong>${esc(o.delivery_date || "—")}${o.delivery_window ? ` · ${esc(o.delivery_window)}` : ""}</strong></div>
        <div><span>Fulfillment</span><strong>${esc(fulfillmentLabel(o))}</strong></div>
        <div><span>Balance</span><strong>${esc(money(pv.balance))}</strong></div>
      </div>
      ${notes ? `<div class="rc2-card-notes">${esc(notes)}</div>` : ""}
      <div class="rc2-card-total-row"><span></span><strong>${esc(money(o.total))}</strong></div>
    `;
    cardEl.prepend(body);

    const qa = document.createElement("div");
    qa.className = "rc2-quick-actions";
    qa.innerHTML = buildQuickActions(o);
    cardEl.appendChild(qa);

    cardEl.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", o.id);
      e.dataTransfer.effectAllowed = "move";
      cardEl.classList.add("is-dragging");
    });
    cardEl.addEventListener("dragend", () => cardEl.classList.remove("is-dragging"));

    if ("ontouchstart" in window) {
      cardEl.addEventListener("click", (e) => {
        if (e.target.closest("[data-rc2-action]")) return;
        cardEl.classList.toggle("is-touch-open");
      });
    }
  }

  function enhanceAllCards() {
    document.querySelectorAll(".production-card[data-order-card]").forEach((el) => {
      const o = findOrder(el.dataset.orderCard);
      if (o) enhanceCard(el, o);
    });
    applyGroupFilter();
  }

  function applyGroupFilter() {
    const ids = new Set(filteredOrders().map((o) => o.id));
    document.querySelectorAll("[data-order-card]").forEach((el) => {
      el.style.display = ids.has(el.dataset.orderCard) ? "" : "none";
    });
    document.querySelectorAll(".rc2-timeline-item, .rc2-list-row, .rc2-calendar-cell").forEach((el) => {
      if (el.dataset.orderId) {
        el.hidden = !ids.has(el.dataset.orderId);
      }
    });
    updateStats();
  }

  function updateStats() {
    const orders = getOrders();
    const today = new Date().toISOString().slice(0, 10);
    const active = orders.filter((o) => ACTIVE_STATUSES.has(String(o.status || "").toUpperCase()));
    const late = orders.filter((o) => isLate(o));
    const designing = orders.filter((o) => String(o.status || "").toUpperCase() === "DESIGNING");
    const preparing = orders.filter(
      (o) => String(o.status || "").toUpperCase() === "CONFIRMED" || String(o.status || "").toUpperCase() === "PENDING",
    );
    const ready = orders.filter((o) => ["READY", "PICKUP_READY"].includes(String(o.status || "").toUpperCase()));
    const delivered = orders.filter((o) => String(o.status || "").toUpperCase() === "DELIVERED");
    const dueToday = orders.filter((o) => String(o.delivery_date || "").slice(0, 10) === today);

    const map = {
      attention: late.length,
      due: dueToday.length,
      designing: designing.length,
      preparing: preparing.length,
      ready: ready.length,
      delivered: delivered.length,
      active: active.length,
    };
    document.querySelectorAll("[data-rc2-stat]").forEach((el) => {
      const key = el.dataset.rc2Stat;
      const val = map[key];
      if (val != null) {
        el.querySelector("strong").textContent = String(val);
        el.classList.toggle("is-attention", key === "attention" && val > 0);
      }
    });
  }

  function mountWorkspaceChrome() {
    const page = document.getElementById("ordersPage");
    if (!page || page.querySelector(".rc2-orders-workspace")) return;

    const layout = page.querySelector(".order-command-layout");
    if (!layout) return;

    const workspace = document.createElement("div");
    workspace.className = "rc2-orders-workspace";

    workspace.innerHTML = `
      <div class="rc2-orders-stats" aria-label="Orders at a glance">
        <article class="rc2-orders-stat is-attention" data-rc2-stat="attention"><small>Needs attention</small><strong>0</strong></article>
        <article class="rc2-orders-stat" data-rc2-stat="due"><small>Due today</small><strong>0</strong></article>
        <article class="rc2-orders-stat" data-rc2-stat="designing"><small>Designing</small><strong>0</strong></article>
        <article class="rc2-orders-stat" data-rc2-stat="preparing"><small>Preparing</small><strong>0</strong></article>
        <article class="rc2-orders-stat" data-rc2-stat="ready"><small>Ready</small><strong>0</strong></article>
        <article class="rc2-orders-stat" data-rc2-stat="delivered"><small>Delivered</small><strong>0</strong></article>
      </div>
      <div class="rc2-orders-toolbar">
        <div class="rc2-view-switcher" role="tablist" aria-label="Orders view">
          <button type="button" role="tab" data-rc2-view="kanban" aria-pressed="true">Kanban</button>
          <button type="button" role="tab" data-rc2-view="timeline" aria-pressed="false">Timeline</button>
          <button type="button" role="tab" data-rc2-view="calendar" aria-pressed="false">Calendar</button>
          <button type="button" role="tab" data-rc2-view="list" aria-pressed="false">List</button>
        </div>
        <div class="rc2-group-chips" role="group" aria-label="Smart groups">
          <button type="button" class="rc2-group-chip" data-rc2-group="all" aria-pressed="true">All</button>
          <button type="button" class="rc2-group-chip" data-rc2-group="morning" aria-pressed="false">Morning</button>
          <button type="button" class="rc2-group-chip" data-rc2-group="afternoon" aria-pressed="false">Afternoon</button>
          <button type="button" class="rc2-group-chip" data-rc2-group="evening" aria-pressed="false">Evening</button>
          <button type="button" class="rc2-group-chip" data-rc2-group="rush" aria-pressed="false">Rush</button>
          <button type="button" class="rc2-group-chip" data-rc2-group="wedding" aria-pressed="false">Wedding</button>
          <button type="button" class="rc2-group-chip" data-rc2-group="funeral" aria-pressed="false">Funeral</button>
          <button type="button" class="rc2-group-chip" data-rc2-group="standing" aria-pressed="false">Standing</button>
          <button type="button" class="rc2-group-chip" data-rc2-group="business" aria-pressed="false">Business</button>
        </div>
      </div>
      <div class="rc2-orders-view-host">
        <div class="rc2-orders-view rc2-view-kanban" data-rc2-view-panel="kanban"></div>
        <div class="rc2-orders-view rc2-timeline-view" data-rc2-view-panel="timeline" hidden></div>
        <div class="rc2-orders-view rc2-calendar-view" data-rc2-view-panel="calendar" hidden></div>
        <div class="rc2-orders-view rc2-list-view" data-rc2-view-panel="list" hidden></div>
      </div>
    `;

    layout.before(workspace);

    const kanbanHost = workspace.querySelector('[data-rc2-view-panel="kanban"]');
    kanbanHost.appendChild(layout);

    const existingSearch = page.querySelector(".bloom-orders-toolbar");
    if (existingSearch) {
      workspace.querySelector(".rc2-orders-toolbar")?.appendChild(existingSearch);
    }

    workspace.querySelectorAll("[data-rc2-view]").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.rc2View));
    });

    workspace.querySelectorAll("[data-rc2-group]").forEach((btn) => {
      btn.addEventListener("click", () => setGroup(btn.dataset.rc2Group));
    });

    const eyebrow = page.querySelector(".heading .eyebrow");
    if (eyebrow) eyebrow.textContent = "ORDERS ATELIER";
    const subtitle = page.querySelector(".heading .subtle");
    if (subtitle) {
      subtitle.textContent =
        "Calm command center for Valentine's, Mother's Day, and every rush — know what needs attention at a glance.";
    }

    setView(state.view, true);
    setGroup(state.group, true);
  }

  function setView(view, silent) {
    state.view = view;
    if (!silent) localStorage.setItem(STORAGE_VIEW, view);

    document.querySelectorAll("[data-rc2-view]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.rc2View === view ? "true" : "false");
    });

    document.querySelectorAll("[data-rc2-view-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.rc2ViewPanel !== view;
    });

    if (view === "timeline") renderTimelineView();
    if (view === "calendar") renderCalendarView();
    if (view === "list") renderListView();

    document.querySelectorAll(".production-card[data-order-card]").forEach((el) => {
      el.draggable = view === "kanban";
    });
  }

  function setGroup(group, silent) {
    state.group = group;
    if (!silent) localStorage.setItem(STORAGE_GROUP, group);

    document.querySelectorAll("[data-rc2-group]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.rc2Group === group ? "true" : "false");
    });

    applyGroupFilter();
    if (state.view === "timeline") renderTimelineView();
    if (state.view === "calendar") renderCalendarView();
    if (state.view === "list") renderListView();
  }

  function renderTimelineView() {
    const panel = document.querySelector('[data-rc2-view-panel="timeline"]');
    if (!panel) return;

    const orders = filteredOrders().slice().sort((a, b) => {
      const da = String(a.delivery_date || "");
      const db = String(b.delivery_date || "");
      return da.localeCompare(db) || String(a.delivery_window || "").localeCompare(String(b.delivery_window || ""));
    });

    const byDay = new Map();
    orders.forEach((o) => {
      const day = String(o.delivery_date || "Unscheduled").slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(o);
    });

    panel.innerHTML = [...byDay.entries()]
      .map(([day, items]) => {
        const label =
          day === "Unscheduled"
            ? "Unscheduled"
            : new Date(day + "T12:00:00").toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              });
        return `<section class="rc2-timeline-day">
          <div class="rc2-timeline-day-head"><h3>${esc(label)}</h3><span>${items.length} order${items.length === 1 ? "" : "s"}</span></div>
          <div class="rc2-timeline-track">
            ${items
              .map((o) => {
                const pv = payView(o);
                return `<article class="rc2-timeline-item" data-order-id="${esc(o.id)}" tabindex="0" role="button">
                  <time class="rc2-timeline-time">${esc(o.delivery_window || "—")}</time>
                  <div><h4>${esc(o.customer_name || "Customer")}</h4><p>${esc(o.occasion || "Floral")} · ${esc(statusLabel(o.status))} · ${esc(money(pv.balance))} due</p></div>
                  <strong>${esc(money(o.total))}</strong>
                </article>`;
              })
              .join("")}
          </div>
        </section>`;
      })
      .join("") || '<p class="subtle">No orders in this group.</p>';
  }

  function renderCalendarView() {
    const panel = document.querySelector('[data-rc2-view-panel="calendar"]');
    if (!panel) return;

    const y = state.calendarMonth.getFullYear();
    const m = state.calendarMonth.getMonth();
    const first = new Date(y, m, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayStr = new Date().toISOString().slice(0, 10);

    const byDate = new Map();
    filteredOrders().forEach((o) => {
      const d = String(o.delivery_date || "").slice(0, 10);
      if (!d) return;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(o);
    });

    const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let cells = dows.map((d) => `<div class="rc2-calendar-dow">${d}</div>`).join("");

    for (let i = 0; i < startPad; i++) {
      cells += `<div class="rc2-calendar-cell is-other-month" aria-hidden="true"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const items = byDate.get(iso) || [];
      const dots = items
        .slice(0, 4)
        .map((o) => {
          let cls = "rc2-calendar-dot";
          if (isLate(o)) cls += " is-late";
          else if (String(o.priority || "").toUpperCase() === "RUSH") cls += " is-rush";
          return `<span class="${cls}"></span>`;
        })
        .join("");
      cells += `<div class="rc2-calendar-cell ${items.length ? "has-orders" : ""} ${iso === todayStr ? "is-today" : ""}" data-cal-date="${iso}" ${items.length ? 'tabindex="0" role="button"' : ""}>
        <span class="rc2-calendar-date">${d}</span>
        <div class="rc2-calendar-dots">${dots}</div>
      </div>`;
    }

    panel.innerHTML = `
      <div class="rc2-calendar-head">
        <div class="rc2-calendar-nav">
          <button type="button" data-cal-nav="-1" aria-label="Previous month">‹</button>
          <button type="button" data-cal-nav="1" aria-label="Next month">›</button>
        </div>
        <h3>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3>
        <span></span>
      </div>
      <div class="rc2-calendar-grid">${cells}</div>`;

    panel.querySelectorAll("[data-cal-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.calendarMonth = new Date(y, m + Number(btn.dataset.calNav), 1);
        renderCalendarView();
      });
    });

    panel.querySelectorAll("[data-cal-date]").forEach((cell) => {
      cell.addEventListener("click", () => {
        setView("timeline");
        setGroup("all");
        window.toast?.(`Orders due ${cell.dataset.calDate}`);
      });
    });
  }

  function renderListView() {
    const panel = document.querySelector('[data-rc2-view-panel="list"]');
    if (!panel) return;

    const orders = filteredOrders().slice().sort((a, b) => {
      if (isLate(a) && !isLate(b)) return -1;
      if (!isLate(a) && isLate(b)) return 1;
      return String(a.delivery_date || "").localeCompare(String(b.delivery_date || ""));
    });

    panel.innerHTML =
      orders
        .map((o) => {
          const pv = payView(o);
          return `<article class="rc2-list-row ${isLate(o) ? "is-late" : ""}" data-order-id="${esc(o.id)}" tabindex="0" role="button">
            <div class="rc2-list-thumb" aria-hidden="true">✿</div>
            <div class="rc2-list-main"><h4>${esc(o.customer_name || "Customer")}</h4><p>${esc(o.order_number || "")} · ${esc(o.occasion || "Floral")} · ${esc(o.delivery_date || "")}</p></div>
            <div class="rc2-list-status">${esc(statusLabel(o.status))}<br>${esc(pv.status)}</div>
            <div class="rc2-list-total">${esc(money(o.total))}</div>
          </article>`;
        })
        .join("") || '<p class="subtle">No orders in this group.</p>';
  }

  function setupDragDrop() {
    document.querySelectorAll(".order-board-column").forEach((col) => {
      if (col.dataset.rc2Drop === "1") return;
      col.dataset.rc2Drop = "1";

      col.addEventListener("dragover", (e) => {
        e.preventDefault();
        col.classList.add("is-drop-target");
      });
      col.addEventListener("dragleave", () => col.classList.remove("is-drop-target"));
      col.addEventListener("drop", async (e) => {
        e.preventDefault();
        col.classList.remove("is-drop-target");
        const id = e.dataTransfer.getData("text/plain");
        const columnId = col.dataset.orderColumn;
        const targetStatus = COLUMN_TARGET_STATUS[columnId];
        if (!id || !targetStatus) return;
        const o = findOrder(id);
        if (!o || String(o.status || "").toUpperCase() === targetStatus) return;
        await patchOrderStatus(id, targetStatus);
      });
    });
  }

  async function handleQuickAction(action, orderId) {
    const o = findOrder(orderId);
    const card = document.querySelector(`[data-order-card="${CSS.escape(orderId)}"]`);
    if (!o) return;

    switch (action) {
      case "edit":
        triggerClick(`[data-edit-order="${CSS.escape(orderId)}"]`, card);
        break;
      case "duplicate":
        await duplicateOrder(o);
        break;
      case "card":
        if (o.card_message) {
          const w = window.open("", "_blank", "width=420,height=560");
          if (w) {
            w.document.write(
              `<html><head><title>Card</title></head><body style="font-family:Georgia,serif;padding:32px"><p>${esc(o.card_message)}</p></body></html>`,
            );
            w.document.close();
            w.print();
          }
        } else {
          triggerClick(`[data-receipt="${CSS.escape(orderId)}"]`, card);
        }
        break;
      case "invoice":
        triggerClick(`[data-invoice-view="${CSS.escape(orderId)}"]`, card) ||
          triggerClick(`[data-receipt="${CSS.escape(orderId)}"]`, card);
        break;
      case "call":
        if (o.customer_phone) location.href = `tel:${o.customer_phone.replace(/\D/g, "")}`;
        break;
      case "message": {
        const phone = (o.customer_phone || "").replace(/\D/g, "");
        if (phone) location.href = `sms:${phone}`;
        break;
      }
      case "assign":
        triggerClick(`[data-edit-order="${CSS.escape(orderId)}"]`, card);
        break;
      case "ready":
        await patchOrderStatus(orderId, "READY");
        break;
      case "delivered":
        await patchOrderStatus(orderId, "DELIVERED");
        break;
      default:
        break;
    }
  }

  function enhancePosCheckout() {
    const checkout = document.querySelector(".pos-home .checkout-card");
    if (!checkout || checkout.querySelector(".rc2-pos-receipt-preview")) return;

    const preview = document.createElement("div");
    preview.className = "rc2-pos-receipt-preview";
    preview.innerHTML = `
      <header><p>Receipt preview</p><strong id="rc2ReceiptCustomer">Walk-in Customer</strong></header>
      <div class="rc2-pos-receipt-body" id="rc2ReceiptBody"><p class="subtle">Add items to preview the ticket.</p></div>`;
    checkout.querySelector(".checkout-lines")?.before(preview);

    const processBtn = checkout.querySelector(".process-payment");
    processBtn?.addEventListener("click", () => {
      checkout.classList.add("rc2-pos-checkout-anim");
      setTimeout(() => checkout.classList.remove("rc2-pos-checkout-anim"), 450);
    });

    updatePosReceiptPreview();
  }

  function updatePosReceiptPreview() {
    const body = document.getElementById("rc2ReceiptBody");
    const customerEl = document.getElementById("rc2ReceiptCustomer");
    if (!body) return;

    let cart = [];
    try {
      cart = JSON.parse(localStorage.getItem("bloom_pos_cart") || "[]");
    } catch {
      cart = [];
    }

    const customer =
      document.querySelector("#posCustomerSelect")?.selectedOptions?.[0]?.dataset?.name || "Walk-in Customer";
    if (customerEl) customerEl.textContent = customer;

    if (!cart.length) {
      body.innerHTML = '<p class="subtle">Add items to preview the ticket.</p>';
      return;
    }

    const subtotal = cart.reduce((s, x) => s + (Number(x.price) || 0) * (Number(x.quantity) || 1), 0);
    body.innerHTML =
      cart
        .map(
          (x) =>
            `<div class="rc2-pos-receipt-line"><span>${esc(x.name)}<small> × ${Number(x.quantity) || 1}</small></span><span>${esc(money((Number(x.price) || 0) * (Number(x.quantity) || 1)))}</span></div>`,
        )
        .join("") + `<div class="rc2-pos-receipt-line"><strong>Subtotal</strong><strong>${esc(money(subtotal))}</strong></div>`;
  }

  function onBoardRendered() {
    mountWorkspaceChrome();
    document.querySelectorAll(".production-card[data-order-card]").forEach((el) => {
      delete el.dataset.rc2Enhanced;
    });
    enhanceAllCards();
    setupDragDrop();
    if (state.view === "timeline") renderTimelineView();
    if (state.view === "calendar") renderCalendarView();
    if (state.view === "list") renderListView();
  }

  function patchLoadOrders() {
    if (window.loadOrders?.__rc2OrdersPatched) return false;
    const orig = window.loadOrders;
    if (!orig) return false;
    window.loadOrders = async function (...args) {
      const r = await orig.apply(this, args);
      onBoardRendered();
      return r;
    };
    window.loadOrders.__rc2OrdersPatched = true;
    return true;
  }

  function ensureLoadOrdersPatch(attemptsLeft) {
    if (patchLoadOrders()) return;
    if (attemptsLeft <= 0) return;
    setTimeout(() => ensureLoadOrdersPatch(attemptsLeft - 1), 400);
  }

  function observeBoard() {
    const board = document.getElementById("ordersBoard");
    if (!board || state.boardObserver) return;
    state.boardObserver = new MutationObserver(() => {
      if (document.querySelector(".production-card[data-order-card]:not([data-rc2-enhanced])")) {
        enhanceAllCards();
        setupDragDrop();
      }
    });
    state.boardObserver.observe(board, { childList: true, subtree: true });
  }

  function observeCart() {
    const queue = document.getElementById("queue");
    if (!queue || state.cartObserver) return;
    state.cartObserver = new MutationObserver(updatePosReceiptPreview);
    state.cartObserver.observe(queue, { childList: true, subtree: true });
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    document.body.classList.add("florisyn-rc2-orders-pos");

    document.addEventListener("click", (e) => {
      const actionBtn = e.target.closest("[data-rc2-action]");
      if (actionBtn) {
        e.preventDefault();
        e.stopPropagation();
        handleQuickAction(actionBtn.dataset.rc2Action, actionBtn.dataset.orderId);
        return;
      }

      const timelineItem = e.target.closest(".rc2-timeline-item");
      if (timelineItem?.dataset.orderId) {
        const card = document.querySelector(`[data-order-card="${CSS.escape(timelineItem.dataset.orderId)}"]`);
        card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        setView("kanban");
        return;
      }

      const listRow = e.target.closest(".rc2-list-row");
      if (listRow?.dataset.orderId) {
        triggerClick(`[data-edit-order="${CSS.escape(listRow.dataset.orderId)}"]`);
      }
    });

    ensureLoadOrdersPatch(20);
    observeBoard();
    observeCart();
    enhancePosCheckout();

    if (document.getElementById("ordersBoard")?.children.length) {
      onBoardRendered();
    }

    const patchShowPage = () => {
      const prev = window.showPage;
      if (!prev || prev.__rc2OrdersShowPage) return;
      window.showPage = function (id) {
        const r = prev.apply(this, arguments);
        if (id === "ordersPage") setTimeout(onBoardRendered, 50);
        if (id === "dashboardPage") {
          enhancePosCheckout();
          updatePosReceiptPreview();
        }
        return r;
      };
      window.showPage.__rc2OrdersShowPage = true;
    };
    patchShowPage();
  }

  window.FlorisynRC2Orders = { init, onBoardRendered, setView, setGroup };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
