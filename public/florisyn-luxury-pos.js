/**
 * Florisyn Luxury POS — category shortcuts, clock, loyalty panel sync.
 * Visual/register chrome only; cart/checkout still owned by app.js.
 */
(function () {
  const CATEGORIES = [
    { label: "Bright Bouquets", filter: "Everyday", image: "/assets/pink-bouquet.jpg" },
    { label: "Contemporary", filter: "Everyday", image: "/assets/atelier-floral-corner.jpg" },
    { label: "Funeral & Sympathy", filter: "Sympathy", image: "/assets/sympathy.png" },
    { label: "Romance Specials", filter: "Everyday", image: "/assets/rose-arr.png" },
    { label: "Seasonal Harvest", filter: "Everyday", image: "/assets/atelier-bouquet-hero.jpg" },
    { label: "Tropical Paradise", filter: "Plants", image: "/assets/orchid.png" },
    { label: "Hand-Tied Stems", filter: "Everyday", image: "/assets/tulips.png" },
    { label: "Luxury Vase", filter: "Everyday", image: "/assets/dish.png" },
    { label: "Wedding Bouquets", filter: "Wedding", image: "/assets/atelier-lilies-corner.jpg" },
    { label: "Dried & Preserved", filter: "Other", image: "/assets/spray.png" },
    { label: "Gifts & Add-ons", filter: "Gifts", image: "/assets/chocolates.png" },
    { label: "Custom Mix", filter: "Everyday", image: "/assets/fresh.png" }
  ];

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function tickClock() {
    const el = $("#posLuxDateTime");
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).replace(",", " •");
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
    const name = opt?.dataset?.name || opt?.textContent || "Clara Kensington";
    const isWalkIn = select ? value === "" : false;
    const isClara = /clara/i.test(name) || value === "clara-kensington";
    nameEl.textContent = isWalkIn ? "Walk-in Customer" : name;
    if (emailEl) {
      emailEl.textContent = isWalkIn
        ? "Select a customer for loyalty"
        : isClara
          ? "clara.kensington@email.com"
          : `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "")}@email.com`;
    }
    if (vip) vip.hidden = isWalkIn;
    const ring = $("#posLuxLoyaltyRing");
    if (ring) ring.style.setProperty("--lux-loyalty", isWalkIn ? "0" : "75");
    const pts = $("#posLuxLoyaltyPts");
    if (pts) pts.textContent = isWalkIn ? "0 pts" : "4,300 pts";
    const note = $("#posLuxLoyaltyNote");
    if (note) note.textContent = isWalkIn ? "Assign a customer to unlock loyalty." : "$50.00 reward coupon available.";
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
    $("#posLuxSearch")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const q = String(e.currentTarget.value || "").trim().toLowerCase();
      if (!q) return;
      const pads = [...document.querySelectorAll("#productPadGrid .quick-sale-pad, #productPadGrid .pad")];
      const hit = pads.find((p) => String(p.dataset.saleItem || p.title || p.textContent || "").toLowerCase().includes(q));
      if (hit) hit.click();
    });
    document.querySelectorAll("[data-pos-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-pos-mode]").forEach((b) => b.classList.toggle("active", b === btn));
        if (btn.dataset.posMode === "customer") $("#posCustomerSelect")?.focus();
        else $("#posLuxSearch")?.focus();
      });
    });
    document.querySelectorAll(".pos-lux-rail-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".pos-lux-rail-btn").forEach((b) => b.classList.toggle("active", b === btn));
        if (btn.dataset.posTool === "lookup") $("#posLuxSearch")?.focus();
      });
    });
  }

  function boot() {
    if (!$("#florisynPosLux")) return;
    renderCategories();
    tickClock();
    setInterval(tickClock, 30000);
    syncStaff();
    syncCustomer();
    syncStatusMetrics();
    wireActions();
  }

  window.FlorisynLuxuryPos = { syncCustomer, syncStatusMetrics, syncStaff, boot };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  document.addEventListener("florisyn-admin-authenticated", boot);
  document.addEventListener("florisyn-pos-refresh-cart", () => {
    syncCustomer();
    syncStatusMetrics();
  });
})();
