import {
  ADMIN_CHECKLIST,
  FLORIST_CHECKLIST,
  ONBOARDING_KEYS,
  WHOLESALE_CHECKLIST,
  bloomEmptyState,
  bloomErrorState,
  bloomLoadingSkeleton,
  helpCopyForPage,
  onboardingProgress,
  parseProductImages,
  wrapApiWithCache
} from "./launch-polish-core.js";

(function initLaunchPolish() {
  let galleryState = { urls: [], index: 0, zoom: false };

  function $(s) {
    return document.querySelector(s);
  }

  function mountGalleryOverlay() {
    if (document.getElementById("bloomGalleryOverlay")) return;
    const el = document.createElement("div");
    el.id = "bloomGalleryOverlay";
    el.className = "bloom-gallery-overlay";
    el.hidden = true;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Product photo gallery");
    el.innerHTML = `
      <div class="bloom-gallery-toolbar">
        <span id="bloomGalleryCounter">1 / 1</span>
        <button type="button" id="bloomGalleryClose" aria-label="Close gallery">Close</button>
      </div>
      <div class="bloom-gallery-stage" id="bloomGalleryStage">
        <img id="bloomGalleryImage" alt="" loading="lazy">
      </div>
      <div class="bloom-gallery-nav">
        <button type="button" id="bloomGalleryPrev" aria-label="Previous photo">‹</button>
        <button type="button" id="bloomGalleryNext" aria-label="Next photo">›</button>
      </div>`;
    document.body.append(el);
    $("#bloomGalleryClose").onclick = closeGallery;
    $("#bloomGalleryPrev").onclick = () => stepGallery(-1);
    $("#bloomGalleryNext").onclick = () => stepGallery(1);
    $("#bloomGalleryImage").onclick = () => {
      galleryState.zoom = !galleryState.zoom;
      $("#bloomGalleryImage").classList.toggle("zoomed", galleryState.zoom);
    };
    let touchX = 0;
    el.addEventListener(
      "touchstart",
      (e) => {
        touchX = e.changedTouches[0]?.clientX || 0;
      },
      { passive: true }
    );
    el.addEventListener(
      "touchend",
      (e) => {
        const dx = (e.changedTouches[0]?.clientX || 0) - touchX;
        if (Math.abs(dx) > 48) stepGallery(dx > 0 ? -1 : 1);
      },
      { passive: true }
    );
    document.addEventListener("keydown", (e) => {
      if (el.hidden) return;
      if (e.key === "Escape") closeGallery();
      if (e.key === "ArrowLeft") stepGallery(-1);
      if (e.key === "ArrowRight") stepGallery(1);
    });
  }

  function openGallery(urls, start = 0) {
    mountGalleryOverlay();
    galleryState.urls = urls.filter(Boolean);
    galleryState.index = Math.max(0, Math.min(galleryState.urls.length - 1, start));
    galleryState.zoom = false;
    renderGallerySlide();
    const overlay = $("#bloomGalleryOverlay");
    overlay.hidden = false;
    $("#bloomGalleryClose").focus();
  }

  function closeGallery() {
    const overlay = $("#bloomGalleryOverlay");
    if (overlay) overlay.hidden = true;
  }

  function stepGallery(dir) {
    if (!galleryState.urls.length) return;
    galleryState.index = (galleryState.index + dir + galleryState.urls.length) % galleryState.urls.length;
    galleryState.zoom = false;
    renderGallerySlide();
  }

  function renderGallerySlide() {
    const img = $("#bloomGalleryImage");
    const counter = $("#bloomGalleryCounter");
    if (!img) return;
    img.src = galleryState.urls[galleryState.index];
    img.classList.remove("zoomed");
    img.alt = `Product photo ${galleryState.index + 1} of ${galleryState.urls.length}`;
    if (counter) counter.textContent = `${galleryState.index + 1} / ${galleryState.urls.length}`;
  }

  function productGalleryThumbHtml(urls, alt) {
    if (!urls.length) return "";
    const primary = urls[0];
    const extra = urls.length > 1 ? `<span class="bloom-gallery-count">+${urls.length - 1}</span>` : "";
    const data = urls.map(encodeURIComponent).join("|");
    return `<button type="button" class="bloom-product-gallery-thumb" data-bloom-gallery="${data}" aria-label="View ${urls.length} product photo${urls.length > 1 ? "s" : ""}">
      <img src="${primary.replace(/"/g, "&quot;")}" alt="${String(alt || "Product").replace(/"/g, "&quot;")}" loading="lazy" decoding="async">
      ${extra}
    </button>`;
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bloom-gallery]");
    if (!btn) return;
    const urls = String(btn.dataset.bloomGallery || "")
      .split("|")
      .map(decodeURIComponent)
      .filter(Boolean);
    if (urls.length) openGallery(urls, 0);
  });

  function injectPageHelp(pageId) {
    const page = document.getElementById(pageId);
    if (!page) return;
    if (pageId === "posPage") {
      // The register already has its own toolbar + "Ask Lily" access, and the
      // fixed-height checkout column means this generic bar can overlap the
      // payment buttons instead of sitting cleanly below them. Skip it here.
      page.querySelector(".bloom-page-help")?.remove();
      return;
    }
    const copy = helpCopyForPage(pageId);
    let bar = page.querySelector(".bloom-page-help");
    if (!bar) {
      // Billion-dollar design pass: this used to be an always-open <div> —
      // a two-line title+body block plus an actions row on every page,
      // ~90-120px of vertical space pushed in above the real content on
      // every navigation. Rebuilt as a native <details> so it renders as a
      // single compact row (title only) by default and reveals the body +
      // actions on click/keyboard activation, same collapsed-by-default
      // pattern already used for the assistant voice panels in Settings.
      // Ask Lily and Learn more are unchanged — just one click further in.
      bar = document.createElement("details");
      bar.className = "bloom-page-help";
      // Billion-dollar design pass, confirmed pre-existing bug: picking the
      // first ".heading" in document order isn't enough. Website Studio's
      // own shell (website-studio-shell.js) re-parents its legacy builder —
      // heading included — into one of its own tab panels *after* this
      // runs (transitionTo calls run() without awaiting it, then calls us
      // synchronously — the shell's async reorganize() lands later). Since
      // "anchor.after(bar)" makes bar a *sibling of the heading inside its
      // own container*, not a sibling of that container inside the page,
      // the bar got carried along into the hidden panel with it.
      //
      // Fix at the mounting logic, not with a per-page special case: only
      // trust a heading that is already a direct child of the page itself
      // (a real top-level page heading, not one nested inside some inner
      // shell/tab/panel a page may reorganize on its own later) and that
      // is currently visible. That's timing-safe too — Website Studio's
      // heading is nested one level inside ".legacy-website-editor-shell"
      // even in the original markup, so this check excludes it correctly
      // whether reorganize() has run yet or not. If no such heading
      // exists, prepend onto the page directly — a plain child of the
      // page can never get swept into a container's own internal
      // reshuffling the way a nested sibling can.
      let anchor = null;
      for (const h of page.querySelectorAll(".heading")) {
        if (h.parentElement === page && h.offsetParent !== null) { anchor = h; break; }
      }
      if (anchor) anchor.after(bar);
      else page.prepend(bar);
    }
    const wasOpen = bar.open;
    bar.innerHTML = `
      <summary>
        <span class="bloom-page-help-label"><span class="eyebrow">Help</span> ${copy.title}</span>
        <span class="bloom-page-help-chevron" aria-hidden="true"></span>
      </summary>
      <div class="bloom-page-help-panel">
        <p>${copy.body}</p>
        <div class="bloom-page-help-actions">
          <button type="button" class="secondary bloom-help-lily" data-page-help-lily>Ask Lily</button>
          <a class="secondary" href="${copy.learn}" target="_blank" rel="noopener">Learn more</a>
        </div>
      </div>`;
    bar.open = wasOpen;
    bar.querySelector("[data-page-help-lily]")?.addEventListener("click", () => {
      window.BloomLilyPlatform?.toggle?.(true);
    });
  }

  function mountNetworkBanner() {
    if ($("#bloomNetworkBanner")) return;
    const b = document.createElement("div");
    b.id = "bloomNetworkBanner";
    b.className = "bloom-network-banner";
    b.hidden = navigator.onLine;
    b.textContent = "Offline — some actions will resume when you reconnect.";
    document.body.prepend(b);
    window.addEventListener("online", () => {
      b.hidden = true;
    });
    window.addEventListener("offline", () => {
      b.hidden = false;
    });
    if (!navigator.onLine) b.hidden = false;
  }

  function mountOnboardingBanner(mode = "florist") {
    const key = ONBOARDING_KEYS[mode];
    if (!key || localStorage.getItem(key) === "done") return;
    const checklist = mode === "admin" ? ADMIN_CHECKLIST : mode === "wholesaler" ? WHOLESALE_CHECKLIST : FLORIST_CHECKLIST;
    let completed = [];
    try {
      completed = JSON.parse(localStorage.getItem(`${key}_steps`) || "[]");
    } catch {
      completed = [];
    }
    const prog = onboardingProgress(checklist, completed);
    if (prog.percent >= 100) {
      localStorage.setItem(key, "done");
      return;
    }
    // Confirmed regression: this used to prepend() straight onto the app
    // root (#app / #adminApp) — the element that also wraps the sidebar
    // and header, not just the page content — so the banner landed above
    // the entire application shell (header, sidebar, everything) rather
    // than above just the current page's content, on every route, not
    // only the dashboard the checklist otherwise implies. #adminApp even
    // already ships a purpose-built host for exactly this (.content's
    // admin equivalent, #adminOnboardingHost — it already has its own
    // CSS, including a `:empty{display:none}` rule) that this code was
    // never actually using. Mount into the real content containers
    // instead — everything else about the banner (checklist state,
    // dismiss, step navigation) is unchanged.
    const host = mode === "admin" ? $("#adminOnboardingHost") : $("#app .content");
    if (!host || host.querySelector(`.bloom-onboarding-banner[data-mode="${mode}"]`)) return;
    const banner = document.createElement("div");
    banner.className = "bloom-onboarding-banner";
    banner.dataset.mode = mode;
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Getting started checklist");
    // Billion-dollar design pass, confirmed bug: the general florist
    // checklist mounts once at app boot and stays until dismissed or
    // completed, on every page. loadWholesaleSeller() mounts a second,
    // wholesaler-specific banner into the same host when visiting the
    // Seller Dashboard — a real, independent checklist, not a duplicate —
    // but both used the identical "WELCOME TO FLORISYN" eyebrow, so two
    // stacked cards with the same headline read as a rendering bug rather
    // than two intentional checklists. Giving the wholesaler banner its
    // own eyebrow keeps both checklists (nothing removed) while making it
    // clear they're separate.
    const eyebrow = mode === "wholesaler" ? "WHOLESALE SETUP" : "WELCOME TO FLORISYN";
    banner.innerHTML = `
      <div style="flex:1">
        <p class="eyebrow">${eyebrow}</p>
        <strong>Setup checklist · ${prog.complete}/${prog.total} complete</strong>
        <progress max="100" value="${prog.percent}"></progress>
        <div class="bloom-onboarding-steps">${prog.remaining
          .slice(0, 4)
          .map(
            (s) =>
              `<label><input type="checkbox" data-onboard-id="${s.id}" ${completed.includes(s.id) ? "checked" : ""}> ${s.label}</label>`
          )
          .join("")}</div>
      </div>
      <button type="button" class="secondary" id="bloomDismissOnboarding">Dismiss</button>`;
    host.prepend(banner);
    if (host.hasAttribute("aria-hidden")) host.removeAttribute("aria-hidden");
    banner.querySelectorAll("[data-onboard-id]").forEach((cb) => {
      cb.onchange = () => {
        const id = cb.dataset.onboardId;
        let steps = [];
        try {
          steps = JSON.parse(localStorage.getItem(`${key}_steps`) || "[]");
        } catch {
          steps = [];
        }
        if (cb.checked && !steps.includes(id)) steps.push(id);
        if (!cb.checked) steps = steps.filter((x) => x !== id);
        localStorage.setItem(`${key}_steps`, JSON.stringify(steps));
        const next = onboardingProgress(checklist, steps);
        banner.querySelector("progress").value = next.percent;
        banner.querySelector("strong").textContent = `Setup checklist · ${next.complete}/${next.total} complete`;
        if (next.percent >= 100) {
          localStorage.setItem(key, "done");
          banner.remove();
        }
        const step = checklist.find((x) => x.id === id);
        if (cb.checked && step?.page && window.showPage) window.showPage(step.page);
        if (cb.checked && step?.lily) window.BloomLilyPlatform?.toggle?.(true);
        if (cb.checked && step?.view && window.__loadCommandView) window.__loadCommandView(step.view);
      };
    });
    banner.querySelector("#bloomDismissOnboarding").onclick = () => {
      localStorage.setItem(key, "done");
      banner.remove();
    };
  }

  function transitionTo(pageId, run) {
    const prev = document.querySelector(".page.active");
    if (prev) prev.classList.add("bloom-page-exit");
    setTimeout(async () => {
      if (prev) prev.classList.remove("bloom-page-exit");
      // Billion-dollar design pass: run() used to fire-and-forget here, so
      // for a page whose own render is async (Website Studio awaits its
      // shell/editor modules, which re-parent DOM nodes into tab panels
      // once they're ready), injectPageHelp ran against a DOM snapshot
      // from *before* that reorganizing had happened — anchoring correctly
      // in the moment, then getting swept along when the page's own
      // shell moved its container afterward. Awaiting run() first means
      // every page's DOM has already settled into its final shape by the
      // time we pick where the help bar goes. run() staying resilient to
      // its own internal failures (never throwing here) is what every
      // other caller already relies on; catch defensively so a broken
      // page render still doesn't skip mounting/refreshing the help bar.
      try {
        await run();
      } catch (err) {
        console.error(err);
      }
      injectPageHelp(pageId);
    }, 80);
  }

  function onPageStart(pageId) {
    const ids = ["customersList", "ordersList", "productsList", "inventoryList", "marketplaceBrowseGrid", "expensesList"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.children.length === 0) {
        el.innerHTML = bloomLoadingSkeleton("cards", 3);
      }
    });
  }

  function toastSuccess(message, toastFn) {
    if (toastFn) toastFn(message);
    const t = $("#toast") || $("#adminToast");
    if (t) t.classList.add("bloom-toast-success");
    setTimeout(() => t?.classList.remove("bloom-toast-success"), 3200);
  }

  function enhanceApi(api) {
    return wrapApiWithCache(api);
  }

  function init(options = {}) {
    mountGalleryOverlay();
    mountNetworkBanner();
    if (!document.getElementById("bloomSkipLink")) {
      const skip = document.createElement("a");
      skip.id = "bloomSkipLink";
      skip.href = options.mode === "admin" ? "#adminApp" : "#app";
      skip.className = "bloom-skip-link";
      skip.textContent = "Skip to main content";
      document.body.prepend(skip);
    }
    if (options.mode === "admin") {
      mountOnboardingBanner("admin");
    } else {
      mountOnboardingBanner("florist");
    }
    if (options.api && options.wrapCache !== false) {
      return enhanceApi(options.api);
    }
    return null;
  }

  window.BloomLaunchPolish = {
    init,
    transitionTo,
    onPageStart,
    refreshPageHelp: injectPageHelp,
    mountOnboarding: mountOnboardingBanner,
    emptyState: (message, opts) => bloomEmptyState({ title: "Nothing here yet", message, ...opts }),
    errorState: bloomErrorState,
    loadingSkeleton: bloomLoadingSkeleton,
    parseProductImages,
    productGalleryThumbHtml,
    openGallery,
    helpCopyForPage,
    toastSuccess,
    ONBOARDING_KEYS
  };
})();
