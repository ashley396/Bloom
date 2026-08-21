/**
 * A tiny static file server for public/, standing in for Netlify's own
 * static hosting + redirects during the Playwright smoke test. It only
 * implements the handful of `netlify.toml` [[redirects]] rules the smoke
 * test actually needs (extend this list if a new smoke test needs more):
 *   /login            -> /login.html
 *   /signup           -> /signup.html
 *   /admin            -> /admin.html
 *   /verify-email     -> /verify-email.html
 *   /forgot-password  -> /forgot-password.html
 *   /reset-password   -> /reset-password.html
 *   /*                -> /index.html   (SPA catch-all, matches netlify.toml)
 *
 * Netlify Functions are not served here — there is no Supabase/Stripe
 * connection in this sandbox to serve them against. Tests that need a
 * function response should route it through Playwright's page.route().
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

const EXPLICIT_REDIRECTS = {
  "/login": "/login.html",
  "/login/": "/login.html",
  "/signup": "/signup.html",
  "/signup/": "/signup.html",
  "/admin": "/admin.html",
  "/admin/": "/admin.html",
  "/verify-email": "/verify-email.html",
  "/verify-email/": "/verify-email.html",
  "/forgot-password": "/forgot-password.html",
  "/forgot-password/": "/forgot-password.html",
  "/reset-password": "/reset-password.html",
  "/reset-password/": "/reset-password.html",
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
};

function resolveFile(urlPath) {
  const clean = urlPath.split("?")[0].split("#")[0];
  const mapped = EXPLICIT_REDIRECTS[clean] || clean;
  let filePath = path.join(ROOT, decodeURIComponent(mapped));

  if (filePath.endsWith("/")) filePath = path.join(filePath, "index.html");

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return filePath;
  }

  // SPA catch-all, mirrors `from = "/*" to = "/index.html"` in netlify.toml.
  return path.join(ROOT, "index.html");
}

export function createStaticServer() {
  return http.createServer((req, res) => {
    try {
      const filePath = resolveFile(req.url || "/");
      const ext = path.extname(filePath);
      const body = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`static-server error: ${error?.message || error}`);
    }
  });
}

export function listen(port = 0) {
  return new Promise((resolve, reject) => {
    const server = createStaticServer();
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

// Allow `node tests/e2e/static-server.mjs [port]` for local/manual use,
// and for Playwright's own `webServer` command.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || process.argv[2] || 4173);
  listen(port).then((server) => {
    const address = server.address();
    console.log(`Florisyn smoke-test static server listening on http://127.0.0.1:${address.port}`);
  });
}
