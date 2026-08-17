/** Client-side Florisyn version (keep in sync with server release metadata). */
window.FLORISYN_VERSION = {
  label: "Florisyn 1.0",
  code: "founder-1.0",
  build: "teststamp1234",
  branch: "redesign-v22"
};

window.BLOOM_VERSION = window.FLORISYN_VERSION;

function applyFlorisynVersionBadges() {
  const text = window.FLORISYN_VERSION.label;
  document.querySelectorAll("[data-florisyn-version], [data-bloom-version]").forEach((el) => {
    el.textContent = text;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyFlorisynVersionBadges);
} else {
  applyFlorisynVersionBadges();
}
