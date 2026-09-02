const form = document.getElementById("forgotForm");
const message = document.getElementById("forgotMessage");
const button = document.getElementById("forgotButton");

// Rate-limit cooldown: only the cooldown's expiry timestamp is ever
// persisted (sessionStorage, cleared the moment it's spent) — never the
// email address, never a token, never anything from the response beyond
// a plain number of seconds — so a refresh mid-cooldown can't quietly
// re-enable the button and let the florist hammer the endpoint again.
const COOLDOWN_STORAGE_KEY = "florisyn_forgot_password_cooldown_until";
const DEFAULT_COOLDOWN_SECONDS = 60;
let countdownTimer = null;

function setMessage(text, kind) {
  message.textContent = text;
  message.className = "bloom-auth-message";
  if (kind) message.classList.add(kind);
}

function formatCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function stopCountdownTimer() {
  // Guards against a duplicate interval if a cooldown is somehow started
  // twice (e.g. a resumed cooldown followed by a fresh rate-limit reply).
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function clearStoredCooldown() {
  try {
    sessionStorage.removeItem(COOLDOWN_STORAGE_KEY);
  } catch (e) {
    // Storage can throw in a locked-down/private browsing context — the
    // cooldown just won't survive a refresh there, which is a safe fallback.
  }
}

function runCooldown(expiresAt) {
  stopCountdownTimer();
  button.disabled = true;

  function tick() {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      stopCountdownTimer();
      clearStoredCooldown();
      button.disabled = false;
      button.textContent = "Send reset link";
      setMessage("You can request another reset link now.", "success");
      return;
    }
    button.textContent = "Send reset link";
    setMessage(`Too many reset requests. Try again in ${formatCountdown(remaining)}.`, "error");
  }

  tick();
  countdownTimer = setInterval(tick, 1000);
}

function startCooldown(retryAfterSeconds) {
  const seconds = Number(retryAfterSeconds) > 0 ? Number(retryAfterSeconds) : DEFAULT_COOLDOWN_SECONDS;
  const expiresAt = Date.now() + seconds * 1000;
  try {
    sessionStorage.setItem(COOLDOWN_STORAGE_KEY, String(expiresAt));
  } catch (e) {
    // Same private-browsing fallback as above — the countdown still runs
    // for this page view, it just won't resume after a refresh.
  }
  runCooldown(expiresAt);
}

// Resume an active cooldown across a page refresh; an already-expired one
// is cleared immediately rather than left sitting in storage.
(function resumeCooldownIfActive() {
  let stored = null;
  try {
    stored = sessionStorage.getItem(COOLDOWN_STORAGE_KEY);
  } catch (e) {
    return;
  }
  if (!stored) return;
  const expiresAt = Number(stored);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    clearStoredCooldown();
    return;
  }
  runCooldown(expiresAt);
})();

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (button.disabled) return;
  const email = document.getElementById("forgotEmail")?.value.trim();
  setMessage("");
  if (!email) {
    setMessage("Enter your business email.", "error");
    return;
  }
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const res = await fetch("/api/auth-forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.code === "auth_rate_limited") {
        startCooldown(data.retry_after_seconds);
        return;
      }
      throw new Error(data.error || "Request failed");
    }
    setMessage(data.message || "Check your email for reset instructions.", "success");
    button.textContent = "Email sent";
  } catch (err) {
    setMessage(err.message || "Could not send reset email.", "error");
    button.disabled = false;
    button.textContent = "Send reset link";
  }
});
