/**
 * Florisyn RC2 — Luxury init
 * Applies cohesive UI polish across the production SPA.
 * No business logic — DOM classes, dialog animation, page consistency only.
 */
(function () {
  "use strict";

  function enhanceDialogs() {
    document.querySelectorAll("dialog").forEach(function (dlg) {
      if (!dlg.dataset.rc2Enhanced) {
        dlg.dataset.rc2Enhanced = "1";
        dlg.addEventListener("toggle", function () {
          if (dlg.open) {
            document.body.classList.add("rc2-dialog-open");
          } else {
            document.body.classList.remove("rc2-dialog-open");
          }
        });
      }
    });
  }

  function enhancePageHeadings() {
    document.querySelectorAll(".page.active .heading h1").forEach(function (h1) {
      h1.classList.add("rc2-page-title");
    });
  }

  function syncMobileNav() {
    var activePage = document.querySelector(".page.active");
    if (!activePage) return;
    var pageId = activePage.id;
    document.querySelectorAll(".mobile-nav button[data-page]").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.page === pageId);
    });
  }

  function observePageChanges() {
    var content = document.querySelector(".content");
    if (!content || content.dataset.rc2Observed) return;
    content.dataset.rc2Observed = "1";
    var observer = new MutationObserver(function () {
      enhancePageHeadings();
      syncMobileNav();
    });
    observer.observe(content, { attributes: true, subtree: true, attributeFilter: ["class"] });
  }

  function init() {
    document.body.classList.add("florisyn-rc2-luxury");
    enhanceDialogs();
    enhancePageHeadings();
    syncMobileNav();
    observePageChanges();
    window.FlorisynRC2 = window.FlorisynRC2 || {};
    window.FlorisynRC2.enhanceDialogs = enhanceDialogs;
    window.FlorisynRC2.syncMobileNav = syncMobileNav;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
