/**
 * Florisyn Luxury Orders — Figma table (filters, sort, pagination).
 */
(function () {
  const PAGE_SIZE = 8;
  const DEMO_TOTAL = 186;

  const DEMO_ROWS = [
    {
      id: "demo-7342",
      order: "#FLR-7342",
      customer: "Sarah Johnson",
      items: [{ name: "Blush Serenity Bouquet", qty: 1, image: "/assets/pink-bouquet.jpg" }],
      total: 180,
      status: "delivered",
      date: "May 12",
      dateKey: "2026-05-12",
      delivery: "Delivery"
    },
    {
      id: "demo-7341",
      order: "#FLR-7341",
      customer: "Michael Cooper",
      items: [
        { name: "Eternal Summer Bouquet", qty: 1, image: "/assets/atelier-bouquet-hero.jpg" },
        { name: "Gift Wrap", qty: 1, image: "/assets/chocolates.png" }
      ],
      total: 132,
      status: "in-progress",
      date: "May 12",
      dateKey: "2026-05-12",
      delivery: "Pickup"
    },
    {
      id: "demo-7340",
      order: "#FLR-7340",
      customer: "David Wilson",
      items: [{ name: "Pure Elegance Arrangement", qty: 2, image: "/assets/atelier-lilies-corner.jpg" }],
      total: 290,
      status: "ready",
      date: "May 11",
      dateKey: "2026-05-11",
      delivery: "Delivery"
    },
    {
      id: "demo-7339",
      order: "#FLR-7339",
      customer: "Emma Taylor",
      items: [
        { name: "Lavender Dreams", qty: 1, image: "/assets/orchid.png" },
        { name: "Card", qty: 1, image: "/assets/fresh.png" }
      ],
      total: 187,
      status: "pending",
      date: "May 11",
      dateKey: "2026-05-11",
      delivery: "Delivery"
    },
    {
      id: "demo-7338",
      order: "#FLR-7338",
      customer: "Clara Kensington",
      items: [
        { name: "Crimson Velvet", qty: 3, image: "/assets/rose-arr.png" },
        { name: "Rose Garden", qty: 1, image: "/assets/atelier-floral-corner.jpg" }
      ],
      total: 810,
      status: "delivered",
      date: "May 10",
      dateKey: "2026-05-10",
      delivery: "White-Glove"
    },
    {
      id: "demo-7337",
      order: "#FLR-7337",
      customer: "James Wright",
      items: [{ name: "Wedding Package — Bridal + 6 Bridesmaids", qty: 1, image: "/assets/atelier-lilies-corner.jpg" }],
      total: 2400,
      status: "in-progress",
      date: "May 10",
      dateKey: "2026-05-10",
      delivery: "Venue Setup"
    },
    {
      id: "demo-7336",
      order: "#FLR-7336",
      customer: "Sophie Adams",
      items: [{ name: "Tropical Paradise", qty: 1, image: "/assets/orchid.png" }],
      total: 195,
      status: "cancelled",
      date: "May 9",
      dateKey: "2026-05-09",
      delivery: "—"
    },
    {
      id: "demo-7335",
      order: "#FLR-7335",
      customer: "Oliver Chen",
      items: [{ name: "Dried Preserved Collection", qty: 2, image: "/assets/spray.png" }],
      total: 340,
      status: "delivered",
      date: "May 9",
      dateKey: "2026-05-09",
      delivery: "Delivery"
    }
  ];

  const TAB_COUNTS = {
    all: DEMO_TOTAL,
    pending: 12,
    "in-progress": 8,
    ready: 5,
    delivery: 3,
    completed: 156,
    cancelled: 2
  };

  const state = {
    tab: "all",
    query: "",
    page: 1,
    sortKey: "order",
    sortDir: "desc",
    selected: new Set(),
    rows: DEMO_ROWS.slice(),
    usingDemo: true
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
    if (orderCancelDisabled(r) || !r.raw?.id) {
      return `<button type="button" class="ord-cancel secondary" disabled>Cancel Order</button>`;
    }
    return `<button type="button" class="ord-cancel secondary danger" data-cancel-order="${esc(r.raw.id)}">Cancel Order</button>`;
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function thumbFor(text) {
    const t = String(text || "").toLowerCase();
    if (t.includes("wedding")) return "/assets/atelier-lilies-corner.jpg";
    if (t.includes("dried") || t.includes("preserved")) return "/assets/spray.png";
    if (t.includes("tropical")) return "/assets/orchid.png";
    if (t.includes("rose") || t.includes("crimson") || t.includes("velvet")) return "/assets/rose-arr.png";
    if (t.includes("lavender")) return "/assets/orchid.png";
    if (t.includes("gift") || t.includes("wrap") || t.includes("card")) return "/assets/chocolates.png";
    return "/assets/pink-bouquet.jpg";
  }

  function normalizeOrders(apiOrders) {
    if (!Array.isArray(apiOrders) || !apiOrders.length) {
      state.usingDemo = true;
      return DEMO_ROWS.slice();
    }
    state.usingDemo = false;
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
    if (state.usingDemo) return TAB_COUNTS[key] ?? 0;
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
    const total = state.usingDemo && state.tab === "all" && !state.query ? DEMO_TOTAL : rows.length;
    const pages = Math.max(1, Math.ceil((state.usingDemo && state.tab === "all" && !state.query ? DEMO_TOTAL : rows.length) / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows =
      state.usingDemo && state.tab === "all" && !state.query
        ? rows.slice(0, PAGE_SIZE)
        : rows.slice(start, start + PAGE_SIZE);

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
        return `<tr class="${selected.trim()}" data-ord-id="${esc(r.id)}">
          <td><input class="ord-check" type="checkbox" data-ord-select="${esc(r.id)}" ${checked} aria-label="Select ${esc(r.order)}"></td>
          <td><span class="ord-num">${esc(r.order)}</span></td>
          <td>${esc(r.customer)}</td>
          <td>${items}</td>
          <td><span class="ord-total">${money(r.total)}</span></td>
          <td><span class="ord-status ${statusClass(r.status)}">${esc(statusLabel(r.status))}</span></td>
          <td>${esc(r.date)}</td>
          <td>${esc(r.delivery)}</td>
          <td class="ord-row-actions">${orderCancelAction(r)}<button type="button" class="ord-actions" data-ord-menu="${esc(r.id)}" aria-label="Order actions">•••</button></td>
        </tr>`;
      })
      .join("");

    const shownFrom = total ? start + 1 : 0;
    const shownTo = Math.min(start + pageRows.length, total);
    const meta = $("#ordPagerMeta");
    if (meta) meta.textContent = `Showing ${shownFrom}-${shownTo} of ${total} orders`;

    const pagesHost = $("#ordPages");
    if (pagesHost) {
      const maxPage = state.usingDemo && state.tab === "all" && !state.query ? 24 : pages;
      const buttons = [];
      buttons.push(`<button type="button" data-ord-page="prev" ${state.page <= 1 ? "disabled" : ""}>Previous</button>`);
      const seq = maxPage <= 5 ? [...Array(maxPage)].map((_, i) => i + 1) : [1, 2, 3, "…", maxPage];
      for (const p of seq) {
        if (p === "…") buttons.push(`<button type="button" disabled>…</button>`);
        else buttons.push(`<button type="button" data-ord-page="${p}" class="${state.page === p ? "active" : ""}">${p}</button>`);
      }
      buttons.push(`<button type="button" data-ord-page="next" ${state.page >= maxPage ? "disabled" : ""}>Next</button>`);
      pagesHost.innerHTML = buttons.join("");
    }

    $$("#ordTable thead th[data-ord-sort]").forEach((th) => {
      th.classList.toggle("is-asc", th.dataset.ordSort === state.sortKey && state.sortDir === "asc");
      th.classList.toggle("is-desc", th.dataset.ordSort === state.sortKey && state.sortDir === "desc");
    });

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

    $("#ordDateRange")?.addEventListener("click", () => {
      window.toast?.("Date range: May 1 – May 12, 2026");
    });

    $("#ordFilterBtn")?.addEventListener("click", () => {
      window.toast?.("More filters coming soon");
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

    $("#ordTable")?.addEventListener("click", (e) => {
      const sortTh = e.target.closest("th[data-ord-sort]");
      if (sortTh) {
        const key = sortTh.dataset.ordSort;
        if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else {
          state.sortKey = key;
          state.sortDir = key === "total" || key === "date" || key === "order" ? "desc" : "asc";
        }
        renderTable();
        return;
      }
      const menu = e.target.closest("[data-ord-menu]");
      if (menu) {
        const row = state.rows.find((r) => r.id === menu.dataset.ordMenu);
        if (row?.raw?.id && typeof window.openOrder === "function") window.openOrder(row.raw);
        else window.toast?.(`${row?.order || "Order"} · ${row?.customer || ""}`);
        return;
      }
      const cancelBtn = e.target.closest("[data-cancel-order]");
      if (cancelBtn && !cancelBtn.disabled) {
        const id = cancelBtn.dataset.cancelOrder;
        const row = state.rows.find((r) => r.raw?.id === id);
        if (!row || orderCancelDisabled(row)) return;
        if (!confirm(`Cancel order ${row.order || ""}?`)) return;
        const apiFn = window.api;
        if (!apiFn) return window.toast?.("Sign in required.");
        cancelBtn.disabled = true;
        apiFn("orders", { method: "PATCH", body: JSON.stringify({ id, status: "CANCELLED" }) })
          .then(async () => {
            window.toast?.("Order cancelled");
            if (typeof window.loadOrders === "function") await window.loadOrders();
            else {
              row.raw.status = "CANCELLED";
              row.status = "cancelled";
              render();
            }
          })
          .catch((err) => {
            window.toast?.(err?.message || "Could not cancel order");
            cancelBtn.disabled = false;
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
      const maxPage = state.usingDemo && state.tab === "all" && !state.query ? 24 : Math.max(1, Math.ceil(filteredRows().length / PAGE_SIZE));
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
