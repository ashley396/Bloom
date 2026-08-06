/**
 * Distributed admission control for password-based authentication routes.
 *
 * Netlify enforces the rate limit at the edge across function instances. The
 * serverless handlers keep their smaller in-memory limits as defense in depth.
 * Session refresh is intentionally excluded so a login burst cannot evict
 * already-authenticated users.
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
    "/.netlify/functions/auth-reset-password",
    "/api/auth-login",
    "/api/auth-signup",
    "/api/auth-forgot-password",
    "/api/auth-reset-password"
  ],
  method: "POST",
  onError: "fail",
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};
