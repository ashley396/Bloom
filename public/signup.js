const $ = (s) => document.querySelector(s);
async function api(path, opt = {}) {
  const base = path.startsWith("auth-") ? `/api/${path}` : `/.netlify/functions/${path}`;
  const r = await fetch(base, { ...opt, headers: { "Content-Type": "application/json", ...(opt.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}

const params = new URLSearchParams(location.search);
const refCode = params.get("ref");
if (refCode) {
  try {
    sessionStorage.setItem("florisyn_referral_code", refCode);
  } catch {
    /* ignore */
  }
}

$("#signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter || $("#signupForm button[type='submit']");
  const message = $("#signupMessage");
  message.textContent = "";
  button.disabled = true;
  button.textContent = "Creating your Florisyn account…";
  try {
    const plan = document.querySelector('input[name="plan"]:checked');
    const referralCode = sessionStorage.getItem("florisyn_referral_code") || refCode || "";
    const payload = {
      fullName: $("#fullName").value.trim(),
      shopName: $("#shopName").value.trim(),
      email: $("#email").value.trim(),
      password: $("#password").value,
      businessPhone: $("#businessPhone").value.trim(),
      businessType: $("#businessType").value,
      businessAddress: $("#businessAddress").value.trim(),
      businessCity: $("#businessCity").value.trim(),
      businessState: $("#businessState").value.trim().toUpperCase(),
      businessZip: $("#businessZip").value.trim(),
      planCode: plan.value,
      subscriptionPrice: Number(plan.dataset.price),
      billingInterval: plan.dataset.interval || "monthly",
      referralCode
    };
    const d = await api("auth-signup", { method: "POST", body: JSON.stringify(payload) });
    if (d.confirmationRequired) {
      sessionStorage.setItem("florisyn_pending_email", payload.email);
      location.href = `/verify-email?pending=1&email=${encodeURIComponent(payload.email)}`;
      return;
    }
    if (d.accessToken) {
      localStorage.setItem("bloom_session", JSON.stringify({ accessToken: d.accessToken, refreshToken: d.refreshToken, user: d.user }));
      if (referralCode) {
        try {
          await api("referral-program", {
            method: "POST",
            headers: { Authorization: `Bearer ${d.accessToken}` },
            body: JSON.stringify({ action: "attribute", code: referralCode })
          });
        } catch {
          /* non-blocking */
        }
      }
      location.href = "/";
    } else location.href = "/?account=created";
  } catch (err) {
    message.textContent = err.message;
    button.disabled = false;
    button.textContent = "Start my free trial";
  }
});
