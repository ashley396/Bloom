(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  async function billingApi(action, extra = {}) {
    const api = window.shopBillingApi || window.api;
    if (!api) throw new Error("Sign in to view billing.");
    if (action === "load") return api("shop-billing");
    return api("shop-billing", { method: "POST", body: JSON.stringify({ action, ...extra }) });
  }

  function render(root, data) {
    if (!root) return;
    const b = data.billing || {};
    const p = b.current_plan || {};
    const can = data.can_manage;
    root.innerHTML = `<div class="shop-billing-plan">
      <p class="eyebrow">CURRENT PLAN</p>
      <h3>${esc(p.label)} <span class="subtle">${esc(p.price_display || "")}</span></h3>
      <dl>
        <div><dt>Next billing</dt><dd>${esc(b.next_billing)}</dd></div>
        <div><dt>Status</dt><dd>${esc(b.status)}</dd></div>
      </dl>
    </div>
    ${can ? `<div class="shop-billing-actions">
      <button type="button" class="primary" id="sbUpgrade" ${b.upgrade_plan ? "" : "disabled"}>Upgrade plan</button>
      <button type="button" class="secondary" id="sbDowngrade" ${b.downgrade_plan ? "" : "disabled"}>Downgrade plan</button>
      <button type="button" class="secondary" id="sbPause">Pause subscription</button>
      <button type="button" class="secondary" id="sbCancel">Cancel subscription</button>
      <button type="button" class="secondary" id="sbDownload">Download my data</button>
    </div>` : `<p class="subtle">Only the shop owner can change plans or billing.</p>`}
    <div class="shop-billing-links">
      <button type="button" id="sbInvoices">Invoices</button>
      <button type="button" id="sbPaymentMethods">Payment methods</button>
      <button type="button" id="sbPaymentHub">Shop payment processors</button>
    </div>
    <p id="shopBillingStatus" class="subtle" aria-live="polite"></p>`;

    root.querySelector("#sbUpgrade")?.addEventListener("click", () => changePlan("upgrade", b.upgrade_plan?.code));
    root.querySelector("#sbDowngrade")?.addEventListener("click", () => changePlan("downgrade", b.downgrade_plan?.code));
    root.querySelector("#sbPause")?.addEventListener("click", () => simpleAction("pause"));
    root.querySelector("#sbCancel")?.addEventListener("click", () => {
      if (confirm("Cancel subscription at the end of this billing period?")) simpleAction("cancel");
    });
    root.querySelector("#sbDownload")?.addEventListener("click", downloadData);
    root.querySelector("#sbInvoices")?.addEventListener("click", () => portal("invoices"));
    root.querySelector("#sbPaymentMethods")?.addEventListener("click", () => portal("payment_methods"));
    root.querySelector("#sbPaymentHub")?.addEventListener("click", () => {
      window.showPage?.("paymentsPage");
      document.getElementById("paymentsTabHub")?.click();
    });
  }

  async function changePlan(action, planCode) {
    const status = document.getElementById("shopBillingStatus");
    try {
      status.textContent = "Opening secure checkout…";
      const d = await billingApi(action, { plan_code: planCode });
      if (d.url) location.assign(d.url);
      else status.textContent = d.message || "Done.";
    } catch (e) {
      status.textContent = e.message;
    }
  }

  async function simpleAction(action) {
    const status = document.getElementById("shopBillingStatus");
    try {
      const d = await billingApi(action);
      status.textContent = d.message || "Updated.";
      await load(document.getElementById("shopBillingRoot"));
    } catch (e) {
      status.textContent = e.message;
    }
  }

  async function portal(action) {
    const status = document.getElementById("shopBillingStatus");
    try {
      const d = await billingApi(action);
      if (d.url) location.assign(d.url);
    } catch (e) {
      status.textContent = e.message;
    }
  }

  async function downloadData() {
    const status = document.getElementById("shopBillingStatus");
    try {
      const d = await billingApi("download_data");
      const blob = new Blob([JSON.stringify(d.download, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = d.filename || "bloom-export.json";
      a.click();
      URL.revokeObjectURL(a.href);
      status.textContent = "Export downloaded.";
    } catch (e) {
      status.textContent = e.message;
    }
  }

  async function load(root) {
    const el = root || document.getElementById("shopBillingRoot");
    if (!el) return;
    el.innerHTML = '<p class="subtle">Loading billing…</p>';
    try {
      const data = await billingApi("load");
      render(el, data);
    } catch (e) {
      el.innerHTML = `<p class="subtle">${esc(e.message)}</p>`;
    }
  }

  window.BloomShopBilling = { load };
})();
