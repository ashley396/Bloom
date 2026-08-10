/**
 * Florisyn Business OS — Rose AI Business Advisor chat + pulse panel.
 */
(function () {
  const RESPONSES = {
    "pricing strategy":
      "Looking at your wedding demand spike, I recommend lifting signature wedding packages by 12–15% while keeping weekday everyday bouquets steady. Protect volume on entry arrangements and capture margin where bookings are already overflowing.",
    "marketing plan":
      "Lead with behind-the-scenes Instagram Reels this week — your competitors are seeing ~40% more engagement on process content. Pair each Reel with a clear wedding consult CTA and a soft Everyday Bouquet promo for midweek.",
    "competitor analysis":
      "Nearby shops are underpricing premium vase work but over-indexing on discounts. Your luxury positioning is the advantage — lean into white-glove delivery stories and VIP add-ons rather than matching coupon wars.",
    "monthly review":
      "Month-to-date: wedding bookings +23%, average order value up slightly, and rose stem usage is running hot for the weekend. Priority: lock supplier reorder by Thursday, then confirm two VIP bridal consultations before Friday."
  };

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
    const key = prompt.trim().toLowerCase();
    for (const [k, v] of Object.entries(RESPONSES)) {
      if (key === k || key.includes(k)) return v;
    }
    if (/price|pricing|wedding|package/i.test(prompt)) return RESPONSES["pricing strategy"];
    if (/market|instagram|social|content/i.test(prompt)) return RESPONSES["marketing plan"];
    if (/competitor|rival|nearby/i.test(prompt)) return RESPONSES["competitor analysis"];
    if (/month|review|report|kpi/i.test(prompt)) return RESPONSES["monthly review"];
    return `Noted. Based on your current books, I would prioritize three moves: protect wedding package margin, schedule a midweek marketing push, and reorder high-velocity roses before Thursday. Ask me to go deeper on pricing, marketing, competitors, or a monthly review.`;
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
            prompt: `Rose, as Florisyn's AI Business Strategist, answer concisely with practical florist shop advice: ${clean}`,
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
