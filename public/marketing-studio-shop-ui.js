/**
 * Marketing Studio — florist-facing panel (Phase 1C of the "Florist-Facing
 * Marketing Studio + Lily Connected Intelligence" pass).
 *
 * Talks to netlify/functions/marketing-studio-shop.js — the real,
 * session-scoped entry point (Phase 1A/1B/1D), never the super_admin-only
 * marketing-studio endpoint or admin.html's own panel. This file is
 * deliberately a small, purpose-built subset of marketing-studio-admin.js:
 * it only ever calls the exact 11 actions that entry point allowlists
 * (status/get_brand_brain/get_visual_style/connections/usage_summary/
 * list_content/create_content_item/generate_content/revise_content/
 * revert_content_revision/approve_content) — no manual shop-ID entry field,
 * no platform-connect/publish/schedule/budget-config UI, because a florist
 * can't reach those actions here at all. The florist's shop is resolved
 * entirely server-side from their session (Phase 1A) — this file never
 * constructs or forwards that identifier itself.
 *
 * Every response is rendered as-is, including "NOT LIVE — PROVIDER
 * CONNECTION REQUIRED" notes — this file never invents a success state
 * the backend didn't actually report.
 */
(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const PLATFORMS = ["facebook", "instagram", "tiktok", "linkedin", "pinterest", "google_business", "youtube"];
  const PLATFORM_LABELS = {
    facebook: "Facebook",
    instagram: "Instagram",
    tiktok: "TikTok",
    linkedin: "LinkedIn",
    pinterest: "Pinterest",
    google_business: "Google Business",
    youtube: "YouTube"
  };
  const STATUS_LABELS = {
    idea: "Idea",
    generating: "Generating…",
    draft: "Draft — ready for your review",
    in_review: "In review",
    approved: "Approved",
    archived: "Rejected"
  };

  // Honest readiness (hardening pass): "Draft — ready for your review" is a
  // real claim — it must never show while a flyer's render/upload hasn't
  // actually finished, failed, or the saved file turned out to be missing.
  // A flyer's content-item `status` flips to "draft" the moment
  // generate_content succeeds server-side — BEFORE the browser has drawn or
  // uploaded anything — so the plain STATUS_LABELS lookup alone would lie
  // here. This is the one place that decides what the eyebrow actually says.
  function effectiveStatusLabel(item) {
    const asset = item.asset;
    if (asset?.asset_type === "flyer" && item.status === "draft") {
      if (state.flyerRenderFailed[item.id]) return "Couldn't prepare flyer";
      if (asset.content?.render_status !== "rendered") return "Preparing your flyer…";
    }
    return STATUS_LABELS[item.status] || item.status;
  }

  let state = { loading: true, error: null, items: [], status: null, brand: null, style: null, usage: null, busyId: null, revisingId: null, flyerRenderFailed: {} };

  function root() {
    return document.getElementById("marketingStudioRoot");
  }

  function toast(msg) {
    window.toast?.(msg);
  }

  async function studioApi(action, extra = {}) {
    const fn = window.bloomMarketingStudioApi || window.api;
    if (!fn) throw new Error("Sign in required.");
    const method = extra.method || "POST";
    const path = `marketing-studio-shop?action=${encodeURIComponent(action)}`;
    if (method === "GET") return fn(path, { method: "GET" });
    return fn(path, { method: "POST", body: JSON.stringify({ action, ...extra.body }) });
  }

  // Phase 14 ("Explainability"): the backend already computes and persists
  // exactly which real inventory rows and which learned Brand Brain/My
  // Style traits shaped this content (grounded_in_inventory/
  // brand_traits_used/visual_traits_used on the asset) — it just never
  // reached this screen before, so a florist reviewing a draft had no way
  // to see WHY Lily wrote what she wrote. Only ever renders what the
  // backend actually reported using; an item grounded in nothing shows no
  // note at all, never a fabricated one.
  function groundingHtml(c) {
    const parts = [];
    const inv = Array.isArray(c.grounded_in_inventory) ? c.grounded_in_inventory : [];
    if (inv.length) {
      parts.push(`real inventory (${inv.map((i) => esc(i.name)).join(", ")})`);
    }
    const traits = [...(Array.isArray(c.brand_traits_used) ? c.brand_traits_used : []), ...(Array.isArray(c.visual_traits_used) ? c.visual_traits_used : [])];
    if (traits.length) {
      parts.push(`your learned style (${traits.map((t) => esc(t.text)).join(", ")})`);
    }
    if (!parts.length) return "";
    return `<p class="subtle marketing-studio-grounding">Grounded in: ${parts.join(" · ")}</p>`;
  }

  // A flyer asset's on-image headline/body/cta is a SEPARATE piece of text
  // from its Facebook caption (c.caption) — same separation an "image"
  // asset already has between its picture and its caption. The exact
  // on-image wording is never re-typed here; it's read straight back from
  // what the server persisted and handed to the deterministic renderer
  // as-is (mountFlyerPreview below), the same "never invent a success
  // state" discipline this file's own docstring already commits to.
  function itemPreviewHtml(item) {
    const asset = item.asset;
    if (!asset || !asset.content) return "";
    const c = asset.content;
    const imgUrl = asset.asset_type === "image" ? c.url : null;
    const isFlyer = asset.asset_type === "flyer";
    // A flyer that already has a durable, persisted url (finalize_flyer_render
    // already uploaded it — this device's own prior render, or a different
    // device/browser entirely) shows that real file directly. This is what
    // makes the flyer look identical from a second device: the second
    // device is showing the SAME uploaded file, not re-drawing its own
    // canvas and hoping it matches. Only a flyer with no url yet (fresh
    // generation, or a revision that changed the on-image wording) needs
    // mountFlyerPreview to render+finalize one.
    const flyerReady = isFlyer && c.render_status === "rendered" && Boolean(c.url);
    const captionText = c.caption || c.body || c.script || c.concept || "";
    return `
      ${imgUrl ? `<img src="${esc(imgUrl)}" alt="" class="lily-job-image" loading="lazy">` : ""}
      ${flyerReady ? `<img src="${esc(c.url)}" alt="" class="lily-job-image" loading="lazy" id="msFlyerImg-${esc(item.id)}">` : ""}
      ${isFlyer && !flyerReady ? `<img alt="" class="lily-job-image" id="msFlyerImg-${esc(item.id)}"><p class="subtle" id="msFlyerNote-${esc(item.id)}">Preparing your flyer…</p>` : ""}
      ${captionText ? `<p>${esc(captionText)}</p>` : ""}
      ${Array.isArray(c.hashtags) && c.hashtags.length ? `<p class="subtle">${c.hashtags.map((h) => `#${esc(String(h).replace(/^#/, ""))}`).join(" ")}</p>` : ""}
      ${groundingHtml(c)}
    `;
  }

  // Requirement 6 (live defect fix): a flyer must never read as
  // "ready for your review" while its deterministic text layer hasn't
  // actually rendered successfully — the whole point is that a florist
  // never sees an uncontrolled/garbled image standing in for the real
  // message. Rendering itself is 100% deterministic canvas drawing of
  // Florisyn's own exact content (see public/flyer-renderer.js) — the
  // only realistic failure mode is the renderer script or canvas support
  // being unavailable, not "the wrong text got drawn." On that rare
  // failure, Approve is disabled directly (no full re-render — this must
  // never loop back into re-attempting the same failing render).
  // Requirement 7 (hardening pass): a real Retry action, not just a
  // "try Generate again" apology — this is a pure re-attempt of the
  // deterministic render + finalize, no AI call, no cost, and it never
  // touches the last valid revision (nothing here writes anything until a
  // NEW attempt actually succeeds).
  function retryFlyerRender(id) {
    delete state.flyerRenderFailed[id];
    render();
  }

  // Injects the Retry button directly into a card's actions without a full
  // list re-render — a full render() would regenerate itemPreviewHtml,
  // which for an already-"rendered" (but now broken) flyer would recreate
  // the SAME broken <img src> and re-trigger the same failure in a loop.
  // Direct DOM insertion here, exactly like the rest of a failure's visual
  // state, sidesteps that entirely.
  function showFlyerRetryButton(id) {
    const card = document.querySelector(`[data-ms-item="${id}"]`);
    const actions = card?.querySelector(".card-actions");
    if (!actions || actions.querySelector('[data-ms-act="retry-flyer"]')) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary";
    btn.setAttribute("data-ms-act", "retry-flyer");
    btn.textContent = "Retry";
    btn.addEventListener("click", () => retryFlyerRender(id));
    actions.insertBefore(btn, actions.firstChild);
  }

  async function mountFlyerPreview(item) {
    const imgEl = document.getElementById(`msFlyerImg-${item.id}`);
    const noteEl = document.getElementById(`msFlyerNote-${item.id}`);
    const c = item.asset?.content;
    if (!imgEl || !c) return;
    const fail = (message) => {
      imgEl.remove();
      if (noteEl) noteEl.textContent = message;
      const card = document.querySelector(`[data-ms-item="${item.id}"]`);
      const approveBtn = card?.querySelector('[data-ms-act="approve"]');
      if (approveBtn) {
        approveBtn.disabled = true;
        approveBtn.title = "This flyer couldn't be prepared yet — it isn't ready for review.";
      }
      // Failure never marks anything completed and never touches whatever
      // content.render_status/url the asset already had (nothing here
      // writes to the server) — the last successfully finalized revision,
      // if any, stays exactly as it was.
      state.flyerRenderFailed[item.id] = true;
      renderEyebrow(item.id);
      showFlyerRetryButton(item.id);
    };
    try {
      if (!window.FlorisynFlyerRenderer) throw new Error("renderer unavailable");
      const canvas = await window.FlorisynFlyerRenderer.renderFlyer({
        template: { regions: c.regions, palette: c.palette },
        content: { headline: c.headline, body: c.body, cta: c.cta },
        style: c.style,
        brand: c.brand || {},
        backgroundUrl: c.background_url,
        width: c.canvas?.width || 1080,
        height: c.canvas?.height || 1080
      });
      const dataUrl = canvas.toDataURL("image/png", 0.92);
      // Requirement 6 still applies at the persistence layer, not just the
      // draw step: a client-side canvas rendering successfully is NOT
      // "ready for your review" on its own (that's exactly the gap a real
      // durability review caught) — finalize_flyer_render has to actually
      // upload these bytes through the server's real storage pipeline and
      // hand back a real, retrievable URL before Approve may be used.
      // asset_id names EXACTLY the revision this render is for — the
      // server refuses to apply a stale render to a since-revised item.
      const saved = await studioApi("finalize_flyer_render", { body: { content_item_id: item.id, asset_id: item.asset.id, data_url: dataUrl } });
      if (!saved?.asset?.url) throw new Error("finalize_flyer_render returned no url");
      item.asset.content = saved.asset.content;
      imgEl.src = saved.asset.url;
      noteEl?.remove();
      delete state.flyerRenderFailed[item.id];
      renderEyebrow(item.id);
      const card = document.querySelector(`[data-ms-item="${item.id}"]`);
      const approveBtn = card?.querySelector('[data-ms-act="approve"]');
      if (approveBtn) {
        approveBtn.disabled = false;
        approveBtn.title = "";
      }
    } catch {
      fail("Couldn't prepare this flyer — try Generate again.");
    }
  }

  // Requirement 6: even the eyebrow status label must flip the instant
  // preparation finishes or fails — not just the image/note underneath —
  // without forcing a full list re-render (which would also re-trigger
  // mountFlyerPreviews and could loop).
  function renderEyebrow(id) {
    const item = state.items.find((i) => i.id === id);
    const eyebrowEl = document.querySelector(`[data-ms-item="${id}"] .eyebrow`);
    if (item && eyebrowEl) eyebrowEl.textContent = effectiveStatusLabel(item);
  }

  function mountFlyerPreviews() {
    for (const item of state.items) {
      // A flyer already marked "rendered" (this device's own earlier
      // finalize, or a different device entirely) is already shown
      // directly by itemPreviewHtml — nothing to render or upload again.
      // A flyer the florist already saw fail this session is left alone
      // too — Retry (a deliberate action) is what re-attempts it, never an
      // automatic loop back into the same failure.
      if (item.asset?.asset_type === "flyer" && item.asset?.content?.render_status !== "rendered" && !state.flyerRenderFailed[item.id]) {
        mountFlyerPreview(item);
      }
    }
  }

  // Requirement 6 (missing-file case): a flyer whose content.url the
  // server reports as finalized is shown directly (mountFlyerPreview is
  // skipped for it) — but if that file has since gone missing from
  // storage, the browser's own <img> error event is real, first-hand proof
  // of that, and must be treated exactly like a render failure: never a
  // silently broken image sitting next to an enabled Approve button.
  function wireFlyerImageFallbacks() {
    for (const item of state.items) {
      if (item.asset?.asset_type !== "flyer" || item.asset?.content?.render_status !== "rendered") continue;
      const imgEl = document.getElementById(`msFlyerImg-${item.id}`);
      if (!imgEl || imgEl.dataset.fallbackWired) continue;
      imgEl.dataset.fallbackWired = "1";
      imgEl.addEventListener("error", () => {
        imgEl.remove();
        const card = document.querySelector(`[data-ms-item="${item.id}"]`);
        const noteEl = document.createElement("p");
        noteEl.className = "subtle";
        noteEl.id = `msFlyerNote-${item.id}`;
        noteEl.textContent = "This flyer's saved file is missing — try Retry.";
        card?.querySelector(".panel-heading")?.insertAdjacentElement("afterend", noteEl);
        const approveBtn = card?.querySelector('[data-ms-act="approve"]');
        if (approveBtn) {
          approveBtn.disabled = true;
          approveBtn.title = "This flyer's saved file is missing — it isn't ready for review.";
        }
        // The stored render_status still claims "rendered" — that's exactly
        // what's wrong (the DB says done, the file is gone). Clearing it
        // locally is what makes Retry actually re-render + re-finalize
        // instead of just retrying a broken <img> load: the next render()
        // call sees a not-"rendered" flyer and mountFlyerPreviews picks it
        // up again through the normal path.
        if (item.asset?.content) item.asset.content.render_status = null;
        state.flyerRenderFailed[item.id] = true;
        renderEyebrow(item.id);
        showFlyerRetryButton(item.id);
      });
    }
  }

  // A normal revision is just a sentence — "make it shorter," "less pink,"
  // "change the image" — never a request to save anything. Style only
  // becomes permanent when the florist's own words say so ("use this style
  // from now on," "remember this," "always do this") — revise_content
  // itself is what decides that (detectPersistIntent), purely from the
  // instruction's own wording; this composer never adds a separate
  // "save as my style" control, so persistence stays exactly as explicit
  // as the conversation the florist actually typed.
  function revisionComposerHtml(item) {
    const busy = state.busyId === item.id;
    return `<div class="panel marketing-revision-box" id="msRevisionBox-${esc(item.id)}" style="margin:0.75em 0;">
      <label>Tell Lily what to change
        <textarea id="msRevisionInput-${esc(item.id)}" rows="2" maxlength="2000" placeholder="e.g. &quot;make it shorter&quot;, &quot;use less pink&quot;, &quot;change the image&quot;, &quot;make it clear we're only closing early today&quot;"></textarea>
      </label>
      <div class="card-actions">
        <button type="button" class="primary" data-ms-act="revise-send" ${busy ? "disabled" : ""}>${busy ? "Working…" : "Send to Lily"}</button>
        <button type="button" class="secondary" data-ms-act="revise-cancel" ${busy ? "disabled" : ""}>Cancel</button>
      </div>
    </div>`;
  }

  function itemHtml(item) {
    const busy = state.busyId === item.id;
    const canGenerate = item.status === "idea";
    const canReview = item.status === "draft" || item.status === "in_review";
    const canUndo = canReview && Boolean(item.asset?.parent_asset_id);
    const revising = canReview && state.revisingId === item.id;
    const platforms = (item.variants || []).map((v) => PLATFORM_LABELS[v.platform] || v.platform).join(", ");
    // Requirement 7 (hardening pass): Approve is disabled by DEFAULT for
    // any flyer that isn't render_status "rendered" yet — covers
    // "preparing," "failed," and "missing" the instant the card first
    // paints, not only after mountFlyerPreview's async work happens to
    // catch a failure. mountFlyerPreview/wireFlyerImageFallbacks explicitly
    // re-enable it the moment a real, finalized render is confirmed.
    const flyerNotReady = item.asset?.asset_type === "flyer" && item.asset?.content?.render_status !== "rendered";
    // A one-click alternative to typing "change the image" into the
    // composer — the common case of "I like the wording, just try a
    // different picture" shouldn't require typing anything. Only offered
    // for flyers (the only asset type with a separate AI-generated
    // background layer to re-roll); a plain image post's own revision
    // composer already regenerates the image on any instruction.
    const canRegenerateImage = canReview && !revising && item.asset?.asset_type === "flyer";
    return `<article class="panel" data-ms-item="${esc(item.id)}">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">${esc(effectiveStatusLabel(item))}</p>
          <h3>${esc(item.title)}</h3>
          ${platforms ? `<p class="subtle">${esc(platforms)}</p>` : ""}
        </div>
      </div>
      <p class="subtle">${esc(item.brief)}</p>
      ${itemPreviewHtml(item)}
      ${revising ? revisionComposerHtml(item) : ""}
      <div class="card-actions">
        ${canGenerate ? `<button type="button" class="primary" data-ms-act="generate" ${busy ? "disabled" : ""}>${busy ? "Working…" : "Ask Lily to create it"}</button>` : ""}
        ${state.flyerRenderFailed[item.id] ? `<button type="button" class="secondary" data-ms-act="retry-flyer" ${busy ? "disabled" : ""}>Retry</button>` : ""}
        ${canReview && !revising ? `<button type="button" class="secondary" data-ms-act="revise" ${busy ? "disabled" : ""}>Ask Lily to change something</button>` : ""}
        ${canRegenerateImage ? `<button type="button" class="secondary" data-ms-act="regenerate-image" ${busy ? "disabled" : ""}>Regenerate image</button>` : ""}
        ${canUndo ? `<button type="button" class="secondary" data-ms-act="revert" ${busy ? "disabled" : ""}>Undo last change</button>` : ""}
        ${canReview ? `<button type="button" class="primary" data-ms-act="approve" ${busy || flyerNotReady ? "disabled" : ""}>Approve</button>` : ""}
        ${canReview ? `<button type="button" class="secondary" data-ms-act="reject" ${busy ? "disabled" : ""}>Reject</button>` : ""}
      </div>
    </article>`;
  }

  function createFormHtml() {
    return `<form id="msCreateItemForm" class="panel">
      <p class="eyebrow">NEW POST</p>
      <h3>Tell Lily what to make</h3>
      <p class="subtle">Describe the arrangement or offer — Lily writes the caption and creates the image from your own brief. Nothing goes out until you approve it.</p>
      <label>What should this post be about?<textarea name="brief" required maxlength="2000" placeholder="e.g. I have 40 roses I need to sell — a bright, romantic bouquet post for Facebook"></textarea></label>
      <fieldset class="marketing-channel-fieldset">
        <legend>Where should this go?</legend>
        ${PLATFORMS.map((p, i) => `<label class="check"><input type="checkbox" name="platforms" value="${p}" ${i === 0 ? "checked" : ""}> ${esc(PLATFORM_LABELS[p])}</label>`).join("")}
      </fieldset>
      <div class="card-actions"><button type="submit" class="primary">Create draft</button></div>
    </form>`;
  }

  function statusNoteHtml() {
    if (!state.status) return "";
    return `<div class="panel" role="status"><p class="subtle">${esc(state.status.note || "")}</p></div>`;
  }

  function knownStyleHtml() {
    const brandSummary = state.brand?.summary;
    const styleSummary = state.style?.summary;
    if (!brandSummary && !styleSummary) return "";
    return `<div class="panel">
      <p class="eyebrow">WHAT LILY KNOWS ABOUT YOUR SHOP</p>
      ${brandSummary ? `<p class="subtle"><strong>Voice:</strong> ${esc(brandSummary)}</p>` : ""}
      ${styleSummary ? `<p class="subtle"><strong>Style:</strong> ${esc(styleSummary)}</p>` : ""}
    </div>`;
  }

  function budgetHtml() {
    const u = state.usage;
    if (!u || u.monthly_budget_cap_cents == null) return "";
    const cap = (u.monthly_budget_cap_cents / 100).toFixed(2);
    const remaining = u.monthly_remaining_cents != null ? (u.monthly_remaining_cents / 100).toFixed(2) : null;
    return `<div class="panel"><p class="eyebrow">MONTHLY AI BUDGET</p><p>$${remaining ?? "—"} remaining of a $${cap} monthly cap.</p></div>`;
  }

  function render() {
    const el = root();
    if (!el) return;
    if (state.loading) {
      el.innerHTML = `<div class="panel" role="status"><p class="subtle">Loading Marketing Studio…</p></div>`;
      return;
    }
    if (state.error) {
      el.innerHTML = `<div class="panel" role="alert"><h3>Something went wrong</h3><p class="subtle">${esc(state.error)}</p><button type="button" class="primary" id="msRetry">Try again</button></div>`;
      el.querySelector("#msRetry")?.addEventListener("click", () => load());
      return;
    }
    const list =
      state.items.length === 0
        ? `<div class="panel"><h3>No posts yet</h3><p class="subtle">Tell Lily what's in your shop and she'll draft the first one below.</p></div>`
        : state.items.map(itemHtml).join("");
    el.innerHTML = `${statusNoteHtml()}${knownStyleHtml()}${budgetHtml()}${createFormHtml()}<div class="cards">${list}</div>`;
    bind(el);
    mountFlyerPreviews();
    wireFlyerImageFallbacks();
  }

  function bind(el) {
    el.querySelector("#msCreateItemForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      if (form.dataset.submitting === "1") return;
      form.dataset.submitting = "1";
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const fd = new FormData(form);
        const brief = String(fd.get("brief") || "").trim();
        const platforms = fd.getAll("platforms");
        if (!brief) {
          toast("Describe what you'd like Lily to create.");
          return;
        }
        const created = await studioApi("create_content_item", { body: { brief, platforms } });
        const newItemId = created?.item?.id;
        // Requirement: type one message, get back one finished draft — no
        // second click to "start" generation. Chains straight into
        // generate_content using the id the server just handed back.
        // Never loses the request if this second call fails: the item
        // still exists in "idea" status, and its own "Ask Lily to create
        // it" button is the exact same fallback path this used to require
        // as a manual first step.
        if (newItemId) {
          try {
            toast("Lily is creating your draft…");
            await studioApi("generate_content", { body: { content_item_id: newItemId } });
            toast("Draft ready for your review.");
          } catch (genErr) {
            toast(genErr.message || "Draft created — click \"Ask Lily to create it\" below to finish it.");
          }
        } else {
          toast("Draft created.");
        }
        form.reset();
        await load();
      } catch (err) {
        toast(err.message || "Could not create that post.");
      } finally {
        form.dataset.submitting = "";
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    el.querySelectorAll("[data-ms-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-ms-item]")?.getAttribute("data-ms-item");
        const act = btn.getAttribute("data-ms-act");
        if (!id || state.busyId) return;
        try {
          if (act === "generate") {
            state.busyId = id;
            render();
            await studioApi("generate_content", { body: { content_item_id: id } });
          } else if (act === "retry-flyer") {
            retryFlyerRender(id);
            return;
          } else if (act === "revise") {
            // Opens the real inline composer (textarea + Send to Lily) —
            // never calls the API yet, and never assumes any persistence
            // intent just from opening it.
            state.revisingId = id;
            render();
            return;
          } else if (act === "revise-cancel") {
            state.revisingId = null;
            render();
            return;
          } else if (act === "revise-send") {
            const input = document.getElementById(`msRevisionInput-${id}`);
            const instruction = (input?.value || "").trim();
            if (!instruction) {
              toast("Tell Lily what to change first.");
              return;
            }
            state.busyId = id;
            state.revisingId = null;
            render();
            await studioApi("revise_content", { body: { content_item_id: id, instruction } });
          } else if (act === "regenerate-image") {
            // One click, no typing — sends the SAME kind of plain-language
            // instruction the composer's own "change the image" example
            // teaches, through the exact same revise_content pipeline.
            // Never a raw provider prompt, never a separate code path.
            state.busyId = id;
            render();
            await studioApi("revise_content", {
              body: { content_item_id: id, instruction: "Regenerate the background image — keep the exact same wording." }
            });
          } else if (act === "revert") {
            if (!confirm("Undo the last change and go back to the previous version?")) return;
            state.busyId = id;
            render();
            await studioApi("revert_content_revision", { body: { content_item_id: id } });
          } else if (act === "approve") {
            if (state.flyerRenderFailed[id]) {
              toast("This flyer couldn't be prepared yet — try Generate again before approving.");
              return;
            }
            if (!confirm("Approve this post? Publishing itself still requires a connected platform.")) return;
            state.busyId = id;
            render();
            await studioApi("approve_content", { body: { content_item_id: id, decision: "approved" } });
          } else if (act === "reject") {
            if (!confirm("Reject this post?")) return;
            state.busyId = id;
            render();
            await studioApi("approve_content", { body: { content_item_id: id, decision: "rejected" } });
          }
          await load();
        } catch (err) {
          toast(err.message || "That didn't work.");
          state.busyId = null;
          render();
        }
      });
    });
  }

  async function load() {
    const el = root();
    if (!el) return;
    state.loading = true;
    state.error = null;
    state.busyId = null;
    state.revisingId = null;
    state.flyerRenderFailed = {};
    render();
    try {
      const [status, brand, style, usage, content] = await Promise.all([
        studioApi("status", { method: "GET" }),
        studioApi("get_brand_brain", { method: "GET" }).catch(() => null),
        studioApi("get_visual_style", { method: "GET" }).catch(() => null),
        studioApi("usage_summary", { method: "GET" }).catch(() => null),
        studioApi("list_content", { method: "GET" })
      ]);
      state.status = status;
      state.brand = brand;
      state.style = style;
      state.usage = usage;
      state.items = content.items || [];
      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      state.error = err.message || "Could not load Marketing Studio.";
      render();
    }
  }

  window.BloomMarketingStudio = { load };
})();
