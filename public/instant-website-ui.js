(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  async function api(action, extra = {}) {
    const fn = window.api;
    if (!fn) throw new Error("Sign in required.");
    return fn("instant-website", { method: "POST", body: JSON.stringify({ action, ...extra }) });
  }

  function mountWizard(root) {
    if (!root || root.querySelector(".instant-wizard-shell")) return;
    root.insertAdjacentHTML(
      "afterbegin",
      `<div class="instant-wizard-shell panel bloom-rc1-wizard">
        <p class="eyebrow">BLOOM INSTANT WEBSITES</p>
        <h2>Launch your florist site in minutes</h2>
        <p class="subtle">We pre-fill from your shop profile — no retyping phone, address, or logo.</p>
        <div class="instant-wizard-steps" id="instantWizardSteps">
          <span class="active">1 Business</span><span>2 Logo</span><span>3 Style</span><span>4 Collections</span><span>5 Domain</span><span>6 Preview</span><span>7 Publish</span>
        </div>
        <label>Launch mode<select id="instantLaunchMode">
          <option value="classic_florist">Classic Florist</option>
          <option value="luxury_boutique">Luxury Boutique</option>
          <option value="garden_cottage">Garden & Cottage</option>
          <option value="bright_gift">Bright Gift Shop</option>
          <option value="wedding_studio">Wedding Studio</option>
          <option value="sympathy_memorial">Sympathy & Memorial</option>
          <option value="modern_minimal">Modern Minimal</option>
          <option value="rustic_farmhouse">Rustic Farmhouse</option>
        </select></label>
        <label>Domain path<select id="instantDomainMode">
          <option value="bloom_subdomain">Use temporary Florisyn address (shopname.bloom-sites.com)</option>
          <option value="connect">Connect a domain I own</option>
          <option value="purchase">Find & purchase a domain (provider integration required)</option>
        </select></label>
        <div class="card-actions">
          <button type="button" class="primary" id="instantGenerateBtn">Build starter website</button>
          <button type="button" class="secondary" id="instantHealthBtn">Website health check</button>
        </div>
        <p id="instantWizardStatus" class="subtle" aria-live="polite"></p>
        <div class="panel bloom-commerce-settings" style="margin-top:1rem">
          <p class="eyebrow">ONLINE COMMERCE</p>
          <h3>Storefront checkout</h3>
          <label><input type="checkbox" id="commercePayNow" checked> Allow pay now (Stripe)</label>
          <label><input type="checkbox" id="commercePayLater" checked> Allow pay later</label>
          <label>Deposit % (0 = full balance)<input type="number" id="commerceDeposit" min="0" max="100" value="0"></label>
          <label>Delivery lead days<input type="number" id="commerceLeadDays" min="0" max="30" value="0"></label>
          <button type="button" class="secondary" id="commerceSaveBtn">Save commerce settings</button>
          <p id="commerceSaveStatus" class="subtle" aria-live="polite"></p>
        </div>
      </div>`
    );
    root.querySelector("#instantGenerateBtn")?.addEventListener("click", async () => {
      const status = root.querySelector("#instantWizardStatus");
      status.textContent = "Generating from your shop profile…";
      try {
        const d = await api("wizard_generate", { launch_mode: root.querySelector("#instantLaunchMode")?.value });
        status.textContent = d.note || "Starter site ready — edit in Website Studio and preview before publish.";
        window.toast?.("Instant website draft created");
        if (window.renderWebsite) window.renderWebsite();
      } catch (e) {
        status.textContent = e.message;
      }
    });
    root.querySelector("#instantHealthBtn")?.addEventListener("click", async () => {
      try {
        const d = await api("health_score", { site: {}, products: [] });
        root.querySelector("#instantWizardStatus").textContent = `Health ${d.score}/100 — ${(d.tips || []).slice(0, 2).join(" ")}`;
      } catch (e) {
        root.querySelector("#instantWizardStatus").textContent = e.message;
      }
    });
    root.querySelector("#commerceSaveBtn")?.addEventListener("click", async () => {
      const status = root.querySelector("#commerceSaveStatus");
      status.textContent = "Saving…";
      try {
        await api("commerce_settings", {
          commerce_settings: {
            stripe_checkout_enabled: root.querySelector("#commercePayNow")?.checked,
            pay_later_enabled: root.querySelector("#commercePayLater")?.checked,
            deposit_percent: Number(root.querySelector("#commerceDeposit")?.value || 0),
            delivery_lead_days: Number(root.querySelector("#commerceLeadDays")?.value || 0),
            online_ordering_enabled: true
          }
        });
        status.textContent = "Commerce settings saved.";
        window.toast?.("Storefront commerce updated");
      } catch (e) {
        status.textContent = e.message;
      }
    });
  }

  async function load() {
    const page = document.getElementById("websitePage");
    if (page) mountWizard(page);
  }

  window.BloomInstantWebsite = { load, mountWizard };
})();
