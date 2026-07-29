const form = document.getElementById("forgotForm");
const message = document.getElementById("forgotMessage");
const button = document.getElementById("forgotButton");

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("forgotEmail")?.value.trim();
  message.textContent = "";
  message.className = "bloom-auth-message";
  if (!email) {
    message.textContent = "Enter your business email.";
    message.classList.add("error");
    return;
  }
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const res = await fetch("/.netlify/functions/auth-forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    message.textContent = data.message || "Check your email for reset instructions.";
    message.classList.add("success");
    button.textContent = "Email sent";
  } catch (err) {
    message.textContent = err.message || "Could not send reset email.";
    message.classList.add("error");
    button.disabled = false;
    button.textContent = "Send reset link";
  }
});
