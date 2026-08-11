(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const DEFAULT_RELAY = 20;

  async function netApi(action, extra = {}, method = "POST") {
    const fn = window.api;
    if (!fn) throw new Error("Sign in required.");
    if (method === "GET") return fn(`florist-network?action=${encodeURIComponent(action)}${extra.qs || ""}`);
    return fn("florist-network", { method, body: JSON.stringify({ action, ...extra }) });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read photo file."));
      reader.readAsDataURL(file);
    });
  }

  function splitPreview(amount, relayPercent) {
    const total = Math.max(0, Number(amount || 0));
    const pct = Math.min(100, Math.max(0, Number(relayPercent ?? DEFAULT_RELAY)));
    const relay = Math.round(total * (pct / 100) * 100) / 100;
    const partner = Math.round((total - relay) * 100) / 100;
    return { total, relay, partner, pct, fulfillingPct: 100 - pct };
  }

  async function payWire(wireId) {
    const result = await netApi("pay-wire", { id: wireId });
    if (result.url) {
      window.location.assign(result.url);
      return;
    }
    window.toast?.("Could not start wire payment.");
  }

  function wireCard(row, view) {
    const paid = row.payment_status === "paid";
    const relayPct = row.relay_fee_percent ?? row.metadata?.relay_fee_percent ?? DEFAULT_RELAY;
    const split = splitPreview(row.wire_amount, relayPct);
    const paymentBadge = `<span class="badge ${paid ? "good" : "warn"}">${esc(row.payment_label || row.payment_status || "unpaid")}</span>`;
    const inboxActions =
      view === "inbox" && row.status === "sent"
        ? `${!paid ? `<p class="subtle">Payment from sending shop: ${esc(row.payment_label || "unpaid")}</p>` : ""}
           <button type="button" class="primary" data-wire-id="${esc(row.id)}" data-wire-status="accepted">Accept</button>
           <button type="button" class="secondary" data-wire-id="${esc(row.id)}" data-wire-status="declined">Decline</button>`
        : view === "inbox" && row.status === "accepted"
          ? `<button type="button" class="secondary" data-wire-id="${esc(row.id)}" data-wire-status="in_production">Start production</button>`
          : view === "inbox" && row.status === "in_production"
            ? `<button type="button" class="secondary" data-wire-id="${esc(row.id)}" data-wire-status="out_for_delivery">Out for delivery</button>`
            : view === "inbox" && row.status === "out_for_delivery"
              ? `<button type="button" class="primary" data-wire-id="${esc(row.id)}" data-wire-status="delivered">Mark delivered</button>`
              : "";
    const outboxPay =
      view === "outbox" && !paid
        ? `<button type="button" class="primary" data-wire-pay="${esc(row.id)}">Pay partner via Stripe</button>
           <button type="button" class="secondary" data-wire-offline="${esc(row.id)}">Mark paid offline</button>`
        : "";
    const photo = row.reference_photo_signed_url
      ? `<img src="${esc(row.reference_photo_signed_url)}" alt="Customer reference photo" class="receipt-preview">`
      : "";
    return `<article class="panel wire-card">
      <div class="panel-heading"><div><p class="eyebrow">${esc(row.wire_number)} ${paymentBadge}</p><h3>${esc(row.recipient_name)}</h3>
      <p class="subtle">${esc(row.delivery_date)} · ${esc(row.status_label || row.status)}</p></div>
      <strong>$${Number(row.wire_amount || 0).toFixed(2)}</strong><small class="subtle"> · ${split.fulfillingPct}% partner ($${split.partner.toFixed(2)}) · ${split.pct}% your relay · $0 Florisyn</small></div>
      ${photo}
      <p>${esc(row.product_description)}</p>
      <p class="subtle">${esc(row.delivery_address)}</p>
      ${row.card_message ? `<p class="subtle"><em>${esc(row.card_message)}</em></p>` : ""}
      <div class="card-actions">${inboxActions}${outboxPay}</div>
    </article>`;
  }

  function partnerOptionsHtml(partners) {
    return (partners.items || [])
      .map(
        (p) =>
          `<option value="${esc(p.shop_id)}">${esc(p.display_name)} — ${esc(p.city || "City")}, ${esc(p.state || "ST")}${p.service_zips?.length ? ` · ZIPs ${esc(p.service_zips.slice(0, 3).join(", "))}` : ""}${p.can_receive_payments ? " · Stripe ready" : " · offline pay"}</option>`
      )
      .join("");
  }

  function profileFormHtml(profile) {
    const p = profile?.profile || {};
    return `<form id="fnProfileForm" class="form-grid two">
      <label>Display name<input name="display_name" value="${esc(p.display_name || "")}" placeholder="Your shop name"></label>
      <label>City<input name="city" value="${esc(p.city || "")}" placeholder="Town or city"></label>
      <label>State<input name="state" value="${esc(p.state || "")}" maxlength="2" placeholder="ST"></label>
      <label class="wide">Service ZIP codes<input name="service_zips" value="${esc((p.service_zips || []).join(", "))}" placeholder="12345, 12346"></label>
      <label>Default relay fee (% you keep)<input name="wire_fee_percent" type="number" min="0" max="100" step="0.5" value="${Number(p.wire_fee_percent ?? DEFAULT_RELAY)}"></label>
      <label class="wide">Short bio<textarea name="bio" rows="2" placeholder="Specialties, delivery area…">${esc(p.bio || "")}</textarea></label>
      <div class="card-actions wide"><button type="submit" class="primary">Save network profile</button></div>
    </form>`;
  }

  async function searchPartners(root, currentSelect) {
    const city = root.querySelector("#fnPartnerCity")?.value || "";
    const state = root.querySelector("#fnPartnerState")?.value || "";
    const zip = root.querySelector("#fnPartnerZip")?.value || "";
    const qs = `&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&zip=${encodeURIComponent(zip)}`;
    const partners = await netApi("partners", { qs }, "GET");
    const select = root.querySelector('[name="fulfilling_shop_id"]');
    if (!select) return partners;
    const prev = currentSelect || select.value;
    select.innerHTML =
      partnerOptionsHtml(partners) || '<option value="">No florists match — try another town, state, or ZIP</option>';
    if (prev && [...select.options].some((o) => o.value === prev)) select.value = prev;
    return partners;
  }

  function wireSplitPreview(root) {
    const amount = root.querySelector('[name="wire_amount"]')?.value;
    const relay = root.querySelector('[name="relay_fee_percent"]')?.value;
    const el = root.querySelector("#fnSplitPreview");
    if (!el) return;
    const split = splitPreview(amount, relay);
    el.textContent = `Wire total $${split.total.toFixed(2)} · Partner receives ${split.fulfillingPct}% ($${split.partner.toFixed(2)}) · You keep ${split.pct}% ($${split.relay.toFixed(2)}) · Florisyn fee $0`;
  }

  async function load(root = document.getElementById("floristNetworkRoot")) {
    if (!root) return;
    root.innerHTML = `<p class="subtle">Loading Florist Network…</p>`;
    try {
      const [inbox, outbox, partners, profile] = await Promise.all([
        netApi("inbox", {}, "GET"),
        netApi("outbox", {}, "GET"),
        netApi("partners", {}, "GET"),
        netApi("profile", {}, "GET"),
      ]);
      const defaultRelay = profile.profile?.wire_fee_percent ?? profile.default_relay_fee_percent ?? DEFAULT_RELAY;
      root.innerHTML = `<div class="fn-layout">
        <article class="panel">
          <p class="eyebrow">FLORISYN FLORIST NETWORK</p>
          <h2>Florist-to-florist wires</h2>
          <p class="subtle">Send overflow orders to trusted partner shops. <strong>Florisyn charges $0 on wires.</strong> Default split is <strong>80% to the fulfilling florist / 20% to the sending florist</strong> — change the relay % if you agree on a different payout.</p>
          <p class="subtle fn-zero-fee-banner">Shop locator · Editable split · Optional customer reference photo</p>
          <section class="fn-partner-locator panel">
            <h3>Find a partner florist</h3>
            <p class="subtle">Search by town, state, or ZIP code.</p>
            <div class="form-grid three fn-locator-row">
              <label>Town / city<input id="fnPartnerCity" type="search" placeholder="e.g. Asheville"></label>
              <label>State<input id="fnPartnerState" type="search" maxlength="2" placeholder="NC"></label>
              <label>ZIP<input id="fnPartnerZip" type="search" inputmode="numeric" placeholder="28801"></label>
            </div>
            <button type="button" class="secondary" id="fnSearchPartners">Search florists</button>
          </section>
          <form id="wireForm" class="form-grid two">
            <label class="wide">Fulfilling florist<select name="fulfilling_shop_id" required>${partnerOptionsHtml(partners) || '<option value="">Join the network to see partners</option>'}</select></label>
            <label>Recipient<input name="recipient_name" required></label>
            <label>Phone<input name="recipient_phone"></label>
            <label class="wide">Delivery address<input name="delivery_address" required></label>
            <label>Delivery date<input name="delivery_date" type="date" required></label>
            <label>Wire amount ($)<input name="wire_amount" type="number" min="1" step="0.01" required></label>
            <label>Your relay fee (%)<input name="relay_fee_percent" type="number" min="0" max="100" step="0.5" value="${Number(defaultRelay)}"><small class="subtle">Default 20% — edit if you agreed on a different split.</small></label>
            <p class="subtle wide" id="fnSplitPreview" aria-live="polite"></p>
            <label class="wide">Arrangement description<textarea name="product_description" rows="2" required></textarea></label>
            <label class="wide">Card message<textarea name="card_message" rows="2"></textarea></label>
            <label class="wide upload-photo">Customer reference photo <span class="label-optional">Optional</span>
              <input id="fnReferencePhoto" type="file" accept="image/jpeg,image/png,image/webp,image/heic">
              <small>Sample of what the customer wants — JPG, PNG, or WebP · max 5 MB</small>
            </label>
            <img id="fnReferencePreview" class="receipt-preview" hidden alt="Reference preview">
            <div class="card-actions wide"><button type="submit" class="primary">Send wire order</button></div>
          </form>
        </article>
        <div class="two">
          <div><h3>Incoming wires</h3>${(inbox.items || []).map((r) => wireCard(r, "inbox")).join("") || "<p class='subtle'>No incoming wires.</p>"}</div>
          <div><h3>Sent wires</h3>${(outbox.items || []).map((r) => wireCard(r, "outbox")).join("") || "<p class='subtle'>No sent wires yet.</p>"}</div>
        </div>
        <article class="panel">
          <h3>Your network profile</h3>
          <p class="subtle">${profile.profile ? `${esc(profile.profile.display_name)} · ${profile.profile.accepts_incoming_wires ? "Accepting wires" : "Not accepting"}` : "Create your profile so other florists can find and wire orders to you."}</p>
          ${profileFormHtml(profile)}
          <div class="card-actions">
            <button type="button" class="secondary" id="fnActivateProfile">${profile.profile ? "Quick activate" : "Join Florist Network"}</button>
            <button type="button" class="secondary" data-page="paymentsPage">Connect Stripe to receive wires</button>
          </div>
        </article>
      </div>`;

      wireSplitPreview(root);
      root.querySelector('[name="wire_amount"]')?.addEventListener("input", () => wireSplitPreview(root));
      root.querySelector('[name="relay_fee_percent"]')?.addEventListener("input", () => wireSplitPreview(root));

      root.querySelector("#fnSearchPartners")?.addEventListener("click", async () => {
        try {
          await searchPartners(root);
          window.toast?.("Partner list updated");
        } catch (err) {
          window.toast?.(err.message);
        }
      });

      root.querySelector("#fnReferencePhoto")?.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        const preview = root.querySelector("#fnReferencePreview");
        if (!file || !preview) return;
        try {
          const url = await readFileAsDataUrl(file);
          preview.src = url;
          preview.hidden = false;
        } catch (err) {
          window.toast?.(err.message);
        }
      });

      root.querySelector('[data-page="paymentsPage"]')?.addEventListener("click", (e) => {
        e.preventDefault();
        window.showPage?.("paymentsPage");
      });

      root.querySelector("#wireForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = Object.fromEntries(fd.entries());
        const photoFile = root.querySelector("#fnReferencePhoto")?.files?.[0];
        if (photoFile) {
          try {
            payload.reference_photo_data_url = await readFileAsDataUrl(photoFile);
          } catch (err) {
            window.toast?.(err.message);
            return;
          }
        }
        try {
          const sent = await netApi("send-wire", { ...payload, send: true });
          const relayPct = sent?.settlement?.relay_fee_percent ?? DEFAULT_RELAY;
          const partnerPct = 100 - relayPct;
          window.toast?.("Wire order sent");
          if (
            sent?.item?.id &&
            window.confirm(
              `Pay your partner now? They receive ${partnerPct}% via Stripe — Florisyn fee is $0.`
            )
          ) {
            await payWire(sent.item.id);
            return;
          }
          load(root);
        } catch (err) {
          window.toast?.(err.message);
        }
      });

      root.querySelector("#fnProfileForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await netApi("save-profile", {
            ...Object.fromEntries(fd.entries()),
            is_active: true,
            accepts_incoming_wires: true,
          });
          window.toast?.("Florist Network profile saved");
          load(root);
        } catch (err) {
          window.toast?.(err.message);
        }
      });

      root.querySelector("#fnActivateProfile")?.addEventListener("click", async () => {
        try {
          await netApi("save-profile", { is_active: true, accepts_incoming_wires: true, wire_fee_percent: DEFAULT_RELAY });
          window.toast?.("Florist Network profile activated");
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

      root.querySelectorAll("[data-wire-pay]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await payWire(btn.dataset.wirePay);
          } catch (err) {
            window.toast?.(err.message);
          }
        });
      });

      root.querySelectorAll("[data-wire-offline]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const note = window.prompt("Optional note (check, Zelle, cash, etc.)") || "";
          try {
            await netApi("mark-paid-offline", { id: btn.dataset.wireOffline, note });
            window.toast?.("Wire marked paid offline");
            load(root);
          } catch (err) {
            window.toast?.(err.message);
          }
        });
      });
    } catch (e) {
      const message = e.message || "Something went wrong loading Florist Network.";
      root.innerHTML = `<div class="panel" role="alert"><h3>Something went wrong</h3><p class="subtle">${esc(message)}</p><button type="button" class="primary" id="fnRetry">Try again</button></div>`;
      root.querySelector("#fnRetry")?.addEventListener("click", () => load(root));
    }
  }

  window.BloomFloristNetwork = { load };
})();
