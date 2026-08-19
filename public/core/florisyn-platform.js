/**
 * Florisyn Platform — client-side services layer.
 * Mobile navigation, assistant routing (Lily · Rose · Daisy), and global resilience.
 */
(function (global) {
  "use strict";

  var OFFICIAL_LOGO = "/assets/florisyn/florisyn-official-icon.png?v=official1";
  var OFFICIAL_MARK = "/assets/florisyn/florisyn-mark.png?v=official1";

  var ASSISTANTS = {
    lily: { page: "aiStudioPage", openLily: true },
    rose: { page: "reportsPage", openLily: false },
    daisy: { page: "dashboardPage", openLily: false, wag: true },
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function setDrawer(open) {
    document.body.classList.toggle("atelier-drawer-open", !!open);
    var backdrop = $("#atelierSidebarBackdrop");
    if (backdrop) backdrop.hidden = !open;
    var toggle = $("#atelierMenuToggle");
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.classList.toggle("florisyn-nav-locked", !!open);
    if (open) {
      var first = document.querySelector("#atelierSidebarDrawer button[data-page]");
      first?.focus?.();
    }
  }

  function wireMobileMoreTab() {
    var more = $("#mobileNavMore");
    if (!more || more.dataset.platformBound) return;
    more.dataset.platformBound = "1";
    more.addEventListener("click", function (e) {
      e.preventDefault();
      setDrawer(true);
    });
  }

  function wireAssistantDock() {
    document.querySelectorAll(".assistant-mini-dock button[data-assistant]").forEach(function (btn) {
      if (btn.dataset.platformBound) return;
      btn.dataset.platformBound = "1";
      btn.addEventListener("click", function (e) {
        var id = btn.getAttribute("data-assistant");
        var cfg = ASSISTANTS[id];
        if (!cfg) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof global.showPage === "function") global.showPage(cfg.page);
        if (cfg.openLily && global.BloomLilyPlatform?.toggle) global.BloomLilyPlatform.toggle(true);
        if (cfg.wag) {
          global.BloomDaisy?.gentleWag?.("Daisy says hi!");
          var toastEl = document.getElementById("toast");
          if (toastEl) {
            toastEl.textContent = "Daisy is cheering you on — Lily and Rose are ready when you need them.";
            toastEl.hidden = false;
            clearTimeout(global.__florisynDaisyToast);
            global.__florisynDaisyToast = setTimeout(function () {
              toastEl.hidden = true;
            }, 3200);
          }
        }
      });
    });
  }

  function applyOfficialLogo() {
    document.querySelectorAll(".florisyn-official-logo").forEach(function (img) {
      if (!img.getAttribute("src")) img.src = OFFICIAL_LOGO;
    });
    document.querySelectorAll(".florisyn-brand-mark").forEach(function (img) {
      if (!img.getAttribute("src")) img.src = OFFICIAL_MARK;
    });
    var loading = $(".florisyn-loading-mark");
    if (loading) loading.src = OFFICIAL_LOGO;
  }

  function wireEscapeClose() {
    if (document.body.dataset.platformEscape) return;
    document.body.dataset.platformEscape = "1";
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.body.classList.contains("atelier-drawer-open")) {
        setDrawer(false);
      }
    });
  }

  function init() {
    wireMobileMoreTab();
    wireAssistantDock();
    applyOfficialLogo();
    wireEscapeClose();
  }

  global.FlorisynPlatform = {
    OFFICIAL_LOGO: OFFICIAL_LOGO,
    OFFICIAL_MARK: OFFICIAL_MARK,
    ASSISTANTS: ASSISTANTS,
    setDrawer: setDrawer,
    init: init,
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
