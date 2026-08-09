/**
 * Florisyn media resilience layer.
 *
 * A tiny, dependency-free utility that makes every floral image in the app
 * degrade gracefully: it validates image URLs, renders an elegant loading
 * shimmer, and swaps broken/hot-linked images for a curated ultra-realistic
 * arrangement instead of showing a broken-image icon. Pure helpers are unit
 * tested; the DOM wiring is a single delegated listener so it works for any
 * markup rendered now or later (Floral Library, Website Builder preview, POS).
 *
 * Browser: exposes window.FlorisynMedia and auto-installs on DOMContentLoaded.
 * Node (tests): the pure helpers can be evaluated in a sandbox (see
 * tests/florisyn-media.test.js).
 */
(function (global) {
  "use strict";

  // Curated, locally-hosted ultra-realistic arrangement used whenever a
  // requested image is missing or fails to load. Local asset = never 404s.
  var DEFAULT_FALLBACK = "/assets/floral-library/florisyn-arrangement-signature-blush.jpg";

  function escapeAttr(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Only allow image sources we trust to render: absolute http(s) URLs,
   * root-relative same-origin paths, and inline data:image payloads.
   * Rejects javascript:/vbscript:, protocol-relative (//evil), and junk.
   */
  function isSafeImageUrl(url) {
    if (typeof url !== "string") return false;
    var value = url.trim();
    if (!value) return false;
    if (/^(?:javascript|vbscript|file):/i.test(value)) return false;
    if (/^https?:\/\/[^\s]+$/i.test(value)) return true;
    if (/^data:image\/[a-z0-9.+-]+;/i.test(value)) return true;
    // Root-relative path, but not a protocol-relative "//host" URL.
    if (/^\/(?!\/)/.test(value)) return true;
    return false;
  }

  function normalizeImageUrl(url) {
    return isSafeImageUrl(url) ? String(url).trim() : "";
  }

  /** Return the first safe URL among [url, fallback], else the default asset. */
  function pickImage(url, fallback) {
    return normalizeImageUrl(url) || normalizeImageUrl(fallback) || DEFAULT_FALLBACK;
  }

  /**
   * Build a resilient <img> HTML string with an elegant loading state and a
   * graceful fallback. Never throws; always returns a valid, escaped tag.
   */
  function mediaImg(options) {
    var opts = options || {};
    var fallback = normalizeImageUrl(opts.fallback) || DEFAULT_FALLBACK;
    var src = pickImage(opts.url, fallback);
    var alt = escapeAttr(opts.alt || "");
    var extra = opts.className ? " " + escapeAttr(opts.className) : "";
    var width = opts.width ? ' width="' + parseInt(opts.width, 10) + '"' : "";
    var height = opts.height ? ' height="' + parseInt(opts.height, 10) + '"' : "";
    return (
      '<img class="fx-media fx-media-loading' + extra + '"' +
      ' src="' + escapeAttr(src) + '"' +
      ' alt="' + alt + '" loading="lazy" decoding="async"' + width + height +
      ' data-fx-media data-fx-fallback="' + escapeAttr(fallback) + '">'
    );
  }

  function markResolved(img) {
    if (img && img.classList) img.classList.remove("fx-media-loading");
  }

  /** Swap a broken image for its fallback exactly once (no reload loops). */
  function handleImgError(img) {
    if (!img || (img.getAttribute && img.getAttribute("data-fx-failed") === "1")) return;
    var fallback = (img.getAttribute && img.getAttribute("data-fx-fallback")) || DEFAULT_FALLBACK;
    if (img.setAttribute) img.setAttribute("data-fx-failed", "1");
    if (img.classList) {
      img.classList.remove("fx-media-loading");
      img.classList.add("fx-media-broken");
    }
    if (img.getAttribute && img.getAttribute("src") !== fallback) img.src = fallback;
  }

  function isTrackedImage(node) {
    return !!(node && node.tagName === "IMG" && node.hasAttribute && node.hasAttribute("data-fx-media"));
  }

  /** Install delegated load/error handling once per document. */
  function init(doc) {
    var target = doc || (typeof document !== "undefined" ? document : null);
    if (!target || target.__fxMediaInit) return;
    target.__fxMediaInit = true;
    // Capture phase: image load/error events do not bubble.
    target.addEventListener("error", function (event) {
      if (isTrackedImage(event && event.target)) handleImgError(event.target);
    }, true);
    target.addEventListener("load", function (event) {
      if (isTrackedImage(event && event.target)) markResolved(event.target);
    }, true);
  }

  var api = {
    DEFAULT_FALLBACK: DEFAULT_FALLBACK,
    escapeAttr: escapeAttr,
    isSafeImageUrl: isSafeImageUrl,
    normalizeImageUrl: normalizeImageUrl,
    pickImage: pickImage,
    mediaImg: mediaImg,
    handleImgError: handleImgError,
    init: init
  };

  if (global) global.FlorisynMedia = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { init(document); });
    } else {
      init(document);
    }
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
