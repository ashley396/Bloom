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
      root.innerHTML = `<p class="subtle">${esc(e.message)}</p>`;
    }
  }

  window.BloomReferralHub = { load: loadReferralHub };
})();
