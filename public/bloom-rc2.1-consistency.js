(function () {
  /** RC2.1 §10 — lightweight DOM passes (no data/logic changes). */

  function wireOrdersSearch() {
    const page = document.getElementById("ordersPage");
    if (!page || page.querySelector(".bloom-orders-toolbar")) return;
    const bar = document.createElement("div");
    bar.className = "bloom-orders-toolbar panel";
    bar.innerHTML = `<label class="visually-hidden" for="bloomOrderSearch">Search orders</label>
      <input type="search" id="bloomOrderSearch" placeholder="Search customer, order #, recipient…">`;
    const layout = page.querySelector(".order-command-layout");
    (layout || page.querySelector(".heading"))?.before(bar);
    bar.querySelector("#bloomOrderSearch")?.addEventListener("input", () => {
      const q = bar.querySelector("#bloomOrderSearch").value.toLowerCase();
      document.querySelectorAll("[data-order-card]").forEach((el) => {
        el.style.display = el.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });
    document.getElementById("refreshOrderBoard")?.addEventListener("click", () => {
      window.loadOrders?.();
    });
  }

  function normalizeDialogs() {
    document.querySelectorAll("dialog").forEach((dlg) => {
      const form = dlg.querySelector("form");
      if (form && !form.classList.contains("dialog-shell") && !dlg.classList.contains("order-builder-dialog")) {
        form.classList.add("bloom-rc21-dialog-form");
      }
    });
  }

  function markActivePage(pageId) {
    document.querySelectorAll(".page").forEach((p) => {
      p.classList.toggle("bloom-rc21-page", p.id === pageId);
    });
  }

  function patchShowPage() {
    const prev = window.showPage;
    if (!prev || prev.__bloomRc21Patched) return;
    window.showPage = function (id) {
      const r = prev.apply(this, arguments);
      markActivePage(id);
      if (id === "ordersPage") wireOrdersSearch();
      return r;
    };
    window.showPage.__bloomRc21Patched = true;
  }

  function init() {
    normalizeDialogs();
    patchShowPage();
    const active = document.querySelector(".page.active");
    if (active) markActivePage(active.id);
    if (document.getElementById("ordersPage")?.classList.contains("active")) wireOrdersSearch();
  }

  window.BloomRC21Consistency = { init, wireOrdersSearch };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
