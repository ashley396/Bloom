(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  function money(n) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(n || 0));
  }

  function canSensitive(role) {
    return ["owner", "manager", "accountant"].includes(String(role || "").toLowerCase());
  }

  function openProfile(customer, ctx) {
    const orders = (ctx.orders || []).filter((o) => o.customer_name === customer.name || o.customer_id === customer.id);
    const ltv = orders.reduce((s, o) => s + Number(o.total || 0), 0);
    const open = orders
      .filter((o) => (o.payment_status || "UNPAID") !== "PAID")
      .reduce((s, o) => s + Math.max(0, Number(o.balance_due ?? (Number(o.total || 0) - Number(o.amount_paid || 0)))), 0);
    const role = ctx.session?.role || ctx.session?.membership?.role || "cashier";
    const sensitive = canSensitive(role);

    const dlg = document.getElementById("customerProfileDialog");
    if (!dlg) return;
    dlg.innerHTML = `<div class="customer-profile-luxury">
      <header class="bloom-page-header">
        <div><p class="eyebrow">CUSTOMER PROFILE</p><h2>${esc(customer.vip ? "★ " : "")}${esc(customer.name)}</h2>
        <p class="subtle">${esc(customer.phone || "")} ${customer.email ? `· ${esc(customer.email)}` : ""}</p></div>
        <div class="card-actions">
          <button type="button" class="primary" data-cp-order="${esc(customer.id)}">New order</button>
          <button type="button" class="secondary" data-cp-pay="${esc(customer.id)}">Send payment link</button>
          <button type="button" class="secondary" data-cp-edit="${esc(customer.id)}">Edit</button>
        </div>
      </header>
      <div class="metric-grid">
        <div class="metric-box"><span>Lifetime value</span><strong>${money(ltv)}</strong></div>
        <div class="metric-box"><span>Open balance</span><strong>${money(open)}</strong></div>
        <div class="metric-box"><span>Orders</span><strong>${orders.length}</strong></div>
      </div>
      <nav class="profile-tabs" role="tablist">
        <button role="tab" aria-selected="true" data-tab="overview">Overview</button>
        <button role="tab" data-tab="orders">Orders</button>
        <button role="tab" data-tab="preferences">Preferences</button>
        <button role="tab" data-tab="notes">Notes</button>
      </nav>
      <section data-panel="overview">
        <p><strong>Favorites:</strong> ${esc(customer.favorite_flowers || "—")} ${customer.favorite_colors ? `· ${esc(customer.favorite_colors)}` : ""}</p>
        <p><strong>Birthday:</strong> ${esc(customer.birthday || "—")} · <strong>Anniversary:</strong> ${esc(customer.anniversary || "—")}</p>
        ${sensitive && customer.is_business ? `<p><strong>House account:</strong> Business customer</p>` : ""}
        ${!sensitive ? `<p class="subtle">Financial details hidden for your role.</p>` : ""}
      </section>
      <section data-panel="orders" hidden>
        ${orders.length ? orders.slice(0, 8).map((o) => `<article class="card"><h3>${esc(o.order_number)}</h3><p>${money(o.total)} · ${esc(o.payment_status || "UNPAID")}</p></article>`).join("") : `<p class="bloom-empty-luxury">No orders yet.</p>`}
      </section>
      <section data-panel="preferences" hidden>
        <p>Allergies / dislikes: ${esc(customer.allergies || customer.notes || "Not recorded")}</p>
      </section>
      <section data-panel="notes" hidden>
        <p>${esc(customer.notes || "No notes.")}</p>
      </section>
      <button type="button" class="secondary close">Close</button>
    </div>`;
    dlg.showModal();
    dlg.querySelector(".close")?.addEventListener("click", () => dlg.close());
    dlg.querySelectorAll("[role=tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        dlg.querySelectorAll("[role=tab]").forEach((t) => t.setAttribute("aria-selected", "false"));
        tab.setAttribute("aria-selected", "true");
        dlg.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
      });
    });
    dlg.querySelector("[data-cp-edit]")?.addEventListener("click", () => {
      dlg.close();
      document.querySelector(`[data-edit-customer="${customer.id}"]`)?.click();
    });
    dlg.querySelector("[data-cp-order]")?.addEventListener("click", () => {
      dlg.close();
      window.BloomGuidedOrder?.open?.({ customer });
    });
    dlg.querySelector("[data-cp-pay]")?.addEventListener("click", () => {
      dlg.close();
      ctx.showPage?.("paymentsPage");
      window.toast?.("Open Payment Hub to send a link.");
    });
  }

  function ensureDialog() {
    if (document.getElementById("customerProfileDialog")) return;
    const d = document.createElement("dialog");
    d.id = "customerProfileDialog";
    d.className = "customer-profile-dialog";
    document.body.appendChild(d);
  }

  function enhanceCustomerList() {
    ensureDialog();
    document.getElementById("customersList")?.addEventListener("click", (e) => {
      const card = e.target.closest("article.card");
      if (!card || e.target.closest("button")) return;
      const edit = card.querySelector("[data-edit-customer]");
      if (!edit) return;
      const id = edit.dataset.editCustomer;
      const customer = (window.__bloomCustomers || []).find((c) => c.id === id);
      if (customer) openProfile(customer, { orders: window.__bloomOrders || [], session: window.session, showPage: window.showPage });
    });
  }

  function init(deps) {
    window.__bloomCustomers = deps.customers;
    window.__bloomOrders = deps.orders;
    enhanceCustomerList();
  }

  window.BloomCustomerProfile = { init, openProfile };
})();
