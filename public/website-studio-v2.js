/**
 * Website Studio V2 — 3-panel florist builder: pages, canvas, SEO & launch checklist.
 */
(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  async function api(action, extra = {}) {
    return window.api("instant-website", { method: "POST", body: JSON.stringify({ action, ...extra }) });
  }

  function mountStudioV2(root) {
    if (!root || root.querySelector(".website-studio-v2")) return;

    const shell = document.createElement("div");
    shell.className = "website-studio-v2 panel bloom-rc1-wizard";
    shell.innerHTML = `
      <div class="ws2-panel ws2-panel-pages">
        <p class="eyebrow">PAGES</p>
        <h3>Site structure</h3>
        <ul class="ws2-page-list" id="ws2PageList"></ul>
      </div>
      <div class="ws2-panel ws2-panel-canvas">
        <p class="eyebrow">VISUAL EDITOR</p>
        <div class="ws2-toolbar">
          <button type="button" class="secondary" id="ws2RefreshPreview">Refresh live preview</button>
          <button type="button" class="secondary" data-device="desktop">Desktop</button>
          <button type="button" class="secondary" data-device="tablet">Tablet</button>
          <button type="button" class="secondary" data-device="mobile">Mobile</button>
          <button type="button" class="primary" id="ws2RunChecklist">Launch checklist</button>
        </div>
        <div class="ws2-live-preview" id="ws2LivePreview" data-device="desktop">
          <iframe id="ws2PreviewFrame" title="Live storefront preview" loading="lazy" height="480"></iframe>
        </div>
        <p class="ws2-autosave" id="ws2AutosaveStatus" aria-live="polite">Open a page in the visual editor below to edit sections.</p>
      </div>
      <div class="ws2-panel ws2-panel-seo">
        <p class="eyebrow">SEO & LAUNCH</p>
        <h3>Search & social</h3>
        <div class="ws2-seo-field">
          <label>Site SEO title<input id="ws2SeoTitle" maxlength="70" placeholder="Shop Name — Florist in City"></label>
          <label>Meta description<textarea id="ws2SeoDescription" rows="3" maxlength="160" placeholder="50–160 characters for Google and social previews"></textarea><span class="ws2-char-count" id="ws2DescCount">0/160</span></label>
          <button type="button" class="secondary" id="ws2SaveSeo">Save SEO settings</button>
        </div>
        <hr>
        <h3>Page SEO</h3>
        <div class="ws2-seo-field">
          <label>Page title override<input id="ws2PageSeoTitle" maxlength="70"></label>
          <label>Page meta description<textarea id="ws2PageSeoDesc" rows="2" maxlength="160"></textarea></label>
          <button type="button" class="secondary" id="ws2SavePageSeo">Save page SEO</button>
        </div>
        <div class="ws2-kpis" id="ws2Kpis" hidden>
          <div class="ws2-kpi"><small>Readiness</small><strong id="ws2Readiness">—</strong></div>
          <div class="ws2-kpi"><small>SEO score</small><strong id="ws2SeoScore">—</strong></div>
        </div>
        <ul class="ws2-checklist" id="ws2Checklist"></ul>
        <hr>
        <h3>Custom domain</h3>
        <div class="ws2-seo-field ws2-domain-field">
          <label>Your domain<input id="ws2DomainInput" placeholder="www.yourflowershop.com"></label>
          <button type="button" class="secondary" id="ws2DomainConnect">Connect domain</button>
          <button type="button" class="secondary" id="ws2DomainVerify">Verify DNS</button>
          <div id="ws2DomainInstructions" class="subtle"></div>
          <p id="ws2DomainStatus" class="subtle" aria-live="polite"></p>
        </div>
        <p id="ws2SeoStatus" class="subtle" aria-live="polite"></p>
      </div>`;
    root.appendChild(shell);

    let pages = [];
    let project = null;
    let activeSlug = "home";
    let previewUrl = null;

    async function loadProject() {
      const d = await api("get_project");
      project = d.project;
      pages = d.pages || [];
      renderPageList();
      fillSeoFields();
      await refreshPreview();
    }

    function renderPageList() {
      const list = shell.querySelector("#ws2PageList");
      const navPages = pages.filter((p) => p.visible !== false).slice(0, 24);
      list.innerHTML = navPages
        .map(
          (p) =>
            `<li><button type="button" data-slug="${esc(p.slug)}" class="${p.slug === activeSlug ? "active" : ""}">${esc(p.title)}<span class="slug">/${esc(p.slug === "home" ? "" : p.slug)}</span></button></li>`
        )
        .join("");
      list.querySelectorAll("button[data-slug]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeSlug = btn.dataset.slug;
          renderPageList();
          fillPageSeoFields();
          if (window.BloomWebsiteEditor?.selectPage) window.BloomWebsiteEditor.selectPage(activeSlug);
        });
      });
    }

    function fillSeoFields() {
      const seo = project?.seo_settings || {};
      shell.querySelector("#ws2SeoTitle").value = seo.title || "";
      shell.querySelector("#ws2SeoDescription").value = seo.meta_description || "";
      updateDescCount();
      fillPageSeoFields();
    }

    function fillPageSeoFields() {
      const page = pages.find((p) => p.slug === activeSlug);
      shell.querySelector("#ws2PageSeoTitle").value = page?.content?.seo_title || "";
      shell.querySelector("#ws2PageSeoDesc").value = page?.content?.meta_description || "";
    }

    function updateDescCount() {
      const len = shell.querySelector("#ws2SeoDescription").value.length;
      shell.querySelector("#ws2DescCount").textContent = `${len}/160`;
    }

    async function refreshPreview() {
      const status = shell.querySelector("#ws2AutosaveStatus");
      try {
        const preview = await window.api("storefront-public", {
          method: "POST",
          body: JSON.stringify({ action: "preview_token" })
        });
        if (!preview?.preview_url) {
          status.textContent = "Preview unavailable — save a draft first.";
          return;
        }
        previewUrl = preview.preview_url;
        const frame = shell.querySelector("#ws2PreviewFrame");
        const slugPath = activeSlug === "home" ? "" : `/${activeSlug}`;
        frame.src = previewUrl.replace(/\/?$/, "") + slugPath;
        status.textContent = "Live preview loaded — unpublished changes appear after save.";
      } catch (e) {
        status.textContent = e.message || "Could not load preview.";
      }
    }

    async function runChecklist() {
      const status = shell.querySelector("#ws2SeoStatus");
      status.textContent = "Running launch checklist…";
      try {
        const d = await api("publish_checklist", { project, pages });
        shell.querySelector("#ws2Kpis").hidden = false;
        shell.querySelector("#ws2Readiness").textContent = `${d.kpis?.readiness_score ?? 0}%`;
        shell.querySelector("#ws2SeoScore").textContent = `${d.kpis?.seo_score ?? 0}%`;
        const list = shell.querySelector("#ws2Checklist");
        list.innerHTML = (d.items || [])
          .map((i) => `<li class="${i.pass ? "pass" : "fail"}">${esc(i.label)}${!i.pass && i.fix ? ` — ${esc(i.fix)}` : ""}</li>`)
          .join("");
        status.textContent = d.ready ? "Ready to publish when you approve." : "Complete checklist items before publishing.";
      } catch (e) {
        status.textContent = e.message;
      }
    }

    shell.querySelector("#ws2SeoDescription")?.addEventListener("input", updateDescCount);

    shell.querySelector("#ws2SaveSeo")?.addEventListener("click", async () => {
      const status = shell.querySelector("#ws2SeoStatus");
      status.textContent = "Saving SEO…";
      try {
        const d = await api("update_seo", {
          seo_title: shell.querySelector("#ws2SeoTitle").value,
          meta_description: shell.querySelector("#ws2SeoDescription").value,
          pages
        });
        project = { ...project, seo_settings: d.seo_settings };
        status.textContent = "Site SEO saved.";
        window.toast?.("SEO settings saved");
      } catch (e) {
        status.textContent = e.message;
      }
    });

    shell.querySelector("#ws2SavePageSeo")?.addEventListener("click", async () => {
      const status = shell.querySelector("#ws2SeoStatus");
      status.textContent = "Saving page SEO…";
      try {
        await api("update_page_seo", {
          slug: activeSlug,
          seo_title: shell.querySelector("#ws2PageSeoTitle").value,
          meta_description: shell.querySelector("#ws2PageSeoDesc").value
        });
        const idx = pages.findIndex((p) => p.slug === activeSlug);
        if (idx >= 0) {
          pages[idx].content = {
            ...(pages[idx].content || {}),
            seo_title: shell.querySelector("#ws2PageSeoTitle").value,
            meta_description: shell.querySelector("#ws2PageSeoDesc").value
          };
        }
        status.textContent = `Page SEO saved for ${activeSlug}.`;
      } catch (e) {
        status.textContent = e.message;
      }
    });

    shell.querySelector("#ws2RefreshPreview")?.addEventListener("click", () => refreshPreview());
    shell.querySelector("#ws2RunChecklist")?.addEventListener("click", () => runChecklist());

    shell.querySelector("#ws2DomainConnect")?.addEventListener("click", async () => {
      const status = shell.querySelector("#ws2DomainStatus");
      const domain = shell.querySelector("#ws2DomainInput").value.trim();
      status.textContent = "Saving domain…";
      try {
        const d = await api("connect_domain", { domain });
        const steps = (d.instructions?.steps || []).map((s) => `<li>${esc(s)}</li>`).join("");
        shell.querySelector("#ws2DomainInstructions").innerHTML = `<ol>${steps}</ol><p>CNAME → <code>${esc(d.instructions?.records?.[0]?.value || "")}</code></p>`;
        status.textContent = d.verification?.verified ? "Domain verified!" : "Add the CNAME record, then click Verify DNS.";
      } catch (e) {
        status.textContent = e.message;
      }
    });

    shell.querySelector("#ws2DomainVerify")?.addEventListener("click", async () => {
      const status = shell.querySelector("#ws2DomainStatus");
      status.textContent = "Checking DNS…";
      try {
        const d = await api("verify_domain", { domain: shell.querySelector("#ws2DomainInput").value.trim() });
        status.textContent = d.verified
          ? "Domain verified — published SEO will use your custom domain."
          : d.verification?.error || "DNS not verified yet.";
      } catch (e) {
        status.textContent = e.message;
      }
    });

    shell.querySelectorAll("[data-device]").forEach((btn) => {
      btn.addEventListener("click", () => {
        shell.querySelector("#ws2LivePreview").dataset.device = btn.dataset.device;
        const h = btn.dataset.device === "mobile" ? 640 : btn.dataset.device === "tablet" ? 520 : 480;
        shell.querySelector("#ws2PreviewFrame").height = h;
      });
    });

    loadProject().catch((e) => {
      shell.querySelector("#ws2SeoStatus").textContent = e.message;
    });
  }

  function load() {
    const page = document.getElementById("websitePage");
    if (page) mountStudioV2(page);
  }

  window.BloomWebsiteStudioV2 = { load, mountStudioV2 };
})();
