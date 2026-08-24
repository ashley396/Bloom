/**
 * Marketing Studio admin panel — Founding Beta (Stage G).
 *
 * Talks to netlify/functions/marketing-studio.js. Deliberately minimal:
 * status + AI Clone enrollment/preview/consent, which is what's needed to
 * actually exercise the real HeyGen (avatar) + ElevenLabs (voice) adapter
 * end to end. Content planning/calendar/publishing-queue/analytics UI is
 * not built here yet — those actions exist server-side (see
 * marketing-studio.js) but have no admin surface until a later pass.
 *
 * Every response this panel renders is shown as-is, including "NOT LIVE —
 * PROVIDER CONNECTION REQUIRED" notes — this file never invents a success
 * state the backend didn't actually report.
 */
(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const USAGE_TYPES = ["social_video", "website_video", "voicemail_greeting", "ads"];
  const USAGE_LABELS = {
    social_video: "Social video posts",
    website_video: "Website video",
    voicemail_greeting: "Voicemail greeting",
    ads: "Paid ads"
  };
  const PLATFORMS = ["facebook", "instagram", "tiktok", "linkedin", "pinterest", "google_business", "youtube"];

  async function adminApi(action, extra = {}) {
    let session = null;
    try {
      session = JSON.parse(localStorage.getItem("bloom_admin_session") || "null");
    } catch {
      localStorage.removeItem("bloom_admin_session");
      session = null;
    }
    const headers = { "Content-Type": "application/json" };
    const token = session?.accessToken || session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
    const method = extra.method || "POST";
    const url = `/.netlify/functions/marketing-studio?action=${encodeURIComponent(action)}${extra.query ? `&${extra.query}` : ""}`;
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify({ action, ...extra.body })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Marketing Studio request failed (${res.status})`);
    return data;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  function checkboxRow(name, value, label) {
    return `<label class="check"><input type="checkbox" data-${name}="${esc(value)}"> ${esc(label)}</label>`;
  }

  function mount(root) {
    if (!root || root.dataset.marketingStudioMounted) return;
    root.dataset.marketingStudioMounted = "1";

    root.innerHTML = `
      <div class="panel" id="msStatusPanel"><p class="quiet">Loading Marketing Studio status…</p></div>

      <div class="panel">
        <h2>Shop</h2>
        <p class="help">Marketing Studio acts on one florist account at a time. Florisyn's own account (Tenant Zero) works the same as any beta shop — paste its shop ID, or open it first from Florist Accounts and click "Use open account".</p>
        <div class="header-actions">
          <input id="msShopId" placeholder="shop_id (uuid)">
          <button type="button" id="msUseOpenShop">Use open account</button>
          <button type="button" id="msLoadShop">Load</button>
        </div>
      </div>

      <div class="panel">
        <h2>Connections</h2>
        <p class="help">Real per-platform connection state — never a guessed or optimistic status. "Connect" redirects the browser to that platform's own OAuth consent screen once real credentials are configured; publishing itself stays NOT LIVE until a connected platform's adapter is verified end to end.</p>
        <div id="msConnectionsList" class="quiet">Load a shop above to see connection status.</div>
      </div>

      <div class="panel">
        <h2>My Style</h2>
        <p class="help">What Lily has learned about this shop's own visual creative style — from what you've told her directly, and from what you've repeatedly approved or rejected. This never affects caption/writing style (that's a separate, shop voice setting) — only backgrounds, lighting, colors, mood, and the look of flyers/photos/graphics. A one-time request like "make this one dark and dramatic" never changes what's saved here; saying "I like this — use it from now on" does.</p>
        <div id="msStyleList" class="quiet">Load a shop above to see its learned style.</div>
        <form id="msStyleAddForm" class="header-actions" style="margin-top:0.75em">
          <select id="msStyleCategory"></select>
          <input id="msStyleText" placeholder="e.g. soft luxury backgrounds" style="flex:1">
          <select id="msStylePolarity">
            <option value="positive">Like</option>
            <option value="negative">Avoid</option>
          </select>
          <button type="submit">Save preference</button>
        </form>
        <div class="header-actions" style="margin-top:0.5em">
          <button type="button" id="msStyleResetBtn">Reset learned style</button>
        </div>
        <p id="msStyleStatus" class="help"></p>
      </div>

      <div class="panel">
        <h2>Content Calendar</h2>
        <p class="help">Draft → Review → Approve → Schedule → Publish. Every status shown here is exactly what the backend reports — nothing is marked "published" unless a real provider actually confirmed it (none are connected yet, so publishing attempts fail honestly with "not live").</p>
        <div class="header-actions">
          <input id="msCalYear" type="number" placeholder="Year" style="width:6em">
          <select id="msCalMonth"></select>
          <button type="button" id="msPlanMonthBtn">Plan this month</button>
          <button type="button" id="msRunQueueBtn" title="Manually run the publishing queue now — the real automatic scheduler exists but isn't deployed in this pass.">Run publishing queue now</button>
        </div>
        <p id="msCostSummary" class="help"></p>
        <div class="header-actions">
          <label>Monthly budget cap ($)<input id="msBudgetCapInput" type="number" min="0" step="0.01" placeholder="No cap"></label>
          <button type="button" id="msSaveBudgetCapBtn">Save</button>
          <span id="msBudgetCapStatus" class="help"></span>
        </div>
        <p id="msBudgetRemaining" class="help"></p>
        <p id="msCalStatus" class="help"></p>
        <div id="msContentList" class="shop-list"></div>
        <div id="msContentDetail"></div>
      </div>

      <div class="panel">
        <h2>AI Clone enrollment</h2>
        <p class="help">Creates a real HeyGen Photo Avatar (if avatar is granted) and/or a real ElevenLabs voice clone (if voice is granted). Requires real reference photos/audio of the consenting person — nothing here is simulated.</p>
        <form id="msEnrollForm" class="form-grid">
          <label class="wide">Person's name<input name="person_name" required placeholder="e.g. Ashley"></label>
          <label class="check wide"><input type="checkbox" id="msAvatarPermission"> Avatar permission granted</label>
          <label class="wide" id="msAvatarPhotosField" hidden>Reference photos (clear, well-lit face photos)<input type="file" id="msAvatarPhotos" accept="image/jpeg,image/png,image/webp" multiple></label>
          <label class="check wide"><input type="checkbox" id="msVoicePermission"> Voice permission granted</label>
          <label class="wide" id="msVoiceAudioField" hidden>Reference audio samples (recorded speech)<input type="file" id="msVoiceAudio" accept="audio/*" multiple></label>
          <div class="wide">
            <strong>Approved usage</strong>
            <div class="check-grid" id="msUsageGrid">${USAGE_TYPES.map((u) => checkboxRow("usage", u, USAGE_LABELS[u])).join("")}</div>
          </div>
          <div class="wide">
            <strong>Approved platforms</strong>
            <div class="check-grid" id="msPlatformGrid">${PLATFORMS.map((p) => checkboxRow("platform", p, p.replace("_", " "))).join("")}</div>
          </div>
          <button type="submit" class="wide">Request enrollment</button>
        </form>
        <p id="msEnrollStatus" class="help"></p>
        <div id="msEnrollResult"></div>
      </div>

      <div class="panel">
        <h2>Preview clone</h2>
        <p class="help">Synthesizes a short line with an already-cloned voice (and, if an avatar profile ID is given, starts a short HeyGen video) — a real sanity check before approving the clone for actual campaign use.</p>
        <div class="form-grid">
          <label>Voice profile ID<input id="msPreviewVoiceId" placeholder="from enrollment result above"></label>
          <label>Avatar profile ID (optional — starts a video instead of audio)<input id="msPreviewAvatarId" placeholder="from enrollment result above"></label>
          <label class="wide">Script<textarea id="msPreviewScript" rows="2" maxlength="200" placeholder="A short line to preview (max 200 characters)."></textarea></label>
        </div>
        <button type="button" id="msPreviewBtn">Generate preview</button>
        <p id="msPreviewStatus" class="help"></p>
        <div id="msPreviewResult"></div>
      </div>

      <div class="panel">
        <h2>Consent grants</h2>
        <div id="msConsentList" class="shop-list"></div>
      </div>

      <div class="panel">
        <h2>Personal Brand Studio</h2>
        <p class="help">How this florist wants THEMSELVES represented in marketing — separate from the shop's general brand voice. Nothing here uses an avatar/voice provider by itself; Digital Twin rendering is a separate, consent-gated step below.</p>
        <form id="pbProfileForm" class="form-grid">
          <label>Display name<input name="display_name" placeholder="e.g. Jordan Lee"></label>
          <label>Founder title<input name="founder_title" placeholder="e.g. Owner & Lead Designer"></label>
          <label>Tone default
            <select name="professional_casual_balance">
              <option value="professional">Professional</option>
              <option value="balanced" selected>Balanced</option>
              <option value="casual">Casual</option>
            </select>
          </label>
          <label>Humor level
            <select name="humor_level">
              <option value="serious">Serious</option>
              <option value="light" selected>Light</option>
              <option value="playful">Playful</option>
            </select>
          </label>
          <label class="wide">Founder story (used for Founder Story mode — your own words, never invented)<textarea name="founder_story" rows="3" maxlength="4000"></textarea></label>
          <button type="submit" class="wide">Save profile</button>
        </form>
        <p id="pbProfileStatus" class="help"></p>
        <p id="pbStyleSummary" class="help"></p>

        <h3>Ask Lily</h3>
        <p class="help">e.g. "Make me a professional founder portrait", "Make a funny post about being a florist", "I don't dress like that, remember it."</p>
        <div class="form-grid">
          <label class="wide">Message<input id="pbCommandInput" placeholder="Tell Lily what you want…"></label>
        </div>
        <button type="button" id="pbCommandBtn">Send to Lily</button>
        <p id="pbCommandStatus" class="help"></p>
        <div id="pbCommandResult"></div>

        <h3>Reference photos</h3>
        <p class="help">Three separate permissions per photo: store it, use it for image generation, use it to train an avatar. Uploading without consenting to store is refused.</p>
        <form id="pbPhotoForm" class="form-grid">
          <label class="wide">Photo<input type="file" id="pbPhotoFile" accept="image/jpeg,image/png,image/webp"></label>
          <label>Label
            <select name="label">
              <option value="approved_likeness_reference" selected>Approved likeness reference</option>
              <option value="favorite_reference">Favorite reference</option>
              <option value="professional_reference">Professional reference</option>
              <option value="casual_reference">Casual reference</option>
              <option value="do_not_use">Do not use</option>
            </select>
          </label>
          <label class="check">${checkboxRow("consent", "store", "Consent to store this photo")}</label>
          <label class="check">${checkboxRow("consent", "image", "Allow use for image generation")}</label>
          <label class="check">${checkboxRow("consent", "avatar", "Allow use for avatar training")}</label>
          <button type="submit" class="wide">Upload photo</button>
        </form>
        <p id="pbPhotoStatus" class="help"></p>
        <div id="pbPhotoList" class="shop-list"></div>
      </div>
    `;

    const statusPanel = root.querySelector("#msStatusPanel");
    const shopIdInput = root.querySelector("#msShopId");
    const enrollForm = root.querySelector("#msEnrollForm");
    const enrollStatus = root.querySelector("#msEnrollStatus");
    const enrollResult = root.querySelector("#msEnrollResult");
    const avatarPermission = root.querySelector("#msAvatarPermission");
    const avatarPhotosField = root.querySelector("#msAvatarPhotosField");
    const avatarPhotosInput = root.querySelector("#msAvatarPhotos");
    const voicePermission = root.querySelector("#msVoicePermission");
    const voiceAudioField = root.querySelector("#msVoiceAudioField");
    const voiceAudioInput = root.querySelector("#msVoiceAudio");
    const previewVoiceId = root.querySelector("#msPreviewVoiceId");
    const previewAvatarId = root.querySelector("#msPreviewAvatarId");
    const previewScript = root.querySelector("#msPreviewScript");
    const previewStatus = root.querySelector("#msPreviewStatus");
    const previewResult = root.querySelector("#msPreviewResult");
    const consentList = root.querySelector("#msConsentList");
    const pbProfileForm = root.querySelector("#pbProfileForm");
    const pbProfileStatus = root.querySelector("#pbProfileStatus");
    const pbStyleSummary = root.querySelector("#pbStyleSummary");
    const pbCommandInput = root.querySelector("#pbCommandInput");
    const pbCommandStatus = root.querySelector("#pbCommandStatus");
    const pbCommandResult = root.querySelector("#pbCommandResult");
    const pbPhotoForm = root.querySelector("#pbPhotoForm");
    const pbPhotoFile = root.querySelector("#pbPhotoFile");
    const pbPhotoStatus = root.querySelector("#pbPhotoStatus");
    const pbPhotoList = root.querySelector("#pbPhotoList");
    let pbLastAssetId = null;
    let pbLastMode = null;

    // ── Content Calendar (Launch-blocker fix, Blocker 4) ─────────────────
    const calYearInput = root.querySelector("#msCalYear");
    const calMonthSelect = root.querySelector("#msCalMonth");
    const calStatus = root.querySelector("#msCalStatus");
    const costSummary = root.querySelector("#msCostSummary");
    const contentList = root.querySelector("#msContentList");
    const contentDetail = root.querySelector("#msContentDetail");
    const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    calMonthSelect.innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
    const now = new Date();
    calYearInput.value = now.getFullYear();
    calMonthSelect.value = String(now.getMonth() + 1);

    // "Draft/In Review/Approved/Scheduled/Publishing/Published/Failed/Needs
    // Attention" — mapped onto the real backend statuses, never inventing
    // a state the schema doesn't actually have. 'failed' reads as "Needs
    // Attention" (matches this app's existing convention for actionable
    // problem states) rather than a dead-end "Failed" label.
    const STATUS_LABELS = {
      idea: "Idea",
      generating: "Generating…",
      draft: "Draft",
      in_review: "In Review",
      approved: "Approved",
      scheduled: "Scheduled",
      publishing: "Publishing",
      published: "Published",
      failed: "Needs Attention",
      archived: "Rejected"
    };
    const STATUS_BADGE_CLASS = {
      published: "good",
      approved: "good",
      scheduled: "good",
      failed: "danger",
      archived: "danger",
      generating: "warn",
      publishing: "warn"
    };
    function statusBadge(status) {
      return `<span class="badge ${STATUS_BADGE_CLASS[status] || ""}">${esc(STATUS_LABELS[status] || status)}</span>`;
    }

    let contentItemsCache = [];
    let openContentItemId = null;
    // Priority I fix: the per-variant "Connection required" badge below
    // used to be a hardcoded string shown for EVERY platform regardless of
    // its real state — so a shop that had actually connected Facebook would
    // still see "Connection required" forever, a fake/stale status exactly
    // the kind "never show fake success/failure states" rule exists to
    // prevent. Populated by loadConnections() (the same real per-platform
    // state the Connections panel itself renders from), reused here instead
    // of a second, parallel truth source.
    let connectionsCache = [];

    const budgetCapInput = root.querySelector("#msBudgetCapInput");
    const budgetCapStatus = root.querySelector("#msBudgetCapStatus");
    const budgetRemaining = root.querySelector("#msBudgetRemaining");

    // Priority 3/6: real per-platform connection state, wired to the real
    // OAuth architecture (marketing-social-oauth.js) — never a static
    // placeholder. connectionsList renders exactly what the backend
    // reports for each of the 7 SUPPORTED_PLATFORMS.
    const connectionsList = root.querySelector("#msConnectionsList");
    // Single source of truth for "what does this platform's connection
    // state actually mean, in one badge/label pair" — used by both the
    // Connections panel and the per-variant badge in the content detail
    // view, so the two can never drift into showing two different truths
    // about the same platform.
    function connectionStatusInfo(platform) {
      const c = connectionsCache.find((row) => row.platform === platform);
      if (!c) return { badge: "", text: "Connection required" };
      if (c.live) return { badge: "good", text: "Connected" };
      if (c.status === "connected") return { badge: "warn", text: "Connected (not verified live)" };
      if (c.status === "connecting") return { badge: "warn", text: "Connecting…" };
      if (c.status === "error") return { badge: "danger", text: "Connection error" };
      if (c.status === "needs_reauth") return { badge: "danger", text: "Needs reauthorization" };
      return { badge: "", text: "Connection required" };
    }
    async function loadConnections() {
      const shopId = shopIdInput.value.trim();
      if (!shopId) return;
      try {
        const d = await adminApi("connections", { method: "GET", query: `shop_id=${encodeURIComponent(shopId)}` });
        connectionsCache = d.items || [];
        connectionsList.innerHTML = (d.items || [])
          .map((c) => {
            const label = c.platform.replace(/_/g, " ");
            const badge = c.live ? "good" : c.status === "connected" ? "warn" : "";
            const statusText = c.live ? "Live" : c.status === "connected" ? "Connected (not verified live)" : c.status === "connecting" ? "Connecting…" : c.status === "error" ? "Error" : c.status === "needs_reauth" ? "Needs reauthorization" : "Not connected";
            const canConnect = c.status !== "connected" && c.status !== "connecting";
            return `<div class="connection-row" data-platform="${esc(c.platform)}">
              <span class="badge ${badge}">${esc(statusText)}</span>
              <strong>${esc(label)}</strong>
              ${c.account_label ? `<span class="quiet">${esc(c.account_label)}</span>` : ""}
              ${c.last_error ? `<span class="quiet">${esc(c.last_error)}</span>` : ""}
              ${canConnect ? `<button type="button" data-connect-platform="${esc(c.platform)}">Connect</button>` : `<button type="button" data-disconnect-platform="${esc(c.platform)}">Disconnect</button>`}
            </div>`;
          })
          .join("");
        connectionsList.querySelectorAll("[data-connect-platform]").forEach((btn) => {
          btn.onclick = async () => {
            const platform = btn.dataset.connectPlatform;
            btn.disabled = true;
            btn.textContent = "Connecting…";
            try {
              const result = await adminApi("connect_platform", { body: { shop_id: shopId, platform } });
              if (result.authorize_url) {
                window.location.href = result.authorize_url;
                return;
              }
              alert(result.message || `${platform} is not connectable yet.`);
            } catch (err) {
              alert(err.message);
            } finally {
              btn.disabled = false;
              btn.textContent = "Connect";
              loadConnections();
            }
          };
        });
        connectionsList.querySelectorAll("[data-disconnect-platform]").forEach((btn) => {
          btn.onclick = async () => {
            const platform = btn.dataset.disconnectPlatform;
            if (!confirm(`Disconnect ${platform}? Content already scheduled to it will fail to publish until reconnected.`)) return;
            try {
              await adminApi("disconnect_platform", { body: { shop_id: shopId, platform } });
              loadConnections();
            } catch (err) {
              alert(err.message);
            }
          };
        });
      } catch (err) {
        connectionsList.textContent = err.message;
      }
    }

    // ── "My Style" — Lily's learned VISUAL creative style ────────────────
    // Deliberately separate from Brand Brain (writing/caption voice, no UI
    // yet) — see ai-style-memory.js's own module docstring for why the two
    // are never merged. Plain, human labels only; never a confidence
    // score, evidence count, embedding, or any other internal/model term.
    const STYLE_CATEGORY_LABELS = {
      background_style: "Backgrounds",
      materials: "Materials",
      lighting: "Lighting",
      colors: "Colors",
      mood: "Mood",
      typography: "Typography",
      flyer_style: "Flyer style",
      product_photo_style: "Product photo style",
      social_post_style: "Social graphic style",
      floral_decoration_level: "Floral decoration level",
      realism_level: "Realism",
      general_avoid: "Always avoid"
    };
    const styleList = root.querySelector("#msStyleList");
    const styleAddForm = root.querySelector("#msStyleAddForm");
    const styleCategorySelect = root.querySelector("#msStyleCategory");
    const styleStatus = root.querySelector("#msStyleStatus");
    styleCategorySelect.innerHTML = Object.entries(STYLE_CATEGORY_LABELS)
      .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`)
      .join("");

    function renderStylePayload(payload) {
      const categories = payload.categories || {};
      const rows = Object.entries(STYLE_CATEGORY_LABELS)
        .map(([category, label]) => {
          const active = categories[category]?.active || [];
          const learning = categories[category]?.learning || [];
          if (!active.length && !learning.length) return "";
          const chip = (t, learningChip) =>
            `<span class="badge${learningChip ? "" : " good"}" title="${learningChip ? "Still learning — not yet applied to new content" : "Applied to new content"}">${esc(t.text)}${t.polarity === "negative" ? " (avoid)" : ""}${learningChip ? " — still learning" : ""} <button type="button" class="link-btn" data-style-forget data-category="${esc(category)}" data-text="${esc(t.text)}" title="Forget this preference">×</button></span>`;
          return `<div class="style-category-row"><strong>${esc(label)}:</strong> ${[...active.map((t) => chip(t, false)), ...learning.map((t) => chip(t, true))].join(" ")}</div>`;
        })
        .filter(Boolean)
        .join("");
      styleList.innerHTML = rows || `<p class="quiet">Lily hasn't learned any visual style for this shop yet — tell her a preference, or approve/reject a few generated pieces, and it will show up here.</p>`;
      styleList.querySelectorAll("[data-style-forget]").forEach((btn) => {
        btn.onclick = async () => {
          const shopId = shopIdInput.value.trim();
          if (!shopId) return;
          try {
            const payload2 = await adminApi("forget_visual_style_trait", { body: { shop_id: shopId, category: btn.dataset.category, text: btn.dataset.text } });
            renderStylePayload(payload2);
            styleStatus.textContent = `Forgot "${btn.dataset.text}".`;
          } catch (err) {
            styleStatus.textContent = err.message;
          }
        };
      });
    }

    async function loadVisualStyle() {
      const shopId = shopIdInput.value.trim();
      if (!shopId) return;
      styleList.innerHTML = `<p class="quiet">Loading…</p>`;
      try {
        const payload = await adminApi("get_visual_style", { method: "GET", query: `shop_id=${encodeURIComponent(shopId)}` });
        renderStylePayload(payload);
      } catch (err) {
        styleList.innerHTML = `<p class="help">Could not load My Style: ${esc(err.message)}</p>`;
      }
    }

    styleAddForm.onsubmit = async (e) => {
      e.preventDefault();
      const shopId = shopIdInput.value.trim();
      const text = root.querySelector("#msStyleText").value.trim();
      if (!shopId) return (styleStatus.textContent = "Enter a shop ID above first.");
      if (!text) return (styleStatus.textContent = "Describe the preference first.");
      styleStatus.textContent = "Saving…";
      try {
        const payload = await adminApi("update_visual_style", {
          body: {
            shop_id: shopId,
            updates: [{ category: styleCategorySelect.value, text, polarity: root.querySelector("#msStylePolarity").value }]
          }
        });
        renderStylePayload(payload);
        root.querySelector("#msStyleText").value = "";
        styleStatus.textContent = "Saved — applied to Lily's next generation for this shop.";
      } catch (err) {
        styleStatus.textContent = err.message;
      }
    };

    root.querySelector("#msStyleResetBtn").onclick = async () => {
      const shopId = shopIdInput.value.trim();
      if (!shopId) return;
      if (!confirm("Reset everything Lily has learned about this shop's visual style? This cannot be undone.")) return;
      try {
        const payload = await adminApi("reset_visual_style", { body: { shop_id: shopId } });
        renderStylePayload(payload);
        styleStatus.textContent = "Learned style reset.";
      } catch (err) {
        styleStatus.textContent = err.message;
      }
    };

    async function loadCostSummary() {
      const shopId = shopIdInput.value.trim();
      if (!shopId) return;
      try {
        const d = await adminApi("usage_summary", { method: "GET", query: `shop_id=${encodeURIComponent(shopId)}` });
        const estDollars = ((d.estimated_total_cents || 0) / 100).toFixed(2);
        const actDollars = ((d.actual_total_cents || 0) / 100).toFixed(2);
        costSummary.innerHTML = `Costs — <strong>ESTIMATED</strong>: $${estDollars} · <strong>ACTUAL</strong>: $${actDollars}${d.actual_total_cents ? "" : ' <span class="quiet">(no provider has ever actually billed Florisyn yet — every provider is not-live)</span>'}`;

        // Priority 2: real persisted per-shop budget — reflects exactly
        // what the backend enforces, never a client-side guess. Only
        // overwrite the input if it's not currently focused, so typing a
        // new value isn't clobbered by a background refresh.
        if (document.activeElement !== budgetCapInput) {
          budgetCapInput.value = d.monthly_budget_cap_cents != null ? (d.monthly_budget_cap_cents / 100).toFixed(2) : "";
        }
        if (d.monthly_budget_cap_cents != null && d.monthly_remaining_cents != null) {
          budgetRemaining.textContent = `This month: $${(d.monthly_committed_spend_cents / 100).toFixed(2)} committed of a $${(d.monthly_budget_cap_cents / 100).toFixed(2)} cap — $${(d.monthly_remaining_cents / 100).toFixed(2)} remaining.`;
        } else {
          budgetRemaining.textContent = "No monthly budget cap configured for this shop — generation spend is unlimited.";
        }
      } catch (err) {
        costSummary.textContent = "";
      }
    }

    async function loadContentList() {
      const shopId = shopIdInput.value.trim();
      if (!shopId) {
        contentList.innerHTML = `<p class="quiet">Enter a shop ID and click Load.</p>`;
        return;
      }
      calStatus.textContent = "Loading content…";
      try {
        const d = await adminApi("list_content", { method: "GET", query: `shop_id=${encodeURIComponent(shopId)}` });
        contentItemsCache = d.items || [];
        calStatus.textContent = "";
        renderContentList();
      } catch (err) {
        calStatus.textContent = `Could not load content: ${err.message}`;
      }
    }

    function renderContentList() {
      if (!contentItemsCache.length) {
        contentList.innerHTML = `<p class="quiet">No content yet for this shop/month. Click "Plan this month" to generate a draft skeleton.</p>`;
        return;
      }
      // Grouped by earliest scheduled_at across the item's variants — a
      // simple date-sorted list, deliberately not a full calendar grid
      // (Section 25: "avoid building a giant calendar product").
      const sorted = [...contentItemsCache].sort((a, b) => {
        const aDate = a.variants?.[0]?.scheduled_at || a.updated_at;
        const bDate = b.variants?.[0]?.scheduled_at || b.updated_at;
        return new Date(bDate) - new Date(aDate);
      });
      contentList.innerHTML = sorted
        .map((item) => {
          const platforms = (item.variants || []).map((v) => esc(v.platform)).join(", ") || "no platforms";
          const when = item.variants?.[0]?.scheduled_at ? new Date(item.variants[0].scheduled_at).toLocaleString() : "not scheduled";
          return `
          <div class="shop-row" data-content-item="${esc(item.id)}" style="cursor:pointer;">
            <div>
              <strong>${esc(item.title || "(untitled)")}</strong>
              <small>${esc(item.content_type)} · ${platforms} · ${esc(when)}${item.uses_ai_clone ? " · Digital Twin" : ""}</small>
            </div>
            ${statusBadge(item.status)}
          </div>`;
        })
        .join("");
      contentList.querySelectorAll("[data-content-item]").forEach((row) => {
        row.onclick = () => {
          openContentItemId = row.dataset.contentItem;
          renderContentDetail();
        };
      });
    }

    function renderContentDetail() {
      const item = contentItemsCache.find((i) => i.id === openContentItemId);
      if (!item) {
        contentDetail.innerHTML = "";
        return;
      }
      const shopId = shopIdInput.value.trim();
      const variants = item.variants || [];
      // Priority 7: the platform SET locks the moment either the content
      // item is past idea/draft/in_review OR any one platform already has
      // a real schedule — matches add_content_platform/
      // remove_content_platform's own server-side gate exactly, so the UI
      // never offers a control the backend would just reject.
      const platformSetLocked = !["idea", "draft", "in_review"].includes(item.status) || variants.some((v) => v.scheduled_at);
      const variantRows = variants
        .map((v) => {
          const disclosure = v.ai_disclosure_required
            ? v.disclosure_applied
              ? '<span class="badge good">Disclosure applied</span>'
              : '<span class="badge danger">Disclosure REQUIRED — not yet applied (publishing is blocked)</span>'
            : '<span class="badge">No AI disclosure required</span>';
          const conn = connectionStatusInfo(v.platform);
          // A published/publishing variant's caption can never be edited
          // (never silently rewrite a live post after the fact) — same
          // boundary update_variant_caption itself enforces.
          const captionLocked = ["published", "publishing"].includes(v.status);
          return `
          <div class="panel" style="margin:0.5em 0;">
            <p><strong>${esc(v.platform)}</strong> ${statusBadge(v.status)} — <span class="badge ${conn.badge}">${esc(conn.text)}</span></p>
            ${
              captionLocked
                ? `<p class="help">${esc(v.caption || "(no caption)")}</p>`
                : `<label>Caption
                     <textarea data-caption-input="${esc(v.id)}" rows="3">${esc(v.caption || "")}</textarea>
                   </label>
                   <button type="button" class="secondary" data-save-caption="${esc(v.id)}">Save caption</button>
                   <span class="help" data-caption-status="${esc(v.id)}"></span>`
            }
            <p>${disclosure}</p>
            ${v.last_error ? `<p class="help">Last error: ${esc(v.last_error)}</p>` : ""}
            ${
              v.ai_disclosure_required && !v.disclosure_applied
                ? `<button type="button" class="secondary" data-apply-disclosure="${esc(v.id)}">Mark disclosure applied</button>`
                : ""
            }
            ${
              !platformSetLocked && variants.length > 1
                ? `<button type="button" class="secondary" data-remove-platform="${esc(v.platform)}">Remove ${esc(v.platform)}</button>`
                : ""
            }
          </div>`;
        })
        .join("") || `<p class="quiet">No platform variants on this content item.</p>`;

      const availablePlatformsToAdd = PLATFORMS.filter((p) => !variants.some((v) => v.platform === p));
      const addPlatformRow =
        !platformSetLocked && availablePlatformsToAdd.length
          ? `<div class="header-actions" style="margin-top:0.5em;">
               <label>Add a platform
                 <select id="msAddPlatformSelect">${availablePlatformsToAdd.map((p) => `<option value="${esc(p)}">${esc(p.replace("_", " "))}</option>`).join("")}</select>
               </label>
               <button type="button" id="msAddPlatformBtn">Add platform</button>
               <span class="help" id="msAddPlatformStatus"></span>
             </div>`
          : platformSetLocked
          ? `<p class="help">Platform selection is locked — this content item has been approved or scheduled.</p>`
          : "";

      const canApprove = ["draft", "in_review"].includes(item.status);
      const canGenerate = item.status === "idea";
      const canSchedule = ["draft", "in_review", "approved"].includes(item.status);
      const canQueue = item.status === "approved";

      contentDetail.innerHTML = `
        <div class="panel">
          <h3>${esc(item.title || "(untitled)")}</h3>
          <p class="help">${esc(item.brief || "")}</p>
          <p>${statusBadge(item.status)} ${item.requires_human_approval ? "" : '<span class="badge">no approval required</span>'}</p>
          ${canGenerate ? `<button type="button" id="msGenerateBtn">Generate content</button>` : ""}
          ${canApprove ? `<button type="button" id="msApproveBtn">Approve</button> <button type="button" class="secondary" id="msRejectBtn">Reject</button>` : ""}
          <div id="msGenNote" class="help"></div>

          ${
            canSchedule
              ? `<div class="header-actions" style="margin-top:0.75em;">
                   <label>Schedule (your shop's local time)<input type="datetime-local" id="msScheduleInput"></label>
                   <button type="button" id="msScheduleBtn">Save schedule</button>
                 </label></div>`
              : ""
          }
          <p id="msScheduleStatus" class="help"></p>

          ${canQueue ? `<button type="button" id="msQueueBtn">Queue for publishing</button>` : ""}
          <p id="msQueueStatus" class="help"></p>

          <h4>Platforms</h4>
          ${variantRows}
          ${addPlatformRow}
        </div>
      `;

      const genNote = contentDetail.querySelector("#msGenNote");
      const genBtn = contentDetail.querySelector("#msGenerateBtn");
      if (genBtn) {
        genBtn.onclick = async () => {
          genBtn.disabled = true;
          genNote.textContent = "Generating…";
          try {
            const result = await adminApi("generate_content", { body: { shop_id: shopId, content_item_id: item.id } });
            const message = result.note || "Generated.";
            await loadContentList();
            openContentItemId = item.id;
            // renderContentDetail() rebuilds the whole panel from scratch —
            // including a fresh, empty #msGenNote — so the message has to be
            // re-applied to the NEW element after re-rendering, not the one
            // that's about to be discarded, or it's wiped the instant this
            // line finishes.
            renderContentDetail();
            const freshNote = contentDetail.querySelector("#msGenNote");
            if (freshNote) freshNote.textContent = message;
          } catch (err) {
            genNote.textContent = err.message;
            genBtn.disabled = false;
          }
        };
      }

      const approveBtn = contentDetail.querySelector("#msApproveBtn");
      if (approveBtn) {
        approveBtn.onclick = async () => {
          try {
            await adminApi("approve_content", { body: { shop_id: shopId, content_item_id: item.id, decision: "approved" } });
            await loadContentList();
            openContentItemId = item.id;
            renderContentDetail();
          } catch (err) {
            alert(err.message);
          }
        };
      }
      const rejectBtn = contentDetail.querySelector("#msRejectBtn");
      if (rejectBtn) {
        rejectBtn.onclick = async () => {
          if (!confirm("Reject this content item?")) return;
          try {
            await adminApi("approve_content", { body: { shop_id: shopId, content_item_id: item.id, decision: "rejected" } });
            await loadContentList();
            openContentItemId = item.id;
            renderContentDetail();
          } catch (err) {
            alert(err.message);
          }
        };
      }

      const scheduleBtn = contentDetail.querySelector("#msScheduleBtn");
      if (scheduleBtn) {
        scheduleBtn.onclick = async () => {
          const scheduleStatus = contentDetail.querySelector("#msScheduleStatus");
          const localValue = contentDetail.querySelector("#msScheduleInput").value;
          if (!localValue) return (scheduleStatus.textContent = "Pick a date/time first.");
          scheduleStatus.textContent = "Saving…";
          try {
            const result = await adminApi("schedule_content_item", { body: { shop_id: shopId, content_item_id: item.id, scheduled_at_local: localValue } });
            const message = `Scheduled for ${new Date(result.scheduled_at_utc).toLocaleString()} (shop timezone: ${esc(result.timezone)}).`;
            await loadContentList();
            openContentItemId = item.id;
            // Same re-render-wipes-the-message issue as genBtn above — the
            // message has to be applied to the freshly rendered element.
            renderContentDetail();
            const freshStatus = contentDetail.querySelector("#msScheduleStatus");
            if (freshStatus) freshStatus.textContent = message;
          } catch (err) {
            scheduleStatus.textContent = err.message;
          }
        };
      }

      const queueBtn = contentDetail.querySelector("#msQueueBtn");
      if (queueBtn) {
        queueBtn.onclick = async () => {
          const queueStatus = contentDetail.querySelector("#msQueueStatus");
          queueStatus.textContent = "Queueing…";
          try {
            const result = await adminApi("enqueue_publish", { body: { shop_id: shopId, content_item_id: item.id } });
            const message = `Queued ${result.jobs_queued} job(s). Publishing itself won't happen until either the (not-yet-deployed) scheduler runs, or you click "Run publishing queue now" above.`;
            await loadContentList();
            openContentItemId = item.id;
            // Same re-render-wipes-the-message issue as genBtn/scheduleBtn
            // above — apply the message to the freshly rendered element,
            // not the one renderContentDetail() is about to discard.
            renderContentDetail();
            const freshStatus = contentDetail.querySelector("#msQueueStatus");
            if (freshStatus) freshStatus.textContent = message;
          } catch (err) {
            queueStatus.textContent = err.message;
          }
        };
      }

      contentDetail.querySelectorAll("[data-apply-disclosure]").forEach((btn) => {
        btn.onclick = async () => {
          try {
            await adminApi("set_content_disclosure", { body: { shop_id: shopId, platform_variant_id: btn.dataset.applyDisclosure, disclosure_applied: true } });
            await loadContentList();
            openContentItemId = item.id;
            renderContentDetail();
          } catch (err) {
            alert(err.message);
          }
        };
      });

      // Priority 7: caption editing during review.
      contentDetail.querySelectorAll("[data-save-caption]").forEach((btn) => {
        btn.onclick = async () => {
          const variantId = btn.dataset.saveCaption;
          const textarea = contentDetail.querySelector(`[data-caption-input="${CSS.escape(variantId)}"]`);
          const statusEl = contentDetail.querySelector(`[data-caption-status="${CSS.escape(variantId)}"]`);
          const caption = textarea.value;
          if (!caption.trim()) {
            statusEl.textContent = "Caption can't be empty.";
            return;
          }
          statusEl.textContent = "Saving…";
          try {
            await adminApi("update_variant_caption", { body: { shop_id: shopId, platform_variant_id: variantId, caption } });
            await loadContentList();
            openContentItemId = item.id;
            // Same re-render-wipes-the-message pattern used throughout this
            // panel — apply the confirmation to the freshly rendered element.
            renderContentDetail();
            const freshStatus = contentDetail.querySelector(`[data-caption-status="${CSS.escape(variantId)}"]`);
            if (freshStatus) freshStatus.textContent = "Saved.";
          } catch (err) {
            statusEl.textContent = err.message;
          }
        };
      });

      // Priority 7: remove a target platform before approval/scheduling.
      contentDetail.querySelectorAll("[data-remove-platform]").forEach((btn) => {
        btn.onclick = async () => {
          const platform = btn.dataset.removePlatform;
          if (!confirm(`Remove ${platform} as a target platform for this content item?`)) return;
          try {
            await adminApi("remove_content_platform", { body: { shop_id: shopId, content_item_id: item.id, platform } });
            await loadContentList();
            openContentItemId = item.id;
            renderContentDetail();
          } catch (err) {
            alert(err.message);
          }
        };
      });

      // Priority 7: add a target platform before approval/scheduling.
      const addPlatformBtn = contentDetail.querySelector("#msAddPlatformBtn");
      if (addPlatformBtn) {
        addPlatformBtn.onclick = async () => {
          const select = contentDetail.querySelector("#msAddPlatformSelect");
          const addStatus = contentDetail.querySelector("#msAddPlatformStatus");
          const platform = select.value;
          addStatus.textContent = "Adding…";
          try {
            const result = await adminApi("add_content_platform", { body: { shop_id: shopId, content_item_id: item.id, platform } });
            const message = result.note || "Added.";
            await loadContentList();
            openContentItemId = item.id;
            renderContentDetail();
            const freshStatus = contentDetail.querySelector("#msAddPlatformStatus");
            if (freshStatus) freshStatus.textContent = message;
          } catch (err) {
            addStatus.textContent = err.message;
          }
        };
      }
    }

    root.querySelector("#msPlanMonthBtn").onclick = async () => {
      const shopId = shopIdInput.value.trim();
      if (!shopId) return (calStatus.textContent = "Enter a shop ID above first.");
      const year = Number(calYearInput.value);
      const month = Number(calMonthSelect.value);
      calStatus.textContent = "Planning…";
      try {
        const result = await adminApi("plan_month", { body: { shop_id: shopId, year, month } });
        calStatus.textContent = result.already_planned
          ? "This month already has planned content."
          : `Planned ${result.items_created ?? 0} content item(s).`;
        await loadContentList();
      } catch (err) {
        calStatus.textContent = err.message;
      }
    };

    root.querySelector("#msRunQueueBtn").onclick = async () => {
      const shopId = shopIdInput.value.trim();
      if (!shopId) return (calStatus.textContent = "Enter a shop ID above first.");
      calStatus.textContent = "Running publishing queue…";
      try {
        const result = await adminApi("run_publishing_queue", { body: { shop_id: shopId } });
        calStatus.textContent = `Processed ${result.processed} job(s). ${result.note || ""}`;
        await loadContentList();
        await loadCostSummary();
      } catch (err) {
        calStatus.textContent = err.message;
      }
    };

    // Priority 2: persisted per-shop default monthly budget cap.
    root.querySelector("#msSaveBudgetCapBtn").onclick = async () => {
      const shopId = shopIdInput.value.trim();
      if (!shopId) return (budgetCapStatus.textContent = "Enter a shop ID above first.");
      const raw = budgetCapInput.value.trim();
      const monthlyBudgetCents = raw === "" ? null : Math.round(Number(raw) * 100);
      if (raw !== "" && (!Number.isFinite(monthlyBudgetCents) || monthlyBudgetCents < 0)) {
        budgetCapStatus.textContent = "Enter a real non-negative dollar amount, or leave it blank for no cap.";
        return;
      }
      budgetCapStatus.textContent = "Saving…";
      try {
        await adminApi("set_marketing_budget_cap", { body: { shop_id: shopId, monthly_budget_cents: monthlyBudgetCents } });
        budgetCapStatus.textContent = "Saved.";
        await loadCostSummary();
      } catch (err) {
        budgetCapStatus.textContent = err.message;
      }
    };

    avatarPermission.onchange = () => { avatarPhotosField.hidden = !avatarPermission.checked; };
    voicePermission.onchange = () => { voiceAudioField.hidden = !voicePermission.checked; };

    async function loadStatus() {
      statusPanel.innerHTML = `<p class="quiet">Loading Marketing Studio status…</p>`;
      try {
        const d = await adminApi("status", { method: "GET" });
        const badge = d.clone_provider?.live
          ? `<span class="badge good">LIVE</span>`
          : `<span class="badge warn">NOT LIVE</span>`;
        const platforms = (d.supported_platforms || [])
          .map((p) => `<span class="badge ${p.live ? "good" : ""}">${esc(p.platform)}${p.live ? "" : " — not live"}</span>`)
          .join(" ");
        statusPanel.innerHTML = `
          <h2>Status</h2>
          <p>AI Clone (HeyGen + ElevenLabs): ${badge}</p>
          <p class="help">${esc(d.note || "")}</p>
          <p>Social platforms: ${platforms || '<span class="quiet">none</span>'}</p>
        `;
      } catch (err) {
        statusPanel.innerHTML = `<p class="help">Could not load status: ${esc(err.message)}</p>`;
      }
    }

    async function loadConsent() {
      const shopId = shopIdInput.value.trim();
      if (!shopId) {
        consentList.innerHTML = `<p class="quiet">Enter a shop ID and click Load.</p>`;
        return;
      }
      try {
        const d = await adminApi("list_clone_consent", { method: "GET", query: `shop_id=${encodeURIComponent(shopId)}` });
        const items = d.items || [];
        consentList.innerHTML = items.length
          ? items
              .map(
                (c) => `
              <div class="shop-row">
                <div>
                  <strong>${esc(c.person_name)}</strong>
                  <small>${c.avatar_permission ? "avatar " : ""}${c.voice_permission ? "voice " : ""}· ${esc((c.approved_usage || []).join(", "))} · ${esc((c.approved_platforms || []).join(", "))}</small>
                </div>
                <span class="badge ${c.active ? "good" : "danger"}">${c.active ? "active" : "revoked"}</span>
                <button type="button" class="secondary" data-revoke="${esc(c.id)}" ${c.active ? "" : "disabled"}>Revoke</button>
              </div>`
              )
              .join("")
          : `<p class="quiet">No consent grants recorded yet for this shop.</p>`;
        consentList.querySelectorAll("[data-revoke]").forEach((btn) => {
          btn.onclick = async () => {
            if (!confirm("Revoke this consent grant? Any avatar/voice profiles tied to it will be suspended.")) return;
            try {
              await adminApi("revoke_clone_consent", { body: { shop_id: shopId, consent_id: btn.dataset.revoke } });
              loadConsent();
            } catch (err) {
              alert(err.message);
            }
          };
        });
      } catch (err) {
        consentList.innerHTML = `<p class="help">Could not load consent grants: ${esc(err.message)}</p>`;
      }
    }

    async function loadPersonalBrandProfile() {
      const shopId = shopIdInput.value.trim();
      if (!shopId) return;
      try {
        const d = await adminApi("get_personal_brand_profile", { method: "GET", query: `shop_id=${encodeURIComponent(shopId)}` });
        pbProfileForm.display_name.value = d.profile.display_name || "";
        pbProfileForm.founder_title.value = d.profile.founder_title || "";
        pbProfileForm.founder_story.value = d.profile.founder_story || "";
        pbProfileForm.professional_casual_balance.value = d.profile.professional_casual_balance || "balanced";
        pbProfileForm.humor_level.value = d.profile.humor_level || "light";
        pbStyleSummary.textContent = d.style_summary ? `Learned style: ${d.style_summary}` : "No learned personal-presentation preferences yet.";
      } catch (err) {
        pbProfileStatus.textContent = `Could not load profile: ${err.message}`;
      }
    }

    async function loadReferencePhotos() {
      const shopId = shopIdInput.value.trim();
      if (!shopId) {
        pbPhotoList.innerHTML = `<p class="quiet">Enter a shop ID and click Load.</p>`;
        return;
      }
      try {
        const d = await adminApi("list_personal_brand_reference_photos", { method: "GET", query: `shop_id=${encodeURIComponent(shopId)}` });
        const items = d.items || [];
        pbPhotoList.innerHTML = items.length
          ? items
              .map(
                (p) => `
              <div class="shop-row">
                <div>
                  <img src="${esc(p.media_url)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:4px;">
                  <small>${esc(p.label)} · ${p.allow_image_generation ? "image-gen " : ""}${p.allow_avatar_generation ? "avatar-gen" : ""}</small>
                </div>
                <span class="badge ${p.revoked_at ? "danger" : "good"}">${p.revoked_at ? "revoked" : "active"}</span>
                <button type="button" class="secondary" data-revoke-photo="${esc(p.id)}" ${p.revoked_at ? "disabled" : ""}>Revoke</button>
                <button type="button" class="secondary" data-delete-photo="${esc(p.id)}">Delete</button>
              </div>`
              )
              .join("")
          : `<p class="quiet">No reference photos on file for this shop yet.</p>`;
        pbPhotoList.querySelectorAll("[data-revoke-photo]").forEach((btn) => {
          btn.onclick = async () => {
            try {
              await adminApi("update_personal_brand_reference_photo", { body: { shop_id: shopId, photo_id: btn.dataset.revokePhoto, revoked: true } });
              loadReferencePhotos();
            } catch (err) {
              alert(err.message);
            }
          };
        });
        pbPhotoList.querySelectorAll("[data-delete-photo]").forEach((btn) => {
          btn.onclick = async () => {
            if (!confirm("Permanently delete this reference photo? This cannot be undone.")) return;
            try {
              await adminApi("delete_personal_brand_reference_photo", { body: { shop_id: shopId, photo_id: btn.dataset.deletePhoto } });
              loadReferencePhotos();
            } catch (err) {
              alert(err.message);
            }
          };
        });
      } catch (err) {
        pbPhotoList.innerHTML = `<p class="help">Could not load reference photos: ${esc(err.message)}</p>`;
      }
    }

    root.querySelector("#msUseOpenShop").onclick = () => {
      const openId = window.BloomAdminSelectedShopId || null;
      if (!openId) {
        alert('No florist account is currently open. Open one from "Florist accounts" first.');
        return;
      }
      shopIdInput.value = openId;
      loadConsent();
      loadPersonalBrandProfile();
      loadReferencePhotos();
      loadContentList();
      loadCostSummary();
      loadConnections();
      loadVisualStyle();
    };
    root.querySelector("#msLoadShop").onclick = () => {
      loadConsent();
      loadPersonalBrandProfile();
      loadReferencePhotos();
      loadContentList();
      loadCostSummary();
      loadConnections();
      loadVisualStyle();
    };

    pbProfileForm.onsubmit = async (e) => {
      e.preventDefault();
      const shopId = shopIdInput.value.trim();
      if (!shopId) return (pbProfileStatus.textContent = "Enter a shop ID above first.");
      pbProfileStatus.textContent = "Saving…";
      try {
        await adminApi("update_personal_brand_profile", {
          body: {
            shop_id: shopId,
            fields: {
              display_name: pbProfileForm.display_name.value,
              founder_title: pbProfileForm.founder_title.value,
              founder_story: pbProfileForm.founder_story.value,
              professional_casual_balance: pbProfileForm.professional_casual_balance.value,
              humor_level: pbProfileForm.humor_level.value
            }
          }
        });
        pbProfileStatus.textContent = "Saved.";
      } catch (err) {
        pbProfileStatus.textContent = err.message;
      }
    };

    root.querySelector("#pbCommandBtn").onclick = async () => {
      const shopId = shopIdInput.value.trim();
      if (!shopId) return (pbCommandStatus.textContent = "Enter a shop ID above first.");
      const message = pbCommandInput.value.trim();
      if (!message) return (pbCommandStatus.textContent = "Type a message for Lily first.");
      pbCommandStatus.textContent = "Lily is working on it…";
      pbCommandResult.innerHTML = "";
      pbLastAssetId = null;
      try {
        const result = await adminApi("personal_brand_command", { body: { shop_id: shopId, message } });
        if (!result.understood) {
          pbCommandStatus.textContent = result.note || "Lily didn't understand that.";
          return;
        }
        pbCommandStatus.textContent = result.memory_ack || (result.asset ? "Here's what Lily made:" : "Got it — nothing to generate from that message.");
        if (result.asset && result.content) {
          pbLastAssetId = result.asset.id;
          pbLastMode = result.classification.mode;
          pbCommandResult.innerHTML = `
            <div class="panel">
              <p><strong>${esc(result.content.headline)}</strong></p>
              <p>${esc(result.content.body)}</p>
              <p class="help">${esc(result.content.cta)}</p>
              <p class="help">Founder presence: ${esc(result.content.founder_presence_brief)}</p>
              <div class="header-actions">
                <button type="button" id="pbApproveBtn">Love this</button>
                <button type="button" id="pbSendToStudioBtn">Send to Marketing Studio</button>
              </div>
            </div>`;
          pbCommandResult.querySelector("#pbApproveBtn").onclick = async () => {
            try {
              await adminApi("submit_personal_brand_feedback", { body: { shop_id: shopId, asset_id: pbLastAssetId, reason: "love_this" } });
              alert("Thanks — Lily will remember this.");
            } catch (err) {
              alert(err.message);
            }
          };
          pbCommandResult.querySelector("#pbSendToStudioBtn").onclick = async () => {
            try {
              const handoff = await adminApi("personal_brand_concept_to_content_item", {
                body: { shop_id: shopId, asset_id: pbLastAssetId, mode: pbLastMode, platforms: result.suggested_platforms }
              });
              alert(`Sent to Marketing Studio as a draft content item (${handoff.variants.length} platform variant(s)). Generate the real copy/image from the content calendar.`);
            } catch (err) {
              alert(err.message);
            }
          };
        }
        loadPersonalBrandProfile();
      } catch (err) {
        pbCommandStatus.textContent = err.message;
      }
    };

    pbPhotoForm.onsubmit = async (e) => {
      e.preventDefault();
      const shopId = shopIdInput.value.trim();
      if (!shopId) return (pbPhotoStatus.textContent = "Enter a shop ID above first.");
      const file = pbPhotoFile.files?.[0];
      if (!file) return (pbPhotoStatus.textContent = "Choose a photo first.");
      const consentedToStore = root.querySelector('[data-consent="store"]')?.checked;
      if (!consentedToStore) return (pbPhotoStatus.textContent = "Consent to store this photo is required.");
      pbPhotoStatus.textContent = "Uploading…";
      try {
        const dataUrl = await fileToDataUrl(file);
        await adminApi("upload_personal_brand_reference_photo", {
          body: {
            shop_id: shopId,
            data_url: dataUrl,
            filename: file.name,
            label: pbPhotoForm.label.value,
            consented_to_store: true,
            allow_image_generation: Boolean(root.querySelector('[data-consent="image"]')?.checked),
            allow_avatar_generation: Boolean(root.querySelector('[data-consent="avatar"]')?.checked)
          }
        });
        pbPhotoStatus.textContent = "Uploaded.";
        pbPhotoForm.reset();
        loadReferencePhotos();
      } catch (err) {
        pbPhotoStatus.textContent = err.message;
      }
    };

    enrollForm.onsubmit = async (e) => {
      e.preventDefault();
      const shopId = shopIdInput.value.trim();
      if (!shopId) return (enrollStatus.textContent = "Enter a shop ID above first.");
      const personName = enrollForm.person_name.value.trim();
      if (!personName) return (enrollStatus.textContent = "Person's name is required.");
      const avatarOn = avatarPermission.checked;
      const voiceOn = voicePermission.checked;
      if (!avatarOn && !voiceOn) return (enrollStatus.textContent = "Grant at least one of avatar or voice permission.");
      const approved_usage = Array.from(root.querySelectorAll("[data-usage]:checked")).map((el) => el.dataset.usage);
      if (approved_usage.length === 0) return (enrollStatus.textContent = "Select at least one approved usage.");
      const approved_platforms = Array.from(root.querySelectorAll("[data-platform]:checked")).map((el) => el.dataset.platform);
      if (approved_platforms.length === 0) return (enrollStatus.textContent = "Select at least one approved platform.");

      const submitBtn = enrollForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      enrollStatus.textContent = "Working…";
      enrollResult.innerHTML = "";
      try {
        let reference_photo_urls;
        if (avatarOn) {
          const files = Array.from(avatarPhotosInput.files || []);
          if (files.length === 0) throw new Error("Avatar permission is granted — add at least one reference photo.");
          reference_photo_urls = [];
          for (const file of files) {
            enrollStatus.textContent = `Uploading ${file.name}…`;
            const dataUrl = await fileToDataUrl(file);
            const uploaded = await adminApi("upload_clone_reference_photo", { body: { shop_id: shopId, data_url: dataUrl, filename: file.name } });
            reference_photo_urls.push(uploaded.url);
          }
        }
        let reference_audio_samples;
        if (voiceOn) {
          const files = Array.from(voiceAudioInput.files || []);
          if (files.length === 0) throw new Error("Voice permission is granted — add at least one reference audio sample.");
          enrollStatus.textContent = "Reading audio samples…";
          reference_audio_samples = await Promise.all(
            files.map(async (file) => ({ data_url: await fileToDataUrl(file), filename: file.name }))
          );
        }

        enrollStatus.textContent = "Submitting enrollment…";
        const result = await adminApi("request_clone_enrollment", {
          body: {
            shop_id: shopId,
            person_name: personName,
            avatar_permission: avatarOn,
            voice_permission: voiceOn,
            approved_usage,
            approved_platforms,
            reference_photo_urls,
            reference_audio_samples
          }
        });

        enrollStatus.textContent = result.note || "Enrollment recorded.";
        const rows = [];
        if (result.enrollment?.avatar) {
          const a = result.enrollment.avatar;
          rows.push(`<p><strong>Avatar:</strong> ${esc(a.status)}${a.profile_id ? ` · profile ID: <code>${esc(a.profile_id)}</code>` : ""}${a.error ? ` · ${esc(a.error)}` : ""}</p>`);
          if (a.profile_id) previewAvatarId.value = a.profile_id;
        }
        if (result.enrollment?.voice) {
          const v = result.enrollment.voice;
          rows.push(`<p><strong>Voice:</strong> ${esc(v.status)}${v.profile_id ? ` · profile ID: <code>${esc(v.profile_id)}</code>` : ""}${v.error ? ` · ${esc(v.error)}` : ""}</p>`);
          if (v.profile_id) previewVoiceId.value = v.profile_id;
        }
        enrollResult.innerHTML = rows.join("");
        loadConsent();
      } catch (err) {
        enrollStatus.textContent = err.message;
      } finally {
        submitBtn.disabled = false;
      }
    };

    root.querySelector("#msPreviewBtn").onclick = async () => {
      const shopId = shopIdInput.value.trim();
      if (!shopId) return (previewStatus.textContent = "Enter a shop ID above first.");
      const script = previewScript.value.trim();
      if (!script) return (previewStatus.textContent = "Enter a short script to preview.");
      const voice_profile_id = previewVoiceId.value.trim() || undefined;
      const avatar_profile_id = previewAvatarId.value.trim() || undefined;
      if (!voice_profile_id && !avatar_profile_id) return (previewStatus.textContent = "Enter a voice or avatar profile ID (from an enrollment result above).");

      previewStatus.textContent = "Generating preview…";
      previewResult.innerHTML = "";
      try {
        const result = await adminApi("preview_clone_profile", { body: { shop_id: shopId, voice_profile_id, avatar_profile_id, script } });
        if (result.note) {
          previewStatus.textContent = result.note;
          return;
        }
        if (result.kind === "audio") {
          previewStatus.textContent = "Voice preview ready.";
          previewResult.innerHTML = `<audio controls src="data:${esc(result.mime || "audio/mpeg")};base64,${result.audioBase64}"></audio>`;
        } else if (result.kind === "video") {
          previewStatus.textContent = `Video render started — job ID ${result.jobId} (status: ${result.status}).`;
          previewResult.innerHTML = `<button type="button" id="msCheckJobBtn">Check render status</button> <span id="msJobStatusLine"></span>`;
          previewResult.querySelector("#msCheckJobBtn").onclick = async () => {
            const line = previewResult.querySelector("#msJobStatusLine");
            line.textContent = "Checking…";
            try {
              const status = await adminApi("clone_job_status", { method: "GET", query: `shop_id=${encodeURIComponent(shopId)}&job_id=${encodeURIComponent(result.jobId)}` });
              if (status.terminal && status.resultUrl) {
                line.innerHTML = `Done: <a href="${esc(status.resultUrl)}" target="_blank" rel="noopener">view video</a>`;
              } else if (status.terminal) {
                line.textContent = `Finished with status "${status.status}"${status.error ? `: ${status.error}` : ""}`;
              } else {
                line.textContent = `Still rendering (status: ${status.status || "unknown"}) — check again shortly.`;
              }
            } catch (err) {
              line.textContent = err.message;
            }
          };
        }
      } catch (err) {
        previewStatus.textContent = err.message;
      }
    };

    loadStatus();
  }

  window.BloomMarketingStudio = { mount };
})();
