const form = document.getElementById("resetForm");
const message = document.getElementById("resetMessage");
const button = document.getElementById("resetButton");
const lead = document.getElementById("resetLead");

function parseHashTokens() {
  const raw = (location.hash || "").replace(/^#/, "");
  if (!raw) return {};
  return Object.fromEntries(
    raw.split("&").map((part) => {
      const [k, v] = part.split("=");
      return [decodeURIComponent(k), decodeURIComponent(v || "")];
    })
  );
}

const tokens = parseHashTokens();
const accessToken = tokens.access_token || "";
const type = tokens.type || "";
// A link that is expired, already used, or otherwise rejected by Supabase's
// /auth/v1/verify redirects here with its own error signal instead of an
// access_token — surface that real reason (mirrors verify-email.js's
// handling of the same GoTrue error-redirect shape) rather than always
// showing the same generic message regardless of why the link failed.
const errorCode = tokens.error_code || tokens.error || "";
const errorDescription = tokens.error_description || "";

if (errorCode) {
  message.textContent = errorDescription
    ? decodeURIComponent(errorDescription.replace(/\+/g, " "))
    : "This reset link is invalid or has already been used. Request a new link from the forgot password page.";
  message.classList.add("error");
} else if (!accessToken || type !== "recovery") {
  message.textContent =
    "This reset link is missing or expired. Request a new link from the forgot password page.";
  message.classList.add("error");
} else {
  form.hidden = false;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("resetPassword")?.value || "";
  const confirm = document.getElementById("resetPasswordConfirm")?.value || "";
  message.textContent = "";
  message.classList.remove("success", "error");
  if (password.length < 8) {
    message.textContent = "Password must be at least 8 characters.";
    return;
  }
  if (password !== confirm) {
    message.textContent = "Passwords do not match.";
    return;
  }
  button.disabled = true;
  button.textContent = "Updating…";
  try {
    const response = await fetch("/api/auth-reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, access_token: accessToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not update password.");
    message.textContent = "Password updated. You can sign in with your new password.";
    message.classList.add("success");
    lead.textContent = "You're all set.";
    form.hidden = true;
    history.replaceState({}, "", location.pathname);
  } catch (error) {
    message.textContent = error.message || "Update failed. Try requesting a new reset link.";
    message.classList.add("error");
    button.disabled = false;
    button.textContent = "Update password";
  }
});
