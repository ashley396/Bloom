/**
 * Florisyn Business OS — Rose AI Business Advisor chat + pulse panel.
 */
(function () {
  const TOPIC_REPLIES = {
    pricing: [
      "Wedding demand is strong — lift signature packages 12–15% while holding steady on weekday everyday price points. Protect entry volume; capture margin where consults are already booked.",
      "Before a blanket price bump, tier by labor: hand-tied everyday stays flat, premium vase and bridal installs move up first. That protects walk-in volume while you recover design time.",
      "Check stem cost on your top three wedding SKUs this week. If rose or hydrangea landed higher, adjust package pricing now instead of eating margin on Saturday rush orders."
    ],
    marketing: [
      "Lead with behind-the-scenes Reels — process content is outperforming static posts in your market. End each clip with one clear CTA: wedding consult or midweek everyday pickup.",
      "This week, pair one educational carousel (care tips, vase sizing) with one social-proof post (review screenshot, delivery moment). Alternate formats so the feed does not feel repetitive.",
      "Repurpose your best recent arrangement as three assets: feed photo, Story poll on color preference, and a short caption with delivery-area keywords for local search."
    ],
    competitors: [
      "Nearby shops are discounting hard on premium vase work. Your edge is service story — highlight white-glove delivery and consult quality instead of matching coupon wars.",
      "Competitors are under-indexing on sympathy professionalism. A calm, consistent sympathy landing page and clear standing-spray tiers can win trust without racing to the bottom.",
      "If rivals push free delivery, counter with value: timed delivery windows, photo proof, and upgrade stems — not a margin-killing free zone."
    ],
    review: [
      "Month-to-date: wedding bookings trending up, average ticket stable, rose usage hot for the weekend. Reorder high-velocity stems by Thursday and confirm VIP bridal consults.",
      "Quick pulse: track unpaid balances and delivery-heavy days first — those two usually explain cash-flow surprises before month end.",
      "Scan last month's top five SKUs by margin, not just revenue. Promote the winners in POS favorites and trim the slow movers from standing cooler commitments."
    ],
    general: [
      "Three moves for this week: protect wedding package margin, schedule one midweek marketing push, and reorder fast-moving roses before the weekend rush.",
      "Start with what is due today — unpaid orders, delivery prep, and cooler gaps — then ask me to go deeper on pricing, marketing, competitors, or a monthly review.",
      "Pick one profit lever and one visibility lever this week. Rose can walk you through either if you name the goal (more weddings, higher AOV, or better weekday traffic)."
    ]
  };

  function simpleHash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

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

  function welcomeCopy() {
    return `Hello ${floristName()}! I have been analyzing your shop performance. Your wedding season bookings are up 23% — shall I suggest pricing adjustments to maximize revenue? I also have 3 new marketing ideas ready for you.`;
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

  function replyFor(prompt) {
    const clean = String(prompt || "").trim();
    let topic = "general";
    if (/price|pricing|wedding|package|margin|markup/i.test(clean)) topic = "pricing";
    else if (/market|instagram|social|content|reel|post|promo/i.test(clean)) topic = "marketing";
    else if (/competitor|rival|nearby|compare/i.test(clean)) topic = "competitors";
    else if (/month|review|report|kpi|pulse|week/i.test(clean)) topic = "review";
    const variants = TOPIC_REPLIES[topic] || TOPIC_REPLIES.general;
    return variants[simpleHash(clean.toLowerCase()) % variants.length];
  }

  async function askRose(prompt) {
    const clean = (prompt || "").trim();
    if (!clean) {
      window.toast?.("Ask Rose a business question first");
      return;
    }
    appendMessage("user", clean);
    const send = $("#bosSendBtn");
    if (send) send.disabled = true;
    try {
      const smartAi = typeof window.smartAi === "function" ? window.smartAi : null;
      if (smartAi) {
        const thinking = document.createElement("article");
        thinking.className = "bos-msg assistant bos-thinking";
        thinking.innerHTML = `<img class="bos-msg-avatar" src="/assets/assistants/rose-portrait.png" alt="" width="28" height="28"><div class="bos-bubble"><p>Rose is reviewing your numbers…</p></div>`;
        $("#bosMessages")?.appendChild(thinking);
        try {
          const context = typeof window.loadAiContext === "function" ? await window.loadAiContext() : {};
          const d = await smartAi({
            mode: "chat",
            persona: "Rose",
            prompt: clean,
            context
          });
          thinking.remove();
          const answer =
            d?.answer ||
            d?.message ||
            d?.result?.message ||
            (typeof d?.result === "string" ? d.result : "") ||
            replyFor(clean);
          appendMessage("assistant", String(answer).trim() || replyFor(clean));
          return;
        } catch {
          thinking.remove();
        }
      }
      await new Promise((r) => setTimeout(r, 280));
      appendMessage("assistant", replyFor(clean));
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
        input.value = btn.dataset.bosChip || btn.textContent || "";
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

    $$("#ecosystemPage [data-bos-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.bosAction;
        const title = btn.closest(".bos-insight")?.querySelector("h3")?.textContent || "Insight";
        if (action === "apply") {
          window.toast?.(`Rose applied: ${title}`);
          addActionItem(`Applied — ${title}`, "Done");
        } else if (action === "create-post") {
          window.toast?.("Opening Lily AI Studio to design the Instagram post…");
          if (window.FlorisynRouter?.navigate) window.FlorisynRouter.navigate("/lily-ai-studio");
          else window.showPage?.("aiStudioPage");
        } else if (action === "add-task") {
          window.toast?.("Added to Action Items");
          addActionItem(btn.closest(".bos-insight")?.querySelector("p")?.textContent || title, "Open");
          setTab("actions");
        }
      });
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
  }

  window.FlorisynBusinessOs = { boot, askRose, setTab };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if ($("#ecosystemPage")?.classList.contains("active")) boot();
    });
  } else if ($("#ecosystemPage")?.classList.contains("active")) {
    boot();
  }
})();
