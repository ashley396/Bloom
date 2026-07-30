/**
 * Florisyn RC2 — Luxury init (enhanced dialog completion)
 */
(function () {
  "use strict";

  let focusTrapDialog = null;
  let focusTrapPrev = null;

  function enhanceDialogs() {
    document.querySelectorAll("dialog").forEach(function (dlg) {
      dlg.classList.add("rc2-ws-dialog");
      if (!dlg.dataset.rc2Enhanced) {
        dlg.dataset.rc2Enhanced = "1";
        dlg.addEventListener("toggle", function () {
          if (dlg.open) {
            document.body.classList.add("rc2-dialog-open");
            trapFocus(dlg);
          } else {
            document.body.classList.remove("rc2-dialog-open");
            releaseFocus();
          }
        });
      }
    });
  }

  function trapFocus(dlg) {
    focusTrapDialog = dlg;
    focusTrapPrev = document.activeElement;
    const focusable = dlg.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first) first.focus();

    function onKey(e) {
      if (e.key !== "Tab" || !dlg.open) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    dlg.__rc2KeyHandler = onKey;
    dlg.addEventListener("keydown", onKey);
  }

  function releaseFocus() {
    if (focusTrapDialog?.__rc2KeyHandler) {
      focusTrapDialog.removeEventListener("keydown", focusTrapDialog.__rc2KeyHandler);
      focusTrapDialog.__rc2KeyHandler = null;
    }
    focusTrapPrev?.focus?.();
    focusTrapDialog = null;
    focusTrapPrev = null;
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
      enhanceDialogs();
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
