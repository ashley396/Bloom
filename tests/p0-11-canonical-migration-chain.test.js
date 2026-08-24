import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ARCHIVED_EXCLUSIONS,
  BASELINE_SOURCES,
  baselineIsCurrent,
  buildBaseline,
} from "../scripts/build-canonical-baseline.mjs";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase/migrations");
const baselinePath = path.join(migrationsDir, "20260804000000_greenfield_baseline.sql");
const legacyDir = path.join(root, "supabase/legacy_migrations");

test("P0-11 executable chain keeps one baseline followed by uniquely versioned forward migrations", () => {
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(files, [
    "20260804000000_greenfield_baseline.sql",
    "20260804171338_p0_09d_function_acl_hardening.sql",
    "20260804185015_p0_10_atomic_order_create.sql",
    "20260804205339_p0_12_closed_beta_tenant_isolation.sql",
    "20260804223000_p0_13_policy_consolidation.sql",
    "20260804224500_p0_14_onboarding_convergence.sql",
    "20260805154819_p0_19_refund_idempotency.sql",
    "20260808161129_hq_service_role_grants.sql",
    "20260808210000_holiday_weddings_email_v1.sql",
    "20260810130000_florist_network_growth_v1.sql",
    "20260810140000_competitive_parity_v2.sql",
    "20260810150000_florist_network_zero_platform_fee.sql",
    "20260810160000_florist_wire_stripe_settlement.sql",
    "20260810210000_growth_rpc_grants.sql",
    "20260810230000_florist_community_profile_avatar.sql",
    "20260810240000_florist_community_storage_policies.sql",
    "20260815000000_website_media_library.sql",
    "20260816180000_platform_library_photo_manager.sql",
    "20260817160000_shop_website_text_color.sql",
    "20260817180000_florist_wire_ratings.sql",
    "20260817200000_florist_wire_sending_commission.sql",
    "20260817210000_bud_fix_requests.sql",
    "20260818000000_florist_community_share_permissions.sql",
    "20260819120000_marketing_campaigns_v1.sql",
    "20260819140000_marketing_promotions_v1.sql",
    "20260819160000_florist_community_follows_search_notifications.sql",
    "20260819170000_marketplace_floral_attributes.sql",
    "20260819180000_marketplace_wholesale_orders_lifecycle.sql",
    "20260819190000_marketplace_seller_storefront.sql",
    "20260819200000_marketplace_notifications.sql",
    "20260819210000_marketplace_seller_reviews.sql",
    "20260819220000_marketplace_order_refunds_disputes.sql",
    "20260819230000_marketplace_standing_orders.sql",
    "20260819240000_marketplace_promotions_buyer_read.sql",
    "20260819250000_marketplace_rls_performance_cleanup.sql",
    "20260819260000_marketplace_multiple_permissive_policies.sql",
    "20260819270000_marketplace_drop_redundant_index.sql",
    "20260819280000_drop_duplicate_shop_indexes.sql",
    "20260819290000_platform_rls_initplan_cleanup.sql",
    "20260819300000_platform_unindexed_foreign_keys.sql",
    "20260819310000_marketplace_pricing_tiers_buyer_read.sql",
    "20260820000000_marketplace_seller_shipping_fee.sql",
    "20260820020000_ai_operating_system_v1.sql",
    "20260820030000_stripe_terminal_location.sql",
    "20260820040000_wedding_inspiration_photos.sql",
    "20260821000000_order_atomic_cross_shop_fk_guard.sql",
    "20260821030000_signup_metadata_not_discarded.sql",
    "20260821040000_missing_grants_notifications_reviews_standing_orders_photos.sql",
    "20260822000000_lily_visual_creation_studio.sql",
    "20260823000000_marketing_studio_foundation_v1.sql",
    "20260824000000_creative_ai_webhook_disclosure_media.sql",
    "20260825000000_personal_brand_studio.sql",
    "20260826000000_digital_twin_lifecycle.sql",
    "20260827000000_revoked_media_quarantine.sql",
    "20260828000000_marketing_studio_budget_controls.sql",
  ]);
  const versions = files.map((name) => name.match(/^(\d{14})_/)?.[1]);
  assert.ok(versions.every(Boolean));
  assert.equal(new Set(versions).size, versions.length);
});

test("P0-11 materialized baseline exactly matches its reviewed sources", () => {
  assert.equal(BASELINE_SOURCES.length, 49);
  assert.equal(baselineIsCurrent(), true);
  assert.equal(fs.readFileSync(baselinePath, "utf8"), buildBaseline());
  const baseline = fs.readFileSync(baselinePath, "utf8");
  for (const source of BASELINE_SOURCES) {
    assert.match(baseline, new RegExp(`BEGIN SOURCE: ${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
});

test("P0-11 excludes rollback, superseded schema, and paused Staff A2 SQL", () => {
  const baseline = fs.readFileSync(baselinePath, "utf8");
  for (const relativePath of ARCHIVED_EXCLUSIONS) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, `${relativePath} must be preserved`);
    assert.doesNotMatch(baseline, new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(baseline, /BEGIN SOURCE: .*rollback/i);
  assert.doesNotMatch(baseline, /BEGIN SOURCE: .*phase2a_a2/i);
  assert.doesNotMatch(baseline, /BEGIN SOURCE: .*marketplace_verification_schema\.sql/i);
});

test("P0-11 preserves the sole hosted migration source byte-for-byte", () => {
  const source = fs.readFileSync(
    path.join(legacyDir, "20260727_marketplace_security_hardening_v1.sql"),
  );
  const digest = crypto.createHash("sha256").update(source).digest("hex");
  assert.equal(digest, "2d6b37a0be3a26d2e8477d1c27bdbf44149cb0fafd9afe72a07121f203ed283b");
});

test("P0-11 baseline contains core tenant, operational, and security contracts", () => {
  const baseline = fs.readFileSync(baselinePath, "utf8");
  for (const relation of [
    "shops",
    "shop_members",
    "customers",
    "orders",
    "inventory",
    "deliveries",
    "audit_events",
    "platform_admins",
    "bloom_floral_library_master",
    "florist_community_posts",
  ]) {
    assert.match(baseline, new RegExp(`(?:create table(?: if not exists)? public\\.${relation}|alter table public\\.${relation})`, "i"));
  }
  assert.match(baseline, /alter table public\.orders enable row level security/i);
  assert.match(baseline, /revoke all on function public\.is_shop_member\(uuid\) from public/i);
  assert.match(baseline, /insert into public\.shops \(owner_user_id, owner_id, name\)/i);
  assert.match(baseline, /create or replace function public\.complete_florist_onboarding/i);
});
