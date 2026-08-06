(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;

  let hubCache = null;
  const TABS = [
    ["overview", "Overview"],
    ["subscriptions", "Subscriptions"],
    ["loyalty", "Loyalty"],
    ["memberships", "Memberships"],
    ["finance", "Finance"],
    ["vendors", "Vendors"],
    ["po", "Purchase orders"],
    ["delivery", "Delivery"],
    ["portal", "Customer portal"],
    ["reports", "Reports"],
    ["coach", "Lily coach"]
  ];

  async function api(action, extra = {}) {
    const fn = window.bloomEcosystemApi || window.api;
    if (!fn) throw new Error("Sign in required.");
    if (action === "load") return fn("business-ecosystem");
    return fn("business-ecosystem", { method: "POST", body: JSON.stringify({ action, ...extra }) });
  }

  function tabButtons(active) {
    return TABS.map(
      ([id, label]) =>
        `<button type="button" class="bloom-eco-tab${active === id ? " active" : ""}" data-eco-tab="${id}">${esc(label)}</button>`
    ).join("");
  }

  function panelOverview(h) {
    const k = h.kpis || {};
    const f = h.finance_center?.profit_and_loss || {};
    return `<div class="bloom-eco-metrics">
      <div class="bloom-eco-metric"><small>Revenue</small><strong>${money(k.revenue || f.revenue)}</strong></div>
      <div class="bloom-eco-metric"><small>Profit</small><strong>${money(k.profit || f.profit)}</strong></div>
      <div class="bloom-eco-metric"><small>Recurring</small><strong>${money(k.recurring_revenue)}</strong></div>
      <div class="bloom-eco-metric"><small>A/R</small><strong>${money(h.finance_center?.accounts_receivable)}</strong></div>
    </div>
    <p class="subtle">Integrates with POS, Payment Hub, Marketplace, Wholesale, and Command Center.</p>`;
  }

  function panelSubs(h) {
    const items = h.flower_subscriptions?.items || [];
    return `<button type="button" class="primary" id="ecoSeedSubs">+ New subscription (dialog)</button>
      <div class="bloom-eco-list">${items.map((s) => `<p><b>${esc(s.customer_name)}</b> — ${esc(s.schedule)} · ${money(s.amount)} · ${esc(s.status)}</p>`).join("") || "<p>No flower subscriptions yet.</p>"}</div>
      <p class="subtle">Types: office, church, birthday club, gift subs, and more. Auto order/payment hooks via Payment Hub.</p>`;
  }

  function panelFinance(h) {
    const fc = h.finance_center || {};
    return `<div class="bloom-eco-metrics">
      <div class="bloom-eco-metric"><small>P&amp;L profit</small><strong>${money(fc.profit_and_loss?.profit)}</strong></div>
      <div class="bloom-eco-metric"><small>Cash flow net</small><strong>${money(fc.cash_flow?.net)}</strong></div>
      <div class="bloom-eco-metric"><small>A/P</small><strong>${money(fc.accounts_payable)}</strong></div>
      <div class="bloom-eco-metric"><small>Sales tax</small><strong>${money(fc.sales_tax)}</strong></div>
    </div>`;
  }

  function render(root, hub) {
    hubCache = hub;
    root.innerHTML = `<div class="bloom-ecosystem-shell panel">
      <p class="eyebrow">FLORISYN BUSINESS ECOSYSTEM</p>
      <h2>Business operating system</h2>
      <div class="bloom-eco-tabs">${tabButtons("overview")}</div>
      ${TABS.map(([id]) => `<div class="bloom-eco-panel${id === "overview" ? " active" : ""}" data-eco-panel="${id}"></div>`).join("")}
      <p id="ecoStatus" class="subtle" aria-live="polite"></p>
    </div>`;
    fillPanel(root, "overview", panelOverview(hub));
    fillPanel(root, "subscriptions", panelSubs(hub));
    fillPanel(root, "loyalty", `<p>Loyalty tiers: ${(hub.loyalty?.tiers || []).map((t) => esc(t.label)).join(", ")}</p><div class="bloom-eco-list">${(hub.loyalty?.accounts || []).map((a) => `<p>Customer ${esc(a.customer_id?.slice(0, 8))}… — ${a.points_balance} pts (${esc(a.tier)})</p>`).join("") || "<p>No loyalty accounts yet.</p>"}</div>`);
    fillPanel(root, "memberships", `<button type="button" class="secondary" id="ecoSeedMemberships">Seed default memberships</button><div class="bloom-eco-list">${(hub.memberships?.plans || []).map((p) => `<p><b>${esc(p.name)}</b></p>`).join("") || "<p>No membership plans yet.</p>"}</div>`);
    fillPanel(root, "finance", panelFinance(hub));
    fillPanel(root, "vendors", `<div class="bloom-eco-list">${(hub.vendors || []).map((v) => `<p>${esc(v.name)} — ${esc(v.payment_terms)}</p>`).join("") || "<p>Track vendors, PO history, and terms here.</p>"}</div>`);
    fillPanel(root, "po", `<div class="bloom-eco-list">${(hub.purchase_orders || []).map((p) => `<p>PO ${esc(p.id?.slice(0, 8))}… — ${esc(p.status)} — ${money(p.total)}</p>`).join("") || "<p>No purchase orders yet.</p>"}</div>`);
    fillPanel(root, "delivery", `<div class="bloom-eco-list">${(hub.delivery_management || []).map((d) => `<p>${esc(d.driver || "Driver")} — ${esc(d.status)} · ${esc(d.gps_note || "")}</p>`).join("") || "<p>Proof of delivery, photos, signatures, mileage — extend delivery runs here.</p>"}</div>`);
    fillPanel(root, "portal", `<p>${esc(hub.customer_portal?.note || "")}</p><p>Capabilities: ${(hub.customer_portal?.capabilities || []).join(", ")}</p>`);
    fillPanel(root, "reports", `<ul>${(hub.reports || []).map((r) => `<li>${esc(r.label)}</li>`).join("")}</ul>`);
    fillPanel(root, "coach", `<div id="ecoCoachList">Loading coach tips…</div>`);
    root.querySelectorAll(".bloom-eco-tab").forEach((btn) =>
      btn.addEventListener("click", () => {
        root.querySelectorAll(".bloom-eco-tab").forEach((b) => b.classList.toggle("active", b === btn));
        root.querySelectorAll(".bloom-eco-panel").forEach((p) => p.classList.toggle("active", p.dataset.ecoPanel === btn.dataset.ecoTab));
        if (btn.dataset.ecoTab === "coach") loadCoach(root);
      })
    );
    root.querySelector("#ecoSeedMemberships")?.addEventListener("click", async () => {
      await api("membership_seed");
      await load(root);
    });
    loadCoach(root);
  }

  function fillPanel(root, id, html) {
    root.querySelector(`[data-eco-panel="${id}"]`).innerHTML = html;
  }

  async function loadCoach(root) {
    const box = root.querySelector("#ecoCoachList");
    if (!box) return;
    try {
      const d = await api("lily_coach");
      box.innerHTML = (d.suggestions || []).map((s) => `<article class="ph-metric"><strong>${esc(s.title)}</strong><p>${esc(s.detail)}</p></article>`).join("");
    } catch (e) {
      box.textContent = e.message;
    }
  }

  async function load(root) {
    const el = root || document.getElementById("ecosystemRoot");
    if (!el) return;
    el.innerHTML = "<p class='subtle'>Loading ecosystem…</p>";
    try {
      const hub = await api("load");
      render(el, hub);
    } catch (e) {
      el.innerHTML = `<p class="subtle">${esc(e.message)}</p>`;
    }
  }

  window.BloomEcosystem = { load };
})();
