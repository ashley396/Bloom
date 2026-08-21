document.querySelectorAll("[data-current-year]").forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});

// Launch-repair: this is a shared classic <script> included on five
// different auth pages (login/signup/forgot-password/reset-password/
// verify-email), several of which declare their own top-level `const
// params` (verify-email.js, for one). Classic <script> tags share one
// global lexical scope, so two sibling scripts both declaring `const
// params` throws "Identifier 'params' has already been declared" —
// a real SyntaxError that aborted this entire file (including the
// [data-current-year] footer stamp above) on verify-email.html. Give
// this file's own binding a name unlikely to collide with any host
// page's script, rather than assuming every future page that includes
// this file has been checked for the name.
const authCommonParams = new URLSearchParams(location.search);
if (authCommonParams.get("reset") === "1" && document.getElementById("authMessage")) {
  document.getElementById("authMessage").textContent =
    "If you reset your password, check your email for the link, then sign in with your new password.";
  document.getElementById("authMessage").classList.add("success");
}
