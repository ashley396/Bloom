import {
  PRICING_TIERS,
  ANNUAL_MONTHS_FREE,
  planQuote,
  formatMoney,
  formatPlanPriceHeadline
} from "./pricing-catalog.js";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

function readInterval() {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("interval");
  if (fromUrl === "annual" || fromUrl === "monthly") return fromUrl;
  try {
    const saved = sessionStorage.getItem("florisyn_billing_interval");
    if (saved === "annual" || saved === "monthly") return saved;
  } catch {
    /* ignore */
  }
  return "monthly";
}

function persistInterval(interval) {
  try {
    sessionStorage.setItem("florisyn_billing_interval", interval);
  } catch {
    /* ignore */
  }
}

function signupHref(tier, interval) {
  return `/signup?plan=${encodeURIComponent(tier.signupCode)}&interval=${encodeURIComponent(interval)}`;
}

function renderPriceCard(tier, interval) {
  const quote = planQuote(tier.monthly, interval);
  const headline = formatPlanPriceHeadline(quote, interval);

  return `<article class="pricing-card${tier.popular ? " pricing-card-popular" : ""}">
    ${tier.popular ? '<span class="pricing-popular">Most popular</span>' : ""}
    <h2>${tier.name}</h2>
    <p class="pricing-summary">${tier.summary}</p>
    <p class="pricing-amount" data-tier="${tier.code}">
      <strong>${headline.amount}</strong><small>${headline.suffix}</small>
    </p>
    <p class="pricing-billed-note">${headline.note}</p>
    <ul class="pricing-features">${tier.features.map((f) => `<li>${f}</li>`).join("")}</ul>
    <a class="primary-btn pricing-cta" href="${signupHref(tier, interval)}" data-cta="pricing-${tier.code}-signup">Start free trial</a>
  </article>`;
}

function updateToggle(root, interval) {
  $$("[data-billing-interval]", root).forEach((btn) => {
    const active = btn.dataset.billingInterval === interval;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const save = $("[data-pricing-save]", root);
  if (save) save.textContent = `Save ${ANNUAL_MONTHS_FREE} months`;
}

export function mountPricingToggle(root = document) {
  const grid = $("#pricingPlansGrid", root);
  const toggle = $("[data-pricing-toggle]", root);
  if (!grid || !toggle) return;

  let interval = readInterval();

  const paint = () => {
    grid.innerHTML = PRICING_TIERS.map((tier) => renderPriceCard(tier, interval)).join("");
    updateToggle(toggle, interval);
    persistInterval(interval);
  };

  toggle.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-billing-interval]");
    if (!btn) return;
    interval = btn.dataset.billingInterval;
    paint();
  });

  paint();
}

export function mountSignupPlans(root = document) {
  const section = $("#pricingPlansSignup", root);
  const toggle = $("[data-pricing-toggle]", root);
  if (!section) return;

  const params = new URLSearchParams(location.search);
  let interval = params.get("interval") === "annual" ? "annual" : readInterval();
  const preferredPlan = params.get("plan");

  const paint = () => {
    section.innerHTML = PRICING_TIERS.map((tier) => {
      const quote = planQuote(tier.monthly, interval);
      const checked = preferredPlan ? tier.signupCode === preferredPlan : tier.popular;
      const headline = formatPlanPriceHeadline(quote, interval);
      return `<label class="signup-plan-card bloom-auth-plan">
        ${tier.popular ? '<span class="popular">Most popular</span>' : ""}
        <input type="radio" name="plan" value="${tier.signupCode}" data-monthly="${tier.monthly}" data-price="${quote.billed}" data-interval="${interval}" ${checked ? "checked" : ""}>
        <span class="signup-plan-card-body">
          <span class="signup-plan-name">${tier.name}</span>
          <span class="signup-plan-price">${headline.amount}<small>${headline.suffix}</small></span>
          <span class="signup-plan-note">${headline.note}</span>
          <span class="signup-plan-summary">${tier.summary}</span>
        </span>
      </label>`;
    }).join("");
    if (toggle) updateToggle(toggle, interval);
    persistInterval(interval);
  };

  toggle?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-billing-interval]");
    if (!btn) return;
    interval = btn.dataset.billingInterval;
    paint();
  });

  paint();
}

if (document.body.dataset.pricingPage === "true") {
  mountPricingToggle();
}

if (document.body.classList.contains("florisyn-signup-hero")) {
  mountSignupPlans();
}
