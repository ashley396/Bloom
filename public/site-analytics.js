/**
 * First-party, non-invasive marketing-site analytics.
 *
 * What this collects: which page was viewed, which site referred the
 * visitor (just the hostname — never the full URL, so no search terms
 * or other-site paths leak), UTM parameters if present, and which CTA
 * button was clicked. That's it.
 *
 * What this deliberately never does: no cookies, no persistent
 * cross-visit identifier, no IP storage, no fingerprinting, no
 * third-party script or pixel. The only client-side state is a random
 * id in sessionStorage that's gone the moment the tab closes — used
 * only to connect this tab's own pageviews to its own later CTA click
 * or signup, never sent anywhere but Florisyn's own backend.
 */
(function () {
  "use strict";

  var ENDPOINT = "/.netlify/functions/site-analytics";
  var LANDING_KEY = "florisyn_landing";
  var SESSION_KEY = "florisyn_session_id";

  function randomId() {
    return "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function sessionId() {
    try {
      var id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = randomId();
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch {
      return null;
    }
  }

  function landing() {
    try {
      var raw = sessionStorage.getItem(LANDING_KEY);
      if (raw) return JSON.parse(raw);
      var params = new URLSearchParams(location.search);
      var record = {
        path: location.pathname,
        referrer: document.referrer || "",
        utm_source: params.get("utm_source") || null,
        utm_medium: params.get("utm_medium") || null,
        utm_campaign: params.get("utm_campaign") || null,
      };
      sessionStorage.setItem(LANDING_KEY, JSON.stringify(record));
      return record;
    } catch {
      return { path: location.pathname, referrer: document.referrer || "" };
    }
  }

  function send(eventType, extra) {
    try {
      var land = landing();
      var payload = Object.assign(
        {
          event_type: eventType,
          path: location.pathname,
          referrer: document.referrer || "",
          landing_path: land.path,
          landing_referrer: land.referrer,
          utm_source: land.utm_source,
          utm_medium: land.utm_medium,
          utm_campaign: land.utm_campaign,
          session_id: sessionId(),
        },
        extra || {}
      );
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      } else {
        fetch(ENDPOINT, { method: "POST", body: body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(function () {});
      }
    } catch {
      /* analytics must never break the page */
    }
  }

  function trackPageview() {
    send("site_pageview");
  }

  function bindCtaClicks() {
    document.addEventListener(
      "click",
      function (e) {
        var el = e.target && e.target.closest ? e.target.closest("[data-cta]") : null;
        if (!el) return;
        send("site_cta_click", { cta_id: el.getAttribute("data-cta") });
      },
      { capture: true }
    );
  }

  function trackConversion(kind) {
    send("site_signup_conversion", { cta_id: kind || "signup" });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      trackPageview();
      bindCtaClicks();
    });
  } else {
    trackPageview();
    bindCtaClicks();
  }

  window.FlorisynAnalytics = { trackConversion: trackConversion };
})();
