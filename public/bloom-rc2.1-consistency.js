(function () {
  /** RC2.1 §10 — lightweight DOM passes (no data/logic changes). */

  // Orders already ships its own search box (#ordSearch, wired in
  // florisyn-luxury-orders.js) and its own refresh button listener
  // (#refreshOrderBoard, wired in app.js). This used to inject a second,
  // unstyled search input (.bloom-orders-toolbar / #bloomOrderSearch)
  // above the real one on every order-board refresh — kept as a no-op so
  // callers (app.js, bloom-rc2.1-founder-polish.js) can still call it
  // safely without re-introducing the duplicate.
  function wireOrdersSearch() {}

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
