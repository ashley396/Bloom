import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeFeatureFlags,
  validateAnnouncementPayload,
  systemHealthSnapshot,
  buildMonthlySeries,
  auditRecordFromRow,
  sanitizeSubscriptionForAdmin,
  DEFAULT_FEATURE_FLAGS
} from "../netlify/functions/_shared/command-center.js";
import fs from "node:fs";

const adminHtml = () => fs.readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const adminJs = () => fs.readFileSync(new URL("../public/admin.js", import.meta.url), "utf8");

test("mergeFeatureFlags applies defaults for unknown keys", () => {
  const flags = mergeFeatureFlags({ marketplace: false });
  assert.equal(flags.marketplace, false);
  assert.equal(flags.ai, DEFAULT_FEATURE_FLAGS.ai);
});

test("validateAnnouncementPayload requires title and body", () => {
  const invalid = validateAnnouncementPayload({ title: "", body: "" });
  assert.equal(invalid.valid, false);
  const valid = validateAnnouncementPayload({ title: "Maintenance", body: "Tonight 10pm CT", audience: "florists", kind: "maintenance" });
  assert.equal(valid.valid, true);
});

test("sanitizeSubscriptionForAdmin omits stripe secrets", () => {
  const sanitized = sanitizeSubscriptionForAdmin({
    shop_id: "s1",
    plan_code: "pro",
    status: "active",
    stripe_customer_id: "cus_123",
    stripe_secret_key: "sk_live_should_not_appear"
  });
  assert.equal(sanitized.stripe_customer_id, "cus_123");
  assert.equal(sanitized.stripe_secret_key, undefined);
});

test("systemHealthSnapshot flags missing env vars", () => {
  const health = systemHealthSnapshot({});
  assert.equal(health.environment_valid, false);
  assert.ok(health.missing_env.length > 0);
});

test("buildMonthlySeries aggregates rows by month", () => {
  const series = buildMonthlySeries([{ created_at: new Date().toISOString() }], { months: 3 });
  assert.equal(series.length, 3);
  assert.equal(series[2].value, 1);
});

test("auditRecordFromRow exposes command center audit fields", () => {
  const row = auditRecordFromRow({
    id: 1,
    created_at: "2026-07-28T12:00:00.000Z",
    admin_user_id: "admin-1",
    shop_id: "shop-1",
    action: "suspend_user",
    details: { target_type: "shop", target_id: "shop-1", result: "success", ip_placeholder: "127.0.0.1" }
  });
  assert.equal(row.action, "suspend_user");
  assert.equal(row.target_type, "shop");
  assert.equal(row.ip_placeholder, "127.0.0.1");
});

test("announcement audience validation accepts florist targeting", () => {
  const valid = validateAnnouncementPayload({
    title: "Holiday hours",
    body: "Support is limited on July 4.",
    audience: "florists",
    kind: "holiday"
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.audience, "florists");
});

test("admin remote editor keeps account, appearance, navigation, features, and subscription edits wired", () => {
  const html = adminHtml();
  const js = adminJs();
  for (const name of [
    "name",
    "email",
    "phone",
    "website",
    "primary",
    "accent",
    "background",
    "sidebar",
    "nav_order",
    "nav_hidden",
    "app_background_image",
    "dashboard_image",
    "logo_image",
    "layout_mode",
    "button_labels",
    "tab_labels",
    "plan_code",
    "subscription_status",
    "account_status"
  ]) {
    assert.match(html, new RegExp(`name="${name}"`));
  }
  assert.match(js, /const FEATURES=\[[^\]]*'website'/);
  assert.match(js, /const FEATURES=\[[^\]]*'lily'/);
  assert.match(js, /const FEATURES=\[[^\]]*'rose'/);
  assert.match(js, /action:'update-shop'/);
  assert.match(js, /action:'save-config'/);
  assert.match(js, /parseJsonField\('button_labels'\)/);
  assert.match(js, /parseJsonField\('tab_labels'\)/);
  assert.match(js, /action:'update-subscription'/);
  assert.match(js, /#saveShop/);
  assert.match(js, /#saveSubscription/);
});
