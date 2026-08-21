/**
 * Florisyn Business OS — Rose AI Business Advisor chat + pulse panel.
 *
 * Beta-blocker repair: the "Business Pulse" / "Business Insights" cards and
 * Rose's welcome message used to be hardcoded fabricated statistics ("your
 * wedding season bookings are up 23%", a fake 15% price-increase
 * recommendation, a fake competitor-engagement claim, a stockout alert not
 * tied to any real inventory) shown to every shop regardless of its real
 * data — styled and timestamped exactly like real AI analysis. They now
 * render the real, shop-scoped suggestions the business-ecosystem backend
 * already computes (netlify/functions/business-ecosystem.js, action
 * "lily_coach") — the same real pipeline business-ecosystem-ui.js's
 * "Lily coach" tab already used, just not previously shown here. If that
 * call fails or returns nothing, an honest empty/unavailable state is
 * shown — never invented numbers.
 */
(function () {
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return [...(root || document).querySelectorAll(sel)];
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function floristName() {
    const fromHeader = $("#atelierUserName")?.textContent?.trim();
    if (fromHeader && fromHeader !== "Florist") return fromHeader.split(/\s+/)[0];
    const email = $("#accountEmail")?.textContent?.trim() || "";
    const local = email.split("@")[0] || "";
    if (local && !/^(admin|user|test)/i.test(local)) {
      return local.charAt(0).toUpperCase() + local.slice(1).split(/[._-]/)[0];
    }
    return "Ashley";
  }

  // No fabricated stat — Rose no longer claims to have "already analyzed"
  // anything before a florist has asked her a single question.
  function welcomeCopy() {
    return `Hello ${floristName()}! I'm Rose, your business advisor. Ask me about pricing, marketing, or operations, or check Business Pulse for a few suggestions based on your shop's real numbers.`;
  }

  function appendMessage(role, text) {
    const wrap = $("#bosMessages");
    if (!wrap) return;
    const article = document.createElement("article");
    article.className = `bos-msg ${role}`;
    if (role === "assistant") {
      article.innerHTML = `<img class="bos-msg-avatar" src="/assets/assistants/rose-portrait.png" alt="" width="28" height="28"><div class="bos-bubble"><p>${esc(text)}</p></div>`;
    } else {
      article.innerHTML = `<div class="bos-bubble"><p>${esc(text)}</p></div>`;
    }
    wrap.appendChild(article);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function ensureWelcome() {
    const wrap = $("#bosMessages");
    if (!wrap || wrap.dataset.seeded) return;
    wrap.dataset.seeded = "1";
    wrap.innerHTML = "";
    appendMessage("assistant", welcomeCopy());
  }

  // Beta-blocker repair: askRose() used to silently substitute a canned,
  // hash-selected paragraph from a hardcoded template bank whenever the
  // real AI call failed — rendered in the identical bubble as a genuine
  // answer, with no indication it wasn't real. Rose now matches Lily's
  // honest-failure pattern (public/lily-platform.js friendlyLilyError):
  // say plainly that the AI service is unavailable, never fabricate an
  // answer in its place.
  const ROSE_UNAVAILABLE =
    "Rose's AI business analysis is temporarily unavailable. Please try again in a moment — the Business Pulse suggestions are still based on your shop's real numbers.";

  async function askRose(prompt) {
    const clean = (prompt || "").trim();
    if (!clean) {
      window.toast?.("Ask Rose a business question first");
      return;
    }
    appendMessage("user", clean);
    const send = $("#bosSendBtn");
    if (send) send.disabled = true;
    const smartAi = typeof window.smartAi === "function" ? window.smartAi : null;
    if (!smartAi) {
      appendMessage("assistant", ROSE_UNAVAILABLE);
      if (send) send.disabled = false;
      return;
    }
    const thinking = document.createElement("article");
    thinking.className = "bos-msg assistant bos-thinking";
    thinking.innerHTML = `<img class="bos-msg-avatar" src="/assets/assistants/rose-portrait.png" alt="" width="28" height="28"><div class="bos-bubble"><p>Rose is reviewing your numbers…</p></div>`;
    $("#bosMessages")?.appendChild(thinking);
    try {
      const context = typeof window.loadAiContext === "function" ? await window.loadAiContext() : {};
      const d = await smartAi({ mode: "chat", persona: "Rose", prompt: clean, context });
      thinking.remove();
      const answer =
        d?.answer ||
        d?.message ||
        d?.result?.message ||
        (typeof d?.result === "string" ? d.result : "");
      appendMessage("assistant", String(answer || "").trim() || ROSE_UNAVAILABLE);
    } catch {
      thinking.remove();
      appendMessage("assistant", ROSE_UNAVAILABLE);
    } finally {
      if (send) send.disabled = false;
    }
  }

  function setTab(id) {
    $$(".bos-tabs [data-bos-tab]").forEach((btn) => {
      const on = btn.dataset.bosTab === id;
      btn.classList.toggle("active", on);
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    $$("[data-bos-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.bosPanel === id);
    });
  }

  // ---- Real, shop-scoped Business Pulse / Business Insights ----
  // Same backend action business-ecosystem-ui.js's "Lily coach" tab
  // already calls (netlify/functions/business-ecosystem.js, action
  // "lily_coach") — real inventory/order/subscription/margin signals,
  // never a hardcoded statistic. Cached only so the two render targets
  // (pulse aside + Business Insights tab) and the Ask Rose/Add-to-Tasks
  // buttons share one fetch per page load.
  let insightsCache = null;

  async function fetchInsights() {
    const fn = window.bloomEcosystemApi || window.api;
    if (typeof fn !== "function") throw new Error("Sign in required.");
    const d = await fn("business-ecosystem", { method: "POST", body: JSON.stringify({ action: "lily_coach" }) });
    return Array.isArray(d?.suggestions) ? d.suggestions : [];
  }

  function emptyPulseState(message) {
    return `<p class="bos-empty subtle">${esc(message)}</p>`;
  }

  function insightCard(suggestion, fetchedAtIso) {
    return `<article class="bos-insight" data-bos-suggestion-id="${esc(suggestion.id)}">
      <h3>${esc(suggestion.title)}</h3>
      <p>${esc(suggestion.detail)}</p>
      <div class="bos-insight-actions">
        <button type="button" data-bos-action="ask">Ask Rose</button>
        <button type="button" data-bos-action="add-task">Add to Tasks</button>
        <time datetime="${esc(fetchedAtIso)}">Just now</time>
      </div>
    </article>`;
  }

  function renderInsights(target, suggestions, fetchedAtIso) {
    if (!target) return;
    if (!suggestions.length) {
      target.innerHTML = emptyPulseState("No specific recommendations right now — your shop's core numbers look steady.");
      return;
    }
    target.innerHTML = suggestions.map((s) => insightCard(s, fetchedAtIso)).join("");
  }

  async function loadInsights() {
    const pulse = $("#bosPulseInsights");
    const tab = $("#bosInsightsTabList");
    if (!pulse && !tab) return;
    if (pulse) pulse.innerHTML = emptyPulseState("Loading Rose's suggestions…");
    if (tab) tab.innerHTML = emptyPulseState("Loading Rose's suggestions…");
    try {
      const suggestions = await fetchInsights();
      const fetchedAtIso = new Date().toISOString();
      insightsCache = { suggestions, fetchedAtIso };
      renderInsights(pulse, suggestions, fetchedAtIso);
      renderInsights(tab, suggestions, fetchedAtIso);
    } catch (e) {
      insightsCache = null;
      const msg = `Rose couldn't load your shop's numbers right now${e?.message ? `: ${e.message}` : "."}`;
      if (pulse) pulse.innerHTML = emptyPulseState(msg);
      if (tab) tab.innerHTML = emptyPulseState(msg);
    }
  }

  function findSuggestion(id) {
    return insightsCache?.suggestions?.find((s) => s.id === id) || null;
  }

  function wireActions() {
    if (document.body.dataset.bosWired) return;
    document.body.dataset.bosWired = "1";

    $$(".bos-tabs [data-bos-tab]").forEach((btn) => {
      btn.addEventListener("click", () => setTab(btn.dataset.bosTab));
    });

    $$("#ecosystemPage [data-bos-chip]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = $("#bosPrompt");
        if (!input) return;
        const chip = (btn.dataset.bosChip || btn.textContent || "").trim();
        if (/pricing strategy/i.test(chip)) input.dataset.bosTopic = "pricing strategy";
        input.value = chip;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    });

    $("#bosChatForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#bosPrompt");
      const prompt = input?.value.trim() || "";
      if (!prompt) return;
      if (input) input.value = "";
      askRose(prompt);
    });

    // Delegated: insight cards are rendered dynamically from real data, so
    // there's no static button to bind at wire-time.
    $("#ecosystemPage")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-bos-action]");
      if (!btn) return;
      const card = btn.closest("[data-bos-suggestion-id]");
      const suggestion = card ? findSuggestion(card.dataset.bosSuggestionId) : null;
      if (!suggestion) return;
      const action = btn.dataset.bosAction;
      if (action === "ask") {
        setTab("chat");
        askRose(suggestion.prompt || suggestion.title);
      } else if (action === "add-task") {
        window.toast?.("Added to Action Items");
        addActionItem(`${suggestion.title} — ${suggestion.detail}`, "Open");
        setTab("actions");
      }
    });
  }

  function addActionItem(text, status) {
    const list = $("#bosActionList");
    if (!list) return;
    const empty = list.querySelector(".bos-empty");
    empty?.remove();
    const row = document.createElement("div");
    row.className = "bos-action-item";
    row.innerHTML = `<span>${esc(text)}</span><em>${esc(status)}</em>`;
    list.prepend(row);
  }

  function boot() {
    wireActions();
    ensureWelcome();
    setTab("chat");
    loadInsights();
  }

  window.FlorisynBusinessOs = { boot, askRose, setTab, loadInsights };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if ($("#ecosystemPage")?.classList.contains("active")) boot();
    });
  } else if ($("#ecosystemPage")?.classList.contains("active")) {
    boot();
  }
})();
