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
    { label: "Support", prompt: "How do I contact Florisyn support?" },
    { label: "Delivery", action: "deliveryLookup" }
  ];

  let deps = null;
  let open = false;
  let expanded = false;
  let tab = "chat";
  let conversationId = null;
  let pendingAction = null;
  let typingTimer = null;
  let adminKpis = null;
  let lastUserMessage = "";
  // Visual Creation Studio: a photo attached in the composer, waiting to
  // be sent. { dataUrl, name } or null. The turn's attached photo (if any)
  // is threaded explicitly through renderJobCard()/mountVisualPreview()
  // rather than kept here — a module-level "last attached image" would
  // get overwritten by a second send before the first send's async job
  // response comes back and reads it.
  let pendingImage = null;

  // Option A — each assistant owns a real lane; the drawer can switch between them.
  const PERSONAS = {
    lily: { name: "Lily", tag: "Design & creative", img: "/assets/assistants/lily-portrait.png", placeholder: "Ask Lily about designs, recipes, or copy…" },
    rose: { name: "Rose", tag: "Business & numbers", img: "/assets/assistants/rose-portrait.png", placeholder: "Ask Rose about pricing, margins, or growth…" },
    daisy: { name: "Daisy", tag: "Getting started", img: "/assets/assistants/daisy-portrait.png", placeholder: "Ask Daisy where to begin…" },
    bud: { name: "Bud", tag: "Something broken?", img: "/assets/assistants/bud-portrait.webp", placeholder: "Tell Bud what's not working…" }
  };
  const PERSONA_KEY = "bloom_lily_persona";
  let persona = (() => {
    try { return PERSONAS[localStorage.getItem(PERSONA_KEY)] ? localStorage.getItem(PERSONA_KEY) : "lily"; } catch { return "lily"; }
  })();
  const personaName = () => PERSONAS[persona]?.name || "Lily";

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

  const JOB_STATUS_LABEL = {
    planned: "Planned",
    running: "Working…",
    waiting_for_user: "Needs your input",
    waiting_for_approval: "Awaiting approval",
    completed: "Ready",
    partially_completed: "Partly ready",
    failed: "Failed"
  };

  /** Refreshes the attach chip shown between the toolbar and composer for
   * a photo waiting to be sent — the one place pendingImage's UI lives. */
  function renderAttachChip() {
    const chip = document.getElementById("lilyAttachChip");
    if (!chip) return;
    if (!pendingImage) {
      chip.hidden = true;
      chip.innerHTML = "";
      return;
    }
    chip.hidden = false;
    chip.innerHTML = `<img src="${esc(pendingImage.dataUrl)}" alt=""><span>${esc(pendingImage.name)}</span><button type="button" id="lilyAttachRemove" title="Remove photo">×</button>`;
    document.getElementById("lilyAttachRemove").onclick = () => {
      pendingImage = null;
      renderAttachChip();
    };
  }

  /** background_change/style vs flyer are told apart by shape, not a
   * separate field — a flyer's content always carries template_id, a
   * background's always carries a plain url. Works for both a fresh
   * generation and a creative.reviseVisual result (same content shapes,
   * see ai-orchestrator.js). */
  function assetKind(content) {
    if (!content) return null;
    if (content.template_id) return "flyer";
    if (content.url) return "background";
    return null;
  }

  function loadImageEl(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image load failed"));
      img.src = src;
    });
  }

  /** Shop identity for the flyer renderer's brand lockup — reuses the same
   * loadAiContext() the rest of the chat already depends on rather than a
   * second fetch, so this stays in sync with whatever Settings → Branding
   * currently has saved. */
  async function brandInfo() {
    try {
      const ctx = deps.loadAiContext ? await deps.loadAiContext() : {};
      const shop = ctx.shop || {};
      return {
        shopName: shop.name || "",
        phone: shop.phone || "",
        website: shop.website || shop.custom_domain || "",
        primaryColor: shop.primary_color || null,
        accentColor: shop.accent_color || null,
        logoUrl: shop.logo_url || null
      };
    } catch {
      return {};
    }
  }

  /** Turns a persisted visual asset's `content` into a single finished
   * image (a data URL) for the job card — either a fully-rendered flyer
   * (text/logo/contact drawn on top of its background) or a background,
   * composited with the photo attached on the same turn when there was
   * one. Never throws — falls back to the raw generated image URL, and
   * ultimately to null (card shows a plain status note instead of an
   * image) rather than leaving the compositor's failure unhandled. */
  async function buildVisualPreview(content, attachedImage) {
    const kind = assetKind(content);
    if (kind === "flyer") {
      if (!window.FlorisynFlyerRenderer || !content.regions) return content.background_url || null;
      try {
        const brand = await brandInfo();
        const canvas = await window.FlorisynFlyerRenderer.renderFlyer({
          template: { regions: content.regions, palette: content.palette },
          content: { headline: content.headline, body: content.body, cta: content.cta },
          style: content.style,
          brand,
          backgroundUrl: content.background_url,
          width: content.canvas?.width || 1080,
          height: content.canvas?.height || 1080
        });
        return canvas.toDataURL("image/png", 0.92);
      } catch {
        return content.background_url || null;
      }
    }
    if (kind === "background") {
      // A photo attached on THIS turn gets segmented client-side and
      // composited over the generated backdrop — the honest
      // segment+generate+composite substitute for true inpainting (this
      // Cloudflare account has no verified image-editing model). Without
      // an attached photo, the generated backdrop IS the finished visual.
      if (attachedImage && window.FlorisynPhotoStudio?.removeBackground && window.FlorisynFlyerRenderer) {
        try {
          const img = await loadImageEl(attachedImage);
          const cut = window.FlorisynPhotoStudio.removeBackground(img);
          if (cut.ok && cut.canvas) {
            const canvas = await window.FlorisynFlyerRenderer.compositeSubjectOnBackground({
              subjectCanvas: cut.canvas,
              backgroundUrl: content.url,
              outWidth: 1200,
              outHeight: 1200
            });
            return canvas.toDataURL("image/jpeg", 0.92);
          }
        } catch {
          /* fall through to the plain generated backdrop below */
        }
      }
      return content.url || null;
    }
    return null;
  }

  /** Fills in a job/asset card's image asynchronously once
   * buildVisualPreview() resolves — separated from the card's synchronous
   * HTML so the card (status, retry buttons, Save/Undo) never waits on
   * compositing to appear. */
  function mountVisualPreview(content, attachedImage) {
    const imgEl = document.getElementById("lilyJobVisual");
    const noteEl = document.getElementById("lilyJobVisualNote");
    buildVisualPreview(content, attachedImage).then((src) => {
      if (!imgEl) return; // the card was replaced (e.g. by a later message) before this resolved
      if (src) {
        imgEl.src = src;
        noteEl?.remove();
      } else {
        imgEl.remove();
        if (noteEl) noteEl.textContent = "Preview isn't available right now — the generated visual is saved and ready.";
      }
    });
  }

  /** Save/Download/Undo — shared between a freshly-run job's card
   * (renderJobCard) and a version restored via Undo (renderAssetCard), so
   * the two never drift into two different action implementations. */
  function wireVisualCardActions({ assetId, content, title }) {
    const traitsUsed = content?.traits_used || [];
    const saveBtn = document.getElementById("lilyJobSave");
    if (saveBtn) {
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saved ✓";
        saveBtn.classList.add("lily-job-saved");
        try {
          // Reinforces the shop-style traits this generation actually used
          // (see ai-style-memory.js's recordApprovalSignal()) — a no-op,
          // not an error, when the generation used none.
          await deps.api("ai-style-memory", { method: "POST", body: JSON.stringify({ action: "record-outcome", signal: "saved", traits_used: traitsUsed }) });
        } catch {
          /* the visual itself is already saved server-side; a failed
             reinforcement signal isn't worth surfacing as an error */
        }
      };
    }
    const downloadBtn = document.getElementById("lilyJobDownload");
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        const imgEl = document.getElementById("lilyJobVisual");
        if (!imgEl?.src) return;
        const a = document.createElement("a");
        a.download = `${(title || "florisyn-visual").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
        a.href = imgEl.src;
        a.click();
      };
    }
    const undoBtn = document.getElementById("lilyJobUndo");
    if (undoBtn) {
      undoBtn.onclick = async () => {
        undoBtn.disabled = true;
        undoBtn.textContent = "Undoing…";
        try {
          await deps.api("ai-style-memory", { method: "POST", body: JSON.stringify({ action: "record-outcome", signal: "undone", traits_used: traitsUsed }) });
          const current = await deps.api("lily-ai", { method: "POST", body: JSON.stringify({ action: "get-asset", asset_id: assetId }) });
          const parentId = current.asset?.parent_asset_id;
          if (!parentId) {
            deps.toast?.("This is already the first version — nothing earlier to undo to.");
            undoBtn.disabled = false;
            undoBtn.textContent = "↩ Undo to previous version";
            return;
          }
          const prev = await deps.api("lily-ai", { method: "POST", body: JSON.stringify({ action: "get-asset", asset_id: parentId }) });
          if (prev.asset) renderAssetCard(prev.asset, title);
        } catch (err) {
          deps.toast?.(err?.message || "Couldn't undo right now.");
          undoBtn.disabled = false;
          undoBtn.textContent = "↩ Undo to previous version";
        }
      };
    }
  }

  /** Renders a restored prior version (from Undo) the same way a freshly-
   * run job's visual renders — same preview compositing, same Save/
   * Download/Undo actions, chained further back via its own
   * parent_asset_id if it has one. */
  function renderAssetCard(asset, title) {
    const mount = document.getElementById("lilyJobCard");
    if (!mount || !asset) return;
    const content = asset.content || {};
    mount.hidden = false;
    mount.innerHTML = `
      <div class="lily-job-head"><strong>${esc(title || "Previous version")}</strong><span class="lily-job-status lily-job-status-completed">Restored</span></div>
      <img class="lily-job-image" id="lilyJobVisual" alt="">
      <p class="lily-job-note" id="lilyJobVisualNote">Composing your preview…</p>
      <div class="lily-job-actions">
        <button type="button" id="lilyJobSave">💾 Save</button>
        <button type="button" id="lilyJobDownload">⬇ Download</button>
        ${asset.parent_asset_id ? `<button type="button" id="lilyJobUndo">↩ Undo to previous version</button>` : ""}
      </div>`;
    mountVisualPreview(content);
    wireVisualCardActions({ assetId: asset.id, content, title });
  }

  /** Picks the one step whose result IS the visual the florist is looking
   * at — a flyer (which already carries its own background, if any) over
   * a bare background step when a job produced both (Tier A flyer +
   * flyer_background), otherwise whichever visual step actually
   * completed. A creative.reviseVisual step's content shape mirrors
   * whichever asset type it revised (see assetKind()). */
  function findVisualStep(steps) {
    const candidates = steps.filter(
      (s) =>
        ["creative.generateBackground", "creative.renderFlyerContent", "creative.reviseVisual"].includes(s.tool) &&
        s.status === "completed" &&
        s.result?.asset_id
    );
    if (!candidates.length) return null;
    const flyer = candidates.find((s) => assetKind(s.result.content) === "flyer");
    return flyer || candidates[candidates.length - 1];
  }

  /** Renders a real preview card for a finished (or partially finished)
   * AI job — the generated image if one exists, a composited/rendered
   * Visual Creation Studio preview (background or flyer) if the job made
   * one, and a retry button per failed step. This is what replaced the
   * old raw-JSON chat dump: a job's text summary types out in the chat
   * bubble via formatJobResponse() on the server, and this card holds the
   * parts text can't show (images, per-step retry, Save/Undo). */
  function renderJobCard(job, attachedImage) {
    const mount = document.getElementById("lilyJobCard");
    if (!mount) return;
    if (!job) {
      mount.hidden = true;
      mount.innerHTML = "";
      return;
    }
    const steps = job.result?.steps || [];
    const imageStep = steps.find((s) => s.tool === "creative.generateImage" && s.status === "completed" && s.result?.url);
    const imageHtml = imageStep ? `<img class="lily-job-image" src="${esc(imageStep.result.url)}" alt="AI-generated image">` : "";
    const visual = findVisualStep(steps);
    const visualContent = visual?.result?.content || null;
    const visualAssetId = visual?.result?.asset_id || null;
    const visualHtml = visualAssetId
      ? `<img class="lily-job-image" id="lilyJobVisual" alt=""><p class="lily-job-note" id="lilyJobVisualNote">Composing your preview…</p>
         <div class="lily-job-actions">
           <button type="button" id="lilyJobSave">💾 Save</button>
           <button type="button" id="lilyJobDownload">⬇ Download</button>
           <button type="button" id="lilyJobUndo">↩ Undo to previous version</button>
         </div>`
      : "";
    const failedSteps = steps.filter((s) => s.status === "failed");
    const retryButtons = failedSteps
      .map(
        (s) =>
          `<button type="button" class="secondary lily-job-retry" data-job-id="${esc(job.id)}" data-step-id="${esc(s.id)}">Retry: ${esc(s.label || s.id)}</button>`
      )
      .join("");
    mount.hidden = false;
    mount.innerHTML = `
      <div class="lily-job-head"><strong>${esc(job.title || "Job")}</strong><span class="lily-job-status lily-job-status-${esc(job.status || "")}">${esc(JOB_STATUS_LABEL[job.status] || job.status || "")}</span></div>
      ${imageHtml}
      ${visualHtml}
      ${retryButtons ? `<div class="lily-job-actions">${retryButtons}</div>` : ""}`;
    mount.querySelectorAll("[data-job-id]").forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = "Retrying…";
        try {
          const data = await deps.api("lily-ai", {
            method: "POST",
            body: JSON.stringify({ action: "retry-job-step", job_id: btn.dataset.jobId, step_id: btn.dataset.stepId, persona })
          });
          if (data.response) await typeAssistantResponse(data.response);
          renderJobCard(data.job || null);
        } catch {
          btn.disabled = false;
          btn.textContent = original;
        }
      };
    });
    if (visualAssetId && visualContent) {
      mountVisualPreview(visualContent, attachedImage);
      wireVisualCardActions({ assetId: visualAssetId, content: visualContent, title: job.title });
    }
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
        <div class="lily-head-id"><img id="lilyHeadAvatar" class="lily-head-avatar" src="${PERSONAS[persona].img}" alt=""><div><strong id="lilyHeadName">${PERSONAS[persona].name}</strong><small id="lilyHeadTag">${PERSONAS[persona].tag}</small></div></div>
        <div class="lily-head-tools">
          <button type="button" id="lilyThemeToggle" title="Theme">◐</button>
          <button type="button" id="lilyExpand" title="Expand">⤢</button>
          <button type="button" id="lilyClose" title="Close">×</button>
        </div>
      </header>
      <nav class="lily-personas" id="lilyPersonas">
        ${Object.entries(PERSONAS).map(([key, p]) => `<button type="button" data-lily-persona="${key}" class="${key === persona ? "active" : ""}" title="${esc(p.name)} — ${esc(p.tag)}"><img src="${p.img}" alt=""><span>${esc(p.name)}</span></button>`).join("")}
      </nav>
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
      <div id="lilyJobCard" class="lily-job-card" hidden></div>
      <div class="lily-toolbar" id="lilyToolbar"></div>
      <div id="lilyAttachChip" class="lily-attach-chip" hidden></div>
      <div class="lily-compose">
        <button type="button" class="lily-attach" id="lilyAttach" title="Attach a photo">📎</button>
        <input type="file" id="lilyAttachFile" accept="image/*" hidden>
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
    document.getElementById("lilyAttach").onclick = () => document.getElementById("lilyAttachFile").click();
    document.getElementById("lilyAttachFile").addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) {
        deps?.toast?.("Please choose a photo under 12 MB");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        pendingImage = { dataUrl: reader.result, name: file.name || "photo" };
        renderAttachChip();
      };
      reader.readAsDataURL(file);
    });
    document.querySelector(".lily-voice").onclick = () => {
      // Was hardcoded to always say "Hi, I'm Lily" here regardless of which
      // assistant was actually active — switching to Rose, Daisy, or Bud
      // and hitting the mic button still played Lily's line. Use the
      // active persona's own name and preview line instead.
      const active = PERSONAS[persona] || PERSONAS.lily;
      const preview = window.FlorisynAssistantVoiceCore?.VOICE_DEFAULTS?.[active.name]?.preview
        || `Hi, I'm ${active.name}. I'm here to help with your shop, and I'll keep things simple.`;
      window.FlorisynAssistantVoice?.speak?.(active.name, preview, { force: true, respectToggle: false });
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
    document.querySelectorAll("[data-lily-persona]").forEach((btn) => {
      btn.onclick = () => setPersona(btn.dataset.lilyPersona);
    });
    document.getElementById("lilyHistorySearch").oninput = () => renderHistoryList();
    applyPersonaChrome();

    const theme = localStorage.getItem(THEME_KEY);
    if (theme) document.body.dataset.lilyTheme = theme;

    const toolbar = document.getElementById("lilyToolbar");
    toolbar.innerHTML = TOOLBAR.map((t) => `<button type="button" data-lily-tool="${esc(t.label)}">${esc(t.label)}</button>`).join("");
    toolbar.querySelectorAll("button").forEach((btn, i) => {
      btn.onclick = () => runToolbar(TOOLBAR[i]);
    });
  }

  function togglePanel(force) {
    open = typeof force === "boolean" ? force : !open;
    const panel = document.getElementById("lilyPanel");
    if (!panel) return;
    panel.hidden = !open;
    if (open) {
      renderChat();
      loadCoach();
    }
  }

  function applyPersonaChrome() {
    const p = PERSONAS[persona] || PERSONAS.lily;
    const avatar = document.getElementById("lilyHeadAvatar");
    const name = document.getElementById("lilyHeadName");
    const tag = document.getElementById("lilyHeadTag");
    const input = document.getElementById("lilyInput");
    const fab = document.getElementById("lilyFab");
    if (avatar) avatar.src = p.img;
    if (name) name.textContent = p.name;
    if (tag) tag.textContent = p.tag;
    if (input) input.placeholder = p.placeholder;
    if (fab) { fab.title = `${p.name} — Florisyn assistant`; const img = fab.querySelector("img"); if (img) { img.src = p.img; img.alt = p.name; } }
    const voiceBtn = document.querySelector(".lily-voice");
    if (voiceBtn) voiceBtn.title = `Hear ${p.name}`;
    document.querySelectorAll("[data-lily-persona]").forEach((b) => b.classList.toggle("active", b.dataset.lilyPersona === persona));
  }

  function setPersona(next, opts = {}) {
    if (!PERSONAS[next]) return;
    persona = next;
    try { localStorage.setItem(PERSONA_KEY, persona); } catch { /* private mode */ }
    applyPersonaChrome();
    document.getElementById("lilyConfirm").hidden = true;
    if (opts.resend && lastUserMessage) {
      document.getElementById("lilyInput").value = lastUserMessage;
      sendMessage();
    } else if (opts.announce !== false) {
      appendMessage("assistant", `Hi, I'm ${PERSONAS[persona].name} — your go-to for ${PERSONAS[persona].tag.toLowerCase()}. How can I help?`);
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

  async function sendMessage(confirm = false) {
    const input = document.getElementById("lilyInput");
    const message = (input?.value || "").trim();
    if (!confirm && !message) return;
    // Captured before pendingImage is cleared below, then threaded
    // explicitly through this call's own renderJobCard() — never stored on
    // module state, so a second message sent before this one's async job
    // response arrives can never overwrite the photo this specific turn
    // attached (see buildVisualPreview()'s attachedImage parameter).
    const imageForThisTurn = pendingImage?.dataUrl || null;
    if (!confirm) {
      lastUserMessage = message;
      appendMessage("user", message);
      input.value = "";
      pendingImage = null;
      renderAttachChip();
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
            persona,
            conversation_id: conversationId,
            // Only a boolean crosses the wire — the actual bytes never
            // leave the browser (compositing is entirely client-side, via
            // buildVisualPreview() below); the server's only use for this
            // is a classification signal (see ai-intent-router.js).
            ...(imageForThisTurn ? { has_image: true } : {})
          })
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
              persona: personaName(),
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
        } else if (data.intent?.intent === "general.chat" && deps.smartAi && message) {
          try {
            const ctx = deps.loadAiContext ? await deps.loadAiContext() : {};
            const chat = await deps.smartAi({
              mode: "chat",
              persona: personaName(),
              prompt: message,
              context: ctx
            });
            const answer = chat.answer || chat.message || chat.result?.text;
            if (answer) data.response = answer;
          } catch {
            /* keep rule-based response */
          }
        }
      }
      hideTyping();
      renderJobCard(data.job || null, imageForThisTurn);
      if (!data.permission?.allowed) {
        await typeAssistantResponse(data.response || "You do not have permission for that action.");
        pendingAction = null;
        document.getElementById("lilyConfirm").hidden = true;
        return;
      }
      await typeAssistantResponse(data.response || "Done.");
      if (data.handoff?.to && PERSONAS[data.handoff.to.toLowerCase()]) {
        const to = data.handoff.to;
        const box = document.getElementById("lilyConfirm");
        box.hidden = false;
        box.innerHTML = `That's really ${esc(to)}'s area.<br><button type="button" class="primary" id="lilyHandoffYes">Bring in ${esc(to)}</button><button type="button" class="secondary" id="lilyHandoffNo">Stay with ${esc(personaName())}</button>`;
        document.getElementById("lilyHandoffYes").onclick = () => { box.hidden = true; setPersona(to.toLowerCase(), { resend: true }); };
        document.getElementById("lilyHandoffNo").onclick = () => { box.hidden = true; };
      }
      const action = data.client_action;
      if (action?.pending && action.requiresConfirmation) {
        pendingAction = { message, action };
        const box = document.getElementById("lilyConfirm");
        box.hidden = false;
        // Ecosystem action tiers (Lily Step 76, see ACTION_TIERS in
        // _shared/lily-ai-engine.js): every confirm box already means
        // IMPORTANT or DESTRUCTIVE (READ/LOW never reach this branch —
        // requiresConfirmationForTier is false for both), so a
        // DESTRUCTIVE action gets a visibly stronger warning instead of
        // looking identical to a routine IMPORTANT write.
        const tierBadge = action.tier === "DESTRUCTIVE" ? `<strong class="lily-confirm-destructive">⚠ This can't be undone.</strong><br>` : "";
        box.innerHTML = `${tierBadge}${esc(action.label || "Confirm this action?")}<br><button type="button" class="primary" id="lilyConfirmYes">Confirm</button><button type="button" class="secondary" id="lilyConfirmNo">Cancel</button>`;
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
        deps.toast?.(action.successMessage || "Florisyn updated inventory.");
        if (action.endpoint === "inventory") deps.loadInventory?.();
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
      return;
    }
    if (item.action === "deliveryLookup") {
      togglePanel(true);
      runDeliveryLookup();
    }
  }

  /** Quick mileage lookup — asks for a delivery address, calls the same
   * route-distance endpoint the order builder's "Calculate driving route"
   * already uses (shop address as origin, from Settings), and posts the
   * result into the chat instead of requiring an order to be open first. */
  async function runDeliveryLookup() {
    const address = window.prompt("Delivery address to calculate mileage from your shop:");
    if (!address || !address.trim()) return;
    const trimmed = address.trim();
    appendMessage("user", `Calculate delivery mileage to: ${trimmed}`);
    showTyping();
    try {
      const d = await deps.api("route-distance", { method: "POST", body: JSON.stringify({ destination: trimmed }) });
      hideTyping();
      if (!d || d.configured === false || d.roundTripMiles == null) {
        appendMessage("assistant", d?.message || "Automatic mileage isn't set up yet. Enter delivery miles manually on the order for now.");
        return;
      }
      appendMessage(
        "assistant",
        `**${Number(d.oneWayMiles).toFixed(1)} miles** one way from your shop (${d.origin}) to ${d.destination} — **${Number(d.roundTripMiles).toFixed(1)} miles round trip**, about **${Math.round(Number(d.driveMinutes))} minutes** drive time.`
      );
    } catch (e) {
      hideTyping();
      appendMessage("assistant", e?.message || "Could not calculate the delivery route. Try again in a moment.");
    }
  }

  function init(options) {
    deps = { mode: "florist", ...options };
    mountShell();
    if (deps.mode === "admin") {
      // Visual Creation Studio (has_image, generated backgrounds/
      // flyers) only exists on the shop-scoped lily-ai path — admin mode
      // routes every message through admin-command-center instead, which
      // has no such job to run, so a florist-facing attach button here
      // would just silently drop whatever photo was picked.
      const attachBtn = document.getElementById("lilyAttach");
      if (attachBtn) attachBtn.hidden = true;
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

  // Beta polish: the top-dock "Daisy" button had no way to actually reach
  // Daisy — she only exists as one of this panel's four personas, with no
  // page of her own. Lily/Rose's dock buttons open a real page each; this
  // gives Daisy's (and any persona's) dock button a real destination: open
  // this panel already switched to that persona, instead of silently
  // falling back to whatever page the button happened to carry a stale
  // data-route for.
  function openPersona(name) {
    if (name && PERSONAS[name] && name !== persona) setPersona(name);
    togglePanel(true);
  }

  window.BloomLilyPlatform = { init, destroy, toggle: () => togglePanel(), open: openPersona };
})();
