(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  async function loadReferralHub(root = document.getElementById("referralHubRoot")) {
    if (!root) return;
    root.innerHTML = `<p class="subtle">Loading referral program…</p>`;
    try {
      const d = await window.api("referral-program", {
        method: "POST",
        body: JSON.stringify({ action: "load" })
      });
      // A partial or empty backend response (feature not yet configured,
      // migration not applied, a network hiccup) used to throw here —
      // `d.reward.label` with no guard — and the catch below would show
      // the raw JS error text ("Cannot read properties of undefined...")
      // directly in the settings page. Default every field instead so a
      // thin response degrades to a working, if less specific, card.
      if (!d?.reward || !d?.share) {
        root.innerHTML = `<p class="subtle">Referral program isn't set up for this shop yet. Check back soon.</p>`;
        return;
      }
      root.innerHTML = `<article class="panel referral-hub">
        <p class="eyebrow">GROW FLORISYN</p>
        <h2>Refer a florist — ${esc(d.reward.label)}</h2>
        <p class="subtle">Share your link. When they subscribe, you each earn ${d.reward.referrerMonthsFree} free month.</p>
        <p><strong>Your code:</strong> <code id="referralCode">${esc(d.share.code)}</code></p>
        <label>Share link<input id="referralUrl" readonly value="${esc(d.share.url)}"></label>
        <div class="card-actions">
          <button type="button" class="primary" id="copyReferral">Copy link</button>
          <button type="button" class="secondary" id="regenReferral">New code</button>
        </div>
        <p class="subtle">Referrals: ${Number(d.stats?.referred_count || 0)} · Rewards earned: ${Number(d.stats?.rewards_earned_months || 0)} months</p>
      </article>`;
      root.querySelector("#copyReferral")?.addEventListener("click", () => {
        navigator.clipboard?.writeText(root.querySelector("#referralUrl").value);
        window.toast?.("Referral link copied");
      });
      root.querySelector("#regenReferral")?.addEventListener("click", async () => {
        await window.api("referral-program", { method: "POST", body: JSON.stringify({ action: "regenerate" }) });
        loadReferralHub(root);
      });
    } catch (e) {
      // Never surface a raw exception message to a florist — always a
      // plain-English fallback, regardless of what actually broke.
      root.innerHTML = `<p class="subtle">Referral program is temporarily unavailable. Try again in a moment.</p>`;
    }
  }

  window.BloomReferralHub = { load: loadReferralHub };
})();
