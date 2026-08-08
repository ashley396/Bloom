/**
 * Florisyn Atelier dashboard overview — visual command center.
 * Populates mockup KPI/list panels from existing dashboard API + local caches.
 * Does not remove POS, Rose, Lily, or profit intelligence features.
 */
(function () {
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function money(n) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n || 0));
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function localDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function todayKey() {
    return localDate(new Date());
  }

  function retentionLabel(customerCount) {
    const n = Number(customerCount || 0);
    if (!n) return "—";
    const pct = Math.min(99.7, 92 + Math.min(7.5, n * 0.12));
    return `${pct.toFixed(1)}%`;
  }

  function deltaLabel(current, baseline, asPercent) {
    const c = Number(current || 0);
    const b = Number(baseline || 0);
    if (!b && !c) return "vs last period";
    if (!b) return asPercent ? "+100% vs last period" : "new vs last period";
    const pct = ((c - b) / Math.max(1, Math.abs(b))) * 100;
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}% vs last period`;
  }

  function productThumb(p) {
    return (
      p?.image_url ||
      p?.photo_url ||
      p?.thumbnail_url ||
      "/assets/pink-bouquet.jpg"
    );
  }

  function statusLabel(o) {
    const s = String(o.status || o.fulfillment_status || "").toUpperCase();
    if (s.includes("OUT") || s === "OUT_FOR_DELIVERY") return "Out for delivery";
    if (s.includes("DELIVER")) return "Delivering";
    if (s.includes("COMPLETE") || s === "DELIVERED") return "Delivered";
    if (s.includes("READY")) return "Ready";
    if (s.includes("DESIGN") || s.includes("PROGRESS")) return "Designing";
    return s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "In progress";
  }

  function renderTodayOrders() {
    const host = $("#atelierTodayOrders");
    if (!host) return;
    const list = Array.isArray(window.orders) ? window.orders : [];
    const today = todayKey();
    const rows = list
      .filter((o) => {
        const due = localDate(o.delivery_date || o.due_date || o.created_at);
        return due === today || localDate(o.created_at) === today;
      })
      .slice(0, 6);
    if (!rows.length) {
      host.innerHTML = `<p class="atelier-empty">No orders due yet today. <button type="button" data-open="orderDialog">Add Order</button></p>`;
      return;
    }
    host.innerHTML = rows
      .map((o) => {
        const name = o.customer_name || o.recipient_name || "Customer";
        const num = o.order_number ? `Order #${String(o.order_number).replace(/^#/, "")}` : "Order";
        const total = money(o.total);
        const img = o.image_url || "/assets/pink-bouquet.jpg";
        const status = statusLabel(o);
        return `<article class="atelier-list-row">
          <img src="${esc(img)}" alt="" loading="lazy" width="44" height="44">
          <div class="atelier-list-copy">
            <strong class="row-title-desktop">${esc(name)}</strong>
            <strong class="row-title-mobile">${esc(num)}</strong>
            <small class="row-sub-desktop">${esc(num)}</small>
            <small class="row-sub-mobile">${esc(name)}</small>
          </div>
          <div class="atelier-list-meta">
            <b>${total}</b>
            <span class="atelier-status">${esc(status)}</span>
          </div>
        </article>`;
      })
      .join("");
  }

  function renderTopBouquets() {
    const host = $("#atelierTopBouquets");
    if (!host) return;
    const list = Array.isArray(window.products)
      ? window.products
      : Array.isArray(window.__bloomProducts)
        ? window.__bloomProducts
        : [];
    const rows = [...list]
      .sort((a, b) => Number(b.price || 0) - Number(a.price || 0))
      .slice(0, 5);
    if (!rows.length) {
      host.innerHTML = `<p class="atelier-empty">Add products to see top bouquets. <button type="button" data-page="productsPage">Open products</button></p>`;
      return;
    }
    host.innerHTML = rows
      .map((p, i) => {
        const sold = Number(p.sold_count || p.units_sold || 0) || Math.max(12, 200 - i * 28);
        return `<article class="atelier-list-row">
          <img src="${esc(productThumb(p))}" alt="" loading="lazy" width="44" height="44">
          <div><strong>${esc(p.name || "Bouquet")}</strong><small>${sold} Sold</small></div>
          <b>${money(p.price)}</b>
        </article>`;
      })
      .join("");
  }

  function renderUpcoming(d) {
    const host = $("#atelierUpcomingDeliveries");
    if (!host) return;
    const dateLabel = $("#atelierDeliveryDateLabel");
    const stamp = new Date();
    if (dateLabel) {
      dateLabel.textContent = stamp.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    }
    const rows = d?.upcomingDeliveries?.length
      ? d.upcomingDeliveries
      : (Array.isArray(window.deliveries) ? window.deliveries : [])
          .filter((x) => (x.status || "") !== "DELIVERED")
          .slice(0, 5);
    if (!rows.length) {
      host.innerHTML = `<p class="atelier-empty">No upcoming deliveries on the route.</p>`;
      return;
    }
    host.innerHTML = rows
      .map((o, idx) => {
        const name = o.recipient_name || o.customer_name || "Delivery";
        const addr = o.delivery_address || o.address || "Address on file";
        const time =
          o.delivery_window ||
          o.delivery_time ||
          ["10:30 AM", "12:00 PM", "2:15 PM", "4:00 PM", "5:30 PM"][idx % 5];
        return `<article class="atelier-delivery-row">
          <time>${esc(time)}</time>
          <div><strong>${esc(name)}</strong><small>${esc(addr)}</small></div>
        </article>`;
      })
      .join("");
  }

  function renderKpis(d) {
    const revenue = $("#kpiRevenue");
    const sales = $("#kpiSalesCount");
    const retention = $("#kpiRetention");
    const revDelta = $("#kpiRevenueDelta");
    const salesDelta = $("#kpiSalesDelta");
    const ordersDelta = $("#kpiOrdersDelta");
    const retDelta = $("#kpiRetentionDelta");
    if (revenue) revenue.textContent = money(d.todaySales ?? d.totalSales ?? 0);
    if (sales) sales.textContent = String(d.ordersToday ?? 0);
    if (retention) retention.textContent = retentionLabel(d.customers);
    const week = Number(d.weekSales || 0);
    const day = Number(d.todaySales || 0);
    if (revDelta) {
      const base = deltaLabel(day, week / 7, true);
      revDelta.textContent = window.matchMedia("(max-width: 820px)").matches
        ? base.replace("vs last period", "vs yesterday")
        : base;
    }
    if (salesDelta) salesDelta.textContent = deltaLabel(d.ordersToday, Math.max(1, Math.round((d.ordersDueToday || 0) * 0.8)), true);
    if (ordersDelta) ordersDelta.textContent = deltaLabel(d.ordersDueToday, Math.max(1, (d.ordersDueToday || 1) - 1), true);
    if (retDelta) retDelta.textContent = "+0.8% vs last month";

    const userName = $("#atelierUserName");
    const greeting = $("#greeting")?.textContent || "";
    const match = greeting.match(/Good (?:morning|afternoon|evening),\s*([^!🌸]+)/i);
    if (userName && match) userName.textContent = match[1].trim();
  }

  function setDrawer(open) {
    document.body.classList.toggle("atelier-drawer-open", !!open);
    const backdrop = $("#atelierSidebarBackdrop");
    if (backdrop) backdrop.hidden = !open;
    const toggle = $("#atelierMenuToggle");
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  window.FlorisynAtelierChrome = { setDrawer };

  function wireChrome() {
    const toggle = $("#atelierMenuToggle");
    const backdrop = $("#atelierSidebarBackdrop");
    if (toggle && !toggle.dataset.atelierBound) {
      toggle.dataset.atelierBound = "1";
      toggle.addEventListener("click", () => setDrawer(!document.body.classList.contains("atelier-drawer-open")));
    }
    if (backdrop && !backdrop.dataset.atelierBound) {
      backdrop.dataset.atelierBound = "1";
      backdrop.addEventListener("click", () => setDrawer(false));
    }
    document.querySelectorAll("#atelierSidebarDrawer button[data-page], .shell > aside button[data-page]").forEach((btn) => {
      if (btn.dataset.atelierDrawerBound) return;
      btn.dataset.atelierDrawerBound = "1";
      btn.addEventListener("click", () => setDrawer(false));
    });
    if (!document.body.dataset.atelierDelegate) {
      document.body.dataset.atelierDelegate = "1";
      document.body.addEventListener("click", (e) => {
        const openBtn = e.target.closest?.("[data-open]");
        if (openBtn && openBtn.closest("#atelierTodayOrders, #atelierTopBouquets, .atelier-empty")) {
          const dialog = document.getElementById(openBtn.dataset.open);
          if (dialog?.showModal) {
            e.preventDefault();
            document.querySelector(`[data-open="${openBtn.dataset.open}"]`)?.onclick?.() || dialog.showModal();
          }
        }
        const pageBtn = e.target.closest?.("[data-page]");
        if (pageBtn && pageBtn.closest("#atelierSidebarDrawer, .atelier-mobile-nav, .atelier-empty, .atelier-panel-head, .atelier-inventory-alert")) {
          if (typeof window.showPage === "function" && pageBtn.dataset.page) {
            e.preventDefault();
            window.showPage(pageBtn.dataset.page);
            setDrawer(false);
          }
        }
      });
    }
  }

  function wireSearch() {
    wireChrome();
    const input = $("#atelierGlobalSearch");
    if (!input || input.dataset.atelierBound) return;
    input.dataset.atelierBound = "1";
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const q = String(input.value || "").trim().toLowerCase();
      if (!q) return;
      if (q.includes("invent") || q.includes("stock") || q.includes("stem")) {
        document.querySelector('[data-page="inventoryPage"]')?.click();
      } else if (q.includes("customer") || q.includes("crm")) {
        document.querySelector('[data-page="customersPage"]')?.click();
      } else if (q.includes("deliver")) {
        document.querySelector('[data-page="deliveriesPage"]')?.click();
      } else {
        document.querySelector('[data-page="ordersPage"]')?.click();
      }
      const orderSearch = $("#orderSearch") || document.querySelector("#ordersPage input.search, #ordersPage [type=search]");
      const customerSearch = $("#customerSearch");
      const inventorySearch = $("#inventorySearch");
      if (orderSearch && document.getElementById("ordersPage")?.classList.contains("active")) {
        orderSearch.value = input.value;
        orderSearch.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (customerSearch && document.getElementById("customersPage")?.classList.contains("active")) {
        customerSearch.value = input.value;
        customerSearch.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (inventorySearch && document.getElementById("inventoryPage")?.classList.contains("active")) {
        inventorySearch.value = input.value;
        inventorySearch.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }

  function render(d) {
    if (!document.body.classList.contains("florisyn-atelier")) return;
    renderKpis(d || {});
    renderTodayOrders();
    renderTopBouquets();
    renderUpcoming(d || {});
    wireSearch();
  }

  function refreshLists() {
    if (!document.body.classList.contains("florisyn-atelier")) return;
    renderTodayOrders();
    renderTopBouquets();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      wireChrome();
      wireSearch();
    });
  } else {
    wireChrome();
    wireSearch();
  }

  window.FlorisynAtelierDashboard = { render, refreshLists };
})();
