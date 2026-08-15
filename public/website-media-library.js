/**
 * Website Studio media library — real upload, browse, reuse, alt text,
 * and delete, replacing the old prompt("Image URL:") flow.
 *
 * Two entry points into the same dialog:
 *   BloomWebsiteMedia.openBrowse()        — manage: upload, alt text, delete
 *   BloomWebsiteMedia.openPicker(onPick)  — browse + click an image to select it
 */
(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  async function api(action, extra = {}) {
    return window.api("instant-website", { method: "POST", body: JSON.stringify({ action, ...extra }) });
  }

  const MAX_BYTES = 8 * 1024 * 1024;
  const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.readAsDataURL(file);
    });
  }

  let dlg = null;
  let media = [];
  let pickMode = null; // null = manage mode; function = picker mode

  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "media-library-dialog";
    dlg.innerHTML = `
      <div class="media-library-head">
        <h3 id="mediaLibraryTitle">Media library</h3>
        <button type="button" class="secondary" id="mediaLibraryClose">Close</button>
      </div>
      <p class="subtle" id="mediaLibraryHint"></p>
      <label class="media-upload-drop" id="mediaUploadDrop">
        <input type="file" id="mediaUploadInput" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
        <span>+ Upload a photo</span>
        <small>JPEG, PNG, WebP, or GIF — up to 8 MB</small>
      </label>
      <p id="mediaUploadStatus" class="subtle" aria-live="polite"></p>
      <div class="media-grid" id="mediaGrid"></div>
    `;
    document.body.appendChild(dlg);

    dlg.querySelector("#mediaLibraryClose").addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => {
      pickMode = null;
    });

    dlg.querySelector("#mediaUploadDrop").addEventListener("dragover", (e) => e.preventDefault());
    dlg.querySelector("#mediaUploadDrop").addEventListener("drop", async (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) await handleUpload(file);
    });
    dlg.querySelector("#mediaUploadInput").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) await handleUpload(file);
      e.target.value = "";
    });

    dlg.querySelector("#mediaGrid").addEventListener("click", async (e) => {
      const pickBtn = e.target.closest("[data-pick]");
      if (pickBtn && pickMode) {
        const item = media.find((m) => m.id === pickBtn.dataset.pick);
        if (item) {
          pickMode(item);
          dlg.close();
        }
        return;
      }
      const altBtn = e.target.closest("[data-edit-alt]");
      if (altBtn) {
        const item = media.find((m) => m.id === altBtn.dataset.editAlt);
        const next = window.prompt("Alt text (describes this image for screen readers and SEO):", item?.alt_text || "");
        if (next == null) return;
        try {
          await api("update_media", { id: item.id, alt_text: next.trim() });
          item.alt_text = next.trim();
          renderGrid();
        } catch (err) {
          setStatus(err.message);
        }
        return;
      }
      const delBtn = e.target.closest("[data-delete-media]");
      if (delBtn) {
        const item = media.find((m) => m.id === delBtn.dataset.deleteMedia);
        try {
          await api("delete_media", { id: item.id });
          media = media.filter((m) => m.id !== item.id);
          renderGrid();
          setStatus("Image deleted.");
        } catch (err) {
          if (err.code || err.items || /used on your site/i.test(err.message || "")) {
            const usage = (err.items || []).length ? err.items : [];
            const where = usage.length ? usage.map((u) => u.page_title || u.slug).join(", ") : "your site";
            if (confirm(`This image is used on ${where}. Delete it anyway? Those sections will show a broken image until you replace it.`)) {
              try {
                await api("delete_media", { id: item.id, confirmed: true });
                media = media.filter((m) => m.id !== item.id);
                renderGrid();
                setStatus("Image deleted.");
              } catch (err2) {
                setStatus(err2.message);
              }
            }
          } else {
            setStatus(err.message);
          }
        }
      }
    });

    return dlg;
  }

  function setStatus(msg) {
    const el = dlg.querySelector("#mediaUploadStatus");
    if (el) el.textContent = msg || "";
  }

  async function handleUpload(file) {
    if (!ALLOWED.has(file.type)) {
      setStatus("Please choose a JPEG, PNG, WebP, or GIF image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus("That image is over 8 MB — try a smaller file.");
      return;
    }
    setStatus("Uploading…");
    try {
      const dataUrl = await fileToDataUrl(file);
      const d = await api("upload_media", { data_url: dataUrl, filename: file.name });
      media = [d.media, ...media];
      renderGrid();
      setStatus(`"${file.name}" uploaded.`);
    } catch (err) {
      setStatus(err.message || "Upload failed. Try again.");
    }
  }

  function renderGrid() {
    const grid = dlg.querySelector("#mediaGrid");
    if (!media.length) {
      grid.innerHTML = `<div class="media-empty">No photos yet. Upload your first one above.</div>`;
      return;
    }
    grid.innerHTML = media
      .map((m) => {
        const usedTag = m.used_in?.length ? `<span class="media-used-tag">Used in ${m.used_in.length} place${m.used_in.length === 1 ? "" : "s"}</span>` : "";
        const pickBtn = pickMode ? `<button type="button" class="primary" data-pick="${esc(m.id)}">Use this photo</button>` : "";
        return `<div class="media-card">
          <div class="media-thumb" style="background-image:url('${esc(m.url)}')" role="img" aria-label="${esc(m.alt_text || m.filename)}"></div>
          <div class="media-meta">
            <div class="media-filename">${esc(m.filename)}</div>
            ${m.alt_text ? `<div class="media-alt">${esc(m.alt_text)}</div>` : `<div class="media-alt media-alt-missing">No alt text — click Alt text to add one</div>`}
            ${usedTag}
          </div>
          <div class="media-actions">
            ${pickBtn}
            <button type="button" class="secondary" data-edit-alt="${esc(m.id)}">Alt text</button>
            <button type="button" class="secondary danger" data-delete-media="${esc(m.id)}">Delete</button>
          </div>
        </div>`;
      })
      .join("");
  }

  async function loadMedia() {
    const grid = dlg.querySelector("#mediaGrid");
    grid.innerHTML = `<div class="media-empty">Loading…</div>`;
    try {
      const d = await api("list_media");
      media = d.media || [];
      renderGrid();
    } catch (err) {
      grid.innerHTML = `<div class="media-empty">${esc(err.message || "Could not load your photos.")}</div>`;
    }
  }

  function openBrowse() {
    ensureDialog();
    pickMode = null;
    dlg.querySelector("#mediaLibraryTitle").textContent = "Media library";
    dlg.querySelector("#mediaLibraryHint").textContent = "Every photo you've uploaded for your website, in one place.";
    setStatus("");
    dlg.showModal();
    loadMedia();
  }

  function openPicker(onPick) {
    ensureDialog();
    pickMode = typeof onPick === "function" ? onPick : null;
    dlg.querySelector("#mediaLibraryTitle").textContent = "Choose a photo";
    dlg.querySelector("#mediaLibraryHint").textContent = "Pick an existing photo, or upload a new one.";
    setStatus("");
    dlg.showModal();
    loadMedia();
  }

  window.BloomWebsiteMedia = { openBrowse, openPicker };
})();
