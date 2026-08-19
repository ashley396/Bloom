/**
 * Florisyn Luxury POS — category shortcuts, clock, loyalty panel sync.
 * Visual/register chrome only; cart/checkout still owned by app.js.
 */
(function () {
  const LIB = "/assets/floral-library/";
  const CATEGORIES = [
    { label: "Bright Bouquets", filter: "Everyday", image: `${LIB}florisyn-everyday-sunny-bouquet.jpg` },
    { label: "Contemporary", filter: "Everyday", image: `${LIB}florisyn-everyday-spring-pastels.jpg` },
    { label: "Funeral & Sympathy", filter: "Sympathy", image: `${LIB}garden-harmony.jpg` },
    { label: "Romance Specials", filter: "Everyday", image: `${LIB}florisyn-everyday-rose-pitcher.jpg` },
    { label: "Seasonal Harvest", filter: "Everyday", image: `${LIB}florisyn-everyday-garden-medley.jpg` },
    { label: "Tropical Paradise", filter: "Plants", image: `${LIB}florisyn-everyday-market-wildflowers.jpg` },
    { label: "Hand-Tied Stems", filter: "Everyday", image: `${LIB}florisyn-everyday-daisies-tulips.jpg` },
    { label: "Luxury Vase", filter: "Everyday", image: `${LIB}florisyn-arrangement-signature-blush.jpg` }
  ];

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function tickClock() {
    const el = $("#posLuxDateTime");
    if (!el) return;
    const now = new Date();
    el.textContent = now
      .toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })
      .replace(",", " •");
  }

  function renderCategories() {
    const host = $("#posLuxCategories");
    if (!host || host.dataset.bound) return;
    host.dataset.bound = "1";
    if (!host.querySelector(".pos-lux-cat")) {
      host.innerHTML = CATEGORIES.map(
        (c, i) =>
          `<button type="button" class="pos-lux-cat${i === 0 ? " active" : ""}" data-pos-cat="${c.filter}" style="background-image:url('${c.image}')">${c.label}</button>`
      ).join("");
    }
    host.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-pos-cat]");
      if (!btn) return;
      host.querySelectorAll(".pos-lux-cat").forEach((n) => n.classList.toggle("active", n === btn));
      const filter = btn.dataset.posCat;
      const select = $("#tileCategoryFilter");
      if (select) {
        if (![...select.options].some((o) => o.value === filter || o.textContent === filter)) {
          const opt = document.createElement("option");
          opt.value = filter;
          opt.textContent = filter;
          select.appendChild(opt);
        }
        select.value = filter;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }

  function syncStaff() {
    const fromHeader = $("#atelierUserName")?.textContent?.trim();
    const email = $("#accountEmail")?.textContent?.trim();
    const staff = $("#posLuxStaffName");
    if (staff && fromHeader && fromHeader !== "Florist") staff.textContent = fromHeader;
    else if (staff && email && !staff.textContent) staff.textContent = email;
  }

  function syncCustomer() {
    const select = $("#posCustomerSelect");
    const nameEl = $("#posLuxCustomerName");
    const emailEl = $("#posLuxCustomerEmail");
    const vip = $("#posLuxVipBadge");
    if (!nameEl) return;
    const opt = select?.selectedOptions?.[0];
    const value = select?.value || "";
    const name = opt?.dataset?.name || opt?.textContent || "";
    const isWalkIn = !value;
    nameEl.textContent = isWalkIn ? "Walk-in Customer" : name;
    // No fabricated email / VIP / loyalty points — only show what's real.
    if (emailEl) emailEl.textContent = isWalkIn ? "Add a customer to this sale" : "Customer on this sale";
    if (vip) vip.hidden = true;
    const ring = $("#posLuxLoyaltyRing");
    if (ring) ring.style.setProperty("--lux-loyalty", "0");
    const pts = $("#posLuxLoyaltyPts");
    if (pts) pts.textContent = "";
    const note = $("#posLuxLoyaltyNote");
    if (note) note.textContent = isWalkIn ? "Walk-in sale — no customer attached." : "Customer attached to this sale.";
  }

  function syncStatusMetrics() {
    const tx = $("#posLuxTxCount");
    const drawer = $("#posLuxDrawerBal");
    const ordersRaw = $("#kpiSalesCount")?.textContent || "";
    const salesRaw = $("#kpiRevenue")?.textContent || $("#todaySales")?.textContent || "";
    const orders = String(ordersRaw).replace(/[^\d]/g, "");
    if (tx && orders && orders !== "0") tx.textContent = orders;
    if (drawer && salesRaw && !/^\$?0(\.00)?$/.test(salesRaw.trim())) drawer.textContent = salesRaw;
  }

  function wireActions() {
    if (document.body.dataset.posLuxWired) return;
    document.body.dataset.posLuxWired = "1";

    $("#posRecallBtn")?.addEventListener("click", () => $("#loadCartQuoteBtn")?.click());
    $("#posHoldOrderBtn")?.addEventListener("click", () => $("#saveCartQuoteBtn")?.click());
    $("#posHoldOrderBtn2")?.addEventListener("click", () => $("#saveCartQuoteBtn")?.click());
    $("#posAcceptCashBtn")?.addEventListener("click", () => {
      document.querySelector(".process-payment,[data-cart-checkout]")?.click();
    });
    $("#posSplitPayBtn")?.addEventListener("click", () => {
      document.querySelector(".process-payment,[data-cart-checkout]")?.click();
    });
    $("#posLuxApplyDiscount")?.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("florisyn-pos-discount-apply"));
    });
    $("#posCustomerSelect")?.addEventListener("change", syncCustomer);
    document.querySelectorAll("[data-pos-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-pos-mode]").forEach((b) => b.classList.toggle("active", b === btn));
        if (btn.dataset.posMode === "customer") $("#posCustomerSelect")?.focus();
        else $("#atelierGlobalSearch")?.focus();
      });
    });
    document.querySelectorAll(".pos-lux-rail-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".pos-lux-rail-btn").forEach((b) => b.classList.toggle("active", b === btn));
        if (btn.dataset.posTool === "lookup") $("#atelierGlobalSearch")?.focus();
      });
    });
  }

  function init() {
    renderCategories();
    wireActions();
    syncStaff();
    syncCustomer();
    syncStatusMetrics();
    tickClock();
    window.setInterval(tickClock, 30000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.FlorisynLuxuryPos = {
    syncCustomer,
    syncStaff,
    syncStatusMetrics,
    renderCategories
  };
})();
