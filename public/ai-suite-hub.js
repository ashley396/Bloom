/**
 * Florisyn AI Suite Hub — unified UX for Marketing, Photo Studio, and POS Intelligence.
 */
(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  async function suiteApi(action, payload = {}) {
    return window.api("ai-suite", {
      method: "POST",
      body: JSON.stringify({ action, ...payload })
    });
  }

  function mountHub(root) {
    if (!root || root.querySelector(".ai-suite-hub")) return;

    root.innerHTML = `
      <div class="heading"><div><p class="eyebrow">FLORISYN AI SUITE</p><h1>Marketing · Photo · POS Intelligence</h1><p class="subtle">AI-driven tools for florists — segmentation, photo polish, and realtime shop analytics. Lily powers copy; Rose powers numbers.</p></div></div>
      <div class="ai-suite-hub">
        <nav class="ai-suite-tabs" role="tablist" aria-label="AI Suite modules">
          <button type="button" role="tab" class="active" data-tab="marketing" aria-selected="true">Marketing AI</button>
          <button type="button" role="tab" data-tab="photo">Photo AI</button>
          <button type="button" role="tab" data-tab="pos">POS Intelligence</button>
        </nav>

        <section class="ai-suite-panel active" data-panel="marketing" role="tabpanel">
          <p class="subtle">Personalized campaigns from your customer and order history — no spam, florist-first tone.</p>
          <div class="card-actions"><button type="button" class="primary" id="aiSuiteRunSegment">Analyze segments</button><button type="button" class="secondary" id="aiSuiteRunStrategy">Build strategy</button><button type="button" class="secondary" data-page="emailCampaignsPage">Email campaigns</button><button type="button" class="secondary" data-page="aiStudioPage">Lily AI Studio</button></div>
          <div id="aiSuiteMarketingOut" class="ai-suite-output" aria-live="polite"></div>
        </section>

        <section class="ai-suite-panel" data-panel="photo" role="tabpanel" hidden>
          <p class="subtle">Analyze arrangement photos, get correction suggestions, and plan social exports.</p>
          <label>Brightness hint (0–255 from BloomShot)<input type="number" id="aiSuiteBrightness" min="0" max="255" value="128"></label>
          <label>Photo notes / filename<input type="text" id="aiSuitePhotoNotes" placeholder="Romantic roses sympathy hydrangea"></label>
          <div class="card-actions"><button type="button" class="primary" id="aiSuitePhotoAnalyze">Analyze photo</button><button type="button" class="secondary" id="aiSuitePhotoCorrect">Suggest corrections</button><button type="button" class="secondary" data-page="bloomshotPage">Open Photo Studio</button></div>
          <div id="aiSuitePhotoOut" class="ai-suite-output" aria-live="polite"></div>
        </section>

        <section class="ai-suite-panel" data-panel="pos" role="tabpanel" hidden>
          <p class="subtle">Realtime KPIs and inventory alerts from your live POS data.</p>
          <div class="card-actions"><button type="button" class="primary" id="aiSuitePosKpis">24h KPIs</button><button type="button" class="secondary" id="aiSuitePosAlerts">Inventory alerts</button><button type="button" class="secondary" id="aiSuitePosInsights">30-day insights</button></div>
          <div id="aiSuitePosOut" class="ai-suite-output" aria-live="polite"></div>
        </section>
      </div>`;

    root.querySelectorAll(".ai-suite-tabs [data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        root.querySelectorAll(".ai-suite-tabs [role=tab]").forEach((b) => {
          b.classList.toggle("active", b === btn);
          b.setAttribute("aria-selected", b === btn ? "true" : "false");
        });
        root.querySelectorAll(".ai-suite-panel").forEach((p) => {
          const on = p.dataset.panel === btn.dataset.tab;
          p.hidden = !on;
          p.classList.toggle("active", on);
        });
      });
    });

    root.querySelectorAll("[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => window.showPage?.(btn.dataset.page));
    });

    async function loadPosContext() {
      const [orders, products, customers] = await Promise.all([
        window.api("orders").catch(() => ({ items: [] })),
        window.api("products").catch(() => ({ items: [] })),
        window.api("customers").catch(() => ({ items: [] }))
      ]);
      return {
        orders: orders.items || orders || [],
        products: products.items || products || [],
        customers: customers.items || customers || [],
        shop: window.shopSettings || {}
      };
    }

    root.querySelector("#aiSuiteRunSegment")?.addEventListener("click", async () => {
      const out = root.querySelector("#aiSuiteMarketingOut");
      out.textContent = "Analyzing customer segments…";
      try {
        const ctx = await loadPosContext();
        const d = await suiteApi("marketing_segment", ctx);
        out.innerHTML = `<pre>${esc(JSON.stringify(d.summary, null, 2))}</pre><p>VIP: ${d.segments?.vip?.length || 0} · At risk: ${d.segments?.at_risk?.length || 0} · New: ${d.segments?.new_buyers?.length || 0}</p>`;
      } catch (e) {
        out.textContent = e.message;
      }
    });

    root.querySelector("#aiSuiteRunStrategy")?.addEventListener("click", async () => {
      const out = root.querySelector("#aiSuiteMarketingOut");
      out.textContent = "Building personalized strategy…";
      try {
        const ctx = await loadPosContext();
        const seg = await suiteApi("marketing_segment", ctx);
        const d = await suiteApi("marketing_strategy", { shop: ctx.shop, segments: seg.segments });
        out.innerHTML = (d.strategy?.tactics || [])
          .map((t) => `<article class="ai-tactic"><strong>${esc(t.channel)}</strong> — ${esc(t.title)}<br><span class="subtle">${esc(t.message_angle)}</span></article>`)
          .join("");
      } catch (e) {
        out.textContent = e.message;
      }
    });

    root.querySelector("#aiSuitePhotoAnalyze")?.addEventListener("click", async () => {
      const out = root.querySelector("#aiSuitePhotoOut");
      out.textContent = "Analyzing…";
      try {
        const d = await suiteApi("photo_analyze", {
          meta: {
            brightness: Number(root.querySelector("#aiSuiteBrightness").value),
            notes: root.querySelector("#aiSuitePhotoNotes").value,
            width: 1200,
            height: 1200
          }
        });
        out.innerHTML = `<p>Quality score: <strong>${d.analysis.quality_score}</strong></p><p>Tags: ${esc(d.analysis.tags.join(", "))}</p><ul>${d.analysis.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
      } catch (e) {
        out.textContent = e.message;
      }
    });

    root.querySelector("#aiSuitePhotoCorrect")?.addEventListener("click", async () => {
      const out = root.querySelector("#aiSuitePhotoOut");
      try {
        const d = await suiteApi("photo_suggest_corrections", {
          meta: { brightness: Number(root.querySelector("#aiSuiteBrightness").value), notes: root.querySelector("#aiSuitePhotoNotes").value },
          adjustments: { brightness: 100, contrast: 100, saturation: 100, warmth: 0 }
        });
        out.innerHTML = `<p>Preset: <strong>${esc(d.suggested.preset)}</strong></p><ul>${d.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul><pre>${esc(JSON.stringify(d.suggested, null, 2))}</pre>`;
      } catch (e) {
        out.textContent = e.message;
      }
    });

    root.querySelector("#aiSuitePosKpis")?.addEventListener("click", async () => {
      const out = root.querySelector("#aiSuitePosOut");
      out.textContent = "Loading KPIs…";
      try {
        const ctx = await loadPosContext();
        const d = await suiteApi("pos_realtime_kpis", { orders: ctx.orders, products: ctx.products });
        out.innerHTML = `<pre>${esc(JSON.stringify(d.kpis, null, 2))}</pre>`;
      } catch (e) {
        out.textContent = e.message;
      }
    });

    root.querySelector("#aiSuitePosAlerts")?.addEventListener("click", async () => {
      const out = root.querySelector("#aiSuitePosOut");
      try {
        const ctx = await loadPosContext();
        const d = await suiteApi("pos_inventory_alerts", { products: ctx.products });
        out.innerHTML = (d.alerts || []).slice(0, 12).map((a) => `<p><strong>${esc(a.level)}</strong> ${esc(a.name)} — ${esc(a.action)}</p>`).join("") || "<p>No alerts.</p>";
      } catch (e) {
        out.textContent = e.message;
      }
    });

    root.querySelector("#aiSuitePosInsights")?.addEventListener("click", async () => {
      const out = root.querySelector("#aiSuitePosOut");
      try {
        const ctx = await loadPosContext();
        const d = await suiteApi("pos_sales_insights", { orders: ctx.orders });
        out.innerHTML = `<pre>${esc(JSON.stringify(d.insights, null, 2))}</pre>`;
      } catch (e) {
        out.textContent = e.message;
      }
    });
  }

  function load() {
    const page = document.getElementById("aiSuitePage");
    if (page) mountHub(page);
  }

  window.BloomAiSuite = { load, suiteApi, mountHub };
})();
