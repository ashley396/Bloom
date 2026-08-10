(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  async function netApi(action, extra = {}, method = "POST") {
    const fn = window.api;
    if (!fn) throw new Error("Sign in required.");
    if (method === "GET") return fn(`florist-network?action=${encodeURIComponent(action)}${extra.qs || ""}`);
    return fn("florist-network", { method, body: JSON.stringify({ action, ...extra }) });
  }

  function wireCard(row, view) {
    const actions =
      view === "inbox" && row.status === "sent"
        ? `<button type="button" class="primary" data-wire-id="${esc(row.id)}" data-wire-status="accepted">Accept</button>
           <button type="button" class="secondary" data-wire-id="${esc(row.id)}" data-wire-status="declined">Decline</button>`
        : view === "inbox" && row.status === "accepted"
          ? `<button type="button" class="secondary" data-wire-id="${esc(row.id)}" data-wire-status="in_production">Start production</button>`
          : view === "inbox" && row.status === "in_production"
            ? `<button type="button" class="secondary" data-wire-id="${esc(row.id)}" data-wire-status="out_for_delivery">Out for delivery</button>`
            : view === "inbox" && row.status === "out_for_delivery"
              ? `<button type="button" class="primary" data-wire-id="${esc(row.id)}" data-wire-status="delivered">Mark delivered</button>`
              : "";
    return `<article class="panel wire-card">
      <div class="panel-heading"><div><p class="eyebrow">${esc(row.wire_number)}</p><h3>${esc(row.recipient_name)}</h3>
      <p class="subtle">${esc(row.delivery_date)} · ${esc(row.status_label || row.status)}</p></div>
      <strong>$${Number(row.wire_amount || 0).toFixed(2)}</strong>${row.metadata?.florisyn_platform_fee === 0 || row.metadata?.florisyn_platform_fee == null ? `<small class="subtle"> · 100% to partner</small>` : ""}</div>
      <p>${esc(row.product_description)}</p>
      <p class="subtle">${esc(row.delivery_address)}</p>
      ${row.card_message ? `<p class="subtle"><em>${esc(row.card_message)}</em></p>` : ""}
      <div class="card-actions">${actions}</div>
    </article>`;
  }

  async function load(root = document.getElementById("floristNetworkRoot")) {
    if (!root) return;
    root.innerHTML = `<p class="subtle">Loading Florist Network…</p>`;
    try {
      const [inbox, outbox, partners, profile] = await Promise.all([
        netApi("inbox", {}, "GET"),
        netApi("outbox", {}, "GET"),
        netApi("partners", {}, "GET"),
        netApi("profile", {}, "GET")
      ]);
      const partnerOptions = (partners.items || [])
        .map((p) => `<option value="${esc(p.shop_id)}">${esc(p.display_name)} — ${esc(p.city || "")} ${esc(p.state || "")}</option>`)
        .join("");
      root.innerHTML = `<div class="fn-layout">
        <article class="panel">
          <p class="eyebrow">FLORISYN FLORIST NETWORK</p>
          <h2>Florist-to-florist wires</h2>
          <p class="subtle">Send overflow orders to trusted partner shops. <strong>Florisyn charges $0 on wires</strong> — your partner florist receives 100% of the wire amount you send.</p>
          <p class="subtle fn-zero-fee-banner">No Florisyn cut · No legacy wire-network fees · You and your partner keep the sale</p>
          <form id="wireForm" class="form-grid two">
            <label class="wide">Fulfilling florist<select name="fulfilling_shop_id" required>${partnerOptions || '<option value="">Join the network to see partners</option>'}</select></label>
            <label>Recipient<input name="recipient_name" required></label>
            <label>Phone<input name="recipient_phone"></label>
            <label class="wide">Delivery address<input name="delivery_address" required></label>
            <label>Delivery date<input name="delivery_date" type="date" required></label>
            <label>Wire amount ($)<input name="wire_amount" type="number" min="1" step="0.01" required></label>
            <label class="wide">Arrangement description<textarea name="product_description" rows="2" required></textarea></label>
            <label class="wide">Card message<textarea name="card_message" rows="2"></textarea></label>
            <div class="card-actions wide"><button type="submit" class="primary">Send wire order</button></div>
          </form>
        </article>
        <div class="two">
          <div><h3>Incoming wires</h3>${(inbox.items || []).map((r) => wireCard(r, "inbox")).join("") || "<p class='subtle'>No incoming wires.</p>"}</div>
          <div><h3>Sent wires</h3>${(outbox.items || []).map((r) => wireCard(r, "outbox")).join("") || "<p class='subtle'>No sent wires yet.</p>"}</div>
        </div>
        <article class="panel">
          <h3>Your network profile</h3>
          <p class="subtle">${profile.profile ? `${esc(profile.profile.display_name)} · ${profile.profile.accepts_incoming_wires ? "Accepting wires" : "Not accepting"}` : "Create your profile so other florists can wire orders to you."}</p>
          <button type="button" class="secondary" id="fnActivateProfile">${profile.profile ? "Update profile" : "Join Florist Network"}</button>
        </article>
      </div>`;

      root.querySelector("#wireForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await netApi("send-wire", { ...Object.fromEntries(fd.entries()), send: true });
          window.toast?.("Wire order sent");
          load(root);
        } catch (err) {
          window.toast?.(err.message);
        }
      });

      root.querySelector("#fnActivateProfile")?.addEventListener("click", async () => {
        try {
          await netApi("save-profile", { is_active: true, accepts_incoming_wires: true });
          window.toast?.("Florist Network profile saved");
          load(root);
        } catch (err) {
          window.toast?.(err.message);
        }
      });

      root.querySelectorAll("[data-wire-status]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await netApi("transition", { id: btn.dataset.wireId, status: btn.dataset.wireStatus });
            window.toast?.("Wire updated");
            load(root);
          } catch (err) {
            window.toast?.(err.message);
          }
        });
      });
    } catch (e) {
      root.innerHTML = `<p class="subtle">${esc(e.message)}</p>`;
    }
  }

  window.BloomFloristNetwork = { load };
})();
