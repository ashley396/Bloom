import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeSiteAnalyticsPayload,
  referrerHost
} from "../netlify/functions/_shared/validation.js";
import { summarizeSiteAnalytics } from "../netlify/functions/_shared/command-center.js";
import { createAdminCommandCenterHandler } from "../netlify/functions/admin-command-center.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

// --- referrerHost -----------------------------------------------------

test("referrerHost extracts a bare, lowercased hostname and drops www.", () => {
  assert.equal(referrerHost("https://www.Google.com/search?q=florist+software"), "google.com");
  assert.equal(referrerHost("https://chatgpt.com/c/abc123"), "chatgpt.com");
});

test("referrerHost never leaks the query string or path", () => {
  const host = referrerHost("https://www.bing.com/search?q=secret+customer+lookup");
  assert.equal(host, "bing.com");
  assert.ok(!host.includes("secret"));
});

test("referrerHost returns null for missing or unparseable referrers", () => {
  assert.equal(referrerHost(null), null);
  assert.equal(referrerHost(""), null);
  assert.equal(referrerHost("not a url"), null);
});

// --- sanitizeSiteAnalyticsPayload --------------------------------------

test("sanitizeSiteAnalyticsPayload accepts a well-formed pageview", () => {
  const safe = sanitizeSiteAnalyticsPayload({
    event_type: "site_pageview",
    path: "/company/pricing/",
    referrer: "https://www.google.com/search?q=florist+pos",
    landing_path: "/company/founding-florists/",
    landing_referrer: "https://chatgpt.com/",
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: "aug-launch",
    session_id: "abc123"
  });
  assert.ok(safe);
  assert.equal(safe.eventType, "site_pageview");
  assert.equal(safe.metadata.path, "/company/pricing/");
  assert.equal(safe.metadata.referrer_host, "google.com");
  assert.equal(safe.metadata.landing_path, "/company/founding-florists/");
  assert.equal(safe.metadata.landing_referrer_host, "chatgpt.com");
  assert.equal(safe.metadata.utm_source, "newsletter");
});

test("sanitizeSiteAnalyticsPayload rejects unknown event types", () => {
  assert.equal(sanitizeSiteAnalyticsPayload({ event_type: "totally_made_up", path: "/" }), null);
});

test("sanitizeSiteAnalyticsPayload rejects a missing or malformed path", () => {
  assert.equal(sanitizeSiteAnalyticsPayload({ event_type: "site_pageview" }), null);
  assert.equal(sanitizeSiteAnalyticsPayload({ event_type: "site_pageview", path: "not-a-path" }), null);
});

test("sanitizeSiteAnalyticsPayload only ever emits the fixed allowlisted metadata shape", () => {
  const safe = sanitizeSiteAnalyticsPayload({
    event_type: "site_cta_click",
    path: "/company/pricing/",
    cta_id: "pricing-premium-signup",
    // Attempted injection of arbitrary fields — must never reach metadata.
    password: "hunter2",
    ip: "203.0.113.5",
    email: "someone@example.com",
    __proto__: { polluted: true }
  });
  assert.ok(safe);
  assert.deepEqual(Object.keys(safe.metadata).sort(), [
    "cta_id",
    "landing_path",
    "landing_referrer_host",
    "path",
    "referrer_host",
    "session_id",
    "utm_campaign",
    "utm_medium",
    "utm_source"
  ]);
  assert.equal(safe.metadata.cta_id, "pricing-premium-signup");
  assert.equal("password" in safe.metadata, false);
  assert.equal("ip" in safe.metadata, false);
  assert.equal("email" in safe.metadata, false);
  assert.equal("polluted" in safe.metadata, false);
});

test("sanitizeSiteAnalyticsPayload truncates oversized strings rather than erroring", () => {
  const safe = sanitizeSiteAnalyticsPayload({
    event_type: "site_signup_conversion",
    path: "/signup",
    cta_id: "x".repeat(500)
  });
  assert.ok(safe);
  assert.equal(safe.metadata.cta_id.length, 100);
});

test("sanitizeSiteAnalyticsPayload rejects a non-object body", () => {
  assert.equal(sanitizeSiteAnalyticsPayload(null), null);
  assert.equal(sanitizeSiteAnalyticsPayload("nope"), null);
});

// --- summarizeSiteAnalytics ---------------------------------------------

