const form = document.getElementById("resetForm");
const message = document.getElementById("resetMessage");
const button = document.getElementById("resetButton");
const lead = document.getElementById("resetLead");

function parseParams(raw) {
  if (!raw) return {};
  return Object.fromEntries(
    raw.split("&").map((part) => {
      const [k, v] = part.split("=");
      return [decodeURIComponent(k || ""), decodeURIComponent(v || "")];
    })
  );
}

function readResetTokens() {
  const hash = parseParams((location.hash || "").replace(/^#/, ""));
  const query = parseParams((location.search || "").replace(/^\?/, ""));
  return {
    accessToken: hash.access_token || query.access_token || "",
    tokenHash: hash.token_hash || query.token_hash || "",
    type: hash.type || query.type || "",
    error: hash.error_description || query.error_description || hash.error || query.error || ""
  };
}

const tokens = readResetTokens();
const accessToken = tokens.accessToken;
const tokenHash = tokens.tokenHash;
const type = tokens.type;
const typeOk = !type || type === "recovery";
const hasResetSecret = Boolean(accessToken || tokenHash);

if (tokens.error) {
  message.textContent = String(tokens.error).replace(/\+/g, " ");
  message.classList.add("error");
} else if (!hasResetSecret || !typeOk) {
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
  if (!hasResetSecret) {
    message.textContent = "This reset link is missing or expired. Request a new link.";
    message.classList.add("error");
    return;
  }
  button.disabled = true;
  button.textContent = "Updating…";
  try {
    const payload = { password };
    if (accessToken) payload.access_token = accessToken;
    if (tokenHash) payload.token_hash = tokenHash;
    const response = await fetch("/api/auth-reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not update password.");
    message.textContent = "Password updated. You can sign in with your new password.";
    message.classList.add("success");
    lead.textContent = "You're all set.";
    form.hidden = true;
    history.replaceState({}, "", location.pathname);
    setTimeout(() => {
      location.href = "/login";
    }, 1200);
  } catch (error) {
    message.textContent = error.message || "Update failed. Try requesting a new reset link.";
    message.classList.add("error");
    button.disabled = false;
    button.textContent = "Update password";
  }
});
