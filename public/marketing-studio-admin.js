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

    root.querySelector("#msUseOpenShop").onclick = () => {
      const openId = window.BloomAdminSelectedShopId || null;
      if (!openId) {
        alert('No florist account is currently open. Open one from "Florist accounts" first.');
        return;
      }
      shopIdInput.value = openId;
      loadConsent();
    };
    root.querySelector("#msLoadShop").onclick = loadConsent;

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
