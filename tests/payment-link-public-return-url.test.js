import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveTrustedReturnBase } from "../netlify/functions/_shared/site-url.js";

// Launch-readiness audit (2026-09-28): the public payment-link "pay"
// action built Stripe's success_url/cancel_url from a caller-supplied
// return_url verbatim — an open redirect on a real payment flow. The base
// is now only ever one of this deployment's own origins.

const env = { SITE_URL: "https://www.florisyn.com", CORS_ALLOWED_ORIGINS: "https://shop.example-partner.com" };

test("no return_url: falls back to the deployment's public site URL", () => {
  assert.equal(resolveTrustedReturnBase(env, "", ""), "https://www.florisyn.com");
  assert.equal(resolveTrustedReturnBase(env, "", undefined), "https://www.florisyn.com");
});

test("a return_url on one of the deployment's own allowed origins is honored, reduced to its origin", () => {
  assert.equal(resolveTrustedReturnBase(env, "", "https://www.florisyn.com/"), "https://www.florisyn.com");
  assert.equal(resolveTrustedReturnBase(env, "", "https://florisyn.com/pay.html?x=1"), "https://florisyn.com");
  assert.equal(resolveTrustedReturnBase(env, "", "https://shop.example-partner.com/anything"), "https://shop.example-partner.com");
});

test("a *.netlify.app host in the body is NOT trusted (anyone can register one) — a real Deploy Preview still resolves through env/Origin, never the body", () => {
  // Body-supplied preview-looking host: ignored.
  assert.equal(resolveTrustedReturnBase(env, "", "https://evil.netlify.app/pay.html"), "https://www.florisyn.com");
  assert.equal(
    resolveTrustedReturnBase(env, "", "https://deploy-preview-191--florisyn-marketing-staging.netlify.app/"),
    "https://www.florisyn.com"
  );
  // A genuine preview deploy is identified by the deploy's own env / the
  // request Origin (resolvePublicSiteUrl), not by what the body claims.
  const previewEnv = { DEPLOY_PRIME_URL: "https://deploy-preview-191--florisyn-marketing-staging.netlify.app" };
  assert.equal(
    resolveTrustedReturnBase(previewEnv, "", "https://evil.netlify.app/"),
    "https://deploy-preview-191--florisyn-marketing-staging.netlify.app"
  );
});

test("an attacker-chosen host is never used — falls back to the deployment's own site URL", () => {
  assert.equal(resolveTrustedReturnBase(env, "", "https://evil.example.com/pay.html"), "https://www.florisyn.com");
  assert.equal(resolveTrustedReturnBase(env, "", "https://www.florisyn.com.evil.example.com"), "https://www.florisyn.com");
  assert.equal(resolveTrustedReturnBase(env, "", "//evil.example.com"), "https://www.florisyn.com");
  assert.equal(resolveTrustedReturnBase(env, "", "javascript:alert(1)"), "https://www.florisyn.com");
  assert.equal(resolveTrustedReturnBase(env, "", "not a url"), "https://www.florisyn.com");
  assert.equal(resolveTrustedReturnBase(env, "", "http://localhost:8888"), "https://www.florisyn.com");
});

test("payment-link-public.js builds Stripe return URLs only through the trusted resolver and keeps PaymentIntent metadata", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "netlify/functions/payment-link-public.js"), "utf8");
  assert.match(src, /resolveTrustedReturnBase\(process\.env, event\.headers\?\.origin \|\| "", body\.return_url\)/);
  assert.doesNotMatch(src, /body\.return_url \|\|/, "return_url must never be used as a raw base again");
  // transfer_data is merged into payment_intent_data, never assigned over
  // it (assigning wholesale dropped the shop/order/link metadata).
  assert.match(src, /sessionParams\.payment_intent_data\.transfer_data = \{ destination: shop\.stripe_connect_account_id \}/);
  assert.doesNotMatch(src, /sessionParams\.payment_intent_data = \{ transfer_data/);
});
