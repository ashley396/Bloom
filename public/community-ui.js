(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const CATEGORIES = ["Design Help", "Business Advice", "Questions", "Celebrations"];
  let state = {
    loading: false,
    error: null,
    items: [],
    profile: null,
    guidelines: [],
    category: "",
    comments: {},
    openComments: null,
  };
  let pendingImageDataUrl = null;

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

  function renderEmpty() {
    return `<div class="community-state community-empty">
      <h3>No posts yet</h3>
      <p>Be the first florist to share a design tip, business question, or celebration.</p>
    </div>`;
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
    return `<form id="communityProfileForm" class="community-profile panel">
      <div class="community-profile-head">
        <div>
          <p class="eyebrow">YOUR FLORIST PROFILE</p>
          <h3>How other florists see you</h3>
          <p class="subtle">Never include customer or order details in your bio.</p>
        </div>
      </div>
      <div class="two">
        <label>Display name<input name="display_name" required maxlength="80" value="${esc(p.display_name || "")}"></label>
        <label>Shop name<input name="shop_display_name" required maxlength="120" value="${esc(p.shop_display_name || "")}"></label>
      </div>
      <div class="two">
        <label>City<input name="city" maxlength="80" value="${esc(p.city || "")}"></label>
        <label>Region / state<input name="region" maxlength="80" value="${esc(p.region || "")}"></label>
      </div>
      <label>Short bio<textarea name="bio" maxlength="500" rows="2" placeholder="Specialty, years in business, what you love designing…">${esc(p.bio || "")}</textarea></label>
      <div class="card-actions">
        <button type="submit" class="secondary">Save profile</button>
      </div>
    </form>`;
  }

  function composerHtml() {
    const opts = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    return `<form id="communityComposer" class="community-composer panel">
      <p class="eyebrow">SHARE WITH FLORISTS</p>
      <h3>Create a post</h3>
      <label>Category<select name="category" required>${opts}</select></label>
      <label>Caption<input name="caption" required maxlength="280" placeholder="What are you sharing?"></label>
      <label>Details (optional)<textarea name="body" maxlength="4000" rows="3" placeholder="Tips, questions, or celebration notes — no customer info."></textarea></label>
      <label>Arrangement photo (optional, max 2 MB)
        <input type="file" id="communityImageInput" accept="image/jpeg,image/png,image/webp">
      </label>
      <img id="communityImagePreview" class="community-image-preview" alt="" hidden>
      <div class="card-actions">
        <button type="submit" class="primary">Post to Community</button>
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

  function postCard(post) {
    const author = post.author || {};
    const img = post.image_url
      ? `<img class="community-post-image" src="${esc(post.image_url)}" alt="Arrangement shared by ${esc(author.display_name || "florist")}" loading="lazy">`
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
        <div>
          <strong>${esc(author.display_name || "Florist")}</strong>
          <span class="subtle"> · ${esc(author.shop_display_name || "")}${author.city ? ` · ${esc(author.city)}` : ""}</span>
          <p class="community-category">${esc(post.category)}</p>
        </div>
        <time class="subtle" datetime="${esc(post.created_at || "")}">${esc(formatWhen(post.created_at))}</time>
      </header>
      <h3 class="community-caption">${esc(post.caption)}</h3>
      ${post.body ? `<p class="community-body">${esc(post.body)}</p>` : ""}
      ${img}
      <div class="community-actions">
        <button type="button" class="secondary community-like${post.liked ? " liked" : ""}" data-id="${esc(post.id)}" aria-pressed="${post.liked ? "true" : "false"}">
          ${post.liked ? "Encouraged" : "Encourage"} · ${Number(post.like_count || 0)}
        </button>
        <button type="button" class="secondary community-toggle-comments" data-id="${esc(post.id)}">
          Comments · ${Number(post.comment_count || 0)}
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
      renderLoading(el);
      return;
    }
    if (state.error) {
      renderError(el, state.error);
      return;
    }
    const feed =
      state.items.length === 0
        ? renderEmpty()
        : `<div class="community-feed">${state.items.map(postCard).join("")}</div>`;

    el.innerHTML = `<div class="community-shell">
      <div class="community-hero">
        <p class="eyebrow">FLORIST COMMUNITY <span class="community-beta-pill">Beta</span></p>
        <h2>Learn and celebrate with fellow florists</h2>
        <p class="subtle">Share design help, business advice, questions, and celebrations. No customer or order data — ever.</p>
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

  function bind() {
    const el = root();
    if (!el) return;

    el.querySelector("#communityProfileForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      setStatus("Saving profile…");
      try {
        const res = await api("save_profile", {
          display_name: fd.get("display_name"),
          shop_display_name: fd.get("shop_display_name"),
          city: fd.get("city"),
          region: fd.get("region"),
          bio: fd.get("bio"),
        });
        state.profile = res.profile;
        setStatus("Profile saved.");
      } catch (err) {
        setStatus(err.message || "Could not save profile.");
      }
    });

    el.querySelector("#communityImageInput")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      pendingImageDataUrl = null;
      const preview = el.querySelector("#communityImagePreview");
      if (!file) {
        if (preview) preview.hidden = true;
        return;
      }
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
        pendingImageDataUrl = reader.result;
        if (preview) {
          preview.src = pendingImageDataUrl;
          preview.hidden = false;
        }
      };
      reader.readAsDataURL(file);
    });

    el.querySelector("#communityComposer")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      setStatus("Publishing…");
      try {
        const payload = {
          category: fd.get("category"),
          caption: fd.get("caption"),
          body: fd.get("body"),
        };
        if (pendingImageDataUrl) payload.image_data_url = pendingImageDataUrl;
        await api("create_post", payload);
        pendingImageDataUrl = null;
        setStatus("Post published.");
        await load({ keepCategory: true });
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
          <strong>${esc(c.author?.display_name || "Florist")}</strong>
          <span class="subtle"> · ${esc(formatWhen(c.created_at))}</span>
          <p>${esc(c.body)}</p>
          ${
            c.is_mine || c.can_moderate
              ? `<button type="button" class="secondary community-delete-comment" data-id="${esc(c.id)}">Delete</button>`
              : ""
          }
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
        if (likeBtn && post) likeBtn.textContent = `Comments · ${post.comment_count}`;
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
    state.loading = true;
    state.error = null;
    render();
    try {
      const qs = { action: "feed" };
      if (state.category) qs.category = state.category;
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
