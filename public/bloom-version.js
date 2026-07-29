/** Client-side Florisyn version (keep in sync with netlify/functions/_shared/bloom-release.js). */
window.FLORISYN_VERSION = {
  label: "Florisyn Foundation",
  code: "foundation-1.0",
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
