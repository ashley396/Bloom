/**
 * Public site URL for auth email redirects (never localhost in production emails).
 * Pathnames are sanitized — user-supplied full URLs cannot become open redirects.
 */

const LOCALHOST_RE = /localhost|127\.0\.0\.1|:8888\b/i;
const NETLIFY_PREVIEW_RE = /^https:\/\/([a-z0-9-]+--)?[a-z0-9-]+\.netlify\.app$/i;

/** Auth email may only redirect to these path prefixes. */
const ALLOWED_AUTH_PATH_PREFIXES = ["/verify-email", "/reset-password"];

export function sanitizeAuthPathname(pathname) {
  const raw = String(pathname || "/verify-email").trim();
  if (!raw || /^https?:\/\//i.test(raw) || raw.startsWith("//") || raw.includes("\\")) {
    return "/verify-email";
  }
  let path = raw.startsWith("/") ? raw : `/${raw}`;
  const [basePath, query = ""] = path.split("?");
  const allowed = ALLOWED_AUTH_PATH_PREFIXES.some(
    (prefix) => basePath === prefix || basePath.startsWith(`${prefix}/`),
  );
  if (!allowed) return "/verify-email";
  if (query && !/^[a-zA-Z0-9_=&%.-]*$/.test(query)) return basePath;
  return query ? `${basePath}?${query}` : basePath;
}

export function isNetlifyPreviewUrl(url) {
  return NETLIFY_PREVIEW_RE.test(String(url || "").trim());
}

export function resolvePublicSiteUrl(env = process.env, requestOrigin = "") {
  const candidates = [
    env.DEPLOY_PRIME_URL,
    env.SITE_URL,
    env.URL,
    String(requestOrigin || "").trim(),
  ]
    .map((value) => String(value || "").trim().replace(/\/$/, ""))
    .filter(Boolean);

  for (const url of candidates) {
    if (!/^https?:\/\//i.test(url)) continue;
    if (LOCALHOST_RE.test(url)) continue;
    return url;
  }

  return "https://bloom-technologies.netlify.app";
}

export function getSiteUrlDiagnostics(env = process.env, requestOrigin = "") {
  const warnings = [];
  const hasSiteUrl = Boolean(String(env.SITE_URL || "").trim());
  const hasDeployPreview = Boolean(String(env.DEPLOY_PRIME_URL || "").trim());
  const origin = String(requestOrigin || "").trim();

  if (!hasSiteUrl && !hasDeployPreview) {
    warnings.push(
      "SITE_URL is not configured — auth emails use fallback https://bloom-technologies.netlify.app unless a non-localhost request origin is available.",
    );
  }
  if (hasSiteUrl && LOCALHOST_RE.test(String(env.SITE_URL))) {
    warnings.push("SITE_URL points to localhost — production auth emails must not use it.");
  }
  if (!hasSiteUrl && LOCALHOST_RE.test(origin)) {
    warnings.push("Request origin is localhost and SITE_URL is unset — using safe fallback domain.");
  }

  const resolved = resolvePublicSiteUrl(env, requestOrigin);
  const source = hasDeployPreview
    ? "DEPLOY_PRIME_URL"
    : hasSiteUrl && !LOCALHOST_RE.test(String(env.SITE_URL))
      ? "SITE_URL"
      : isNetlifyPreviewUrl(origin)
        ? "request_origin_preview"
        : resolved.includes("bloom-technologies.netlify.app")
          ? "fallback"
          : "URL_or_origin";

  return {
    resolved,
    source,
    warnings,
    site_url_configured: hasSiteUrl,
    deploy_preview_configured: hasDeployPreview,
  };
}

export function authRedirectPath(env, requestOrigin, pathname) {
  const base = resolvePublicSiteUrl(env, requestOrigin);
  const path = sanitizeAuthPathname(pathname);
  return `${base}${path}`;
}
