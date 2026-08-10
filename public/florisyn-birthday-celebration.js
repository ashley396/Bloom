/**
 * Florisyn Birthday Celebration — Aug 10 surprise for Ashley & the shop.
 * Runs once per calendar day; respects reduced motion.
 */
(function (global) {
  "use strict";

  const FOUNDER_BIRTHDAY_MD = "08-10";
  const STORAGE_PREFIX = "florisyn_birthday_seen_";

  const MESSAGES = {
    lily: "Happy birthday! Let's design something unforgettable today — maybe a signature birthday bouquet for the shop window?",
    rose: "Happy birthday. Your shop is growing beautifully — I'll keep the numbers sharp while you celebrate.",
    daisy: "It's YOUR day! You're blooming, and we're cheering for you louder than a bucket of peonies!",
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function todayMonthDay() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${m}-${day}`;
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function floristFirstName() {
    const fromHeader = $("#atelierUserName")?.textContent?.trim();
    if (fromHeader && fromHeader !== "Florist") return fromHeader.split(/\s+/)[0];
    const email = $("#accountEmail")?.textContent?.trim() || "";
    const local = email.split("@")[0] || "";
    if (local && !/^(admin|user|test)/i.test(local)) {
      return local.charAt(0).toUpperCase() + local.slice(1).split(/[._-]/)[0];
    }
    return "Ashley";
  }

  function isBirthdayToday() {
    return todayMonthDay() === FOUNDER_BIRTHDAY_MD;
  }

  function alreadyCelebrated() {
    try {
      return localStorage.getItem(STORAGE_PREFIX + todayKey()) === "1";
    } catch {
      return false;
    }
  }

  function markCelebrated() {
    try {
      localStorage.setItem(STORAGE_PREFIX + todayKey(), "1");
    } catch {}
  }

  function prefersReducedMotion() {
    return global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  }

  function launchConfetti() {
    if (prefersReducedMotion()) return;
    const wrap = document.createElement("div");
    wrap.className = "florisyn-birthday-confetti";
    wrap.setAttribute("aria-hidden", "true");
    const colors = ["#e06b85", "#ffd978", "#ffffff", "#9ec5ff", "#c8f0d8"];
    for (let i = 0; i < 48; i++) {
      const piece = document.createElement("span");
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDuration = `${2.8 + Math.random() * 2.4}s`;
      piece.style.animationDelay = `${Math.random() * 1.2}s`;
      wrap.appendChild(piece);
    }
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 5200);
  }

  function renderBanner(name) {
    const host = $("#dashboardPage .atelier-dash-main");
    if (!host || host.querySelector(".florisyn-birthday-banner")) return;
    const banner = document.createElement("section");
    banner.className = "florisyn-birthday-banner";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Birthday celebration");
    banner.innerHTML = `
      <div class="florisyn-birthday-inner">
        <p class="florisyn-birthday-eyebrow">Happy Birthday from Florisyn</p>
        <h2>Happy Birthday, ${name}!</h2>
        <p>Your flower shop OS is blooming with you today — Lily, Rose, and Daisy saved something special just for you.</p>
        <div class="florisyn-birthday-assistants">
          <article><img src="/assets/assistants/lily-portrait.png" alt="" width="40" height="40"><div><b>Lily</b><small>${MESSAGES.lily}</small></div></article>
          <article><img src="/assets/assistants/rose-portrait.png" alt="" width="40" height="40"><div><b>Rose</b><small>${MESSAGES.rose}</small></div></article>
          <article><img src="/assets/assistants/daisy-portrait.png" alt="" width="40" height="40"><div><b>Daisy</b><small>${MESSAGES.daisy}</small></div></article>
        </div>
        <div class="florisyn-birthday-actions">
          <button type="button" class="primary" data-birthday-action="lily">Design with Lily</button>
          <button type="button" class="secondary" data-birthday-action="pos">Open POS</button>
        </div>
      </div>`;
    host.insertBefore(banner, host.firstChild);
    banner.querySelector('[data-birthday-action="lily"]')?.addEventListener("click", () => {
      document.querySelector('[data-page="aiStudioPage"]')?.click();
      global.BloomLilyPlatform?.toggle?.(true);
    });
    banner.querySelector('[data-birthday-action="pos"]')?.addEventListener("click", () => {
      document.querySelector('[data-page="posPage"]')?.click();
    });
  }

  function personalizeGreeting(name) {
    const greeting = $("#greeting");
    if (!greeting) return;
    const hour = new Date().getHours();
    const time =
      hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    greeting.textContent = `${time}, ${name} — happy birthday!`;
  }

  function speakDaisy() {
    const text = `Happy birthday, ${floristFirstName()}! Daisy and the whole Florisyn team are celebrating you today.`;
    if (global.FlorisynAssistantVoice?.speak) {
      global.FlorisynAssistantVoice.speak("Daisy", text, { force: true, preferUploadedVoice: true });
    }
  }

  function celebrate(options = {}) {
    if (!isBirthdayToday()) return false;
    if (!options.force && alreadyCelebrated()) {
      document.body.classList.add("florisyn-birthday-active");
      personalizeGreeting(floristFirstName());
      renderBanner(floristFirstName());
      return true;
    }
    document.body.classList.add("florisyn-birthday-active");
    const name = floristFirstName();
    personalizeGreeting(name);
    renderBanner(name);
    launchConfetti();
    const toast = $("#toast");
    if (toast) {
      toast.textContent = `Happy Birthday, ${name}! Lily, Rose & Daisy are celebrating with you today.`;
      toast.hidden = false;
      clearTimeout(global.__florisynBirthdayToast);
      global.__florisynBirthdayToast = setTimeout(() => {
        toast.hidden = true;
      }, 5200);
    }
    global.BloomDaisy?.gentleWag?.("Happy birthday!");
    if (options.speak !== false) setTimeout(speakDaisy, 900);
    markCelebrated();
    return true;
  }

  function initWhenAppVisible() {
    const app = $("#app");
    if (!app || app.hidden) return;
    celebrate();
  }

  function hookShowApp() {
    const app = $("#app");
    if (!app) return;
    const observer = new MutationObserver(() => {
      if (!app.hidden) initWhenAppVisible();
    });
    observer.observe(app, { attributes: true, attributeFilter: ["hidden"] });
    if (!app.hidden) initWhenAppVisible();
  }

  global.FlorisynBirthday = {
    isBirthdayToday,
    celebrate,
    init: hookShowApp,
    FOUNDER_BIRTHDAY_MD,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hookShowApp);
  } else {
    hookShowApp();
  }
})(typeof window !== "undefined" ? window : globalThis);
