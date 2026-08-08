/**
 * Florisyn client-side router — History API + persistent shell.
 * Sidebar/header stay mounted; only `.page` sections swap by pathname.
 */
(function () {
  const ROUTES = {
    "/": { page: "dashboardPage", path: "/dashboard" },
    "/dashboard": { page: "dashboardPage" },
    "/pos": { page: "posPage" },
    "/orders": { page: "ordersPage" },
    "/products": { page: "productsPage" },
    "/bouquets": { page: "bouquetsPage" },
    "/customers": { page: "customersPage" },
    "/deliveries": { page: "deliveriesPage" },
    "/payment-centre": { page: "paymentsPage" },
    "/payment-center": { page: "paymentsPage", path: "/payment-centre" },
    "/lily-ai-studio": { page: "aiStudioPage" },
    "/analytics": { page: "analyticsPage" },
    "/reports": { page: "reportsPage" },
    "/expenses": { page: "expensesPage" },
    "/photo-studio": { page: "bloomshotPage" },
    "/website-studio": { page: "websitePage" },
    "/floral-library": { page: "libraryPage" },
    "/staff": { page: "staffPage" },
    "/wholesale": { page: "marketplacePage" },
    "/stores": { page: "storesPage" },
    "/business-os": { page: "ecosystemPage" },
    "/pos-settings": { page: "posSettingsPage" },
    "/settings": { page: "settingsPage" },
    "/inventory": { page: "inventoryPage" },
    "/invoices": { page: "invoicesPage" },
    "/subscription": { page: "subscriptionPage" },
    "/community": { page: "communityPage" },
    "/wholesale/seller": { page: "wholesaleSellerPage" }
  };

  /** Preferred URL when navigating by page id (programmatic showPage). */
  const PAGE_PATH = {
    dashboardPage: "/dashboard",
    posPage: "/pos",
    ordersPage: "/orders",
    productsPage: "/products",
    bouquetsPage: "/bouquets",
    libraryPage: "/floral-library",
    customersPage: "/customers",
    deliveriesPage: "/deliveries",
    paymentsPage: "/payment-centre",
    aiStudioPage: "/lily-ai-studio",
    analyticsPage: "/analytics",
    reportsPage: "/reports",
    expensesPage: "/expenses",
    bloomshotPage: "/photo-studio",
    websitePage: "/website-studio",
    staffPage: "/staff",
    marketplacePage: "/wholesale",
    storesPage: "/stores",
    ecosystemPage: "/business-os",
    posSettingsPage: "/pos-settings",
    settingsPage: "/settings",
    inventoryPage: "/inventory",
    invoicesPage: "/invoices",
    subscriptionPage: "/subscription",
    communityPage: "/community",
    wholesaleSellerPage: "/wholesale/seller"
  };

  let currentPath = "/dashboard";
  let applying = false;
  let showPageFn = null;

  function normalizePath(pathname) {
    if (!pathname || pathname === "/") return "/";
    const clean = String(pathname).replace(/\/+$/, "") || "/";
    return clean.startsWith("/") ? clean : `/${clean}`;
  }

  function resolve(pathname) {
    const path = normalizePath(pathname);
    const entry = ROUTES[path];
    if (!entry) return { path: "/dashboard", page: "dashboardPage", unknown: true };
    return {
      path: entry.path || path,
      page: entry.page,
      unknown: false
    };
  }

  function pathForPage(pageId, preferredPath) {
    if (preferredPath && ROUTES[normalizePath(preferredPath)]?.page === pageId) {
      return ROUTES[normalizePath(preferredPath)].path || normalizePath(preferredPath);
    }
    return PAGE_PATH[pageId] || "/dashboard";
  }

  function syncActiveNav(path) {
    const activePath = normalizePath(path);
    document
      .querySelectorAll(
        "#app aside button[data-page], #app aside a[data-page], .mobile-nav button[data-page], .mobile-nav a[data-page], .assistant-mini-dock button[data-page], .florisyn-lux-nav button[data-page]"
      )
      .forEach((el) => {
        const route = el.getAttribute("data-route") || PAGE_PATH[el.dataset.page] || "";
        const match = normalizePath(route) === activePath;
        el.classList.toggle("active", match);
        if (match) el.setAttribute("aria-current", "page");
        else el.removeAttribute("aria-current");
      });
  }

  function setUrl(path, { replace = false, search = "", hash = "" } = {}) {
    const next = normalizePath(path);
    const url = `${next}${search || ""}${hash || ""}`;
    const state = { florisynRoute: next };
    if (replace) history.replaceState(state, "", url);
    else if (normalizePath(location.pathname) !== next || (search && location.search !== search)) {
      history.pushState(state, "", url);
    } else {
      history.replaceState(state, "", url);
    }
    currentPath = next;
  }

  function applyPath(pathname, { replace = false, skipHistory = false, search, hash } = {}) {
    const resolved = resolve(pathname);
    if (resolved.unknown && pathname && normalizePath(pathname) !== "/") {
      // Fall back quietly to dashboard for unknown florist routes.
    }
    const targetPath = resolved.path;
    const pageId = resolved.page;

    if (!skipHistory) setUrl(targetPath, { replace: replace || resolved.unknown, search, hash });
    else currentPath = targetPath;

    applying = true;
    try {
      const go = showPageFn || window.showPage;
      if (typeof go === "function") go(pageId, { fromRouter: true, path: targetPath });
      else {
        document.querySelectorAll(".page").forEach((p) => {
          const on = p.id === pageId;
          p.classList.toggle("active", on);
          p.hidden = !on;
        });
        syncActiveNav(targetPath);
      }
    } finally {
      applying = false;
    }
    syncActiveNav(targetPath);
    document.dispatchEvent(
      new CustomEvent("florisyn-route-change", { detail: { path: targetPath, page: pageId } })
    );
    return { path: targetPath, page: pageId };
  }

  function navigate(to, opts = {}) {
    if (typeof to === "string" && to.startsWith("/")) return applyPath(to, opts);
    if (typeof to === "string") return navigateToPage(to, opts);
    return applyPath("/dashboard", opts);
  }

  function navigateToPage(pageId, opts = {}) {
    const path = pathForPage(pageId, opts.path);
    return applyPath(path, opts);
  }

  /**
   * Wrap showPage so programmatic navigation also updates the URL,
   * without double-applying when the router itself called showPage.
   */
  function installShowPageBridge(fn) {
    showPageFn = function florisynShowPage(id, meta = {}) {
      if (meta?.fromRouter) {
        fn(id);
        syncActiveNav(meta.path || currentPath);
        return;
      }
      const path = pathForPage(id, meta.path);
      if (!applying && normalizePath(location.pathname) !== path) {
        setUrl(path, { replace: Boolean(meta.replace) });
      }
      currentPath = path;
      fn(id);
      syncActiveNav(path);
    };
    window.showPage = showPageFn;
    return showPageFn;
  }

  function onNavClick(e) {
    if (e.defaultPrevented) return;
    const el = e.target.closest?.("[data-route], [data-page]");
    if (!el) return;
    if (el.closest("dialog")) return;
    if (el.hasAttribute("data-open")) return;
    // Ignore plain form controls / selects that may carry leftover data-page.
    if (el.matches("option, select, input, textarea, label")) return;
    const inShell = el.closest(
      "#atelierSidebarDrawer, .florisyn-lux-nav, .mobile-nav, .atelier-mobile-nav, .assistant-mini-dock, .platform-top-strip, .florisyn-lux-header, .atelier-premium-card, .atelier-panel-head, .atelier-inventory-alert, .atelier-empty, .content, .atelier-dash-overview"
    );
    if (!inShell) return;

    const route = el.getAttribute("data-route");
    const page = el.dataset.page;
    if (!route && !page) return;
    // Only buttons/links/nav affordances — not arbitrary nested nodes with data-page.
    if (!el.matches("button, a, [role='button'], .atelier-inventory-alert, .atelier-panel-more, .atelier-view-all")) {
      if (!el.hasAttribute("data-route") && !el.hasAttribute("data-page")) return;
      if (!el.matches("button, a")) return;
    }

    e.preventDefault();
    if (route) applyPath(route);
    else navigateToPage(page);
  }

  function bootFromLocation({ replace = true } = {}) {
    const qp = new URLSearchParams(location.search);
    const legacyPage = qp.get("page");
    if (legacyPage) {
      qp.delete("page");
      const search = qp.toString() ? `?${qp.toString()}` : "";
      const path = legacyPage.startsWith("/") ? legacyPage : pathForPage(legacyPage.endsWith("Page") ? legacyPage : `${legacyPage}Page`);
      return applyPath(path, { replace: true, search });
    }
    return applyPath(location.pathname || "/dashboard", {
      replace,
      search: location.search,
      hash: location.hash
    });
  }

  function init() {
    if (document.body.dataset.florisynRouterInit) return;
    document.body.dataset.florisynRouterInit = "1";
    document.addEventListener("click", onNavClick);
    window.addEventListener("popstate", () => {
      applyPath(location.pathname || "/dashboard", { skipHistory: true, search: location.search, hash: location.hash });
    });
  }

  window.FlorisynRouter = {
    ROUTES,
    PAGE_PATH,
    init,
    navigate,
    navigateToPage,
    applyPath,
    bootFromLocation,
    installShowPageBridge,
    syncActiveNav,
    resolve,
    pathForPage,
    get path() {
      return currentPath;
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
