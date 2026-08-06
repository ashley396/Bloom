/**
 * Distributed admission control for password-based authentication routes.
 *
 * Netlify enforces rateLimit from this config at the edge across instances.
 * Redirect rate_limit rules in netlify.toml provide a second distributed gate
 * for CLI deploys where edge rateLimit post-processing can be skipped.
 * Serverless handlers keep smaller in-memory limits as defense in depth.
 * Session refresh is intentionally excluded so a login burst cannot evict
 * already-authenticated users.
 *
 * Pro plan allows 5 code-based rate-limit rules per project — keep this path
 * list at 4 function entry points (login UI hits /.netlify/functions/*).
 */
export default async function authAdmission(request, context) {
  const requestId = context.requestId || crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-florisyn-request-id", requestId);

  const nextRequest = new Request(request, { headers });
  const response = typeof context.nextRequest === "function"
    ? await context.nextRequest(nextRequest)
    : await context.next(nextRequest);
  response.headers.set("x-request-id", requestId);
  response.headers.set("cache-control", "no-store");
  return response;
}

export const config = {
  path: [
    "/.netlify/functions/auth-login",
    "/.netlify/functions/auth-signup",
    "/.netlify/functions/auth-forgot-password",
    "/.netlify/functions/auth-reset-password"
  ],
  rateLimit: {
    action: "rate_limit",
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};
