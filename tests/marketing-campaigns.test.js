import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getFeatureFlags, isFeatureEnabled } from "../netlify/functions/_shared/feature-flags.js";
import {
  validateMarketingCampaignBody,
  CAMPAIGN_STATUSES,
  CAMPAIGN_CHANNELS,
} from "../netlify/functions/_shared/marketing-campaigns.js";

const root = process.cwd();

test("MARKETING_CAMPAIGNS defaults ON for growth rollout", () => {
  const flags = getFeatureFlags({});
  assert.equal(flags.MARKETING_CAMPAIGNS, true);
  assert.equal(isFeatureEnabled("MARKETING_CAMPAIGNS", {}), true);
  assert.equal(
    isFeatureEnabled("MARKETING_CAMPAIGNS", { FLORISYN_FLAG_MARKETING_CAMPAIGNS: "false" }),
    false
  );
});

test("campaign validation requires a name and rejects an invalid status", () => {
  assert.equal(validateMarketingCampaignBody({}).valid, false);
  const ok = validateMarketingCampaignBody({ name: "Mother's Day 2027" });
  assert.equal(ok.valid, true);
  assert.equal(ok.sanitized.name, "Mother's Day 2027");
  assert.equal(ok.sanitized.status, "draft");
  assert.equal(validateMarketingCampaignBody({ name: "X", status: "live" }).valid, false);
  for (const status of CAMPAIGN_STATUSES) {
    assert.equal(validateMarketingCampaignBody({ name: "X", status }).valid, true);
  }
});

test("campaign date range must be start before end, same as holiday peaks", () => {
  assert.equal(
    validateMarketingCampaignBody({ name: "X", starts_on: "2027-05-09", ends_on: "2027-05-01" }).valid,
    false
  );
  assert.equal(
    validateMarketingCampaignBody({ name: "X", starts_on: "2027-05-01", ends_on: "2027-05-09" }).valid,
    true
  );
  assert.equal(validateMarketingCampaignBody({ name: "X", starts_on: "not-a-date" }).valid, false);
});

test("campaign product_ids and channels are validated, not trusted raw", () => {
  const badProduct = validateMarketingCampaignBody({ name: "X", product_ids: ["not-a-uuid"] });
  assert.equal(badProduct.valid, false);

  const goodProduct = validateMarketingCampaignBody({
    name: "X",
    product_ids: ["11111111-1111-4111-8111-111111111111"],
  });
  assert.equal(goodProduct.valid, true);
  assert.deepEqual(goodProduct.sanitized.product_ids, ["11111111-1111-4111-8111-111111111111"]);

  const badChannel = validateMarketingCampaignBody({ name: "X", channels: ["instagram_ads"] });
  assert.equal(badChannel.valid, false);

  const goodChannels = validateMarketingCampaignBody({ name: "X", channels: ["email", "email", "holiday"] });
  assert.equal(goodChannels.valid, true);
  // Only channels Florisyn has real backend support for today — never a
  // decorative channel with no integration behind it.
  assert.deepEqual(goodChannels.sanitized.channels, ["email", "holiday"]);
  assert.ok(CAMPAIGN_CHANNELS.includes("email"));
  assert.ok(!CAMPAIGN_CHANNELS.includes("google_ads"));
});

test("marketing-campaigns.js gates on the feature flag and stays shop-scoped", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketing-campaigns.js"), "utf8");
  assert.match(src, /isFeatureEnabled\("MARKETING_CAMPAIGNS"\)/);
  assert.match(src, /currentUser\(event\)/);
  assert.match(src, /eq\("shop_id", shopId\)/);
  // The attach action must also verify the target campaign belongs to this
  // shop before letting a florist point their own content at it — not
  // just trust a bare campaign_id from the client.
  assert.match(src, /eq\("shop_id", shopId\)[\s\S]*maybeSingle/);
});

test("migration adds shop-scoped RLS for marketing_campaigns and links existing content", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260819120000_marketing_campaigns_v1.sql"),
    "utf8"
  );
  assert.match(sql, /create table if not exists public\.marketing_campaigns/i);
  assert.match(sql, /alter table public\.marketing_campaigns enable row level security/i);
  assert.match(sql, /is_shop_member\(shop_id\)/);
  assert.match(sql, /revoke all on table public\.marketing_campaigns from anon/i);
  // Nullable FKs onto existing content — never breaks a standalone email
  // campaign or holiday peak that isn't attached to any campaign.
  assert.match(sql, /add column if not exists campaign_id uuid references public\.marketing_campaigns\(id\) on delete set null/);
});

test("marketing-campaigns.js checks the audiences action before the generic GET/list branch", () => {
  const src = fs.readFileSync(path.join(root, "netlify/functions/marketing-campaigns.js"), "utf8");
  const audiencesIdx = src.indexOf('action === "audiences"');
  const listIdx = src.indexOf('method === "GET" || action === "list"');
  assert.ok(audiencesIdx > -1 && listIdx > -1);
  assert.ok(
    audiencesIdx < listIdx,
    "the audiences branch must be checked first — method===\"GET\" alone would otherwise shadow ?action=audiences"
  );
  // Only the columns segmentation needs — never the customer's name,
  // phone, email, address, or notes.
  assert.match(src, /\.from\("customers"\)\s*\n?\s*\.select\("id,vip,birthday,anniversary,created_at,contact_preferences"\)/);
  assert.doesNotMatch(src, /select\("[^"]*\b(name|phone|email|address|notes)\b[^"]*"\)[^)]*customers/);
});

test("Marketing nav stays hidden until the flag enables it, same as its connected tools", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /data-page="marketingPage"[^>]*hidden/);
  assert.match(html, /id="marketingRoot"/);
  assert.match(html, /marketing-campaigns-ui\.js/);
});
