/**
 * Florisyn RC2 — Daily Atelier Flow
 * Luxury production timeline for the dashboard. UI enhancement only.
 */
(function () {
  const TYPE_ICONS = {
    delivery: "🚚",
    appointment: "📅",
    order: "💐",
    call: "📞",
    website: "🌐",
    payment: "💳",
  };

  function buildAtelierItems(data) {
    const items = [];
    const orders = data?.todayOrders || data?.orders || [];

    if (Array.isArray(orders)) {
      orders.slice(0, 4).forEach((order, i) => {
        items.push({
          time: order.due_time || order.delivery_time || `${9 + i}:00 AM`,
          type: "order",
          title: order.recipient_name || order.customer_name || "Order",
          subtitle: order.occasion || order.status || "",
        });
      });
    }

    if (items.length === 0) {
      return [
        { time: "8:30 AM", type: "order", title: "Morning design bench", subtitle: "Review today's queue" },
        { time: "10:00 AM", type: "delivery", title: "First delivery run", subtitle: "Check manifest" },
        { time: "12:00 PM", type: "website", title: "Website orders", subtitle: "Process new submissions" },
        { time: "2:00 PM", type: "payment", title: "Outstanding invoices", subtitle: "Send gentle reminders" },
      ];
    }

    return items;
  }

  function mountAtelierFlow(data) {
    if (document.getElementById("florisynAtelierFlow")) return;

    const dashboard = document.getElementById("dashboardPage");
    const bloomMoment = document.getElementById("florisynBloomMoment");
    const welcomeRow = dashboard?.querySelector(".pos-welcome-row");
    const anchor = bloomMoment || welcomeRow;
    if (!dashboard || !anchor) return;

    const items = buildAtelierItems(data);
    const block = document.createElement("section");
    block.id = "florisynAtelierFlow";
    block.className = "panel";
    block.setAttribute("aria-label", "Daily atelier flow");

    const listHtml = items
      .map(
        (item) => `
      <li class="atelier-item">
        <span class="atelier-icon" aria-hidden="true">${TYPE_ICONS[item.type] || "•"}</span>
        <div>
          <div>
            <span class="atelier-time">${item.time}</span>
            <span class="atelier-type">${item.type}</span>
          </div>
          <p class="atelier-title">${item.title}</p>
          ${item.subtitle ? `<p class="atelier-subtitle">${item.subtitle}</p>` : ""}
        </div>
      </li>`
      )
      .join("");

    block.innerHTML = `
      <p class="eyebrow">DAILY ATELIER FLOW</p>
      <h2>Your production day</h2>
      <p class="subtle">Curated schedule — not a task list.</p>
      <ol class="atelier-timeline">${listHtml}</ol>`;

    anchor.after(block);
  }

  window.FlorisynRC2 = window.FlorisynRC2 || {};
  window.FlorisynRC2.mountAtelierFlow = mountAtelierFlow;

  document.addEventListener("florisyn:dashboard-ready", (e) => {
    mountAtelierFlow(e.detail || {});
  });
})();
