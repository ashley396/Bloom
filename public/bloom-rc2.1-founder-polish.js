(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  function initials(name) {
    return String(name || "?")
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  function money(n) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(n || 0));
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
  }

  function customerReminders(c) {
    const chips = [];
    const bday = daysUntil(c.birthday);
    const ann = daysUntil(c.anniversary);
    if (bday !== null && bday >= 0 && bday <= 14) chips.push(`Birthday in ${bday}d`);
    if (ann !== null && ann >= 0 && ann <= 14) chips.push(`Anniversary in ${ann}d`);
    return chips;
  }

  function customerLifetime(c, orderList) {
    return (orderList || [])
      .filter((o) => o.customer_name === c.name || o.customer_id === c.id)
      .reduce((s, o) => s + Number(o.total || 0), 0);
  }

  function customerCard(c, orderList) {
    const ltv = customerLifetime(c, orderList);
    const orderCount = (orderList || []).filter((o) => o.customer_name === c.name).length;
    const reminders = customerReminders(c);
    return `<article class="card bloom-customer-card">
      <div class="card-top">
        <div class="bloom-staff-card">
          <div class="bloom-avatar" aria-hidden="true">${esc(initials(c.name))}</div>
          <div>
            <h3>${c.vip ? "★ " : ""}${esc(c.name)}</h3>
            <div class="meta">${esc(c.phone || "")}${c.email ? ` · ${esc(c.email)}` : ""}</div>
            ${c.favorite_flowers ? `<p class="subtle">Favorites: ${esc(c.favorite_flowers)}${c.favorite_colors ? ` · ${esc(c.favorite_colors)}` : ""}</p>` : ""}
          </div>
        </div>
        <div>${c.vip ? '<span class="badge">VIP</span> ' : ""}${c.is_business ? '<span class="badge good">BUSINESS</span>' : ""}</div>
      </div>
      ${reminders.length ? `<div class="bloom-reminder-chips">${reminders.map((r) => `<span>${esc(r)}</span>`).join("")}</div>` : ""}
      <p class="subtle">Lifetime ${money(ltv)} · ${orderCount} order${orderCount === 1 ? "" : "s"}</p>
      ${c.notes ? `<p class="subtle">Note: ${esc(String(c.notes).slice(0, 120))}${String(c.notes).length > 120 ? "…" : ""}</p>` : ""}
      <div class="card-actions">
        <button class="secondary" data-view-customer="${c.id}">Profile</button>
        <button class="secondary" data-edit-customer="${c.id}">Edit</button>
        <button class="secondary" data-delete-customer="${c.id}">Delete</button>
      </div>
    </article>`;
  }

  function staffCard(x, timeEntries) {
    const entries = (timeEntries || []).filter((e) => e.staff_id === x.id);
    const open = entries.find((e) => !e.clock_out);
    const clockLabel = open
      ? `Clocked in ${new Date(open.clock_in).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : entries
          .filter((e) => e.clock_out)
          .slice(-1)
          .map((e) => `Last out ${new Date(e.clock_out).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`)[0] || "Not on clock";
    return `<article class="card employee-card bloom-staff-card-wrap">
      <div class="bloom-staff-card">
        <div class="bloom-avatar" aria-hidden="true">${esc(initials(x.name))}</div>
        <div class="card-top" style="flex:1;border:none;padding:0">
          <div><h3>${esc(x.name)}</h3>
          <div class="meta">${esc(clockLabel)}</div></div>
          <span class="badge ${open ? "good" : ""}">${open ? "CLOCKED IN" : "CLOCKED OUT"}</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="primary" data-staff-clock="${x.id}" data-clock-action="${open ? "CLOCK_OUT" : "CLOCK_IN"}">${open ? "Clock out" : "Clock in"}</button>
        <button class="secondary" data-edit-staff="${x.id}">Employee file (PIN)</button>
      </div>
    </article>`;
  }

  function wrapProductionOrder(html, o) {
    const fulfillment = o.fulfillment || "—";
    const pay = o.payment_status || "UNPAID";
    const extra = `<div class="bloom-order-timeline">
      <span>${esc(fulfillment)}</span>
      <span>Pay: ${esc(pay)}</span>
      ${o.delivery_address ? `<span>Delivery</span>` : `<span>Pickup</span>`}
    </div>
    <div class="card-actions" style="margin-top:8px">
      <button class="secondary" data-invoice-view="${o.id}" type="button">Print invoice</button>
    </div>`;
    return html.replace("</article>", `${extra}</article>`);
  }

  function inventoryCard(i, helpers) {
    const f = helpers.inventoryFreshness(i);
    const freshClass = f.score <= 25 ? "danger" : f.score <= 55 ? "warn" : "good";
    const low = Number(i.quantity) <= Number(i.low_stock_level);
    return `<article class="card inventory-card bloom-inventory-card">
      <div class="bloom-inventory-thumb" aria-hidden="true">✿</div>
      <div class="card-top">
        <div>
          <div class="inventory-title-row"><h3>${esc(i.name)}</h3>${i.color ? `<span class="color-label">${esc(i.color)}</span>` : ""}</div>
          <div class="meta">${esc(i.category || "")}${i.variety ? ` · ${esc(i.variety)}` : ""} · ${Number(i.quantity || 0)} ${esc(i.unit || "stems")}</div>
          ${i.supplier ? `<p class="subtle">Supplier: ${esc(i.supplier)}</p>` : ""}
        </div>
        <span class="badge ${low ? "warn" : "good"}">${low ? "LOW STOCK" : "IN STOCK"}</span>
      </div>
      <div class="freshness-meter"><div><span>Freshness</span><b class="${freshClass}">${f.label}</b></div><progress max="100" value="${f.score}"></progress></div>
      <div class="inventory-pricing"><span>Cost ${money(i.cost)}</span><span>Retail ${money(i.price)}</span></div>
      <p class="bloom-voice-hint">Voice: say "add inventory" in Lily · Barcode scan on upload banner</p>
      <div class="card-actions"><button class="secondary" data-edit-inventory="${i.id}">Edit</button><button class="secondary" data-delete-inventory="${i.id}">Delete</button></div>
    </article>`;
  }

  function enhanceCommandCenter(d) {
    const page = document.getElementById("dashboardPage");
    if (!page || page.querySelector(".bloom-command-center")) return;
    page.querySelector(".bloom-lily-insight")?.remove();
    const pickups = Number(d.ordersDueToday || 0);
    const strip = document.createElement("section");
    strip.className = "bloom-command-center";
    strip.setAttribute("aria-label", "Today at a glance");
    strip.innerHTML = `
      <article><small>Today's revenue</small><strong>${money(d.todaySales)}</strong></article>
      <article><small>Orders today</small><strong>${Number(d.ordersToday || 0)}</strong></article>
      <article><small>Deliveries</small><strong>${Number(d.deliveriesToday || 0)}</strong></article>
      <article><small>Pickups due</small><strong>${pickups}</strong></article>
      <article><small>Inventory alerts</small><strong>${Number(d.lowStock || 0)}</strong></article>
      <article><small>Outstanding</small><strong>${money(d.unpaidTotal)}</strong></article>`;
    const host = document.getElementById("bloomQuickActions") || document.querySelector(".pos-welcome-row");
    host?.after(strip);
    const lily = document.createElement("div");
    lily.className = "bloom-lily-insight panel";
    lily.innerHTML = `<p class="eyebrow">LILY</p><p id="bloomLilyInsightText">${esc(buildLilyInsight(d))}</p>`;
    strip.after(lily);
  }

  function buildLilyInsight(d) {
    const parts = [];
    if (Number(d.lowStock)) parts.push(`${d.lowStock} inventory item(s) need attention`);
    if (Number(d.ordersDueToday)) parts.push(`${d.ordersDueToday} order(s) due today`);
    if (Number(d.unpaidTotal) > 0) parts.push(`${money(d.unpaidTotal)} still open on invoices`);
    if (!parts.length) return "Today looks calm — a good moment to prep cooler inventory or refresh your website featured collection.";
    return `Focus first on ${parts.join(", then ")}.`;
  }

  function mountOrdersToolbar() {
    window.BloomRC21Consistency?.wireOrdersSearch?.();
  }

  function initLoadingScreen() {
    const el = document.getElementById("bloomLoadingScreen");
    if (!el) return;
    window.addEventListener("load", () => {
      setTimeout(() => el.classList.add("is-hidden"), 400);
    });
    setTimeout(() => el.classList.add("is-hidden"), 4000);
  }

  function tuneLily() {
    const fab = document.getElementById("lilyFab");
    if (fab) fab.title = "Lily — florist assistant (opens when you need help)";
  }

  window.BloomRC21 = {
    customerCard,
    staffCard,
    wrapProductionOrder,
    inventoryCard,
    enhanceCommandCenter,
    mountOrdersToolbar,
    initLoadingScreen,
    tuneLily,
    initials
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("bloom-rc21");
    initLoadingScreen();
    tuneLily();
  });
})();
