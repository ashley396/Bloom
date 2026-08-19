import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function migrationSql() {
  return fs.readFileSync(
    path.join(root, "supabase/migrations/20260819300000_platform_unindexed_foreign_keys.sql"),
    "utf8"
  );
}

// Platform-wide unindexed_foreign_keys cleanup — same purely-additive fix
// as the 17 covering indexes in the marketplace RLS/performance-cleanup
// migration, extended to the remaining 114 findings across every other
// table. Each (table, index name, column) triple below was resolved
// live against pg_constraint before this migration was written, so this
// test checks the migration against that same resolved list rather than
// re-deriving it from the advisor's prose.

const EXPECTED = [
  ["audit_events", "audit_events_actor_user_id_idx", "actor_user_id"],
  ["bloom_customer_subscriptions", "bloom_customer_subscriptions_customer_id_idx", "customer_id"],
  ["bloom_delivery_details", "bloom_delivery_details_delivery_id_idx", "delivery_id"],
  ["bloom_delivery_details", "bloom_delivery_details_order_id_idx", "order_id"],
  ["bloom_delivery_details", "bloom_delivery_details_shop_id_idx", "shop_id"],
  ["bloom_library_duplicate_reviews", "bloom_library_duplicate_reviews_reviewed_by_idx", "reviewed_by"],
  ["bloom_loyalty_accounts", "bloom_loyalty_accounts_shop_id_idx", "shop_id"],
  ["bloom_loyalty_transactions", "bloom_loyalty_transactions_customer_id_idx", "customer_id"],
  ["bloom_loyalty_transactions", "bloom_loyalty_transactions_shop_id_idx", "shop_id"],
  ["bloom_membership_enrollments", "bloom_membership_enrollments_customer_id_idx", "customer_id"],
  ["bloom_membership_enrollments", "bloom_membership_enrollments_plan_id_idx", "plan_id"],
  ["bloom_membership_enrollments", "bloom_membership_enrollments_shop_id_idx", "shop_id"],
  ["bloom_purchase_order_lines", "bloom_purchase_order_lines_purchase_order_id_idx", "purchase_order_id"],
  ["bloom_purchase_order_lines", "bloom_purchase_order_lines_shop_id_idx", "shop_id"],
  ["bloom_purchase_orders", "bloom_purchase_orders_approved_by_idx", "approved_by"],
  ["bloom_purchase_orders", "bloom_purchase_orders_shop_id_idx", "shop_id"],
  ["bloom_purchase_orders", "bloom_purchase_orders_vendor_id_idx", "vendor_id"],
  ["bloom_shop_catalog_products", "bloom_shop_catalog_products_master_library_id_idx", "master_library_id"],
  ["bloom_shop_catalog_products", "bloom_shop_catalog_products_shop_id_idx", "shop_id"],
  ["bloom_storefront_order_events", "bloom_storefront_order_events_order_id_idx", "order_id"],
  ["bloom_storefront_preview_tokens", "bloom_storefront_preview_tokens_created_by_idx", "created_by"],
  ["bloom_vendor_profiles", "bloom_vendor_profiles_shop_id_idx", "shop_id"],
  ["bloom_vendor_profiles", "bloom_vendor_profiles_supplier_id_idx", "supplier_id"],
  ["bloom_website_page_versions", "bloom_website_page_versions_page_id_idx", "page_id"],
  ["bloom_website_page_versions", "bloom_website_page_versions_shop_id_idx", "shop_id"],
  ["bloom_website_pages", "bloom_website_pages_shop_id_idx", "shop_id"],
  ["customer_portal_access", "customer_portal_access_customer_id_idx", "customer_id"],
  ["email_campaigns", "email_campaigns_created_by_idx", "created_by"],
  ["florist_community_comments", "florist_community_comments_author_user_id_idx", "author_user_id"],
  ["florist_community_comments", "florist_community_comments_shop_id_idx", "shop_id"],
  ["florist_community_follows", "florist_community_follows_shop_id_idx", "shop_id"],
  ["florist_community_likes", "florist_community_likes_shop_id_idx", "shop_id"],
  ["florist_community_notifications", "florist_community_notifications_actor_user_id_idx", "actor_user_id"],
  ["florist_community_notifications", "florist_community_notifications_comment_id_idx", "comment_id"],
  ["florist_community_notifications", "florist_community_notifications_post_id_idx", "post_id"],
  ["florist_community_notifications", "florist_community_notifications_shop_id_idx", "shop_id"],
  ["florist_community_posts", "florist_community_posts_answered_comment_id_idx", "answered_comment_id"],
  ["florist_community_recipes", "florist_community_recipes_author_shop_id_idx", "author_shop_id"],
  ["florist_community_recipes", "florist_community_recipes_author_user_id_idx", "author_user_id"],
  ["florist_community_reports", "florist_community_reports_reporter_shop_id_idx", "reporter_shop_id"],
  ["florist_community_reports", "florist_community_reports_reporter_user_id_idx", "reporter_user_id"],
  ["florist_wire_orders", "florist_wire_orders_created_by_idx", "created_by"],
  ["florist_wire_orders", "florist_wire_orders_source_order_id_idx", "source_order_id"],
  ["florist_wire_ratings", "florist_wire_ratings_rater_shop_id_idx", "rater_shop_id"],
  ["gift_card_transactions", "gift_card_transactions_actor_user_id_idx", "actor_user_id"],
  ["gift_card_transactions", "gift_card_transactions_gift_card_id_idx", "gift_card_id"],
  ["gift_card_transactions", "gift_card_transactions_order_id_idx", "order_id"],
  ["gift_card_transactions", "gift_card_transactions_shop_id_idx", "shop_id"],
  ["gift_cards", "gift_cards_issued_by_idx", "issued_by"],
  ["holiday_peaks", "holiday_peaks_created_by_idx", "created_by"],
  ["house_account_statements", "house_account_statements_house_account_id_idx", "house_account_id"],
  ["house_account_statements", "house_account_statements_shop_id_idx", "shop_id"],
  ["house_account_transactions", "house_account_transactions_actor_user_id_idx", "actor_user_id"],
  ["house_account_transactions", "house_account_transactions_house_account_id_idx", "house_account_id"],
  ["house_account_transactions", "house_account_transactions_order_id_idx", "order_id"],
  ["house_account_transactions", "house_account_transactions_shop_id_idx", "shop_id"],
  ["house_accounts", "house_accounts_customer_id_idx", "customer_id"],
  ["integration_events", "integration_events_shop_id_idx", "shop_id"],
  ["lily_action_audit", "lily_action_audit_user_id_idx", "user_id"],
  ["lily_conversations", "lily_conversations_shop_id_idx", "shop_id"],
  ["lily_messages", "lily_messages_shop_id_idx", "shop_id"],
  ["lily_messages", "lily_messages_user_id_idx", "user_id"],
  ["marketing_campaigns", "marketing_campaigns_created_by_idx", "created_by"],
  ["marketing_promotions", "marketing_promotions_activated_by_idx", "activated_by"],
  ["marketing_promotions", "marketing_promotions_campaign_id_idx", "campaign_id"],
  ["marketing_promotions", "marketing_promotions_created_by_idx", "created_by"],
  ["order_status_history", "order_status_history_changed_by_idx", "changed_by"],
  ["order_status_history", "order_status_history_order_id_idx", "order_id"],
  ["orders", "orders_customer_id_idx", "customer_id"],
  ["orders", "orders_user_id_idx", "user_id"],
  ["payment_hub_payment_links", "payment_hub_payment_links_customer_id_idx", "customer_id"],
  ["payment_hub_recovery_attempts", "payment_hub_recovery_attempts_order_id_idx", "order_id"],
  ["payment_hub_recovery_attempts", "payment_hub_recovery_attempts_payment_id_idx", "payment_id"],
  ["payment_hub_recovery_attempts", "payment_hub_recovery_attempts_payment_link_id_idx", "payment_link_id"],
  ["payment_hub_recurring_runs", "payment_hub_recurring_runs_order_id_idx", "order_id"],
  ["payment_hub_recurring_runs", "payment_hub_recurring_runs_payment_id_idx", "payment_id"],
  ["payment_hub_recurring_runs", "payment_hub_recurring_runs_subscription_id_idx", "subscription_id"],
  ["payment_hub_refunds", "payment_hub_refunds_actor_user_id_idx", "actor_user_id"],
  ["payment_hub_refunds", "payment_hub_refunds_payment_id_idx", "payment_id"],
  ["payment_hub_saved_methods", "payment_hub_saved_methods_customer_id_idx", "customer_id"],
  ["payments", "payments_customer_id_idx", "customer_id"],
  ["payments", "payments_received_by_idx", "received_by"],
  ["platform_admin_audit", "platform_admin_audit_admin_user_id_idx", "admin_user_id"],
  ["platform_admin_audit", "platform_admin_audit_shop_id_idx", "shop_id"],
  ["platform_admin_notifications", "platform_admin_notifications_shop_id_idx", "shop_id"],
  ["platform_agent_fix_requests", "platform_agent_fix_requests_requested_by_idx", "requested_by"],
  ["platform_agent_fix_requests", "platform_agent_fix_requests_shop_id_idx", "shop_id"],
  ["platform_agent_fix_requests", "platform_agent_fix_requests_ticket_id_idx", "ticket_id"],
  ["platform_announcements", "platform_announcements_created_by_idx", "created_by"],
  ["platform_beta_feedback", "platform_beta_feedback_shop_id_idx", "shop_id"],
  ["platform_beta_feedback", "platform_beta_feedback_user_id_idx", "user_id"],
  ["platform_feature_flags", "platform_feature_flags_updated_by_idx", "updated_by"],
  ["platform_library_photos", "platform_library_photos_created_by_idx", "created_by"],
  ["platform_settings", "platform_settings_updated_by_idx", "updated_by"],
  ["platform_support_items", "platform_support_items_assigned_to_idx", "assigned_to"],
  ["platform_support_items", "platform_support_items_shop_id_idx", "shop_id"],
  ["platform_support_items", "platform_support_items_user_id_idx", "user_id"],
  ["pos_quotes", "pos_quotes_created_by_idx", "created_by"],
  ["pos_quotes", "pos_quotes_customer_id_idx", "customer_id"],
  ["product_recipes", "product_recipes_inventory_id_idx", "inventory_id"],
  ["product_recipes", "product_recipes_shop_id_idx", "shop_id"],
  ["profiles", "profiles_default_shop_id_idx", "default_shop_id"],
  ["shop_admin_config", "shop_admin_config_updated_by_idx", "updated_by"],
  ["shop_referral_attributions", "shop_referral_attributions_referrer_shop_id_idx", "referrer_shop_id"],
  ["shop_subscription_events", "shop_subscription_events_actor_user_id_idx", "actor_user_id"],
  ["shop_subscription_exit_surveys", "shop_subscription_exit_surveys_actor_user_id_idx", "actor_user_id"],
  ["shops", "shops_owner_id_idx", "owner_id"],
  ["shops", "shops_owner_user_id_idx", "owner_user_id"],
  ["staff_time_entries", "staff_time_entries_shop_id_idx", "shop_id"],
  ["suppliers", "suppliers_shop_id_idx", "shop_id"],
  ["wedding_checklist_items", "wedding_checklist_items_shop_id_idx", "shop_id"],
  ["wedding_projects", "wedding_projects_created_by_idx", "created_by"],
  ["wedding_projects", "wedding_projects_customer_id_idx", "customer_id"],
  ["wedding_projects", "wedding_projects_order_id_idx", "order_id"],
];

