(function () {
  function enhanceDashboard(data) {
    document.body.classList.add("bloom-rc2-dashboard");
    if (document.body.classList.contains("florisyn-atelier")) {
      window.FlorisynAtelierDashboard?.render?.(data);
      window.BloomRC1?.enhanceDashboard?.(data);
      return;
    }
    const welcome = document.querySelector(".rose-welcome-card");
    if (welcome && !document.getElementById("bloomLuxuryHero")) {
      const floral = welcome.querySelector(".welcome-floral");
      if (floral) floral.remove();
      const heroUrl =
        window.shopSettings?.hero_image_url ||
        window.shopSettings?.dashboard_hero_url ||
        "/assets/floral-library/garden-harmony.jpg";
      const logo = window.shopSettings?.logo_url;
      const block = document.createElement("div");
      block.id = "bloomLuxuryHero";
      block.className = "bloom-luxury-hero";
      block.innerHTML = `
        <div class="bloom-hero-visual">
          <img id="bloomHeroImage" src="${heroUrl.replace(/"/g, "&quot;")}" alt="Shop hero" loading="eager">
          <label class="bloom-hero-edit secondary">Change hero<input type="file" id="bloomHeroUpload" accept="image/*" hidden></label>
        </div>
        <div class="bloom-hero-copy">
          ${logo ? `<img class="bloom-hero-logo" src="${logo.replace(/"/g, "&quot;")}" alt="Shop logo">` : ""}
          <h1 id="greeting">${document.getElementById("greeting")?.textContent || "Welcome"}</h1>
          <p id="dashboardDate" class="subtle">${document.getElementById("dashboardDate")?.textContent || ""}</p>
          <p class="welcome-subline">Your Florisyn Command Center.</p>
        </div>`;
      welcome.prepend(block);
      const stats = welcome.querySelector(".welcome-stats");
      if (stats) {
        stats.classList.add("bloom-hero-stats");
        if (!stats.querySelector("[data-staff-clocked]")) {
          stats.insertAdjacentHTML(
            "beforeend",
            `<span data-staff-clocked><b id="staffClockedIn">${Number(data?.staffClockedIn || 0)}</b><small>Staff in</small></span>
             <span data-holiday><b id="holidayReminder">${data?.holidayReminder ? "●" : "—"}</b><small>Holiday</small></span>`
          );
        }
      }
      block.querySelector("#bloomHeroUpload")?.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          block.querySelector("#bloomHeroImage").src = reader.result;
          window.toast?.("Hero preview updated — save branding in Settings to keep it.");
        };
        reader.readAsDataURL(file);
      });
    }
    mountQuickActions();
    window.BloomRC1?.enhanceDashboard?.(data);
  }

  function mountQuickActions() {
    if (document.getElementById("bloomQuickActions")) return;
    const host = document.querySelector("#dashboardPage .pos-welcome-row");
    if (!host) return;
    const row = document.createElement("section");
    row.id = "bloomQuickActions";
    row.className = "bloom-quick-actions panel";
    row.innerHTML = `<p class="eyebrow">QUICK ACTIONS</p>
      <div class="card-actions">
        <button type="button" class="primary" data-open="orderDialog">New order</button>
        <button type="button" class="secondary" data-page="deliveriesPage">Deliveries</button>
        <button type="button" class="secondary" data-page="libraryPage">Floral Library</button>
        <button type="button" class="secondary" data-page="websitePage">Website</button>
        <button type="button" class="secondary" data-page="paymentsPage">Payments</button>
      </div>`;
    host.after(row);
  }

  function mountRecipePrivacy() {
    const page = document.getElementById("productsPage");
    if (!page || page.querySelector(".recipe-privacy-banner")) return;
    const banner = document.createElement("p");
    banner.className = "recipe-privacy-banner panel subtle";
    banner.setAttribute("role", "note");
    banner.textContent =
      "Recipes are private to your shop staff — stem counts, costs, and design notes are never shown to customers or on your public website.";
    page.querySelector(".heading")?.after(banner);
  }

  window.BloomRC2 = { enhanceDashboard, mountRecipePrivacy };
})();
