/**
 * Real self-service photo manager for admin — upload a photo for the
 * Floral Library or Website Studio hero picker, edit or remove it, no
 * developer required. Talks to netlify/functions/admin-photo-manager.js.
 */
(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

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
    const url = `/.netlify/functions/admin-photo-manager?action=${encodeURIComponent(action)}${extra.query ? `&${extra.query}` : ""}`;
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify({ action, ...extra.body })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Photo manager request failed");
    return data;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.readAsDataURL(file);
    });
  }

  function parseRecipe(text) {
    return String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, qty] = line.split(",").map((s) => s.trim());
        return { name, qty: Number(qty) };
      })
      .filter((r) => r.name);
  }

  function recipeToText(recipe) {
    return (recipe || []).map((r) => `${r.name}, ${r.qty}`).join("\n");
  }

  function mount(root) {
    if (!root || root.dataset.photoManagerMounted) return;
    root.dataset.photoManagerMounted = "1";

    const wrap = document.createElement("div");
    wrap.className = "panel";
    wrap.innerHTML = `
      <p class="eyebrow">PHOTO MANAGER</p>
      <h2>Add real photos</h2>
      <p class="help">Upload real photos for the Floral Library or the Website Studio hero picker — no developer needed, changes go live immediately for every florist.</p>
      <form id="photoMgrForm">
        <div class="form-grid">
          <label>Where does this go?
            <select id="photoMgrContext">
              <option value="website_hero">Website Studio hero photo</option>
              <option value="floral_library">Floral Library item</option>
            </select>
          </label>
          <label>Category<input id="photoMgrCategory" placeholder="e.g. Signature, Funeral, Spring" required></label>
          <label>Name<input id="photoMgrName" required></label>
          <label id="photoMgrPriceField" hidden>Price<input id="photoMgrPrice" type="number" step="0.01" min="0"></label>
          <label class="wide">Short description<input id="photoMgrShortDescription"></label>
          <label class="wide">Description<textarea id="photoMgrDescription"></textarea></label>
          <label class="wide" id="photoMgrRecipeField" hidden>Recipe — one ingredient per line, "Name, Quantity"<textarea id="photoMgrRecipe" placeholder="Red Roses, 12
White Hydrangea, 4"></textarea></label>
          <label class="wide">Alt text (describes the photo for accessibility)<input id="photoMgrAltText" required></label>
          <label class="wide">Photo<input type="file" id="photoMgrFile" accept="image/jpeg,image/png,image/webp,image/gif"></label>
        </div>
        <div class="card-actions">
          <button type="submit" class="primary" id="photoMgrSubmit">Add photo</button>
          <button type="button" class="secondary" id="photoMgrCancelEdit" hidden>Cancel edit</button>
        </div>
        <p id="photoMgrStatus" class="help" aria-live="polite"></p>
      </form>
      <h3>Current photos</h3>
      <div id="photoMgrGrid" class="photo-mgr-grid"></div>
    `;
    root.appendChild(wrap);

    const form = wrap.querySelector("#photoMgrForm");
    const contextSelect = wrap.querySelector("#photoMgrContext");
    const priceField = wrap.querySelector("#photoMgrPriceField");
    const recipeField = wrap.querySelector("#photoMgrRecipeField");
    const priceInput = wrap.querySelector("#photoMgrPrice");
    const status = wrap.querySelector("#photoMgrStatus");
    const grid = wrap.querySelector("#photoMgrGrid");
    const submitBtn = wrap.querySelector("#photoMgrSubmit");
    const cancelEditBtn = wrap.querySelector("#photoMgrCancelEdit");
    const fileInput = wrap.querySelector("#photoMgrFile");

    let editingId = null;
    let items = [];

    function toggleContextFields() {
      const isLibrary = contextSelect.value === "floral_library";
      priceField.hidden = !isLibrary;
      recipeField.hidden = !isLibrary;
      priceInput.required = isLibrary && !editingId ? true : priceInput.required;
    }
    contextSelect.addEventListener("change", toggleContextFields);
    toggleContextFields();

    function resetForm() {
      editingId = null;
      form.reset();
      toggleContextFields();
      submitBtn.textContent = "Add photo";
      cancelEditBtn.hidden = true;
      fileInput.required = true;
    }

    function startEdit(item) {
      editingId = item.id;
      contextSelect.value = item.context;
      wrap.querySelector("#photoMgrCategory").value = item.category || "";
      wrap.querySelector("#photoMgrName").value = item.name || "";
      priceInput.value = item.suggested_retail ?? "";
      wrap.querySelector("#photoMgrShortDescription").value = item.short_description || "";
      wrap.querySelector("#photoMgrDescription").value = item.description || "";
      wrap.querySelector("#photoMgrRecipe").value = recipeToText(item.recipe);
      wrap.querySelector("#photoMgrAltText").value = item.alt_text || "";
      toggleContextFields();
      submitBtn.textContent = "Save changes";
      cancelEditBtn.hidden = false;
      fileInput.required = false; // editing metadata doesn't require re-uploading the photo
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    cancelEditBtn.addEventListener("click", resetForm);

    function renderGrid() {
      if (!items.length) {
        grid.innerHTML = `<p class="help">No admin-uploaded photos yet — add one above.</p>`;
        return;
      }
      grid.innerHTML = items
        .map(
          (item) => `<article class="card photo-mgr-card">
            <img src="${esc(item.image_url)}" alt="${esc(item.alt_text)}" loading="lazy">
            <div class="body">
              <span class="badge">${esc(item.context === "floral_library" ? "Floral Library" : "Website Hero")}</span>
              <h3>${esc(item.name)}</h3>
              <p class="help">${esc(item.category)}${item.context === "floral_library" && item.suggested_retail ? ` · $${Number(item.suggested_retail).toFixed(2)}` : ""}</p>
            </div>
            <div class="card-actions">
              <button type="button" class="secondary" data-edit-photo="${esc(item.id)}">Edit</button>
              <button type="button" class="secondary" data-delete-photo="${esc(item.id)}">Delete</button>
            </div>
          </article>`
        )
        .join("");
    }

    async function loadGrid() {
      try {
        const d = await adminApi("list", { method: "GET" });
        items = d.items || [];
        renderGrid();
      } catch (e) {
        grid.innerHTML = `<p class="help">${esc(e.message)}</p>`;
      }
    }

    grid.addEventListener("click", async (e) => {
      const editBtn = e.target.closest("[data-edit-photo]");
      if (editBtn) {
        const item = items.find((i) => i.id === editBtn.dataset.editPhoto);
        if (item) startEdit(item);
        return;
      }
      const deleteBtn = e.target.closest("[data-delete-photo]");
      if (deleteBtn) {
        if (!confirm("Delete this photo? This can't be undone.")) return;
        try {
          await adminApi("delete", { body: { id: deleteBtn.dataset.deletePhoto } });
          status.textContent = "Photo deleted.";
          await loadGrid();
        } catch (err) {
          status.textContent = err.message;
        }
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      status.textContent = editingId ? "Saving changes…" : "Uploading…";
      try {
        const context = contextSelect.value;
        const payload = {
          context,
          category: wrap.querySelector("#photoMgrCategory").value,
          name: wrap.querySelector("#photoMgrName").value,
          short_description: wrap.querySelector("#photoMgrShortDescription").value,
          description: wrap.querySelector("#photoMgrDescription").value,
          alt_text: wrap.querySelector("#photoMgrAltText").value
        };
        if (context === "floral_library") {
          payload.suggested_retail = Number(priceInput.value);
          payload.recipe = parseRecipe(wrap.querySelector("#photoMgrRecipe").value);
        }

        const file = fileInput.files?.[0];
        if (file) payload.dataUrl = await fileToDataUrl(file);

        if (editingId) {
          await adminApi("update", { body: { id: editingId, ...payload } });
          status.textContent = "Saved.";
        } else {
          if (!file) throw new Error("Choose a photo to upload.");
          payload.filename = file.name;
          await adminApi("upload", { body: payload });
          status.textContent = "Photo added — live for every florist now.";
        }
        resetForm();
        await loadGrid();
      } catch (err) {
        status.textContent = err.message;
      } finally {
        submitBtn.disabled = false;
      }
    });

    loadGrid();
  }

  window.BloomPhotoManager = { mount };
})();
