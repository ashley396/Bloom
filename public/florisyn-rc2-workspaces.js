/**
 * Florisyn RC2 — Complete workspace enhancements (UI only).
 * Purpose-built layouts, summary bars, card polish, and state chrome.
 * Delegates to existing app.js handlers — no business logic changes.
 */
(function () {
  "use strict";

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const money = (n) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(n || 0));

  const PAGE_IDS = [
    "inventoryPage",
    "customersPage",
    "deliveriesPage",
    "productsPage",
    "libraryPage",
    "marketplacePage",
    "wholesaleSellerPage",
    "paymentsPage",
    "websitePage",
    "aiStudioPage",
    "bloomshotPage",
    "reportsPage",
    "expensesPage",
    "invoicesPage",
    "staffPage",
    "settingsPage",
    "subscriptionPage",
    "ecosystemPage",
    "storesPage",
    "dashboardPage",
    "ordersPage",
  ];

  const observers = new Map();
  let showPageWrapped = false;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function ensureSummary(page, slotId, html) {
    if (!page || document.getElementById(slotId)) return;
    const host = document.createElement("div");
    host.id = slotId;
    host.className = "rc2-ws-summary";
    host.innerHTML = html;
    const anchor =
      page.querySelector(".inventory-toolbar") ||
      page.querySelector(".expense-toolbar") ||
      page.querySelector(".library-toolbar") ||
      page.querySelector(".delivery-summary") ||
      page.querySelector(".marketplace-shell") ||
      page.querySelector(".report-summary") ||
      page.querySelector(".invoice-summary") ||
      page.querySelector(".heading");
    if (anchor) anchor.insertAdjacentElement("afterend", host);
    else page.prepend(host);
  }

  function polishCards(root) {
    if (!root) return;
    root.querySelectorAll(".card, .product-card, .production-card, .employee-card, .invoice-card, .inventory-card").forEach((el) => {
      el.classList.add("rc2-ws-card");
      el.querySelectorAll("button, [role='button']").forEach((btn) => btn.classList.add("rc2-ws-action"));
    });
  }

  function markComplete(pageId) {
    const page = document.getElementById(pageId);
    if (page) page.classList.add("rc2-ws-complete");
    document.body.classList.add("rc2-ws-active");
  }

  async function enhanceInventory() {
    const page = document.getElementById("inventoryPage");
    if (!page) return;
    markComplete("inventoryPage");
    try {
      const data = window.api ? await window.api("inventory") : null;
      const items = data?.items || [];
      const low = items.filter((i) => Number(i.quantity) <= Number(i.low_stock_level || 0)).length;
      const useFirst = items.filter((i) => {
        const q = Number(i.quantity || 0);
        return q > 0 && q <= 3;
      }).length;
      const roses = items.filter((i) => /rose/i.test(String(i.name || "")));
      const roseByColor = roses.reduce((acc, i) => {
        const c = String(i.color || "Unspecified").trim() || "Unspecified";
        acc[c] = (acc[c] || 0) + Number(i.quantity || 0);
        return acc;
      }, {});
      const roseHtml = Object.keys(roseByColor).length
        ? Object.entries(roseByColor)
            .slice(0, 6)
            .map(([c, n]) => `<span class="rc2-ws-chip">${esc(c)} · ${n}</span>`)
            .join("")
        : '<span class="rc2-ws-muted">Add roses to see color counts</span>';
      const retail = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.price || 0), 0);
      ensureSummary(
        page,
        "rc2InventoryHealth",
        `<div class="rc2-ws-metrics">
          <article><small>SKUs tracked</small><strong>${items.length}</strong></article>
          <article><small>Low stock</small><strong class="${low ? "rc2-accent-warn" : ""}">${low}</strong></article>
          <article><small>Use first</small><strong>${useFirst}</strong></article>
          <article><small>Retail value</small><strong>${money(retail)}</strong></article>
        </div>
        <div class="rc2-ws-subpanel"><p class="eyebrow">ROSE STEMS BY COLOR</p><div class="rc2-ws-chips">${roseHtml}</div></div>`
      );
    } catch {
      ensureSummary(
        page,
        "rc2InventoryHealth",
        `<div class="rc2-ws-state rc2-ws-error" role="status">Could not load inventory summary. Items below may still be available.</div>`
      );
    }
    polishCards(page);
    page.querySelectorAll(".inventory-card").forEach((card) => card.classList.add("rc2-inventory-card"));
  }

  async function enhanceCustomers() {
    const page = document.getElementById("customersPage");
    if (!page) return;
    markComplete("customersPage");
    try {
      const data = window.api ? await window.api("customers") : null;
      const rows = data?.items || [];
      const vip = rows.filter((c) => c.vip).length;
      const business = rows.filter((c) => c.is_business).length;
      const recent = rows
        .slice()
        .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")))
        .slice(0, 5);
      const recentHtml = recent.length
        ? recent.map((c) => `<span class="rc2-ws-chip">${esc(c.name)}</span>`).join("")
        : '<span class="rc2-ws-muted">No customers yet</span>';
      ensureSummary(
        page,
        "rc2CustomerConcierge",
        `<div class="rc2-ws-metrics">
          <article><small>Total customers</small><strong>${rows.length}</strong></article>
          <article><small>VIP</small><strong>${vip}</strong></article>
          <article><small>Business accounts</small><strong>${business}</strong></article>
          <article><small>House accounts</small><strong>${rows.filter((c) => c.is_house_account).length}</strong></article>
        </div>
        <div class="rc2-ws-subpanel"><p class="eyebrow">RECENT CUSTOMERS</p><div class="rc2-ws-chips">${recentHtml}</div></div>`
      );
    } catch {
      ensureSummary(page, "rc2CustomerConcierge", `<div class="rc2-ws-state rc2-ws-error" role="status">Customer summary unavailable.</div>`);
    }
    polishCards(page);
    page.querySelectorAll(".card").forEach((card) => card.classList.add("rc2-customer-card"));
  }

  function enhanceDeliveries() {
    const page = document.getElementById("deliveriesPage");
    const list = document.getElementById("deliveriesList");
    if (!page || !list) return;
    markComplete("deliveriesPage");
    const cards = [...list.querySelectorAll(".delivery-card, .card")];
    if (!cards.length) {
      list.classList.add("rc2-delivery-empty");
      return;
    }
    const groups = {
      scheduled: [],
      out: [],
      delivered: [],
    };
    cards.forEach((card) => {
      const badge = card.querySelector(".badge");
      const status = String(badge?.textContent || "PENDING").toUpperCase();
      if (status === "DELIVERED") groups.delivered.push(card);
      else if (status === "OUT_FOR_DELIVERY") groups.out.push(card);
      else groups.scheduled.push(card);
    });
    list.className = "rc2-delivery-board";
    list.innerHTML = "";
    [
      ["Scheduled & routed", groups.scheduled, "scheduled"],
      ["Out for delivery", groups.out, "out"],
      ["Delivered", groups.delivered, "delivered"],
    ].forEach(([label, items, key]) => {
      const col = document.createElement("section");
      col.className = `rc2-delivery-column rc2-delivery-${key}`;
      col.innerHTML = `<header><h2>${esc(label)}</h2><span>${items.length}</span></header><div class="rc2-delivery-stack"></div>`;
      const stack = col.querySelector(".rc2-delivery-stack");
      if (items.length) items.forEach((c) => {
        c.classList.add("rc2-ws-card", "rc2-delivery-card");
        stack.appendChild(c);
      });
      else stack.innerHTML = `<p class="rc2-ws-empty" role="status">No stops in this group.</p>`;
      list.appendChild(col);
    });
  }

  function enhanceProducts() {
    const page = document.getElementById("productsPage");
    if (!page) return;
    markComplete("productsPage");
    polishCards(page);
    page.querySelectorAll(".product-card").forEach((card) => card.classList.add("rc2-product-card"));
  }

  function enhanceLibrary() {
    const page = document.getElementById("libraryPage");
    if (!page) return;
    markComplete("libraryPage");
    polishCards(page);
    page.querySelectorAll(".floral-library-card").forEach((card) => card.classList.add("rc2-library-card"));
  }

  function enhanceFinancePages() {
    ["reportsPage", "expensesPage", "invoicesPage"].forEach((id) => {
      const page = document.getElementById(id);
      if (!page) return;
      markComplete(id);
      polishCards(page);
      page.querySelectorAll(".report-table, .report-row").forEach((el) => el.classList.add("rc2-finance-table"));
    });
  }

  function enhanceStaff() {
    const page = document.getElementById("staffPage");
    if (!page) return;
    markComplete("staffPage");
    polishCards(page);
    page.querySelectorAll(".employee-card").forEach((card) => card.classList.add("rc2-staff-card"));
  }

  function enhanceSettingsFamily() {
    ["settingsPage", "subscriptionPage", "ecosystemPage", "storesPage"].forEach((id) => {
      const page = document.getElementById(id);
      if (!page) return;
      markComplete(id);
      page.querySelectorAll(".panel, .shop-billing-root, .bloom-ecosystem-shell").forEach((el) => el.classList.add("rc2-ws-panel"));
    });
  }

  function enhanceCreativePages() {
    ["aiStudioPage", "bloomshotPage", "websitePage"].forEach((id) => {
      const page = document.getElementById(id);
      if (!page) return;
      markComplete(id);
      page.classList.add(`rc2-${id.replace("Page", "")}-workspace`);
    });
  }

  function enhancePayments() {
    const page = document.getElementById("paymentsPage");
    if (!page) return;
    markComplete("paymentsPage");
    page.classList.add("rc2-payments-workspace");
    page.querySelectorAll(".payment-tile, .payment-action-primary, .process-payment").forEach((el) => {
      el.classList.add("rc2-ws-action");
    });
  }

  function enhanceMarketplace() {
    const page = document.getElementById("marketplacePage");
    if (!page) return;
    markComplete("marketplacePage");
    polishCards(page);
    page.querySelectorAll(".marketplace-product").forEach((card) => card.classList.add("rc2-marketplace-card"));
  }

  function enhanceWholesaleSeller() {
    const page = document.getElementById("wholesaleSellerPage");
    const root = document.getElementById("wholesaleSellerRoot");
    if (!page || !root) return;
    markComplete("wholesaleSellerPage");
    root.classList.add("rc2-wholesale-seller-complete");
    polishCards(root);
    root.querySelectorAll(".wholesale-seller-nav button").forEach((btn) => btn.classList.add("rc2-ws-action"));
  }

  function enhanceDialogs() {
    document.querySelectorAll("dialog").forEach((dlg) => {
      dlg.classList.add("rc2-ws-dialog");
      if (!dlg.dataset.rc2DialogBound) {
        dlg.dataset.rc2DialogBound = "1";
        dlg.addEventListener("cancel", (e) => {
          if (dlg.classList.contains("rc2-ws-dialog-no-dismiss")) e.preventDefault();
        });
      }
    });
  }

  const enhancers = {
    inventoryPage: enhanceInventory,
    customersPage: enhanceCustomers,
    deliveriesPage: enhanceDeliveries,
    productsPage: enhanceProducts,
    libraryPage: enhanceLibrary,
    marketplacePage: enhanceMarketplace,
    wholesaleSellerPage: enhanceWholesaleSeller,
    paymentsPage: enhancePayments,
    websitePage: () => enhanceCreativePages(),
    aiStudioPage: () => enhanceCreativePages(),
    bloomshotPage: () => enhanceCreativePages(),
    reportsPage: () => enhanceFinancePages(),
    expensesPage: () => enhanceFinancePages(),
    invoicesPage: () => enhanceFinancePages(),
    staffPage: enhanceStaff,
    settingsPage: () => enhanceSettingsFamily(),
    subscriptionPage: () => enhanceSettingsFamily(),
    ecosystemPage: () => enhanceSettingsFamily(),
    storesPage: () => enhanceSettingsFamily(),
    dashboardPage: () => markComplete("dashboardPage"),
    ordersPage: () => markComplete("ordersPage"),
  };

  function runEnhancer(pageId) {
    enhanceDialogs();
    const fn = enhancers[pageId];
    if (fn) Promise.resolve(fn()).catch(() => {});
  }

  function observeList(pageId, selector) {
    const key = `${pageId}:${selector}`;
    if (observers.has(key)) return;
    const root = document.getElementById(pageId);
    const list = root?.querySelector(selector);
    if (!list) return;
    const obs = new MutationObserver(() => runEnhancer(pageId));
    obs.observe(list, { childList: true, subtree: true });
    observers.set(key, obs);
  }

  function bindObservers() {
    observeList("inventoryPage", "#inventoryList");
    observeList("customersPage", "#customersList");
    observeList("deliveriesPage", "#deliveriesList");
    observeList("productsPage", "#productsList");
    observeList("libraryPage", "#libraryList");
    observeList("wholesaleSellerPage", "#wholesaleSellerRoot");
    observeList("expensesPage", "#expensesList");
    observeList("invoicesPage", "#invoiceList");
    observeList("staffPage", "#staffList");
    observeList("marketplacePage", "#marketplaceBrowseGrid");
  }

  function wrapShowPage() {
    if (showPageWrapped || !window.showPage) return false;
    const original = window.showPage;
    window.showPage = function (id) {
      original.apply(this, arguments);
      window.setTimeout(() => runEnhancer(id), 120);
      window.setTimeout(() => runEnhancer(id), 480);
    };
    window.showPage.__rc2WsWrapped = true;
    showPageWrapped = true;
    return true;
  }

  function init() {
    document.body.classList.add("florisyn-rc2-workspaces");
    bindObservers();
    enhanceDialogs();
    const active = document.querySelector(".page.active");
    if (active?.id) runEnhancer(active.id);
    if (!wrapShowPage()) {
      let attempts = 20;
      const timer = window.setInterval(() => {
        if (wrapShowPage() || --attempts <= 0) window.clearInterval(timer);
      }, 250);
    }
    PAGE_IDS.forEach((id) => {
      if (document.getElementById(id)?.classList.contains("active")) runEnhancer(id);
    });
  }

  window.FlorisynRC2Workspaces = {
    init,
    runEnhancer,
    polishCards,
    PAGE_IDS,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
