/**
 * Distributed admission control for password-based authentication routes.
 *
 * Primary distributed gate: netlify.toml redirect rate_limit on /api/auth-*.
 * This edge function correlates request IDs and keeps a docs-aligned rateLimit
 * on the same /api entry points (Pro: max 5 code-based rules project-wide).
 * Serverless handlers keep smaller in-memory limits as defense in depth.
 * Session refresh is intentionally excluded.
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
    "/api/auth-login",
    "/api/auth-signup",
    "/api/auth-forgot-password",
    "/api/auth-reset-password"
  ],
  rateLimit: {
    action: "rate_limit",
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};
