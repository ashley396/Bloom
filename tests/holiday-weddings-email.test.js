import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getFeatureFlags, isFeatureEnabled } from "../netlify/functions/_shared/feature-flags.js";
import {
  validateHolidayPeakBody,
  holidayCapacityAlert,
  validateEmailCampaignBody,
  validateWeddingProjectBody,
  validateWeddingChecklistBody,
  HOLIDAY_STATUSES,
  EMAIL_STATUSES,
  WEDDING_STATUSES,
} from "../netlify/functions/_shared/holiday-weddings-email.js";

const root = process.cwd();

test("HOLIDAY_COMMAND_CENTER / EMAIL_CAMPAIGNS / WEDDING_WORKFLOWS default ON for growth rollout", () => {
  const flags = getFeatureFlags({});
  assert.equal(flags.HOLIDAY_COMMAND_CENTER, true);
  assert.equal(flags.EMAIL_CAMPAIGNS, true);
  assert.equal(flags.WEDDING_WORKFLOWS, true);
  assert.equal(isFeatureEnabled("HOLIDAY_COMMAND_CENTER", {}), true);
  assert.equal(isFeatureEnabled("EMAIL_CAMPAIGNS", {}), true);
  assert.equal(isFeatureEnabled("WEDDING_WORKFLOWS", {}), true);
  assert.equal(
    isFeatureEnabled("HOLIDAY_COMMAND_CENTER", { FLORISYN_FLAG_HOLIDAY_COMMAND_CENTER: "false" }),
    false
  );
});

test("holiday peak validation requires name and date range", () => {
  assert.equal(validateHolidayPeakBody({}).valid, false);
  const ok = validateHolidayPeakBody({
    name: "Valentine's Day",
    starts_on: "2026-02-01",
    ends_on: "2026-02-14",
    target_orders: 40,
    current_orders: 10,
    alert_threshold: 75,
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.sanitized.name, "Valentine's Day");
  assert.equal(
    validateHolidayPeakBody({
      name: "X",
      starts_on: "2026-02-14",
      ends_on: "2026-02-01",
    }).valid,
    false
  );
  assert.ok(HOLIDAY_STATUSES.includes("paused"));
});

test("holiday capacity alert levels", () => {
  assert.equal(holidayCapacityAlert({ target_orders: 0 }).level, "none");
  assert.equal(
    holidayCapacityAlert({ target_orders: 100, current_orders: 50, alert_threshold: 80 }).level,
    "ok"
  );
  assert.equal(
    holidayCapacityAlert({ target_orders: 100, current_orders: 85, alert_threshold: 80 }).level,
    "warn"
  );
  assert.equal(
    holidayCapacityAlert({ target_orders: 100, current_orders: 100, alert_threshold: 80 }).level,
    "critical"
  );
  assert.equal(
    holidayCapacityAlert({
      target_orders: 100,
      current_orders: 10,
      is_paused: true,
    }).level,
    "paused"
  );
});

test("email campaign validation and status set", () => {
  assert.equal(validateEmailCampaignBody({}).valid, false);
  const ok = validateEmailCampaignBody({
    name: "Mother's Day",
    subject: "Order early",
    body_html: "<p>Hello</p>",
    audience_note: "opted-in VIP",
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.sanitized.status, "draft");
  assert.ok(EMAIL_STATUSES.includes("scheduled"));
});

test("wedding project and checklist validation", () => {
  assert.equal(validateWeddingProjectBody({}).valid, false);
  const ok = validateWeddingProjectBody({
    couple_names: "Alex & Jordan",
    event_date: "2026-09-12",
    budget_cents: 250000,
    status: "inquiry",
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.sanitized.budget_cents, 250000);
  assert.equal(validateWeddingChecklistBody({ title: "" }).valid, false);
  assert.equal(validateWeddingChecklistBody({ title: "Consult" }).valid, true);
  assert.ok(WEDDING_STATUSES.includes("in_production"));
});

test("API functions gate on feature flags and stay shop-scoped", () => {
  for (const [file, flag] of [
    ["holiday-command.js", "HOLIDAY_COMMAND_CENTER"],
    ["email-campaigns.js", "EMAIL_CAMPAIGNS"],
    ["weddings.js", "WEDDING_WORKFLOWS"],
  ]) {
    const src = fs.readFileSync(path.join(root, "netlify/functions", file), "utf8");
    assert.match(src, new RegExp(`isFeatureEnabled\\("${flag}"\\)`));
    assert.match(src, /currentUser\(event\)/);
    assert.match(src, /eq\("shop_id", shopId\)/);
  }
  const email = fs.readFileSync(path.join(root, "netlify/functions/email-campaigns.js"), "utf8");
  assert.match(email, /email_send_disabled|FLORISYN_EMAIL_CAMPAIGNS_SEND/);
  assert.doesNotMatch(email, /nodemailer|sendgrid|mailgun/i);
});

test("migration adds shop-scoped RLS for holiday, email, wedding tables", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260808210000_holiday_weddings_email_v1.sql"),
    "utf8"
  );
  for (const table of [
    "holiday_peaks",
    "email_campaigns",
    "wedding_projects",
    "wedding_checklist_items",
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /is_shop_member\(shop_id\)/);
  assert.match(sql, /revoke all on table public\.holiday_peaks from anon/i);
  assert.match(sql, /revoke all on table public\.email_campaigns from anon/i);
  assert.match(sql, /revoke all on table public\.wedding_projects from anon/i);
});

test("nav and pages stay hidden until flags enable", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /data-page="holidayPage"[^>]*hidden/);
  assert.match(html, /data-page="emailCampaignsPage"[^>]*hidden/);
  assert.match(html, /data-page="weddingsPage"[^>]*hidden/);
  assert.match(html, /data-route="\/florist-network"/);
  assert.match(html, /id="holidayPage"/);
  assert.match(html, /id="emailCampaignsPage"/);
  assert.match(html, /id="weddingsPage"/);
  assert.match(html, /holiday-command-ui\.js/);
  assert.match(html, /email-campaigns-ui\.js/);
  assert.match(html, /weddings-ui\.js/);

  const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(app, /refreshGrowthFeatureFlags|HOLIDAY_COMMAND_CENTER/);
  assert.match(app, /EMAIL_CAMPAIGNS/);
  assert.match(app, /WEDDING_WORKFLOWS/);
  assert.match(app, /FLORIST_NETWORK/);
  assert.match(app, /setHolidayNavVisible/);
  assert.match(app, /setEmailCampaignsNavVisible/);
  assert.match(app, /setWeddingsNavVisible/);
  assert.match(app, /loadHolidayPage/);
  assert.match(app, /loadEmailCampaignsPage/);
  assert.match(app, /loadWeddingsPage/);
  assert.match(app, /loadFloristNetworkPage/);

  assert.match(
    fs.readFileSync(path.join(root, "public/holiday-command-ui.js"), "utf8"),
    /BloomHolidayCommand/
  );
  assert.match(
    fs.readFileSync(path.join(root, "public/email-campaigns-ui.js"), "utf8"),
    /BloomEmailCampaigns/
  );
  assert.match(fs.readFileSync(path.join(root, "public/weddings-ui.js"), "utf8"), /BloomWeddings/);
});
