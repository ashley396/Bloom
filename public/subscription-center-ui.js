(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const money = (n) => `$${Number(n || 0).toFixed(2)}`;

  async function apiCall(action, extra = {}) {
    const api = window.subscriptionCenterApi || window.shopBillingApi || window.api;
    if (!api) throw new Error("Sign in to manage your subscription.");
    if (action === "load") return api("shop-billing");
    return api("shop-billing", { method: "POST", body: JSON.stringify({ action, ...extra }) });
  }

  function renderHistory(history) {
    const events = (history?.events || [])
      .map((e) => `<li><time>${new Date(e.created_at).toLocaleString()}</time> ${esc(e.event_type)}</li>`)
      .join("");
    const invoices = (history?.invoices || [])
      .map(
        (inv) =>
          `<li>${esc(inv.number || inv.id)} — ${money(inv.amount)} · ${esc(inv.status)} ${
            inv.pdf ? `<a href="${esc(inv.pdf)}" target="_blank" rel="noopener">PDF</a>` : ""
          }</li>`
      )
      .join("");
    return `<div class="sub-grid"><div><h4>Billing activity</h4><ul class="sub-list">${events || "<li>No activity yet.</li>"}</ul></div>
      <div><h4>Invoice history</h4><ul class="sub-list">${invoices || "<li>No invoices yet.</li>"}</ul></div></div>`;
  }

  function render(root, data) {
    const c = data.center || data.billing || {};
    const p = c.current_plan || {};
    const can = data.can_manage;
    const hist = c.history || {};

    root.innerHTML = `<div class="sub-center-shell">
      <div class="shop-billing-plan sub-plan-card">
        <p class="eyebrow">CURRENT PLAN</p>
        <h3>${esc(p.label)} <span class="subtle">${esc(p.price_display || "")}</span></h3>
        <dl class="sub-dl">
          <div><dt>Next billing</dt><dd>${esc(c.next_billing)}</dd></div>
          <div><dt>Status</dt><dd>${esc(c.status)}</dd></div>
          <div><dt>Final billing date</dt><dd>${esc(c.final_billing_date)}</dd></div>
          <div><dt>Access until</dt><dd>${esc(c.access_expiration_date)}</dd></div>
        </dl>
        ${
          c.cancel_at_period_end
            ? `<p class="sub-reminder"><strong>Data export:</strong> ${esc(c.cancellation?.message || "Download your data before access ends.")}</p>`
            : ""
        }
      </div>
      ${
        can
          ? `<div class="shop-billing-actions sub-actions">
        <button type="button" class="primary" id="subUpgrade" ${c.upgrade_plan ? "" : "disabled"}>Upgrade</button>
        <button type="button" class="secondary" id="subDowngrade" ${c.downgrade_plan ? "" : "disabled"}>Downgrade</button>
        <button type="button" class="secondary" id="subPause" ${c.paused ? "disabled" : ""}>Pause</button>
        <button type="button" class="secondary" id="subResume" ${c.can_resume ? "" : "disabled"}>Resume</button>
        <button type="button" class="secondary" id="subReactivate" ${c.can_reactivate ? "" : "disabled"}>Reactivate</button>
        <button type="button" class="secondary sub-cancel-btn" id="subCancel">Cancel subscription</button>
        <button type="button" class="secondary" id="subExport">Download my data</button>
      </div>`
          : `<p class="subtle">Only the shop owner can change the Bloom subscription.</p>`
      }
      <div class="shop-billing-links sub-links">
        <button type="button" id="subInvoices">Billing history (portal)</button>
        <button type="button" id="subPaymentMethods">Payment methods</button>
      </div>
      ${renderHistory(hist)}
      <p id="subCenterStatus" class="subtle" aria-live="polite"></p>
    </div>`;

    bind(root, c, can);
    if (c.exit_survey?.pending) showExitSurvey(c.exit_survey.reasons);
  }

  function bind(root, c, can) {
    root.querySelector("#subUpgrade")?.addEventListener("click", () => planChange("upgrade", c.upgrade_plan?.code));
    root.querySelector("#subDowngrade")?.addEventListener("click", () => planChange("downgrade", c.downgrade_plan?.code));
    root.querySelector("#subPause")?.addEventListener("click", () => act("pause"));
    root.querySelector("#subResume")?.addEventListener("click", () => act("resume"));
    root.querySelector("#subReactivate")?.addEventListener("click", () => act("reactivate"));
    root.querySelector("#subCancel")?.addEventListener("click", () => confirmCancel(c));
    root.querySelector("#subExport")?.addEventListener("click", exportData);
    root.querySelector("#subInvoices")?.addEventListener("click", () => portal("invoices"));
    root.querySelector("#subPaymentMethods")?.addEventListener("click", () => portal("payment_methods"));
  }

  function confirmCancel(c) {
    const dlg = document.createElement("dialog");
    dlg.className = "sub-cancel-dialog";
    dlg.innerHTML = `<form method="dialog" class="panel">
      <h2>Cancel subscription?</h2>
      <p class="subtle">One confirmation — no phone call or email required.</p>
      <ul class="sub-cancel-facts">
        <li><strong>Final billing date:</strong> ${esc(c.final_billing_date || c.next_billing)}</li>
        <li><strong>Access until:</strong> ${esc(c.access_expiration_date || c.next_billing)}</li>
        <li><strong>Your data:</strong> Export anytime before access ends.</li>
      </ul>
      <div class="card-actions">
        <button type="button" class="secondary" id="subCancelAbort">Keep subscription</button>
        <button type="button" class="primary sub-cancel-btn" id="subCancelConfirm">Confirm cancellation</button>
      </div>
    </form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector("#subCancelAbort")?.addEventListener("click", () => dlg.close());
    dlg.querySelector("#subCancelConfirm")?.addEventListener("click", async () => {
      dlg.close();
      const d = await act("cancel", true);
      if (d?.show_exit_survey) showExitSurvey(c.exit_survey?.reasons || []);
    });
    dlg.addEventListener("close", () => dlg.remove());
  }

  function showExitSurvey(reasons) {
    const dlg = document.createElement("dialog");
    dlg.className = "sub-survey-dialog";
    const opts = (reasons || [])
      .map((r) => `<option value="${esc(r.code)}">${esc(r.label)}</option>`)
      .join("");
    dlg.innerHTML = `<form method="dialog" class="panel">
      <h2>Optional feedback</h2>
      <p class="subtle">Help us improve Bloom (optional — skip anytime).</p>
      <label>Reason<select id="subSurveyReason"><option value="">Select…</option>${opts}</select></label>
      <label>Comments<textarea id="subSurveyFeedback" rows="3"></textarea></label>
      <div class="card-actions">
        <button type="button" class="secondary" id="subSurveySkip">Skip</button>
        <button type="button" class="primary" id="subSurveySend">Submit</button>
      </div>
    </form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector("#subSurveySkip")?.addEventListener("click", async () => {
      await apiCall("exit_survey", { skip: true });
      dlg.close();
    });
    dlg.querySelector("#subSurveySend")?.addEventListener("click", async () => {
      await apiCall("exit_survey", {
        reason_code: dlg.querySelector("#subSurveyReason")?.value,
        feedback: dlg.querySelector("#subSurveyFeedback")?.value
      });
      dlg.close();
    });
    dlg.addEventListener("close", () => dlg.remove());
  }

  async function planChange(action, code) {
    const st = document.getElementById("subCenterStatus");
    try {
      st.textContent = "Opening secure checkout…";
      const d = await apiCall(action, { plan_code: code });
      if (d.url) location.assign(d.url);
    } catch (e) {
      st.textContent = e.message;
    }
  }

  async function act(action, returnData) {
    const st = document.getElementById("subCenterStatus");
    try {
      const d = await apiCall(action);
      st.textContent = d.message || "Updated.";
      await load(document.querySelector("[data-subscription-root]") || document.getElementById("subscriptionCenterRoot"));
      return returnData ? d : undefined;
    } catch (e) {
      st.textContent = e.message;
    }
  }

  async function portal(action) {
    try {
      const d = await apiCall(action);
      if (d.url) location.assign(d.url);
    } catch (e) {
      document.getElementById("subCenterStatus").textContent = e.message;
    }
  }

  async function exportData() {
    const st = document.getElementById("subCenterStatus");
    try {
      const d = await apiCall("download_data");
      const blob = new Blob([JSON.stringify(d.download, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = d.filename || "bloom-export.json";
      a.click();
      URL.revokeObjectURL(a.href);
      st.textContent = "Export downloaded.";
    } catch (e) {
      st.textContent = e.message;
    }
  }

  async function load(root) {
    const el =
      root ||
      document.querySelector("[data-subscription-root]") ||
      document.getElementById("subscriptionCenterRoot") ||
      document.getElementById("shopBillingRoot");
    if (!el) return;
    el.setAttribute("data-subscription-root", "1");
    el.innerHTML = '<p class="subtle">Loading subscription center…</p>';
    try {
      const data = await apiCall("load");
      render(el, data);
    } catch (e) {
      el.innerHTML = `<p class="subtle">${esc(e.message)}</p>`;
    }
  }

  window.BloomSubscriptionCenter = { load };
  window.BloomShopBilling = { load };
})();
