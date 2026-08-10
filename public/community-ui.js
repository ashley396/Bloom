(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const CATEGORIES = ["Design Help", "Business Advice", "Questions", "Celebrations", "Arrangement Share"];
  let state = {
    loading: false,
    error: null,
    items: [],
    profile: null,
    guidelines: [],
    category: "",
    comments: {},
    openComments: null,
    composerDraft: {
      category: CATEGORIES[0],
      caption: "",
      body: "",
    },
    recipeUi: {},
  };
  let pendingImageDataUrl = null;
  let pendingAvatarDataUrl = null;

  async function api(action, extra = {}, method = "POST") {
    const fn = window.bloomCommunityApi || window.api;
    if (!fn) throw new Error("Sign in required.");
    if (method === "GET") {
      const qs = new URLSearchParams({ action, ...extra });
      return fn(`florist-community?${qs.toString()}`);
    }
    return fn("florist-community", { method: "POST", body: JSON.stringify({ action, ...extra }) });
  }

  function root() {
    return document.getElementById("communityRoot");
  }

  function setStatus(msg) {
    const el = document.getElementById("communityStatus");
    if (el) el.textContent = msg || "";
  }

  function renderLoading(el) {
    el.innerHTML = `<div class="community-state community-loading" role="status">
      <div class="community-spinner" aria-hidden="true"></div>
      <p>Loading Florist Community…</p>
    </div>`;
  }

  function renderError(el, message) {
    el.innerHTML = `<div class="community-state community-error" role="alert">
      <h3>Something went wrong</h3>
      <p>${esc(message)}</p>
      <button type="button" class="primary" id="communityRetry">Try again</button>
    </div>`;
    el.querySelector("#communityRetry")?.addEventListener("click", () => load());
  }

  function isAllowedImageFile(file) {
    if (!file) return false;
    const mime = String(file.type || "").toLowerCase();
    if (["image/jpeg", "image/png", "image/webp"].includes(mime)) return true;
    const ext = String(file.name || "").split(".").pop()?.toLowerCase();
    return ["jpg", "jpeg", "png", "webp"].includes(ext);
  }

  function captureComposerDraft() {
    const form = root()?.querySelector("#communityComposer");
    if (!form) return;
    const fd = new FormData(form);
    state.composerDraft = {
      category: String(fd.get("category") || state.composerDraft.category || CATEGORIES[0]),
      caption: String(fd.get("caption") || ""),
      body: String(fd.get("body") || ""),
    };
  }

  function resetComposerDraft() {
    state.composerDraft = { category: CATEGORIES[0], caption: "", body: "" };
    pendingImageDataUrl = null;
  }

  function updateComposerImagePreview(dataUrl) {
    const preview = root()?.querySelector("#communityImagePreview");
    if (!preview) return;
    if (dataUrl) {
      preview.src = dataUrl;
      preview.hidden = false;
    } else {
      preview.removeAttribute("src");
      preview.hidden = true;
    }
  }
  function renderEmpty() {
    return `<div class="community-state community-empty">
      <h3>Your florist feed is quiet</h3>
      <p>Share an arrangement photo, design tip, or question — the way you would on social, but florist-only.</p>
    </div>`;
  }

  function avatarHtml(profile, { size = "md", alt = "Florist profile photo" } = {}) {
    const url = profile?.avatar_url;
    const initials = esc(String(profile?.display_name || "F").trim().charAt(0).toUpperCase() || "F");
    if (url) {
      return `<img class="community-avatar community-avatar-${size}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" width="48" height="48">`;
    }
    return `<span class="community-avatar community-avatar-${size} community-avatar-fallback" aria-hidden="true">${initials}</span>`;
  }

  function guidelinesHtml(list) {
    const items = (list || []).map((g) => `<li>${esc(g)}</li>`).join("");
    return `<details class="community-guidelines panel">
      <summary>Community guidelines <span class="community-beta-pill">Beta</span></summary>
      <ol>${items}</ol>
    </details>`;
  }

  function profileForm(profile) {
    const p = profile || {};
    const previewSrc = pendingAvatarDataUrl || p.avatar_url || "";
    const previewInner = previewSrc
      ? `<img id="communityAvatarPreview" class="community-avatar community-avatar-xl" src="${esc(previewSrc)}" alt="Your profile photo">`
      : `<span id="communityAvatarPreview" class="community-avatar community-avatar-xl community-avatar-fallback">${esc(
          String(p.display_name || "F").trim().charAt(0).toUpperCase() || "F"
        )}</span>`;
    return `<form id="communityProfileForm" class="community-profile panel">
      <div class="community-profile-social">
        <div class="community-profile-photo-col">
          ${previewInner}
          <label class="community-avatar-upload">
            <span class="primary community-avatar-upload-btn">Change photo</span>
            <input type="file" id="communityAvatarInput" accept="image/jpeg,image/png,image/webp" hidden>
          </label>
          ${
            p.avatar_url || pendingAvatarDataUrl
              ? `<button type="button" class="secondary community-avatar-remove" id="communityAvatarRemove">Remove photo</button>`
              : ""
          }
        </div>
        <div class="community-profile-fields">
          <p class="eyebrow">YOUR FLORIST PROFILE</p>
          <h3>${esc(p.display_name || "Your florist identity")}</h3>
          <p class="subtle">Profile photos and arrangement posts work like Instagram or Facebook — but only for florists. Never include customer or order details.</p>
          <div class="two">
            <label>Display name<input name="display_name" required maxlength="80" value="${esc(p.display_name || "")}"></label>
            <label>Shop name<input name="shop_display_name" required maxlength="120" value="${esc(p.shop_display_name || "")}"></label>
          </div>
          <div class="two">
            <label>City<input name="city" maxlength="80" value="${esc(p.city || "")}"></label>
            <label>Region / state<input name="region" maxlength="80" value="${esc(p.region || "")}"></label>
          </div>
          <label>Short bio<textarea name="bio" maxlength="500" rows="2" placeholder="Specialty, style, years in business…">${esc(p.bio || "")}</textarea></label>
          <div class="card-actions">
            <button type="submit" class="primary">Save profile</button>
          </div>
        </div>
      </div>
    </form>`;
  }

  function composerHtml() {
    const p = state.profile || {};
    const draft = state.composerDraft || {};
    const selectedCategory = draft.category || CATEGORIES[0];
    const opts = CATEGORIES.map(
      (c) => `<option value="${esc(c)}"${c === selectedCategory ? " selected" : ""}>${esc(c)}</option>`
    ).join("");
    const previewAttrs = pendingImageDataUrl
      ? `src="${esc(pendingImageDataUrl)}"`
      : 'hidden aria-hidden="true"';
    return `<form id="communityComposer" class="community-composer panel">
      <div class="community-composer-head">
        ${avatarHtml(p, { size: "sm", alt: "Your profile" })}
        <div>
          <p class="eyebrow">CREATE A POST</p>
          <h3>Share with florists</h3>
        </div>
      </div>
      <label>Category<select name="category" required>${opts}</select></label>
      <label>Caption<input name="caption" required maxlength="280" placeholder="What's on your design bench today?" value="${esc(draft.caption || "")}"></label>
      <label>Details (optional)<textarea name="body" maxlength="4000" rows="3" placeholder="Recipe tips, mechanics, or business advice — no customer info.">${esc(draft.body || "")}</textarea></label>
      <label class="community-photo-upload">
        <span class="community-photo-upload-label">📷 Arrangement photo (optional, max 2 MB, JPG/PNG/WebP)</span>
        <input type="file" id="communityImageInput" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp">
      </label>
      <img id="communityImagePreview" class="community-image-preview" alt="Arrangement preview" ${previewAttrs}>
      <div class="card-actions">
        <button type="submit" class="primary">Post</button>
      </div>
    </form>`;
  }

  function filterBar(active) {
    const chips = [`<button type="button" class="community-chip${active ? "" : " active"}" data-cat="">All</button>`]
      .concat(
        CATEGORIES.map(
          (c) =>
            `<button type="button" class="community-chip${active === c ? " active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`
        )
      )
      .join("");
    return `<div class="community-filters" role="toolbar" aria-label="Filter by category">${chips}</div>`;
  }

  function recipePanel(post) {
    const id = post.id;
    if (post.published_recipe) {
      const r = post.published_recipe;
      const stems = (r.recipe || [])
        .slice(0, 8)
        .map((row) => `<li>${esc(row.qty || row.quantity)} × ${esc(row.name)}</li>`)
        .join("");
      const importBtn =
        !post.is_mine && r.id
          ? `<button type="button" class="primary community-import-recipe" data-recipe-id="${esc(r.id)}">Add to My Shop</button>`
          : "";
      return `<div class="community-recipe panel community-recipe-published">
        <p class="eyebrow">🌸 LILY RECIPE · SHARED</p>
        <h4>${esc(r.title)}</h4>
        ${r.suggested_retail ? `<p class="subtle">Suggested retail · $${Number(r.suggested_retail).toFixed(0)}</p>` : ""}
        ${stems ? `<ul class="community-recipe-stems">${stems}</ul>` : ""}
        ${importBtn}
      </div>`;
    }
    if (!post.is_mine) return "";
    if (post.recipe_status === "draft" && post.recipe_draft) {
      const d = post.recipe_draft;
      const rows = (d.recipe || [])
        .map(
          (row, i) =>
            `<div class="community-recipe-row"><input data-recipe-idx="${i}" data-field="name" value="${esc(row.name)}" maxlength="120" aria-label="Ingredient"><input data-recipe-idx="${i}" data-field="qty" type="number" min="1" value="${esc(row.qty || row.quantity || 1)}" aria-label="Qty"></div>`
        )
        .join("");
      return `<div class="community-recipe panel community-recipe-draft" data-post-id="${esc(id)}">
        <p class="eyebrow">🌸 LILY RECIPE · DRAFT</p>
        <label>Title<input class="community-recipe-title" value="${esc(d.name || "")}" maxlength="120"></label>
        <label>Category<input class="community-recipe-category" value="${esc(d.category || "Everyday")}" maxlength="80"></label>
        <label>Suggested retail ($)<input class="community-recipe-retail" type="number" min="0" step="1" value="${esc(d.suggested_retail || 0)}"></label>
        <div class="community-recipe-rows">${rows}</div>
        <div class="card-actions">
          <button type="button" class="secondary community-save-recipe" data-id="${esc(id)}">Save draft</button>
          <button type="button" class="primary community-publish-recipe" data-id="${esc(id)}">Publish to Community</button>
        </div>
      </div>`;
    }
    if (post.can_build_recipe && post.image_url) {
      const ui = state.recipeUi[id] || {};
      return `<div class="community-recipe panel" data-recipe-panel="${esc(id)}">
        <p class="eyebrow">LILY</p>
        <p class="subtle">Turn your arrangement photo into a stem-count recipe other florists can copy.</p>
        ${ui.busy ? `<p class="community-recipe-busy" role="status">Lily is building your recipe…</p>` : ""}
        ${ui.error ? `<p class="community-error-inline" role="alert">${esc(ui.error)}</p>` : ""}
        ${ui.notice ? `<p class="subtle">${esc(ui.notice)}</p>` : ""}
        <button type="button" class="primary community-build-recipe" data-id="${esc(id)}"${ui.busy ? " disabled" : ""}>Build recipe with Lily</button>
      </div>`;
    }
    return "";
  }

  function postCard(post) {
    const author = post.author || {};
    const img = post.image_url
      ? `<figure class="community-post-image-wrap"><img class="community-post-image" src="${esc(post.image_url)}" alt="Arrangement shared by ${esc(author.display_name || "florist")}" loading="lazy"></figure>`
      : "";
    const mod = post.can_moderate
      ? `<button type="button" class="secondary community-mod-hide" data-id="${esc(post.id)}">Hide</button>
         <button type="button" class="secondary danger community-mod-remove" data-id="${esc(post.id)}">Remove</button>`
      : "";
    const mine = post.is_mine
      ? `<button type="button" class="secondary danger community-delete" data-id="${esc(post.id)}">Delete</button>`
      : "";
    return `<article class="community-post panel" data-post-id="${esc(post.id)}">
      <header class="community-post-head">
        ${avatarHtml(author, { size: "md", alt: `${author.display_name || "Florist"} profile photo` })}
        <div class="community-post-author">
          <strong>${esc(author.display_name || "Florist")}</strong>
          <span class="subtle">${esc(author.shop_display_name || "")}${author.city ? ` · ${esc(author.city)}` : ""}</span>
          <p class="community-category">${esc(post.category)}</p>
        </div>
        <time class="subtle community-post-time" datetime="${esc(post.created_at || "")}">${esc(formatWhen(post.created_at))}</time>
      </header>
      ${img}
      <h3 class="community-caption">${esc(post.caption)}</h3>
      ${post.body ? `<p class="community-body">${esc(post.body)}</p>` : ""}
      ${recipePanel(post)}
      <div class="community-actions">
        <button type="button" class="secondary community-like${post.liked ? " liked" : ""}" data-id="${esc(post.id)}" aria-pressed="${post.liked ? "true" : "false"}">
          ${post.liked ? "♥ Encouraged" : "♡ Encourage"} · ${Number(post.like_count || 0)}
        </button>
        <button type="button" class="secondary community-toggle-comments" data-id="${esc(post.id)}">
          💬 ${Number(post.comment_count || 0)}
        </button>
        <button type="button" class="secondary community-report" data-id="${esc(post.id)}">Report</button>
        ${mine}
        ${mod}
      </div>
      <div class="community-comments" id="comments-${esc(post.id)}" hidden></div>
    </article>`;
  }

  function formatWhen(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function render() {
    const el = root();
    if (!el) return;
    if (state.loading) {
      captureComposerDraft();
      renderLoading(el);
      return;
    }
    if (state.error) {
      captureComposerDraft();
      renderError(el, state.error);
      return;
    }
    captureComposerDraft();
    const feed =
      state.items.length === 0
        ? renderEmpty()
        : `<div class="community-feed">${state.items.map(postCard).join("")}</div>`;

    el.innerHTML = `<div class="community-shell">
      <div class="community-hero">
        <p class="eyebrow">FLORIST SOCIAL <span class="community-beta-pill">Beta</span></p>
        <h2>Your florist feed</h2>
        <p class="subtle">Profile photos, arrangement posts, Lily recipes, encourages, and comments — like Instagram or Facebook, built only for flower shops.</p>
      </div>
      ${guidelinesHtml(state.guidelines)}
      ${profileForm(state.profile)}
      ${composerHtml()}
      ${filterBar(state.category)}
      <p id="communityStatus" class="subtle" aria-live="polite"></p>
      ${feed}
    </div>`;
    bind();
  }

  function bindFileImage(inputId, onDataUrl, previewSelector) {
    const el = root();
    el.querySelector(inputId)?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!isAllowedImageFile(file)) {
        setStatus("Please choose a JPEG, PNG, or WebP image (iPhone HEIC is not supported yet).");
        e.target.value = "";
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setStatus("Image must be under 2 MB.");
        e.target.value = "";
        return;
      }
      captureComposerDraft();
      const reader = new FileReader();
      reader.onload = () => {
        onDataUrl(reader.result);
        updateComposerImagePreview(reader.result);
        setStatus("Photo attached — your caption is saved. Click Post when ready.");
      };
      reader.onerror = () => {
        setStatus("Could not read that image file. Try another photo.");
        e.target.value = "";
      };
      reader.readAsDataURL(file);
    });
  }

  function collectRecipeDraft(panel) {
    if (!panel) return null;
    const name = panel.querySelector(".community-recipe-title")?.value?.trim();
    const category = panel.querySelector(".community-recipe-category")?.value?.trim() || "Everyday";
    const suggested_retail = Number(panel.querySelector(".community-recipe-retail")?.value || 0);
    const recipe = [];
    panel.querySelectorAll(".community-recipe-row").forEach((row) => {
      const idx = row.querySelector("[data-field='name']");
      const qty = row.querySelector("[data-field='qty']");
      const stemName = idx?.value?.trim();
      const stemQty = Number(qty?.value || 0);
      if (stemName && stemQty > 0) recipe.push({ name: stemName, qty: stemQty, kind: "flower" });
    });
    if (!name || !recipe.length) return null;
    return { name, category, suggested_retail, recipe, instructions: [] };
  }

  function bind() {
    const el = root();
    if (!el) return;

    el.querySelector("#communityProfileForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      setStatus("Saving profile…");
      try {
        const payload = {
          display_name: fd.get("display_name"),
          shop_display_name: fd.get("shop_display_name"),
          city: fd.get("city"),
          region: fd.get("region"),
          bio: fd.get("bio"),
        };
        if (pendingAvatarDataUrl) payload.avatar_data_url = pendingAvatarDataUrl;
        const res = await api("save_profile", payload);
        state.profile = res.profile;
        pendingAvatarDataUrl = null;
        setStatus("Profile saved.");
        render();
      } catch (err) {
        setStatus(err.message || "Could not save profile.");
      }
    });

    el.querySelector("#communityAvatarRemove")?.addEventListener("click", async () => {
      pendingAvatarDataUrl = null;
      setStatus("Removing profile photo…");
      try {
        const fd = new FormData(el.querySelector("#communityProfileForm"));
        const res = await api("save_profile", {
          display_name: fd.get("display_name"),
          shop_display_name: fd.get("shop_display_name"),
          city: fd.get("city"),
          region: fd.get("region"),
          bio: fd.get("bio"),
          remove_avatar: true,
        });
        state.profile = res.profile;
        setStatus("Profile photo removed.");
        render();
      } catch (err) {
        setStatus(err.message || "Could not remove photo.");
      }
    });

    el.querySelector("#communityAvatarInput")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setStatus("Please choose a JPEG, PNG, or WebP image.");
        e.target.value = "";
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setStatus("Image must be under 2 MB.");
        e.target.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        pendingAvatarDataUrl = reader.result;
        const col = el.querySelector(".community-profile-photo-col");
        const old = col?.querySelector(".community-avatar-xl, #communityAvatarPreview");
        if (col && old) {
          const img = document.createElement("img");
          img.id = "communityAvatarPreview";
          img.className = "community-avatar community-avatar-xl";
          img.src = pendingAvatarDataUrl;
          img.alt = "Your profile photo";
          old.replaceWith(img);
        }
        if (!col?.querySelector("#communityAvatarRemove")) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "secondary community-avatar-remove";
          btn.id = "communityAvatarRemove";
          btn.textContent = "Remove photo";
          btn.addEventListener("click", async () => {
            pendingAvatarDataUrl = null;
            setStatus("Removing profile photo…");
            try {
              const form = el.querySelector("#communityProfileForm");
              const fd = new FormData(form);
              const res = await api("save_profile", {
                display_name: fd.get("display_name"),
                shop_display_name: fd.get("shop_display_name"),
                city: fd.get("city"),
                region: fd.get("region"),
                bio: fd.get("bio"),
                remove_avatar: true,
              });
              state.profile = res.profile;
              setStatus("Profile photo removed.");
              render();
            } catch (err) {
              setStatus(err.message || "Could not remove photo.");
            }
          });
          col?.append(btn);
        }
        setStatus("Photo ready — click Save profile.");
      };
      reader.readAsDataURL(file);
    });

    bindFileImage("#communityImageInput", (url) => {
      pendingImageDataUrl = url;
    }, "#communityImagePreview");

    el.querySelector("#communityComposer")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const caption = String(fd.get("caption") || "").trim();
      if (!caption) {
        setStatus("Caption is required.");
        return;
      }
      setStatus("Publishing…");
      try {
        const payload = {
          category: fd.get("category"),
          caption,
          body: fd.get("body"),
        };
        if (pendingImageDataUrl) payload.image_data_url = pendingImageDataUrl;
        await api("create_post", payload);
        resetComposerDraft();
        setStatus("Post published.");
        await load({ keepCategory: true, keepComposer: false });
      } catch (err) {
        setStatus(err.message || "Could not publish.");
      }
    });

    el.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.category = btn.getAttribute("data-cat") || "";
        await load({ keepCategory: true });
      });
    });

    el.querySelectorAll(".community-like").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        try {
          const res = await api("toggle_like", { post_id: id });
          const post = state.items.find((p) => p.id === id);
          if (post) {
            post.liked = res.liked;
            post.like_count = Math.max(0, Number(post.like_count || 0) + (res.liked ? 1 : -1));
          }
          render();
        } catch (err) {
          setStatus(err.message);
        }
      });
    });

    el.querySelectorAll(".community-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete your post?")) return;
        try {
          await api("delete_post", { id: btn.getAttribute("data-id") });
          await load({ keepCategory: true });
        } catch (err) {
          setStatus(err.message);
        }
      });
    });

    el.querySelectorAll(".community-mod-hide").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api("moderate_hide", { id: btn.getAttribute("data-id") });
          await load({ keepCategory: true });
        } catch (err) {
          setStatus(err.message);
        }
      });
    });

    el.querySelectorAll(".community-mod-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this post from the community feed?")) return;
        try {
          await api("moderate_remove", { id: btn.getAttribute("data-id") });
          await load({ keepCategory: true });
        } catch (err) {
          setStatus(err.message);
        }
      });
    });

    el.querySelectorAll(".community-report").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const reason = prompt("Why are you reporting this post?");
        if (!reason || reason.trim().length < 3) return;
        try {
          const res = await api("report_post", { post_id: btn.getAttribute("data-id"), reason });
          setStatus(res.message || "Report submitted.");
        } catch (err) {
          setStatus(err.message);
        }
      });
    });

    el.querySelectorAll(".community-build-recipe").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        state.recipeUi[id] = { busy: true, error: "", notice: "" };
        render();
        try {
          const res = await api("generate_recipe", { post_id: id });
          const post = state.items.find((p) => p.id === id);
          if (post) {
            post.recipe_draft = res.recipe_draft;
            post.recipe_status = "draft";
            if (res.item) Object.assign(post, res.item);
          }
          delete state.recipeUi[id];
          const notice =
            res.lily_source === "local_fallback"
              ? "Lily drafted a starter recipe you can edit (AI was busy)."
              : "Recipe draft ready — review and publish when you are happy.";
          setStatus(notice);
          if (typeof window.toast === "function") window.toast(notice);
          render();
        } catch (err) {
          state.recipeUi[id] = {
            busy: false,
            error: err.message || "Lily could not build a recipe.",
            notice: "",
          };
          setStatus(state.recipeUi[id].error);
          render();
        }
      });
    });

    el.querySelectorAll(".community-save-recipe").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const panel = el.querySelector(`.community-recipe-draft[data-post-id="${CSS.escape(id)}"]`);
        const draft = collectRecipeDraft(panel);
        if (!draft) {
          setStatus("Add a title and at least one stem line.");
          return;
        }
        btn.disabled = true;
        setStatus("Saving recipe draft…");
        try {
          await api("save_recipe_draft", { post_id: id, recipe_draft: draft });
          const post = state.items.find((p) => p.id === id);
          if (post) {
            post.recipe_draft = draft;
            post.recipe_status = "draft";
          }
          setStatus("Recipe draft saved.");
        } catch (err) {
          setStatus(err.message || "Could not save draft.");
        } finally {
          btn.disabled = false;
        }
      });
    });

    el.querySelectorAll(".community-publish-recipe").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const panel = el.querySelector(`.community-recipe-draft[data-post-id="${CSS.escape(id)}"]`);
        const draft = collectRecipeDraft(panel);
        if (!draft) {
          setStatus("Add a title and at least one stem line.");
          return;
        }
        if (!confirm("Publish this recipe for other florists to copy?")) return;
        btn.disabled = true;
        setStatus("Publishing recipe…");
        try {
          const res = await api("publish_recipe", { post_id: id, recipe_draft: draft });
          const post = state.items.find((p) => p.id === id);
          if (post && res.item) Object.assign(post, res.item);
          else if (post) {
            post.recipe_status = "published";
            post.published_recipe = res.published_recipe;
            post.can_build_recipe = false;
          }
          setStatus("Recipe published to Community.");
          render();
        } catch (err) {
          setStatus(err.message || "Could not publish recipe.");
          btn.disabled = false;
        }
      });
    });

    el.querySelectorAll(".community-import-recipe").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const recipeId = btn.getAttribute("data-recipe-id");
        btn.disabled = true;
        setStatus("Adding recipe to your shop…");
        try {
          const res = await api("import_recipe_to_shop", { recipe_id: recipeId });
          setStatus(res.message || "Added to Products & Recipe Builder.");
          if (typeof window.toast === "function") window.toast(res.message);
        } catch (err) {
          setStatus(err.message || "Could not import recipe.");
        } finally {
          btn.disabled = false;
        }
      });
    });

    el.querySelectorAll(".community-toggle-comments").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const box = el.querySelector(`#comments-${CSS.escape(id)}`);
        if (!box) return;
        if (!box.hidden && state.openComments === id) {
          box.hidden = true;
          state.openComments = null;
          return;
        }
        box.hidden = false;
        state.openComments = id;
        box.innerHTML = `<p class="subtle">Loading comments…</p>`;
        try {
          const res = await api("comments", { post_id: id }, "GET");
          state.comments[id] = res.items || [];
          box.innerHTML = renderComments(id, state.comments[id]);
          bindCommentForm(box, id);
        } catch (err) {
          box.innerHTML = `<p class="community-error-inline">${esc(err.message)}</p>`;
        }
      });
    });
  }

  function renderComments(postId, items) {
    const list =
      (items || [])
        .map(
          (c) => `<div class="community-comment">
          ${avatarHtml(c.author || {}, { size: "xs", alt: "" })}
          <div class="community-comment-body">
            <strong>${esc(c.author?.display_name || "Florist")}</strong>
            <span class="subtle"> · ${esc(formatWhen(c.created_at))}</span>
            <p>${esc(c.body)}</p>
            ${
              c.is_mine || c.can_moderate
                ? `<button type="button" class="secondary community-delete-comment" data-id="${esc(c.id)}">Delete</button>`
                : ""
            }
          </div>
        </div>`
        )
        .join("") || `<p class="subtle">No comments yet.</p>`;
    return `${list}
      <form class="community-comment-form" data-post="${esc(postId)}">
        <label>Add a comment<input name="body" required maxlength="1000" placeholder="Encourage or answer — no customer details"></label>
        <button type="submit" class="secondary">Comment</button>
      </form>`;
  }

  function bindCommentForm(box, postId) {
    box.querySelector(".community-comment-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api("add_comment", { post_id: postId, body: fd.get("body") });
        const res = await api("comments", { post_id: postId }, "GET");
        state.comments[postId] = res.items || [];
        const post = state.items.find((p) => p.id === postId);
        if (post) post.comment_count = state.comments[postId].length;
        box.innerHTML = renderComments(postId, state.comments[postId]);
        bindCommentForm(box, postId);
        const likeBtn = root()?.querySelector(`.community-toggle-comments[data-id="${postId}"]`);
        if (likeBtn && post) likeBtn.textContent = `💬 ${post.comment_count}`;
      } catch (err) {
        setStatus(err.message);
      }
    });
    box.querySelectorAll(".community-delete-comment").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api("delete_comment", { id: btn.getAttribute("data-id") });
          const res = await api("comments", { post_id: postId }, "GET");
          state.comments[postId] = res.items || [];
          box.innerHTML = renderComments(postId, state.comments[postId]);
          bindCommentForm(box, postId);
        } catch (err) {
          setStatus(err.message);
        }
      });
    });
  }

  async function load(opts = {}) {
    const el = root();
    if (!el) return;
    if (!opts.keepCategory) state.category = state.category || "";
    if (opts.keepComposer !== false) captureComposerDraft();
    state.loading = true;
    state.error = null;
    render();
    try {
      const fn = window.bloomCommunityApi || window.api;
      if (!fn) throw new Error("Sign in required.");
      const params = new URLSearchParams();
      if (state.category) params.set("category", state.category);
      const path = params.toString() ? `florist-community?${params}` : "florist-community";
      const data = await fn(path);
      state.profile = data.profile;
      state.guidelines = data.guidelines || [];
      state.items = data.items || [];
      state.loading = false;
      state.error = null;
      render();
    } catch (err) {
      state.loading = false;
      state.error = err.message || "Could not load Community.";
      render();
    }
  }

  window.BloomCommunity = { load };
})();
