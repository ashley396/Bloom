/** Client-side Bloom version (keep in sync with netlify/functions/_shared/bloom-release.js). */
window.BLOOM_VERSION = {
  label: "Bloom Version 1.0 RC1",
  code: "1.0.0-rc.1",
  branch: "release-candidate-v1"
};

function applyBloomVersionBadges() {
  const text = window.BLOOM_VERSION.label;
  document.querySelectorAll("[data-bloom-version]").forEach((el) => {
    el.textContent = text;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyBloomVersionBadges);
} else {
  applyBloomVersionBadges();
}
