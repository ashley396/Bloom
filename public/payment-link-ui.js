(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;

  function params() {
    return new URLSearchParams(location.search);
  }

  async function publicApi(path, opts = {}) {
    const base = "/.netlify/functions/";
    const res = await fetch(base + path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function renderQr(url) {
    const img = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
    return `<img src="${img}" width="180" height="180" alt="QR code for payment link" loading="lazy">`;
  }

  async function load() {
    const root = document.getElementById("payRoot");
    const token = params().get("t");
    if (params().get("paid") === "1") {
      root.innerHTML = `<h1>Thank you</h1><p class="subtle">Your payment was submitted. The florist will confirm shortly.</p>`;
      return;
    }
    if (!token) {
      root.innerHTML = `<h1>Invalid link</h1><p class="subtle">This payment URL is missing a secure token.</p>`;
      return;
    }
    try {
      const info = await publicApi(`payment-link-public?t=${encodeURIComponent(token)}`);
      root.innerHTML = `<p class="eyebrow">SECURE PAYMENT</p>
        <h1>Pay ${money(info.amount_due)}</h1>
        ${info.allow_partial ? `<label>Amount to pay ($)<input id="payPartial" type="number" min="0.01" step="0.01" value="${info.amount_due}"></label>` : ""}
        <button type="button" class="primary" id="paySubmit">Continue to card checkout</button>
        <p class="subtle">Powered by Florisyn Payment Hub · Stripe</p>`;
      document.getElementById("paySubmit").onclick = async () => {
        const amount = info.allow_partial ? Number(document.getElementById("payPartial")?.value || info.amount_due) : info.amount_due;
        const d = await publicApi("payment-link-public", {
          method: "POST",
          body: JSON.stringify({ action: "pay", token, amount, return_url: location.origin })
        });
        if (d.checkout_url) location.assign(d.checkout_url);
      };
    } catch (e) {
      root.innerHTML = `<h1>Unable to load payment</h1><p class="subtle">${esc(e.message)}</p>`;
    }
  }

  window.BloomPaymentLink = { load, renderQr };
  document.addEventListener("DOMContentLoaded", load);
})();
