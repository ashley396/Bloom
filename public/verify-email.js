const params = new URLSearchParams(location.search);
// Supabase's own /auth/v1/verify redirect — not our own code — carries the
// *real* outcome of the confirmation click. On success it appends session
// tokens as a URL hash fragment (`#access_token=...`); on failure (expired
// or already-used link) it appends `error`/`error_code` either as a hash
// fragment or, on some GoTrue versions, the query string. `?confirmed=1` in
// contrast is a flag we bake into the redirect_to URL ourselves, before any
// verification happens — it used to be trusted unconditionally here, which
// meant this page claimed "confirmed" even when the click actually failed
// server-side. Real success/failure must come from Supabase's own signal.
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
const hasAccessToken = hashParams.has("access_token");
const errorCode = hashParams.get("error_code") || hashParams.get("error") || params.get("error_code") || params.get("error");
const errorDescription = hashParams.get("error_description") || params.get("error_description");

const msg = document.getElementById("verifyMessage");
const title = document.getElementById("verifyTitle");
const lead = document.getElementById("verifyLead");
const steps = document.getElementById("verifySteps");
const resendForm = document.getElementById("resendConfirmationForm");
const resendEmail = document.getElementById("resendEmail");
const resendButton = document.getElementById("resendButton");
const pendingEmail = params.get("email") || sessionStorage.getItem("florisyn_pending_email") || "";

if (resendEmail) resendEmail.value = pendingEmail;

if (errorCode) {
  title.textContent = "Verification link expired";
  lead.textContent = errorDescription
    ? decodeURIComponent(errorDescription.replace(/\+/g, " "))
    : "This confirmation link is no longer valid or has already been used.";
  msg.textContent = "Sign in if you already confirmed, or request a fresh confirmation email below.";
  msg.classList.add("error");
  if (steps) steps.hidden = true;
  if (resendForm) resendForm.hidden = false;
} else if (hasAccessToken) {
  title.textContent = "Email confirmed";
  lead.textContent = "Thank you — your email is verified. Sign in to open your Florisyn workspace.";
  msg.textContent = "You're all set. We won't ask you to confirm again on this device.";
  msg.classList.add("success");
  if (steps) steps.hidden = true;
  sessionStorage.removeItem("florisyn_pending_email");
} else if (params.get("confirmed") === "1") {
  // Landed here with our own success flag but no real Supabase signal
  // either way (no hash tokens, no error) — most likely a stale bookmark
  // or a reload of this exact URL, not a fresh click from the email. Don't
  // claim confirmed; point the visitor at what actually tells them.
  title.textContent = "Check your email";
  lead.textContent = "If you already clicked the confirmation link in your email, you can sign in now. Otherwise, use the link in your inbox or request a new one below.";
  msg.textContent = "";
  if (steps) steps.hidden = true;
  if (resendForm) resendForm.hidden = false;
} else if (params.get("pending") === "1") {
  title.textContent = "Confirm your email";
  // Pre-launch QA: this used to claim "We sent a confirmation link"
  // unconditionally, even on the one path signup itself can already tell
  // apart — a real send failure (not just "no email provider configured
  // yet", which auth-signup.js treats as a soft, expected case). Absent
  // `sent` param (e.g. a bookmarked/older link) keeps the original
  // friendly assumption rather than implying a failure we don't know
  // happened.
  if (params.get("sent") === "0") {
    lead.textContent = "Your account was created, but we could not confirm the confirmation email sent just now.";
    msg.textContent = "Use the resend button below — if it still does not arrive, contact Florisyn support.";
  } else {
    lead.textContent = "Your account was created. We sent a confirmation link — check your inbox (and spam folder).";
    msg.textContent = "If it does not arrive, use the resend button below.";
  }
  msg.classList.add("success");
  if (resendForm) resendForm.hidden = false;
}

resendForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = String(resendEmail?.value || "").trim();
  msg.classList.remove("success", "error");
  if (!email) {
    msg.textContent = "Enter the email address you used to create your Florisyn account.";
    msg.classList.add("error");
    return;
  }
  resendButton.disabled = true;
  resendButton.textContent = "Sending...";
  try {
    const response = await fetch("/api/auth-resend-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Could not resend confirmation email (${response.status})`);
    sessionStorage.setItem("florisyn_pending_email", email);
    msg.textContent = data.message || "If this email has an unconfirmed account, a new confirmation link will arrive shortly.";
    msg.classList.add("success");
  } catch (error) {
    msg.textContent = error.message || "Could not resend confirmation email.";
    msg.classList.add("error");
  } finally {
    resendButton.disabled = false;
    resendButton.textContent = "Resend confirmation email";
  }
});
