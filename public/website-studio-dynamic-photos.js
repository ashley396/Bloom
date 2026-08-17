/**
 * Loads real hero photos a platform admin uploaded from the admin console
 * (netlify/functions/admin-photo-manager.js, context=website_hero) into
 * the existing static hero photo picker (index.html's
 * .photo-category-chips / .image-picker.photo-gallery), so new photos
 * show up for every florist without a developer editing index.html and
 * redeploying.
 *
 * Deliberately additive: never removes or replaces the static photos
 * baked into the page, and degrades silently to "just the static set" on
 * any fetch failure — an admin-content hiccup must never break the
 * picker that's already working.
 */
(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  function wireHeroImageClick(button) {
    button.onclick = () => {
      const urlInput = document.getElementById("heroImageUrl");
      if (urlInput) urlInput.value = button.dataset.heroImage;
      window.renderWebsite?.();
      window.toast?.("Website photo selected");
    };
  }

  // Mirrors the existing static-chip click behavior in app.js exactly,
  // so a dynamically-added chip (a category an admin used that isn't one
  // of the built-in ones) filters the same way as every other chip.
  function wireGalleryFilterClick(button, chipsContainer) {
    button.onclick = () => {
      chipsContainer.querySelectorAll("[data-gallery-filter]").forEach((x) => x.classList.remove("active"));
      button.classList.add("active");
      const filter = button.dataset.galleryFilter;
      document.querySelectorAll(".photo-gallery [data-category]").forEach((card) => {
        card.hidden = filter !== "all" && card.dataset.category !== filter;
      });
    };
  }

  async function load() {
    const chipsContainer = document.querySelector(".photo-category-chips");
    const gallery = document.querySelector(".image-picker.photo-gallery");
    if (!chipsContainer || !gallery || gallery.dataset.adminPhotosLoaded) return;
    gallery.dataset.adminPhotosLoaded = "1";

    let items = [];
    try {
      const res = await fetch("/.netlify/functions/admin-photo-manager?action=public_list&context=website_hero");
      if (!res.ok) return;
      const d = await res.json();
      items = Array.isArray(d.items) ? d.items : [];
    } catch {
      return;
    }
    if (!items.length) return;

    for (const item of items) {
      const category = String(item.category || "").trim();
      if (!category) continue;

      let chip = chipsContainer.querySelector(`[data-gallery-filter="${CSS.escape(category)}"]`);
      if (!chip) {
        chip = document.createElement("button");
        chip.type = "button";
        chip.dataset.galleryFilter = category;
        chip.textContent = category;
        chipsContainer.appendChild(chip);
        wireGalleryFilterClick(chip, chipsContainer);
      }

      const button = document.createElement("button");
      button.type = "button";
      button.dataset.category = category;
      button.dataset.heroImage = item.url;
      button.dataset.adminUploaded = "true";
      button.style.backgroundImage = `url('${item.url}')`;
      button.innerHTML = `<span>${esc(item.name || "Untitled")}</span>`;
      gallery.appendChild(button);
      wireHeroImageClick(button);
    }
  }

  window.BloomWebsiteStudioDynamicPhotos = { load };
})();
