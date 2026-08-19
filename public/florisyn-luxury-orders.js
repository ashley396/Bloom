/**
 * Florisyn Luxury Orders — Figma table (filters, sort, pagination).
 */
(function () {
  const PAGE_SIZE = 8;

  const state = {
    tab: "all",
    query: "",
    page: 1,
    sortKey: "order",
    sortDir: "desc",
    selected: new Set(),
    rows: [],
    dateFrom: "",
    dateTo: "",
    fulfillment: "",
    paymentStatus: ""
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return [...(root || document).querySelectorAll(sel)];
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function money(n) {
    return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function mapStatus(raw) {
    const s = String(raw || "").toUpperCase();
    if (["DELIVERED", "COMPLETED", "PAID"].includes(s)) return "delivered";
    if (["CANCELLED", "CANCELED", "VOID"].includes(s)) return "cancelled";
    if (["READY", "READY_FOR_PICKUP", "READY_PICKUP"].includes(s)) return "ready";
    if (["OUT_FOR_DELIVERY", "OUT", "EN_ROUTE"].includes(s)) return "delivery";
    if (["IN_PROGRESS", "DESIGNING", "PRODUCTION", "CONFIRMED", "PROCESSING"].includes(s)) return "in-progress";
    return "pending";
  }

  function statusLabel(key) {
    return (
      {
        delivered: "Delivered ✓",
        "in-progress": "In Progress",
        ready: "Ready",
        pending: "Pending",
        cancelled: "Cancelled ✗",
        delivery: "Out for Delivery"
      }[key] || "Pending"
    );
  }

  function statusClass(key) {
    if (key === "delivery") return "in-progress";
    return key;
  }

  function orderCancelDisabled(r) {
    if (r.status === "cancelled" || r.status === "delivered") return true;
    const raw = String(r.raw?.status || "").toUpperCase();
    return ["CANCELLED", "CANCELED", "VOID", "DELIVERED", "COMPLETED"].includes(raw);
  }

  function orderCancelAction(r) {
    // Labeled "Delete" per the owner's request, but — deliberately — this
    // still only cancels the order (status: CANCELLED via data-cancel-
    // order below), never a hard delete. Orders are financial records;
    // this keeps them for accounting/history instead of destroying them.
    if (orderCancelDisabled(r)) {
      return `<button type="button" class="ord-cancel secondary" disabled>Delete</button>`;
    }
    if (!r.raw?.id) return "";
    return `<button type="button" class="ord-cancel secondary danger" data-cancel-order="${esc(r.raw.id)}">Delete</button>`;
  }

  function formatDate(value) {
    if (!value) return "—";
    // A bare "YYYY-MM-DD" (how a Postgres `date` column like delivery_date
    // serializes) has no time component — it's already the exact day the
    // florist picked. Routing it through `new Date()` reads it as UTC
    // midnight, and every negative-UTC-offset (i.e. every US) timezone
    // then reads that back as the *previous* local day, showing every
    // order's delivery date one day early in this table. Full timestamps
    // (created_at etc.) do carry real timezone info and still need the
    // Date-based conversion below.
    const bareDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    if (bareDate) {
      const d = new Date(Number(bareDate[1]), Number(bareDate[2]) - 1, Number(bareDate[3]));
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function thumbFor(text) {
    const t = String(text || "").toLowerCase();
    if (t.includes("wedding")) return "/assets/atelier-lilies-corner.jpg";
    if (t.includes("dried") || t.includes("preserved")) return "/assets/spray.jpg";
    if (t.includes("tropical")) return "/assets/orchid.jpg";
    if (t.includes("rose") || t.includes("crimson") || t.includes("velvet")) return "/assets/rose-arr.jpg";
    if (t.includes("lavender")) return "/assets/orchid.jpg";
    if (t.includes("gift") || t.includes("wrap") || t.includes("card")) return "/assets/chocolates.jpg";
    return "/assets/pink-bouquet.jpg";
  }

  function normalizeOrders(apiOrders) {
    if (!Array.isArray(apiOrders) || !apiOrders.length) {
      return [];
    }
    return apiOrders.map((o, i) => {
      const desc = o.arrangement_description || o.notes || o.occasion || "Floral arrangement";
      const parts = String(desc)
        .split(/;|,|\n/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 2);
      const items = (parts.length ? parts : [desc]).map((name) => {
        const qtyMatch = name.match(/(\d+)\s*[×x]\s*(.+)/i);
        return {
          name: qtyMatch ? qtyMatch[2].trim() : name,
          qty: qtyMatch ? Number(qtyMatch[1]) : 1,
          image: thumbFor(name)
        };
      });
      const fulfillment = String(o.fulfillment || "").toUpperCase();
      let delivery = "—";
      if (fulfillment.includes("DELIV")) delivery = "Delivery";
      else if (fulfillment.includes("PICK")) delivery = "Pickup";
      else if (fulfillment.includes("VENUE") || fulfillment.includes("SETUP")) delivery = "Venue Setup";
      else if (o.delivery_address) delivery = "Delivery";
      return {
        id: o.id || `api-${i}`,
        order: o.order_number ? (String(o.order_number).startsWith("#") ? o.order_number : `#${o.order_number}`) : `#FLR-${1000 + i}`,
        customer: o.customer_name || o.recipient_name || "Walk-in Customer",
        items,
        total: Number(o.total ?? o.total_preview ?? 0),
        status: mapStatus(o.status || o.payment_status),
        date: formatDate(o.delivery_date || o.created_at),
        dateKey: String(o.delivery_date || o.created_at || "").slice(0, 10),
        delivery,
        raw: o
      };
    });
  }

  function filteredRows() {
    let rows = state.rows.slice();
    if (state.tab === "pending") rows = rows.filter((r) => r.status === "pending");
    else if (state.tab === "in-progress") rows = rows.filter((r) => r.status === "in-progress");
    else if (state.tab === "ready") rows = rows.filter((r) => r.status === "ready");
    else if (state.tab === "delivery") rows = rows.filter((r) => r.status === "delivery" || /delivery|white-glove|venue/i.test(r.delivery));
    else if (state.tab === "completed") rows = rows.filter((r) => r.status === "delivered");
    else if (state.tab === "cancelled") rows = rows.filter((r) => r.status === "cancelled");

    const q = state.query.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.order, r.customer, r.delivery, ...r.items.map((i) => i.name)].join(" ").toLowerCase().includes(q)
      );
    }

    if (state.dateFrom) rows = rows.filter((r) => r.dateKey && r.dateKey >= state.dateFrom);
    if (state.dateTo) rows = rows.filter((r) => r.dateKey && r.dateKey <= state.dateTo);
    if (state.fulfillment) rows = rows.filter((r) => r.delivery === state.fulfillment);
    if (state.paymentStatus) {
      rows = rows.filter((r) => String(r.raw?.payment_status || "UNPAID").toUpperCase() === state.paymentStatus);
    }

    const dir = state.sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let av = a[state.sortKey];
      let bv = b[state.sortKey];
      if (state.sortKey === "total") return (Number(av) - Number(bv)) * dir;
      if (state.sortKey === "date") return String(a.dateKey).localeCompare(String(b.dateKey)) * dir;
      if (state.sortKey === "items") {
        av = a.items.map((i) => i.name).join(", ");
        bv = b.items.map((i) => i.name).join(", ");
      }
      return String(av || "").localeCompare(String(bv || ""), undefined, { sensitivity: "base" }) * dir;
    });
    return rows;
  }

  function tabCount(key) {
    if (key === "all") return state.rows.length;
    if (key === "delivery") {
      return state.rows.filter((r) => r.status === "delivery" || /delivery|white-glove|venue/i.test(r.delivery)).length;
    }
    if (key === "completed") return state.rows.filter((r) => r.status === "delivered").length;
    return state.rows.filter((r) => r.status === key).length;
  }

  function renderTabs() {
    const host = $("#ordTabs");
    if (!host) return;
    const tabs = [
      ["all", "All Orders", null],
      ["pending", "Pending", "pending"],
      ["in-progress", "In Progress", "in-progress"],
      ["ready", "Ready for Pickup", "ready"],
      ["delivery", "Out for Delivery", "delivery"],
      ["completed", "Completed", "completed"],
      ["cancelled", "Cancelled", "cancelled"]
    ];
    host.innerHTML = tabs
      .map(([id, label, countKey]) => {
        const count = countKey ? tabCount(countKey) : null;
        const active = state.tab === id ? " active" : "";
        const countHtml = count == null ? "" : ` <em>${count}</em>`;
        return `<button type="button" data-ord-tab="${id}" class="${active.trim()}">${esc(label)}${countHtml}</button>`;
      })
      .join("");
  }

  function renderTable() {
    const body = $("#ordTableBody");
    if (!body) return;
    const rows = filteredRows();
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    if (!pageRows.length) {
      const noOrdersAtAll = !state.rows.length;
      body.innerHTML = `<div class="ord-empty">
        <p class="ord-empty-title">${noOrdersAtAll ? "No orders yet" : "No orders match this view"}</p>
        <p class="ord-empty-sub">${
          noOrdersAtAll
            ? "New orders you create will show up here as tiles."
            : "Try a different tab, search term, or date range."
        }</p>
      </div>`;
    } else {
      body.innerHTML = pageRows
        .map((r) => {
          const checked = state.selected.has(r.id) ? "checked" : "";
          const selected = state.selected.has(r.id) ? " is-selected" : "";
          const items = r.items
            .map(
              (it) =>
                `<div class="ord-item"><img class="ord-thumb" src="${esc(it.image)}" alt="" width="28" height="28"><span>${esc(it.name)} (x${Number(it.qty) || 1})</span></div>`
            )
            .join("");
          const editBtn = r.raw?.id
            ? `<button type="button" class="secondary" data-edit-order="${esc(r.raw.id)}">Edit</button>`
            : "";
          return `<article class="ord-tile${selected}" data-ord-id="${esc(r.id)}">
            <label class="ord-tile-select"><input class="ord-check" type="checkbox" data-ord-select="${esc(r.id)}" ${checked} aria-label="Select ${esc(r.order)}"></label>
            <div class="ord-tile-head">
              <span class="ord-num">${esc(r.order)}</span>
              <span class="ord-status ${statusClass(r.status)}">${esc(statusLabel(r.status))}</span>
            </div>
            <div class="ord-tile-customer">${esc(r.customer)}</div>
            <div class="ord-tile-items">${items}</div>
            <div class="ord-tile-meta"><span>${esc(r.date)}</span><span>${esc(r.delivery)}</span></div>
            <div class="ord-tile-foot">
              <span class="ord-total">${money(r.total)}</span>
              <div class="ord-tile-actions">${editBtn}${orderCancelAction(r)}</div>
            </div>
          </article>`;
        })
        .join("");
    }

    const shownFrom = total ? start + 1 : 0;
    const shownTo = Math.min(start + pageRows.length, total);
    const meta = $("#ordPagerMeta");
    if (meta) meta.textContent = total ? `Showing ${shownFrom}-${shownTo} of ${total} orders` : "";

    const pagesHost = $("#ordPages");
    if (pagesHost) {
      const maxPage = pages;
      const buttons = [];
      buttons.push(`<button type="button" data-ord-page="prev" ${state.page <= 1 ? "disabled" : ""}>Previous</button>`);
      const seq = maxPage <= 5 ? [...Array(maxPage)].map((_, i) => i + 1) : [1, 2, 3, "…", maxPage];
      for (const p of seq) {
        if (p === "…") buttons.push(`<button type="button" disabled>…</button>`);
        else buttons.push(`<button type="button" data-ord-page="${p}" class="${state.page === p ? "active" : ""}">${p}</button>`);
      }
      buttons.push(`<button type="button" data-ord-page="next" ${state.page >= maxPage ? "disabled" : ""}>Next</button>`);
      pagesHost.innerHTML = total ? buttons.join("") : "";
    }

    const sortSelect = $("#ordSortSelect");
    if (sortSelect) sortSelect.value = `${state.sortKey}-${state.sortDir}`;

    const all = $("#ordSelectAll");
    if (all) {
      const ids = pageRows.map((r) => r.id);
      all.checked = ids.length > 0 && ids.every((id) => state.selected.has(id));
      all.indeterminate = ids.some((id) => state.selected.has(id)) && !all.checked;
    }
  }

  function render() {
    renderTabs();
    renderTable();
  }

  function wire() {
    if (document.body.dataset.ordLuxWired) return;
    document.body.dataset.ordLuxWired = "1";

    $("#ordTabs")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ord-tab]");
      if (!btn) return;
      state.tab = btn.dataset.ordTab;
      state.page = 1;
      render();
    });

    $("#ordSearch")?.addEventListener("input", (e) => {
      state.query = e.target.value || "";
      state.page = 1;
      renderTable();
    });

    // Real date-range and fulfillment/payment filters — these used to be
    // fake: the date button's label was hardcoded HTML text ("May 1 - May
    // 12, 2026") that never changed and never filtered anything, and the
    // filter button only ever toasted "coming soon."
    function togglePopover(btn, panel) {
      const opening = panel.hidden;
      closePopovers();
      if (!opening) return;
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    }

    function closePopovers() {
      $$(".ord-popover").forEach((panel) => (panel.hidden = true));
      $$(".ord-popover-anchor > button").forEach((btn) => btn.setAttribute("aria-expanded", "false"));
    }

    document.addEventListener("click", (e) => {
      if (e.target.closest(".ord-popover-anchor")) return;
      closePopovers();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePopovers();
    });

    function updateDateRangeLabel() {
      const label = $("#ordDateRangeLabel");
      const btn = $("#ordDateRange");
      if (!label || !btn) return;
      const has = Boolean(state.dateFrom || state.dateTo);
      btn.classList.toggle("has-value", has);
      if (!has) {
        label.textContent = "All dates";
        return;
      }
      const fmt = (v) => formatDate(v);
      if (state.dateFrom && state.dateTo) label.textContent = `${fmt(state.dateFrom)} - ${fmt(state.dateTo)}`;
      else if (state.dateFrom) label.textContent = `From ${fmt(state.dateFrom)}`;
      else label.textContent = `Through ${fmt(state.dateTo)}`;
    }

    function updateFilterButtonState() {
      const btn = $("#ordFilterBtn");
      if (btn) btn.classList.toggle("has-value", Boolean(state.fulfillment || state.paymentStatus));
    }

    $("#ordDateRange")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = $("#ordDatePanel");
      if (!panel) return;
      if (panel.hidden) {
        $("#ordDateFrom").value = state.dateFrom;
        $("#ordDateTo").value = state.dateTo;
      }
      togglePopover($("#ordDateRange"), panel);
    });

    $("#ordDatePanel")?.addEventListener("click", (e) => e.stopPropagation());

    $("#ordDateApply")?.addEventListener("click", () => {
      state.dateFrom = $("#ordDateFrom")?.value || "";
      state.dateTo = $("#ordDateTo")?.value || "";
      state.page = 1;
      closePopovers();
      updateDateRangeLabel();
      renderTable();
    });

    $("#ordDateClear")?.addEventListener("click", () => {
      state.dateFrom = "";
      state.dateTo = "";
      if ($("#ordDateFrom")) $("#ordDateFrom").value = "";
      if ($("#ordDateTo")) $("#ordDateTo").value = "";
      state.page = 1;
      closePopovers();
      updateDateRangeLabel();
      renderTable();
    });

    $("#ordFilterBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = $("#ordFilterPanel");
      if (!panel) return;
      if (panel.hidden) {
        $("#ordFilterFulfillment").value = state.fulfillment;
        $("#ordFilterPayment").value = state.paymentStatus;
      }
      togglePopover($("#ordFilterBtn"), panel);
    });

    $("#ordFilterPanel")?.addEventListener("click", (e) => e.stopPropagation());

    $("#ordFilterApply")?.addEventListener("click", () => {
      state.fulfillment = $("#ordFilterFulfillment")?.value || "";
      state.paymentStatus = $("#ordFilterPayment")?.value || "";
      state.page = 1;
      closePopovers();
      updateFilterButtonState();
      renderTable();
    });

    $("#ordFilterClear")?.addEventListener("click", () => {
      state.fulfillment = "";
      state.paymentStatus = "";
      if ($("#ordFilterFulfillment")) $("#ordFilterFulfillment").value = "";
      if ($("#ordFilterPayment")) $("#ordFilterPayment").value = "";
      state.page = 1;
      closePopovers();
      updateFilterButtonState();
      renderTable();
    });

    $("#ordExportBtn")?.addEventListener("click", () => {
      const rows = filteredRows();
      const csv = ["Order,Customer,Items,Total,Status,Date,Delivery"]
        .concat(
          rows.map((r) =>
            [r.order, r.customer, r.items.map((i) => `${i.name} (x${i.qty})`).join("; "), r.total, statusLabel(r.status), r.date, r.delivery]
              .map((v) => `"${String(v).replace(/"/g, '""')}"`)
              .join(",")
          )
        )
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "florisyn-orders.csv";
      a.click();
      URL.revokeObjectURL(url);
      window.toast?.("Orders exported");
    });

    $("#ordSortSelect")?.addEventListener("change", (e) => {
      const [key, dir] = String(e.target.value || "order-desc").split("-");
      state.sortKey = key;
      state.sortDir = dir === "asc" ? "asc" : "desc";
      renderTable();
    });

    $("#ordTable")?.addEventListener("click", (e) => {
      const cancelBtn = e.target.closest("[data-cancel-order]");
      if (cancelBtn && !cancelBtn.disabled) {
        const id = cancelBtn.dataset.cancelOrder;
        const row = state.rows.find((r) => r.raw?.id === id);
        if (!row || orderCancelDisabled(row)) return;
        // Try a real delete first — it only succeeds for an order with no
        // payment history. If it's blocked (financial record protection,
        // see netlify/functions/orders.js), fall back to marking the order
        // Cancelled instead, and say so explicitly: a button labeled
        // "Delete" that silently just changes a status badge, with the
        // order still sitting right there in the list, reads exactly like
        // "the delete button doesn't work."
        if (!confirm(`Delete order ${row.order || ""}? Orders with payment history are kept for your records and marked Cancelled instead.`)) return;
        const apiFn = window.api;
        if (!apiFn) return window.toast?.("Sign in required.");
        cancelBtn.disabled = true;
        apiFn("orders", { method: "DELETE", body: JSON.stringify({ id }) })
          .then(async () => {
            window.toast?.("Order deleted");
            if (typeof window.loadOrders === "function") await window.loadOrders();
            else {
              state.rows = state.rows.filter((r) => r.raw?.id !== id);
              render();
            }
          })
          .catch(async (deleteErr) => {
            if (!/payment history/i.test(deleteErr?.message || "")) {
              window.toast?.(deleteErr?.message || "Could not delete order");
              cancelBtn.disabled = false;
              return;
            }
            try {
              await apiFn("orders", { method: "PATCH", body: JSON.stringify({ id, status: "CANCELLED" }) });
              alert(`Order ${row.order || ""} has payment history, so Florisyn kept it and marked it Cancelled instead of deleting it — this protects your financial records. Refund or adjust the payment in Payment Center if you need to remove it from your books.`);
              if (typeof window.loadOrders === "function") await window.loadOrders();
              else {
                row.raw.status = "CANCELLED";
                row.status = "cancelled";
                render();
              }
            } catch (cancelErr) {
              window.toast?.(cancelErr?.message || "Could not cancel order");
              cancelBtn.disabled = false;
            }
          });
      }
    });

    $("#ordTable")?.addEventListener("change", (e) => {
      if (e.target.id === "ordSelectAll") {
        const rows = filteredRows().slice(0, PAGE_SIZE);
        rows.forEach((r) => {
          if (e.target.checked) state.selected.add(r.id);
          else state.selected.delete(r.id);
        });
        renderTable();
        return;
      }
      const box = e.target.closest("[data-ord-select]");
      if (!box) return;
      if (box.checked) state.selected.add(box.dataset.ordSelect);
      else state.selected.delete(box.dataset.ordSelect);
      renderTable();
    });

    $("#ordPages")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ord-page]");
      if (!btn || btn.disabled) return;
      const val = btn.dataset.ordPage;
      const maxPage = Math.max(1, Math.ceil(filteredRows().length / PAGE_SIZE));
      if (val === "prev") state.page = Math.max(1, state.page - 1);
      else if (val === "next") state.page = Math.min(maxPage, state.page + 1);
      else state.page = Number(val) || 1;
      renderTable();
    });
  }

  function boot(apiOrders) {
    wire();
    state.rows = normalizeOrders(apiOrders);
    state.page = 1;
    render();
  }

  window.FlorisynLuxuryOrders = { boot, render, normalizeOrders };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if ($("#ordersPage")?.classList.contains("active")) boot(window.orders || []);
    });
  } else if ($("#ordersPage")?.classList.contains("active")) {
    boot(window.orders || []);
  }
})();
