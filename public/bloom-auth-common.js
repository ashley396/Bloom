document.querySelectorAll("[data-current-year]").forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});

const params = new URLSearchParams(location.search);
if (params.get("reset") === "1" && document.getElementById("authMessage")) {
  document.getElementById("authMessage").textContent =
    "If you reset your password, check your email for the link, then sign in with your new password.";
  document.getElementById("authMessage").classList.add("success");
}