test("summarizeSiteAnalytics labels known AI-assistant and search-engine referrers", () => {
  const summary = summarizeSiteAnalytics([
    { event_type: "site_pageview", created_at: "2026-08-19T10:00:00Z", metadata: { path: "/", referrer_host: "google.com" } },
    { event_type: "site_pageview", created_at: "2026-08-19T10:01:00Z", metadata: { path: "/company/pricing/", referrer_host: "chatgpt.com" } },
    { event_type: "site_pageview", created_at: "2026-08-19T10:02:00Z", metadata: { path: "/resources/", referrer_host: null } }
  ]);
  assert.equal(summary.pageviews, 3);
  const bySource = Object.fromEntries(summary.top_referrers.map((r) => [r.source, r.count]));
  assert.equal(bySource.Google, 1);
  assert.equal(bySource.ChatGPT, 1);
  assert.equal(bySource["Direct / unknown"], 1);
});

test("summarizeSiteAnalytics tracks top landing pages by first-touch, not raw pageview path", () => {
  const summary = summarizeSiteAnalytics([
    { event_type: "site_pageview", metadata: { path: "/company/pricing/", landing_path: "/resources/florist-glossary/" } },
    { event_type: "site_pageview", metadata: { path: "/signup", landing_path: "/resources/florist-glossary/" } },
    { event_type: "site_pageview", metadata: { path: "/company/about/", landing_path: "/company/about/" } }
  ]);
  const byPath = Object.fromEntries(summary.top_landing_pages.map((p) => [p.path, p.count]));
  assert.equal(byPath["/resources/florist-glossary/"], 2);
  assert.equal(byPath["/company/about/"], 1);
});

test("summarizeSiteAnalytics counts CTA clicks and signup conversions separately from pageviews", () => {
  const summary = summarizeSiteAnalytics([
    { event_type: "site_pageview", metadata: { path: "/" } },
    { event_type: "site_cta_click", metadata: { path: "/company/pricing/", cta_id: "pricing-premium-signup" } },
    { event_type: "site_cta_click", metadata: { path: "/company/pricing/", cta_id: "pricing-premium-signup" } },
    { event_type: "site_signup_conversion", metadata: { path: "/signup", landing_path: "/company/founding-florists/", landing_referrer_host: "google.com" } }
  ]);
  assert.equal(summary.pageviews, 1);
  assert.equal(summary.cta_clicks, 2);
  assert.equal(summary.signup_conversions, 1);
  assert.deepEqual(summary.top_ctas[0], { cta_id: "pricing-premium-signup", count: 2 });
  assert.equal(summary.founding_florist_landing_conversions, 1);
  assert.deepEqual(summary.conversions_by_landing_referrer[0], { source: "Google", count: 1 });
});

test("summarizeSiteAnalytics is a clean empty state, not an error, with no traffic yet", () => {
  const summary = summarizeSiteAnalytics([]);
  assert.equal(summary.pageviews, 0);
  assert.equal(summary.cta_clicks, 0);
  assert.equal(summary.signup_conversions, 0);
  assert.equal(summary.founding_florist_landing_conversions, 0);
  assert.deepEqual(summary.top_referrers, []);
  assert.deepEqual(summary.top_landing_pages, []);
  assert.deepEqual(summary.top_ctas, []);
  assert.deepEqual(summary.conversions_by_landing_referrer, []);
});

// --- admin-command-center.js: action=site-analytics ----------------------

test("site-analytics admin action reads real marketing_site audit rows, scoped to that entity_type", async () => {
  const client = createFakeSupabaseClient([
    { data: { user_id: "u1", role: "super_admin", active: true }, error: null }, // platform_admins lookup
    {
      data: [
        { created_at: "2026-08-19T10:00:00Z", event_type: "site_pageview", metadata: { path: "/company/pricing/", referrer_host: "google.com", landing_path: "/company/pricing/" } },
        { created_at: "2026-08-19T10:01:00Z", event_type: "site_cta_click", metadata: { path: "/company/pricing/", cta_id: "pricing-premium-signup" } },
        { created_at: "2026-08-19T10:02:00Z", event_type: "site_signup_conversion", metadata: { path: "/signup", landing_path: "/company/founding-florists/", landing_referrer_host: "chatgpt.com" } }
      ],
      error: null
    } // audit_events select
  ]);
  const handler = createAdminCommandCenterHandler({
    authenticate: async () => ({ user: { id: "u1" } }),
    createServerClient: () => client
  });
  const res = await handler({ httpMethod: "GET", queryStringParameters: { action: "site-analytics" }, headers: {} });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.pageviews, 1);
  assert.equal(body.cta_clicks, 1);
  assert.equal(body.signup_conversions, 1);
  assert.equal(body.founding_florist_landing_conversions, 1);
  assert.equal(body.window_days, 30);

  const auditCall = client.calls.find((c) => c.table === "audit_events");
  assert.ok(auditCall, "expected a real audit_events query, not a hardcoded response");
  const eqOp = auditCall.ops.find(([name]) => name === "eq");
  assert.deepEqual(eqOp[1], ["entity_type", "marketing_site"]);
});
