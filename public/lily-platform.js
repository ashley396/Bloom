(function () {
  const STORAGE_KEY = "bloom_lily_v1";
  const THEME_KEY = "bloom_lily_theme";
  const TOOLBAR = [
    { label: "Create Order", page: "ordersPage", dialog: "orderDialog" },
    { label: "Add Product", page: "productsPage" },
    { label: "Find Customer", page: "customersPage" },
    { label: "Marketplace", page: "marketplacePage" },
    { label: "Inventory", page: "inventoryPage" },
    { label: "Reports", page: "reportsPage" },
    { label: "Facebook Post", prompt: "Write a Facebook post for today's featured arrangement" },
    { label: "Website", page: "websitePage" },
    { label: "Support", prompt: "How do I contact Florisyn support?" }
  ];

  let deps = null;
  let open = false;
  let expanded = false;
  let tab = "chat";
  let conversationId = null;
  let pendingAction = null;
  let typingTimer = null;
  let adminKpis = null;

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  }

  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function activeConversation(store) {
    if (!store.activeId) {
      store.activeId = `local-${Date.now()}`;
      store.conversations = store.conversations || {};
      store.conversations[store.activeId] = {
        id: store.activeId,
        title: "New conversation",
        messages: [],
        updated_at: new Date().toISOString()
      };
    }
    return store.conversations[store.activeId];
  }

  function renderMarkdown(text) {
    const safe = esc(text);
    return safe
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/^(.+)$/s, (m) => (m.includes("<p>") || m.includes("<ul>") ? m : `<p>${m}</p>`));
  }

  function friendlyLilyError(error) {
    const msg = String(error?.message || error || "");
    if (/cloud ai|local fallback|local ai|load failed|ai unavailable|provider|ollama/i.test(msg)) {
      return "Lily is here, but her AI writing service is temporarily offline. You can still use the quick buttons below for orders, products, customers, inventory, website, reports, and support.";
    }
    return `I hit a snag: ${msg || "Please try again."}`;
  }

  function marketingDraftFallback(generate, shop = {}) {
    if (!generate?.task && !generate?.input?.prompt) return "";
    const shopName = shop.name || "Our flower shop";
    const prompt = String(generate.input?.prompt || generate.input?.message || "").trim();
    const topic = prompt.replace(/^write (a )?/i, "").replace(/\.$/, "") || "today's featured flowers";
    const channel = String(generate.input?.channel || generate.channel || "facebook").toLowerCase();
    if (channel.includes("facebook")) {
      return `**Draft (edit before posting):**\n\n🌸 ${topic.charAt(0).toUpperCase() + topic.slice(1)} — fresh from ${shopName}! Perfect for gifting or brightening your week. Stop by or order for local delivery.\n\n#flowers #localflorist #${shopName.replace(/[^a-z0-9]+/gi, "").toLowerCase() || "florist"}`;
    }
    return `**Draft (edit before posting):**\n\n${topic.charAt(0).toUpperCase() + topic.slice(1)} — from ${shopName}. Fresh, local, and ready for your next celebration.`;
  }

  function mountShell() {
    if (document.getElementById("lilyFab")) return;
    const fab = document.createElement("button");
    fab.type = "button";
    fab.id = "lilyFab";
    fab.className = "lily-fab";
    fab.title = "Lily — Florisyn assistant";
    fab.innerHTML = '<img src="/assets/assistants/lily-portrait.png" alt="Lily">';
    fab.onclick = () => togglePanel(true);

    const panel = document.createElement("section");
    panel.id = "lilyPanel";
    panel.className = "lily-panel";
    panel.hidden = true;
    panel.innerHTML = `
      <header class="lily-panel-head">
        <div><strong>Lily</strong><small>Intelligent operating assistant</small></div>
        <div class="lily-head-tools">
          <button type="button" id="lilyThemeToggle" title="Theme">◐</button>
          <button type="button" id="lilyExpand" title="Expand">⤢</button>
          <button type="button" id="lilyClose" class="lily-close-btn" title="Close Lily chat" aria-label="Close Lily chat">
            <span class="lily-close-x" aria-hidden="true">×</span>
            <span class="lily-close-label">Close</span>
          </button>
        </div>
      </header>
      <nav class="lily-tabs">
        <button type="button" data-lily-tab="chat" class="active">Chat</button>
        <button type="button" data-lily-tab="history">Recent</button>
        <button type="button" data-lily-tab="coach">Coach</button>
      </nav>
      <div class="lily-search" id="lilyHistorySearchWrap" hidden>
        <input id="lilyHistorySearch" placeholder="Search conversation history…">
      </div>
      <div class="lily-body" id="lilyBody"></div>
      <div class="lily-suggestions" id="lilySuggestions"></div>
      <div id="lilyConfirm" class="lily-confirm" hidden></div>
      <div class="lily-toolbar" id="lilyToolbar"></div>
      <div class="lily-compose">
        <input type="file" id="lilyPhotoInput" accept="image/jpeg,image/png,image/webp,image/heic" hidden>
        <button type="button" class="lily-photo" title="Analyze arrangement photo" aria-label="Upload arrangement photo">📷</button>
        <button type="button" class="lily-voice" title="Hear Lily">🎙</button>
        <textarea id="lilyInput" rows="1" placeholder="Ask Lily anything about your shop…"></textarea>
        <button type="button" class="lily-send" id="lilySend">→</button>
      </div>`;

    document.body.append(fab, panel);
    document.getElementById("lilyClose").onclick = () => togglePanel(false);
    document.getElementById("lilyExpand").onclick = () => {
      expanded = !expanded;
      panel.classList.toggle("lily-expanded", expanded);
    };
    document.getElementById("lilyThemeToggle").onclick = () => {
      const next = document.body.dataset.lilyTheme === "dark" ? "light" : "dark";
      document.body.dataset.lilyTheme = next;
      localStorage.setItem(THEME_KEY, next);
    };
    document.getElementById("lilySend").onclick = () => sendMessage();
    document.getElementById("lilyPhotoInput").onchange = (e) => analyzeArrangementPhoto(e.target.files?.[0]);
    document.querySelector(".lily-photo").onclick = () => document.getElementById("lilyPhotoInput").click();
    document.querySelector(".lily-voice").onclick = () => {
      window.FlorisynAssistantVoice?.speak?.(
        "Lily",
        "Hi, I'm Lily. I'm here to help with your shop, and I'll keep things simple.",
        { force: true, respectToggle: false }
      );
    };
    document.getElementById("lilyInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    document.querySelectorAll("[data-lily-tab]").forEach((btn) => {
      btn.onclick = () => setTab(btn.dataset.lilyTab);
    });
    document.getElementById("lilyHistorySearch").oninput = () => renderHistoryList();

    const theme = localStorage.getItem(THEME_KEY);
    if (theme) document.body.dataset.lilyTheme = theme;

    const toolbar = document.getElementById("lilyToolbar");
    toolbar.innerHTML = TOOLBAR.map((t) => `<button type="button" data-lily-tool="${esc(t.label)}">${esc(t.label)}</button>`).join("");
    toolbar.querySelectorAll("button").forEach((btn, i) => {
      btn.onclick = () => runToolbar(TOOLBAR[i]);
    });
  }

  function lockPageScroll(locked) {
    document.body.classList.toggle("lily-panel-open", locked);
    if (locked) {
      document.body.dataset.lilyScrollY = String(window.scrollY || 0);
      document.body.style.top = `-${window.scrollY || 0}px`;
      document.body.style.position = "fixed";
      document.body.style.width = "100%";
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    } else {
      const y = Number(document.body.dataset.lilyScrollY || 0);
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
      delete document.body.dataset.lilyScrollY;
      window.scrollTo(0, y);
    }
  }

  function togglePanel(force) {
    open = typeof force === "boolean" ? force : !open;
    const panel = document.getElementById("lilyPanel");
    if (!panel) return;
    panel.hidden = !open;
    lockPageScroll(open);
    if (open) {
      renderChat();
      loadCoach();
    }
  }

  function setTab(next) {
    tab = next;
    document.querySelectorAll("[data-lily-tab]").forEach((b) => b.classList.toggle("active", b.dataset.lilyTab === tab));
    document.getElementById("lilyHistorySearchWrap").hidden = tab !== "history";
    if (tab === "chat") renderChat();
    if (tab === "history") renderHistoryList();
    if (tab === "coach") renderCoachTab();
  }

  function renderChat() {
    const body = document.getElementById("lilyBody");
    if (!body) return;
    const store = loadStore();
    const conv = activeConversation(store);
    body.innerHTML = conv.messages
      .map(
        (m) =>
          `<article class="lily-msg ${m.role === "user" ? "user" : "assistant"}">${m.role === "assistant" ? renderMarkdown(m.content) : esc(m.content)}</article>`
      )
      .join("");
    body.scrollTop = body.scrollHeight;
    renderSuggestions(store.lastSuggestions || []);
  }

  function renderSuggestions(list) {
    const el = document.getElementById("lilySuggestions");
    if (!el) return;
    el.innerHTML = (list || [])
      .slice(0, 4)
      .map((s) => `<button type="button" data-lily-prompt="${esc(s.prompt || s.title)}">${esc(s.title || s)}</button>`)
      .join("");
    el.querySelectorAll("[data-lily-prompt]").forEach((b) => {
      b.onclick = () => {
        document.getElementById("lilyInput").value = b.dataset.lilyPrompt;
        sendMessage();
      };
    });
  }

  function renderHistoryList() {
    const body = document.getElementById("lilyBody");
    const q = document.getElementById("lilyHistorySearch").value.trim().toLowerCase();
    const store = loadStore();
    const items = Object.values(store.conversations || {})
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .filter((c) => !q || c.title.toLowerCase().includes(q) || (c.messages || []).some((m) => m.content.toLowerCase().includes(q)));
    body.innerHTML = `<div class="lily-history-list">${items
      .map(
        (c) =>
          `<button type="button" data-conv="${esc(c.id)}"><strong>${esc(c.title)}</strong><small>${new Date(c.updated_at).toLocaleString()} · ${(c.messages || []).length} messages</small></button>`
      )
      .join("")}<button type="button" id="lilyClearHistory" class="secondary">Clear all history</button></div>`;
    body.querySelectorAll("[data-conv]").forEach((b) => {
      b.onclick = () => {
        store.activeId = b.dataset.conv;
        saveStore(store);
        setTab("chat");
      };
    });
    document.getElementById("lilyClearHistory").onclick = () => {
      if (!confirm("Clear all Lily conversations on this device?")) return;
      deps?.api?.("lily-ai", {
        method: "POST",
        body: JSON.stringify({ action: "clear-memory", conversation_id: conversationId }),
      }).catch(() => {});
      localStorage.removeItem(STORAGE_KEY);
      conversationId = null;
      setTab("chat");
      deps?.toast?.("Lily history cleared");
    };
  }

  async function loadCoach() {
    if (!deps?.api || deps.mode === "admin") return;
    try {
      const d = await deps.api("lily-ai", { method: "POST", body: JSON.stringify({ action: "coach" }) });
      const store = loadStore();
      store.lastSuggestions = d.suggestions || [];
      saveStore(store);
      renderSuggestions(store.lastSuggestions);
    } catch {
      renderSuggestions([
        { title: "Create order", prompt: "Create an order for a walk-in customer" },
        { title: "Today's deliveries", prompt: "Show today's deliveries" },
        { title: "Facebook post", prompt: "Write a Facebook post" }
      ]);
    }
  }

  function renderCoachTab() {
    const body = document.getElementById("lilyBody");
    const store = loadStore();
    const list = store.lastSuggestions || [];
    body.innerHTML = list.length
      ? `<div class="lily-history-list">${list
          .map(
            (s) =>
              `<button type="button" data-coach="${esc(s.prompt)}"><strong>${esc(s.title)}</strong><small>${esc(s.detail || "")}</small></button>`
          )
          .join("")}</div>`
      : `<p class="subtle">Open the dashboard to refresh business coach tips.</p>`;
    body.querySelectorAll("[data-coach]").forEach((b) => {
      b.onclick = () => {
        document.getElementById("lilyInput").value = b.dataset.coach;
        setTab("chat");
        sendMessage();
      };
    });
  }

  function appendMessage(role, content) {
    const store = loadStore();
    const conv = activeConversation(store);
    conv.messages.push({ role, content, created_at: new Date().toISOString() });
    if (role === "user" && conv.title === "New conversation") conv.title = content.slice(0, 60);
    conv.updated_at = new Date().toISOString();
    saveStore(store);
    renderChat();
  }

  function showTyping() {
    const body = document.getElementById("lilyBody");
    const el = document.createElement("div");
    el.className = "lily-typing";
    el.id = "lilyTyping";
    el.textContent = "Lily is thinking…";
    body.append(el);
    body.scrollTop = body.scrollHeight;
  }

  function hideTyping() {
    document.getElementById("lilyTyping")?.remove();
  }

  async function typeAssistantResponse(text) {
    hideTyping();
    const store = loadStore();
    const conv = activeConversation(store);
    const msg = { role: "assistant", content: "", created_at: new Date().toISOString() };
    conv.messages.push(msg);
    saveStore(store);
    renderChat();
    const body = document.getElementById("lilyBody");
    const nodes = body.querySelectorAll(".lily-msg.assistant");
    const target = nodes[nodes.length - 1];
    let i = 0;
    clearInterval(typingTimer);
    return new Promise((resolve) => {
      typingTimer = setInterval(() => {
        i += Math.max(2, Math.floor(text.length / 80));
        msg.content = text.slice(0, i);
        if (target) target.innerHTML = renderMarkdown(msg.content);
        body.scrollTop = body.scrollHeight;
        if (i >= text.length) {
          clearInterval(typingTimer);
          msg.content = text;
          saveStore(store);
          resolve();
        }
      }, 16);
    });
  }

  async function analyzeArrangementPhoto(file) {
    if (!file || !deps?.api) return;
    appendMessage("user", `[Uploaded arrangement photo: ${file.name}]`);
    showTyping();
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await deps.api("lily-arrangement-vision", {
        method: "POST",
        body: JSON.stringify({ image_data_url: dataUrl }),
      });
      const draft = result.draft || {};
      const lines = (draft.recipe_lines || [])
        .map((r) => `- ${r.qty || "?"} × ${r.name}${r.note ? ` (${r.note})` : ""}`)
        .join("\n");
      const text = `**Likely arrangement draft** (please review before saving):\n\n**Style:** ${draft.arrangement_style || "—"}\n**Colors:** ${(draft.color_palette || []).join(", ") || "—"}\n**Difficulty:** ${draft.difficulty || "—"}\n\n**Estimated recipe:**\n${lines || "_Add stems manually in Floral Library._"}\n\n**Wholesale (est.):** $${draft.estimated_wholesale_cost?.min ?? "—"}–$${draft.estimated_wholesale_cost?.max ?? "—"}\n**Retail (est.):** $${draft.suggested_retail_price?.min ?? "—"}–$${draft.suggested_retail_price?.max ?? "—"}\n\n_${draft.uncertainty || "Review all counts and pricing before saving."}_\n\nOpen **Floral Library** to edit and save when ready — nothing was saved automatically.`;
      hideTyping();
      await typeAssistantResponse(text);
      if (draft.manual_fallback) {
        deps.toast?.("Vision AI unavailable — use manual recipe builder");
      }
    } catch (err) {
      hideTyping();
      await typeAssistantResponse(friendlyLilyError(err));
    } finally {
      const input = document.getElementById("lilyPhotoInput");
      if (input) input.value = "";
    }
  }

  async function sendMessage(confirm = false) {
    const input = document.getElementById("lilyInput");
    const message = (input?.value || "").trim();
    if (!confirm && !message) return;
    if (!confirm) {
      appendMessage("user", message);
      input.value = "";
    }
    showTyping();
    try {
      let data;
      if (deps.mode === "admin") {
        data = await deps.api("admin-command-center", {
          method: "POST",
          body: JSON.stringify({ action: "lily-query", message, kpis: adminKpis || {} })
        });
        data = { response: data.response, permission: data.permission, client_action: null };
      } else {
        data = await deps.api("lily-ai", {
          method: "POST",
          body: JSON.stringify({
            message: confirm && pendingAction ? pendingAction.message : message,
            confirm,
            conversation_id: conversationId,
            persona: deps.assistantPersona || "Lily",
          }),
        });
        conversationId = data.conversation_id || conversationId;
        if (data.coach?.length) {
          const store = loadStore();
          store.lastSuggestions = data.coach;
          saveStore(store);
          renderSuggestions(data.coach);
        }
        if (data.generate && deps.smartAi) {
          try {
            const gen = await deps.smartAi({
              mode: "generate",
              persona: "Lily",
              task: data.generate.task,
              input: data.generate.input,
              schema: data.generate.schema
            });
            const extra = gen.result ? `\n\n**Draft:**\n${JSON.stringify(gen.result, null, 2)}` : "";
            data.response = (data.response || "") + extra;
            deps.api?.("admin-command-center", { method: "POST", body: JSON.stringify({ action: "record-ai-request" }) }).catch(() => {});
          } catch {
            const ctx = deps.loadAiContext ? await deps.loadAiContext().catch(() => ({})) : {};
            const fallback = marketingDraftFallback(data.generate, ctx.shop || data.generate?.input?.shop);
            if (fallback) {
              data.response = (data.response || "") + `\n\n${fallback}`;
            } else if (data.response) {
              data.response += "\n\nI couldn't generate an AI draft just now. Check Cloudflare AI in Netlify, or try again in a moment.";
            }
          }
      }
      hideTyping();
      if (!data.permission?.allowed) {
        await typeAssistantResponse(data.response || "You do not have permission for that action.");
        pendingAction = null;
        document.getElementById("lilyConfirm").hidden = true;
        return;
      }
      await typeAssistantResponse(data.response || "Done.");
      const action = data.client_action;
      if (action?.pending && action.requiresConfirmation) {
        pendingAction = { message, action };
        const box = document.getElementById("lilyConfirm");
        box.hidden = false;
        box.innerHTML = `${esc(action.label || "Confirm this action?")}<br><button type="button" class="primary" id="lilyConfirmYes">Confirm</button><button type="button" class="secondary" id="lilyConfirmNo">Cancel</button>`;
        document.getElementById("lilyConfirmYes").onclick = () => {
          box.hidden = true;
          executeClientAction(action, true);
          sendMessage(true);
        };
        document.getElementById("lilyConfirmNo").onclick = () => {
          pendingAction = null;
          box.hidden = true;
        };
      } else if (action && !action.pending) {
        executeClientAction(action, false);
      }
    } catch (err) {
      hideTyping();
      await typeAssistantResponse(friendlyLilyError(err));
    }
  }

  async function executeClientAction(action, confirmed) {
    if (!action || !deps) return;
    if (action.type === "navigate" || action.navigate) {
      const page = action.navigate;
      if (page === "admin_command_center") return;
      if (deps.showPage) deps.showPage(page);
      if (action.prefill?.search) {
        const search = document.getElementById("customerSearch");
        if (search) search.value = action.prefill.search;
        deps.renderCustomers?.();
      }
    }
    if (action.openDialog) {
      const dialog = document.getElementById(action.openDialog);
      if (action.openDialog === "orderDialog") await deps.prepareOrderBuilder?.();
      if (action.prefill?.customer_name) {
        const el = document.getElementById("orderCustomerName");
        if (el) el.value = action.prefill.customer_name;
      }
      dialog?.showModal?.();
    }
    if (action.type === "api" && confirmed && deps.api) {
      try {
        await deps.api(action.endpoint, { method: action.method || "POST", body: JSON.stringify(action.body || {}) });
        deps.toast?.("Florisyn updated inventory.");
        deps.loadInventory?.();
      } catch (e) {
        deps.toast?.(e.message);
      }
    }
    if (action.type === "generate" && deps.showPage) {
      deps.showPage("aiStudioPage");
    }
  }

  function runToolbar(item) {
    if (item.page && deps?.showPage) {
      deps.showPage(item.page);
      if (item.dialog) {
        const dialog = document.getElementById(item.dialog);
        if (item.dialog === "orderDialog") deps.prepareOrderBuilder?.();
        dialog?.showModal?.();
      }
      togglePanel(false);
      return;
    }
    if (item.prompt) {
      togglePanel(true);
      document.getElementById("lilyInput").value = item.prompt;
      sendMessage();
    }
  }

  function init(options) {
    deps = { mode: "florist", ...options };
    mountShell();
    if (deps.mode === "admin") {
      deps.api("admin-command-center?action=dashboard")
        .then((d) => {
          adminKpis = d.kpis;
        })
        .catch(() => {});
    } else {
      loadCoach();
    }
  }

  function destroy() {
    document.getElementById("lilyFab")?.remove();
    document.getElementById("lilyPanel")?.remove();
    deps = null;
  }

  window.BloomLilyPlatform = { init, destroy, toggle: () => togglePanel() };
})();
