/**
 * Password-recovery landing guard — loaded first, inline, on every page a
 * misconfigured or not-yet-allow-listed Supabase "Redirect URLs" setting
 * could bounce a recovery link back to (the site root and /login), so a
 * real Supabase recovery session is never silently swallowed by the public
 * homepage or the plain sign-in form.
 *
 * Why this exists: auth-forgot-password.js always asks Supabase to send
 * the florist to `${SITE_URL}/reset-password` (see authRedirectPath in
 * _shared/site-url.js). But GoTrue only honors `redirect_to` when it
 * matches that project's own configured Site URL / Additional Redirect
 * URLs allow-list — a Supabase Auth *dashboard* setting, not something
 * this repo controls or this guard can fix. When a project's allow-list
 * doesn't yet include the exact `/reset-password` path (as on a brand new
 * project whose Auth URL configuration was never touched), GoTrue instead
 * redirects to the bare Site URL, and the recovery session tokens land as
 * a URL hash on whatever page that resolves to (typically `/` or
 * `/login`) instead of on the dedicated "set new password" page that
 * actually knows how to use them.
 *
 * This only ever fires on the one unambiguous, safe-to-trust signal: a
 * hash carrying both `type=recovery` and a real `access_token` — the
 * exact shape GoTrue's own successful verify redirect produces. It never
 * touches an expired/invalid-link error redirect (`#error=...`), since
 * those can't be reliably told apart here from an unrelated email-
 * confirmation failure that belongs on /verify-email instead; that case
 * is handled locally by reset-password.js itself, for whenever it lands
 * there directly.
 *
 * Must run before anything else on the page (no `defer`, no async) so it
 * can hand off before any other script reacts to "no session found".
 */
(function () {
  try {
    if (location.pathname === "/reset-password" || location.pathname === "/reset-password.html") return;
    var hash = String(location.hash || "").replace(/^#/, "");
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get("type") === "recovery" && params.get("access_token")) {
      location.replace("/reset-password" + location.hash);
    }
  } catch (e) {
    // Never let a parsing edge case block the rest of the page from loading.
  }
})();
