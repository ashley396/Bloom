/**
 * Public site URL for auth email redirects (never localhost in production emails).
 */
export function resolvePublicSiteUrl(env = process.env, requestOrigin = "") {
  const candidates = [
    env.DEPLOY_PRIME_URL,
    env.SITE_URL,
    env.URL,
    String(requestOrigin || "").trim()
  ]
    .map((value) => String(value || "").trim().replace(/\/$/, ""))
    .filter(Boolean);

  for (const url of candidates) {
    if (!/^https?:\/\//i.test(url)) continue;
    if (/localhost|127\.0\.0\.1|:8888\b/i.test(url)) continue;
    return url;
  }

  return "https://bloom-technologies.netlify.app";
}

export function authRedirectPath(env, requestOrigin, pathname) {
  const base = resolvePublicSiteUrl(env, requestOrigin);
  const path = String(pathname || "").startsWith("/") ? pathname : `/${pathname || ""}`;
  return `${base}${path}`;
}
