const params = new URLSearchParams(location.search);
const msg = document.getElementById("verifyMessage");
const title = document.getElementById("verifyTitle");
const lead = document.getElementById("verifyLead");
const steps = document.getElementById("verifySteps");

if (params.get("confirmed") === "1") {
  title.textContent = "Email confirmed";
  lead.textContent = "Thank you — your email is verified. Sign in to open your Florisyn workspace.";
  msg.textContent = "You're all set. We won't ask you to confirm again on this device.";
  msg.classList.add("success");
  if (steps) steps.hidden = true;
} else if (params.get("pending") === "1") {
  title.textContent = "Confirm your email";
  lead.textContent = "Your account was created. We sent a confirmation link — check your inbox (and spam folder).";
  msg.textContent = "Links expire for security. Request a new signup if this one ages out.";
  msg.classList.add("success");
} else if (params.get("error") === "1") {
  title.textContent = "Verification link expired";
  lead.textContent = "This confirmation link is no longer valid or has already been used.";
  msg.textContent = "Sign in if you already confirmed, or create your account again to receive a fresh email.";
  msg.classList.add("error");
  if (steps) steps.hidden = true;
}