test("adds exactly the 114 resolved covering indexes, one per finding, and no others", () => {
  const sql = migrationSql();
  const creates = sql.match(/create index if not exists [\w]+ on public\.[\w]+\([\w]+\);/g) || [];
  assert.equal(creates.length, EXPECTED.length, `expected ${EXPECTED.length} create index statements`);
  assert.equal(creates.length, 114);
});

test("every expected (table, index name, column) triple is present with the exact resolved column", () => {
  const sql = migrationSql();
  for (const [table, idxName, col] of EXPECTED) {
    const pattern = new RegExp(
      `create index if not exists ${idxName} on public\\.${table}\\(${col}\\);`
    );
    assert.match(sql, pattern, `missing or malformed statement for ${table}.${col} (${idxName})`);
  }
});

test("every index is purely additive — 'if not exists', never a bare create index that could error on rerun", () => {
  const sql = migrationSql();
  const bareCreates = sql.match(/create index (?!if not exists)\w/g) || [];
  assert.equal(bareCreates.length, 0, "every create index statement must use 'if not exists'");
});

test("no statement other than create index / comments / notify appears in the migration", () => {
  const sql = migrationSql();
  const meaningfulLines = sql
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("--"));
  for (const line of meaningfulLines) {
    assert.ok(
      /^create index if not exists/.test(line) || /^notify pgrst/.test(line),
      `unexpected statement in a purely-additive index migration: ${line}`
    );
  }
});

test("migration is registered in both canonical migration-chain lists", () => {
  const snapshot = fs.readFileSync(path.join(root, "tests/florisyn-live-schema-snapshot.test.js"), "utf8");
  const chain = fs.readFileSync(path.join(root, "tests/p0-11-canonical-migration-chain.test.js"), "utf8");
  assert.match(snapshot, /20260819300000_platform_unindexed_foreign_keys\.sql/);
  assert.match(chain, /20260819300000_platform_unindexed_foreign_keys\.sql/);
});
