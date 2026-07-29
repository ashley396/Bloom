(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const money = (n) => `$${Number(n || 0).toFixed(2)}`;

  let hubCache = null;
  let canConfigure = false;

  function badgeMode(mode) {
    if (mode === "live") return '<span class="ph-badge live">Live</span>';
    if (mode === "coming_soon") return '<span class="ph-badge soon">Coming soon</span>';
    if (mode === "test") return '<span class="ph-badge test">Test</span>';
    return `<span class="ph-badge">${esc(mode || "—")}</span>`;
  }

  function renderProviders(providers, catalog) {
    return providers
      .map((p) => {
        const label = catalog[p.provider_id]?.label || p.provider_id;
        const soon = p.coming_soon || catalog[p.provider_id]?.integrated === false;
        return `<article class="ph-provider-card${soon ? " coming-soon" : ""}" data-provider="${esc(p.provider_id)}">
      <div class="ph-provider-head"><strong>${esc(label)}</strong>${badgeMode(p.mode)}</div>
      <p class="subtle">Status: <b>${esc(p.status)}</b>${p.is_default ? " · Default" : ""} · Health: ${esc(p.health_status || "—")}</p>
      <p class="subtle">Webhook: ${esc(p.webhook_status || "—")} · Permissions: ${p.permissions_ok ? "OK" : "Check"}</p>
      <p class="subtle">Ref: ${esc(p.provider_ref || "—")}</p>
      <p class="subtle">Last sync: ${p.last_sync_at ? esc(new Date(p.last_sync_at).toLocaleString()) : "—"}</p>
      <div class="card-actions">
        ${soon ? '<button type="button" class="secondary" disabled>Coming soon</button>' : `<button type="button" class="secondary ph-connect" data-provider="${esc(p.provider_id)}">Connect</button>`}
        ${!soon ? `<button type="button" class="secondary ph-sync" data-provider="${esc(p.provider_id)}">Sync</button>` : ""}
        ${!soon ? `<button type="button" class="secondary ph-reconnect" data-provider="${esc(p.provider_id)}">Reconnect</button>` : ""}
        ${canConfigure && !soon && p.provider_id !== "stripe" ? `<button type="button" class="secondary ph-disconnect" data-provider="${esc(p.provider_id)}">Disconnect</button>` : ""}
        ${canConfigure && !soon ? `<button type="button" class="soft-green ph-default" data-provider="${esc(p.provider_id)}">Set default</button>` : ""}
      </div>
    </article>`;
      })
      .join("");
  }

  function renderDashboard(dashboard) {
    const d = dashboard || {};
    return `<div class="ph-metrics">
      <div class="ph-metric"><small>Today's sales</small><strong>${money(d.todays_sales)}</strong></div>
      <div class="ph-metric"><small>Pending payouts</small><strong>${money(d.pending_payouts)}</strong></div>
      <div class="ph-metric"><small>Refunds</small><strong>${money(d.refunds)}</strong></div>
      <div class="ph-metric"><small>Failed payments</small><strong>${Number(d.failed_payments || 0)}</strong></div>
    </div>`;
  }

  function renderMethods(methodSettings, allMethods) {
    return (allMethods || [])
      .map((m) => {
        const on = methodSettings[m.key];
        return `<label class="ph-method-row"><span>${esc(m.label)}</span><input type="checkbox" data-method-key="${esc(m.key)}" ${on ? "checked" : ""} ${canConfigure ? "" : "disabled"}></label>`;
      })
      .join("");
  }

  function renderReports(reports) {
    return `<div class="ph-metrics">
      <div class="ph-metric"><small>Gift card liability</small><strong>${money(reports.gift_card_liability)}</strong></div>
      <div class="ph-metric"><small>House accounts</small><strong>${money(reports.outstanding_balances)}</strong></div>
      <div class="ph-metric"><small>Tips (today)</small><strong>${money(reports.tips)}</strong></div>
      <div class="ph-metric"><small>Wholesale credit due</small><strong>${money(reports.outstanding_balances)}</strong></div>
    </div>`;
  }

  function renderFutureRails(rails) {
    return (rails || [])
      .map((r) => `<span class="ph-badge soon">${esc(r.label)}</span>`)
      .join(" ");
  }

  function renderExperience(experience) {
    const r = experience?.reports || {};
    const terminals = (experience?.terminals || [])
      .map((t) => `<span class="ph-badge soon">${esc(t.label)}</span>`)
      .join(" ");
    return `<h3>Payments experience (v1.2)</h3>
      <div class="ph-metrics">
        <div class="ph-metric"><small>Success rate</small><strong>${Number(r.payment_success_rate || 0).toFixed(1)}%</strong></div>
        <div class="ph-metric"><small>Failed</small><strong>${Number(r.failed_payments_count || 0)}</strong></div>
        <div class="ph-metric"><small>Outstanding</small><strong>${money(r.outstanding_balances)}</strong></div>
        <div class="ph-metric"><small>Recurring</small><strong>${money(r.recurring_revenue)}</strong></div>
      </div>
      <p class="subtle">Links: ${Number(r.payment_links?.paid || 0)} paid · ${Number(r.payment_links?.active || 0)} active · Terminals: ${terminals}</p>
      <button type="button" class="secondary" id="phRecoveryDemo">Simulate payment recovery</button>
      <button type="button" class="secondary" id="phRecurringRun">Run recurring billing (subscriptions)</button>`;
  }

  function renderRefunds(refunds) {
    const hist = (refunds?.history || [])
      .slice(0, 8)
      .map((r) => `<li>${money(r.amount)} · ${esc(r.provider_id)} · ${esc(r.status)}${r.notes ? ` · ${esc(r.notes)}` : ""}</li>`)
      .join("");
    return `<h3>Refund center</h3>
      <div class="two"><label>Amount<input id="phRefundAmount" type="number" step="0.01"></label><label>Stripe payment intent ID<input id="phRefundIntent" placeholder="pi_…"></label></div>
      <label>Reason<select id="phRefundReason">${(refunds?.reasons || []).map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("")}</select></label>
      <label>Notes<textarea id="phRefundNotes" rows="2" placeholder="Internal notes (audit log)"></textarea></label>
      <label class="check"><input type="checkbox" id="phRefundPartial"> Partial refund</label>
      <button type="button" class="primary" id="phRefundSubmit">Issue refund</button>
      <button type="button" class="secondary" id="phRefundVoid">Void last (by ID in hub API)</button>
      <ul class="subtle">${hist || "<li>No refunds yet.</li>"}</ul>`;
  }

  function renderHub(root, data) {
    if (!root) return;
    hubCache = data;
    const mode = data.mode_indicator === "live" ? "Live mode" : "Test mode";
    root.innerHTML = `<div class="payment-hub-shell panel">
      <div class="panel-heading"><div><p class="eyebrow">PAYMENT HUB PRO</p><h2>Universal payment platform</h2><p class="subtle">${esc(mode)} · Default: ${esc(data.default_provider || "None")} · v${esc(String(data.version || "1.1").replace("1.2-experience", "1.2"))}</p></div>
      <button type="button" class="secondary" id="phRefresh">Refresh</button></div>
      ${renderDashboard(data.dashboard)}
      ${renderReports(data.reports || {})}
      ${renderExperience(data.experience || {})}
      <p class="subtle">Future rails: ${renderFutureRails(data.future_payment_rails)}</p>
      <div class="payment-hub-grid" id="phProviders">${renderProviders(data.providers || [], data.catalog || {})}</div>
      <hr>
      <h3>Enabled payment methods</h3>
      <div class="ph-method-list" id="phMethods">${renderMethods(data.method_settings || {}, data.payment_methods)}</div>
      ${canConfigure ? '<button type="button" class="primary" id="phSaveMethods">Save methods</button>' : ""}
      <hr>
      ${renderRefunds(data.refunds || {})}
      <hr>
      <h3>Gift cards</h3>
      <div class="two"><label>Code<input id="phGiftCode" placeholder="BLOOM-1000"></label><label>Amount<input id="phGiftAmount" type="number" min="1" step="0.01"></label></div>
      <div class="card-actions"><button type="button" class="secondary" id="phGiftLookup">Balance lookup</button><button type="button" class="secondary" id="phGiftReload">Reload</button><button type="button" class="primary" id="phGiftIssue">Issue card</button></div>
      <p id="phGiftStatus" class="subtle" aria-live="polite"></p>
      <hr>
      <h3>House accounts</h3>
      <div class="two"><label>Business name<input id="phHouseName" placeholder="Hotel / Event venue"></label><label>Credit limit<input id="phHouseLimit" type="number" min="0" step="0.01"></label></div>
      <button type="button" class="secondary" id="phHouseCreate">Create account</button>
      <div id="phHouseList" class="subtle"></div>
    </div>`;
    bindHubEvents(root);
    loadHouseList();
    if (data.setup_wizard?.state?.show_wizard) showSetupWizard(data.setup_wizard);
  }

  function bindHubEvents(root) {
    root.querySelector("#phRefresh")?.addEventListener("click", () => window.BloomPaymentHub?.load(true));
    root.querySelector("#phSaveMethods")?.addEventListener("click", saveMethods);
    root.querySelector("#phGiftIssue")?.addEventListener("click", issueGift);
    root.querySelector("#phGiftLookup")?.addEventListener("click", lookupGift);
    root.querySelectorAll(".ph-connect").forEach((btn) =>
      btn.addEventListener("click", () => connectProvider(btn.dataset.provider))
    );
    root.querySelectorAll(".ph-disconnect").forEach((btn) =>
      btn.addEventListener("click", () => hubAction({ action: "disconnect_provider", provider_id: btn.dataset.provider }))
    );
    root.querySelectorAll(".ph-default").forEach((btn) =>
      btn.addEventListener("click", () => hubAction({ action: "set_default_provider", provider_id: btn.dataset.provider }))
    );
    root.querySelectorAll(".ph-reconnect").forEach((btn) =>
      btn.addEventListener("click", () => hubAction({ action: "reconnect_provider", provider_id: btn.dataset.provider }))
    );
    root.querySelectorAll(".ph-sync").forEach((btn) =>
      btn.addEventListener("click", () => hubAction({ action: "provider_sync", provider_id: btn.dataset.provider }))
    );
    root.querySelector("#phGiftReload")?.addEventListener("click", reloadGift);
    root.querySelector("#phRefundSubmit")?.addEventListener("click", submitRefund);
    root.querySelector("#phRecoveryDemo")?.addEventListener("click", () =>
      hubAction({ action: "payment_recovery_run", attempt_number: 0, order_id: "demo" })
    );
    root.querySelector("#phRecurringRun")?.addEventListener("click", () => hubAction({ action: "recurring_billing_process" }));
    root.querySelector("#phHouseCreate")?.addEventListener("click", createHouse);
  }

  async function loadHouseList() {
    const api = window.BloomPaymentHub?.api || window.api;
    const box = document.getElementById("phHouseList");
    if (!api || !box) return;
    try {
      const d = await api("payment-hub", { method: "POST", body: JSON.stringify({ action: "house_accounts_list" }) });
      box.innerHTML = (d.accounts || [])
        .map((a) => `<p><b>${esc(a.name)}</b> — ${money(a.balance)} / limit ${money(a.credit_limit)}${a.suspended_at ? " (suspended)" : ""}</p>`)
        .join("") || "No house accounts yet.";
    } catch (e) {
      box.textContent = e.message;
    }
  }

  async function createHouse() {
    await hubAction({
      action: "house_account_create",
      name: document.getElementById("phHouseName")?.value,
      credit_limit: document.getElementById("phHouseLimit")?.value,
      payment_term: "net_30"
    });
    await loadHouseList();
  }

  async function reloadGift() {
    const code = document.getElementById("phGiftCode")?.value;
    const amount = document.getElementById("phGiftAmount")?.value;
    const api = window.BloomPaymentHub?.api || window.api;
    const status = document.getElementById("phGiftStatus");
    try {
      const d = await api("payment-hub", { method: "POST", body: JSON.stringify({ action: "gift_card_reload", code, amount }) });
      status.textContent = `Reloaded — balance ${money(d.balance)}`;
    } catch (e) {
      status.textContent = e.message;
    }
  }

  async function submitRefund() {
    const api = window.BloomPaymentHub?.api || window.api;
    try {
      await api("payment-hub", {
        method: "POST",
        body: JSON.stringify({
          action: "refund_create",
          amount: document.getElementById("phRefundAmount")?.value,
          payment_intent_id: document.getElementById("phRefundIntent")?.value,
          reason: document.getElementById("phRefundReason")?.value,
          notes: document.getElementById("phRefundNotes")?.value,
          partial: document.getElementById("phRefundPartial")?.checked,
          provider_id: "stripe"
        })
      });
      window.toast?.("Refund submitted");
      await window.BloomPaymentHub.load(true);
    } catch (e) {
      window.toast?.(e.message);
    }
  }

  function showSetupWizard(wizard) {
    if (document.getElementById("phWizardDialog")) return;
    const dlg = document.createElement("dialog");
    dlg.id = "phWizardDialog";
    dlg.className = "ph-wizard-dialog";
    dlg.innerHTML = `<form method="dialog" class="panel"><h2>What payment processor do you already use?</h2>
      <p class="subtle">Florisyn connects to the processor you have — you are not forced into a single vendor.</p>
      <div class="ph-wizard-options">${(wizard.options || [])
        .map((o) => `<button type="button" class="secondary ph-wizard-choice" data-choice="${esc(o.id)}">${esc(o.label)}</button>`)
        .join("")}</div>
      <button type="button" class="secondary" id="phWizardSkip">Skip for now</button></form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelectorAll(".ph-wizard-choice").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await hubAction({ action: "setup_wizard_complete", choice: btn.dataset.choice });
        dlg.close();
        if (btn.dataset.choice === "stripe") connectProvider("stripe");
      });
    });
    dlg.querySelector("#phWizardSkip")?.addEventListener("click", async () => {
      await hubAction({ action: "setup_wizard_complete", choice: "none" });
      dlg.close();
    });
  }

  async function hubAction(body) {
    const api = window.BloomPaymentHub?.api || window.api;
    if (!api) return;
    await api("payment-hub", { method: "POST", body: JSON.stringify(body) });
    await window.BloomPaymentHub.load(true);
  }

  async function connectProvider(id) {
    if (id === "stripe") {
      try {
        const api = window.BloomPaymentHub?.api || window.api;
        const d = await api("stripe-connect", { method: "POST", body: JSON.stringify({}) });
        if (d.url) location.assign(d.url);
        else await hubAction({ action: "connect_provider", provider_id: "stripe" });
      } catch (e) {
        window.toast?.(e.message);
      }
      return;
    }
    await hubAction({ action: "connect_provider", provider_id: id });
  }

  async function saveMethods() {
    const methods = {};
    document.querySelectorAll("[data-method-key]").forEach((el) => {
      methods[el.dataset.methodKey] = el.checked;
    });
    await hubAction({ action: "update_payment_methods", methods });
    window.toast?.("Payment methods saved");
    if (window.BloomPaymentHub?.applyCheckoutMethods) await window.BloomPaymentHub.applyCheckoutMethods();
  }

  async function issueGift() {
    const code = document.getElementById("phGiftCode")?.value;
    const amount = document.getElementById("phGiftAmount")?.value;
    const api = window.BloomPaymentHub?.api || window.api;
    const status = document.getElementById("phGiftStatus");
    try {
      const d = await api("payment-hub", {
        method: "POST",
        body: JSON.stringify({ action: "gift_card_issue", code, amount })
      });
      status.textContent = `Issued ${d.card.code} — balance ${money(d.card.balance)}`;
    } catch (e) {
      status.textContent = e.message;
    }
  }

  async function lookupGift() {
    const code = document.getElementById("phGiftCode")?.value;
    const api = window.BloomPaymentHub?.api || window.api;
    const status = document.getElementById("phGiftStatus");
    try {
      const d = await api("payment-hub", {
        method: "POST",
        body: JSON.stringify({ action: "gift_card_lookup", code })
      });
      status.textContent = `${d.card.code}: ${money(d.card.balance)} remaining (${(d.transactions || []).length} transactions)`;
    } catch (e) {
      status.textContent = e.message;
    }
  }

  function renderCheckoutButtons(methods) {
    const grid = document.querySelector(".payment-method-grid");
    const checkoutBtn = document.getElementById("checkout");
    if (!grid) return;
    grid.querySelectorAll("[data-hub-method]").forEach((el) => el.remove());
    const manualMap = {
      cash: "Cash",
      check: "Check",
      gift_card: "Gift Card",
      store_credit: "Store Credit",
      house_account: "House Account",
      purchase_order: "Purchase Order",
      wire_transfer: "Other"
    };
    for (const m of methods || []) {
      if (["credit_card", "debit_card", "apple_pay", "google_pay"].includes(m.key)) {
        if (checkoutBtn) checkoutBtn.hidden = false;
        continue;
      }
      const label = manualMap[m.key];
      if (!label) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary local-payment";
      btn.dataset.method = label;
      btn.dataset.hubMethod = m.key;
      btn.textContent = `Record ${m.label.toLowerCase()}`;
      btn.addEventListener("click", () => {
        const rec = document.querySelector(`.local-payment[data-method="${label}"]`);
        if (rec) rec.click();
        else window.recordLocalPayment?.(label);
      });
      grid.appendChild(btn);
    }
    const cardEnabled = (methods || []).some((m) => ["credit_card", "debit_card"].includes(m.key));
    if (checkoutBtn) checkoutBtn.hidden = !cardEnabled;
  }

  async function load(force) {
    const root = document.getElementById("paymentHubRoot");
    if (!root) return;
    if (!force && hubCache) {
      renderHub(root, hubCache);
      return hubCache;
    }
    root.innerHTML = '<div class="ph-loading panel">Loading Payment Hub…</div>';
    const api = window.BloomPaymentHub?.api || window.api;
    if (!api) {
      root.innerHTML = '<div class="ph-empty panel">Sign in to manage payments.</div>';
      return null;
    }
    try {
      const data = await api("payment-hub");
      canConfigure = true;
      renderHub(root, data);
      renderCheckoutButtons(data.checkout_methods);
      return data;
    } catch (e) {
      root.innerHTML = `<div class="ph-empty panel">${esc(e.message)}</div>`;
      return null;
    }
  }

  async function applyCheckoutMethods() {
    const api = window.BloomPaymentHub?.api || window.api;
    if (!api) throw new Error("Sign in to load checkout payment methods.");
    const d = await api("payment-hub?action=checkout_methods");
    renderCheckoutButtons(d.checkout_methods);
    return d;
  }

  window.BloomPaymentHub = {
    load,
    applyCheckoutMethods,
    renderCheckoutButtons,
    hubCache: () => hubCache,
    async createPaymentLink(orderId, opts = {}) {
      const apiFn = window.BloomPaymentHub?.api || window.api;
      if (!apiFn || !orderId) throw new Error("Order required.");
      const d = await apiFn("payment-hub", {
        method: "POST",
        body: JSON.stringify({
          action: "payment_link_create",
          order_id: orderId,
          base_url: opts.baseUrl || location.origin,
          amount: opts.amount,
          allow_partial: opts.allowPartial !== false,
          email: opts.email,
          sms: opts.sms
        })
      });
      if (opts.email || opts.sms) {
        await apiFn("payment-hub", {
          method: "POST",
          body: JSON.stringify({
            action: "payment_link_send",
            link_id: d.link?.id,
            url: d.url,
            email: opts.email,
            sms: opts.sms,
            email_to: opts.emailTo,
            sms_to: opts.smsTo
          })
        });
      }
      return d;
    }
  };
})();
