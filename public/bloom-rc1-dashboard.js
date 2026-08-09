(function () {
  function enhanceDashboard(dashboardData) {
    if (document.body.classList.contains("florisyn-atelier")) return;
    const host = document.querySelector("#dashboardPage .pos-welcome-row");
    if (!host || document.getElementById("bloomLuxuryTimeline")) return;
    const d = dashboardData || {};
    const name = document.getElementById("greeting")?.textContent?.replace(/^Good (morning|afternoon|evening),?\s*/i, "").replace(/!$/, "") || "there";
    const lilyLine = buildLilySummary(d, name);
    const block = document.createElement("section");
    block.id = "bloomLuxuryTimeline";
    block.className = "panel bloom-dashboard-timeline";
    block.setAttribute("aria-label", "Today's timeline");
    block.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">TODAY'S FLOW</p><h3>Shop timeline</h3></div></div>
      <p class="subtle" id="bloomLilyDaySummary">${lilyLine}</p>
      <div id="bloomTimelineItems"></div>`;
    host.after(block);
    const items = [];
    if (Number(d.ordersDueToday) > 0) items.push({ time: "Today", label: `${d.ordersDueToday} order(s) due`, kind: "orders" });
    if (Number(d.deliveriesToday) > 0) items.push({ time: "Today", label: `${d.deliveriesToday} delivery stop(s)`, kind: "delivery" });
    if (Number(d.unpaidTotal) > 0) items.push({ time: "Reminder", label: `Outstanding ${formatMoney(d.unpaidTotal)}`, kind: "payment" });
    if (Number(d.lowStock) > 0) items.push({ time: "Inventory", label: `${d.lowStock} low-stock alert(s)`, kind: "inventory" });
    const box = block.querySelector("#bloomTimelineItems");
    box.innerHTML = items.length
      ? items.map((i) => `<article><div><strong>${i.label}</strong><small>${i.time}</small></div></article>`).join("")
      : `<p class="bloom-empty-luxury">Nothing urgent on the timeline — a good moment to prep the cooler or refresh your website.</p>`;
  }

  function buildLilySummary(d, name) {
    const parts = [];
    if (Number(d.deliveriesToday)) parts.push(`${d.deliveriesToday} deliver${d.deliveriesToday === 1 ? "y" : "ies"}`);
    if (Number(d.ordersDueToday)) parts.push(`${d.ordersDueToday} pickup or order${d.ordersDueToday === 1 ? "" : "s"} due`);
    if (Number(d.unpaidTotal) > 0) parts.push(`unpaid balance on the books`);
    if (!parts.length) return `Good day, ${name}. Your shop is calm — consider featuring a seasonal arrangement on your website.`;
    return `Good morning, ${name}. You have ${parts.join(", ")} today.`;
  }

  function formatMoney(v) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v || 0));
  }

  function enhanceInventoryCooler(items) {
    const page = document.getElementById("inventoryPage");
    if (!page || page.querySelector("#inventoryCoolerView")) return;
    const toggle = document.createElement("div");
    toggle.className = "card-actions";
    toggle.innerHTML = `<button type="button" class="secondary" id="inventoryViewTable">Table view</button><button type="button" class="primary" id="inventoryViewCooler">Cooler view</button>`;
    const heading = page.querySelector(".heading");
    heading?.appendChild(toggle);
    const cooler = document.createElement("div");
    cooler.id = "inventoryCoolerView";
    cooler.className = "inventory-cooler-grid";
    cooler.hidden = true;
    page.querySelector("#inventoryList")?.before(cooler);
    function renderCooler() {
      cooler.innerHTML = (items || [])
        .map(
          (i) => `<article class="cooler-card panel"><img src="/assets/floral-library/garden-harmony.jpg" alt="" loading="lazy"><div class="body"><h4>${i.color ? i.color + " " : ""}${i.name}</h4><p>${Number(i.quantity || 0)} stems · reserved ${Number(i.metadata?.reserved_qty || 0)}</p></div></article>`
        )
        .join("");
    }
    document.getElementById("inventoryViewCooler")?.addEventListener("click", () => {
      cooler.hidden = false;
      renderCooler();
    });
    document.getElementById("inventoryViewTable")?.addEventListener("click", () => {
      cooler.hidden = true;
    });
  }

  window.BloomRC1 = { enhanceDashboard, enhanceInventoryCooler };
})();
