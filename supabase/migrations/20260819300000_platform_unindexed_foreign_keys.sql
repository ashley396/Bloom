-- Platform-wide unindexed_foreign_keys cleanup. Same category, same fix,
-- and the same safety guarantee as the 17 covering indexes added for
-- marketplace tables in 20260819250000_marketplace_rls_performance_cleanup.sql:
-- a plain, purely-additive `create index if not exists` on a foreign-key
-- column that currently has no covering index at all. This never changes
-- query results — it only gives the planner (and cascading FK checks on
-- the referenced table's UPDATE/DELETE) a usable index to walk instead
-- of a full table scan.
--
-- Scope: the 114 `unindexed_foreign_keys` advisor findings remaining
-- after the marketplace-scoped pass, across every other table in the
-- schema. Each (table, fkey_name) pair below was resolved against
-- pg_constraint live (not guessed from the advisor's prose) to get the
-- exact column(s) the constraint covers, then cross-checked against
-- pg_indexes to confirm the new index name doesn't collide with
-- anything that already exists. One index per finding, named
-- `<table>_<column>_idx` to match this codebase's existing convention
-- (see e.g. `orders_shop_id_idx`, `customers_shop_id_idx` from the same
-- earlier migration).
--
-- Nothing here is a judgment call the way multiple_permissive_policies
-- or unused_index were — every unindexed FK genuinely benefits from a
-- covering index, and adding one is never a regression, so all 114 are
-- included in a single migration rather than split up.

-- audit_events
create index if not exists audit_events_actor_user_id_idx on public.audit_events(actor_user_id);

-- bloom_customer_subscriptions
create index if not exists bloom_customer_subscriptions_customer_id_idx on public.bloom_customer_subscriptions(customer_id);

-- bloom_delivery_details
create index if not exists bloom_delivery_details_delivery_id_idx on public.bloom_delivery_details(delivery_id);
create index if not exists bloom_delivery_details_order_id_idx on public.bloom_delivery_details(order_id);
create index if not exists bloom_delivery_details_shop_id_idx on public.bloom_delivery_details(shop_id);

-- bloom_library_duplicate_reviews
create index if not exists bloom_library_duplicate_reviews_reviewed_by_idx on public.bloom_library_duplicate_reviews(reviewed_by);

-- bloom_loyalty_accounts
create index if not exists bloom_loyalty_accounts_shop_id_idx on public.bloom_loyalty_accounts(shop_id);

-- bloom_loyalty_transactions
create index if not exists bloom_loyalty_transactions_customer_id_idx on public.bloom_loyalty_transactions(customer_id);
create index if not exists bloom_loyalty_transactions_shop_id_idx on public.bloom_loyalty_transactions(shop_id);

-- bloom_membership_enrollments
create index if not exists bloom_membership_enrollments_customer_id_idx on public.bloom_membership_enrollments(customer_id);
create index if not exists bloom_membership_enrollments_plan_id_idx on public.bloom_membership_enrollments(plan_id);
create index if not exists bloom_membership_enrollments_shop_id_idx on public.bloom_membership_enrollments(shop_id);

-- bloom_purchase_order_lines
create index if not exists bloom_purchase_order_lines_purchase_order_id_idx on public.bloom_purchase_order_lines(purchase_order_id);
create index if not exists bloom_purchase_order_lines_shop_id_idx on public.bloom_purchase_order_lines(shop_id);

-- bloom_purchase_orders
create index if not exists bloom_purchase_orders_approved_by_idx on public.bloom_purchase_orders(approved_by);
create index if not exists bloom_purchase_orders_shop_id_idx on public.bloom_purchase_orders(shop_id);
create index if not exists bloom_purchase_orders_vendor_id_idx on public.bloom_purchase_orders(vendor_id);

-- bloom_shop_catalog_products
create index if not exists bloom_shop_catalog_products_master_library_id_idx on public.bloom_shop_catalog_products(master_library_id);
create index if not exists bloom_shop_catalog_products_shop_id_idx on public.bloom_shop_catalog_products(shop_id);

-- bloom_storefront_order_events
create index if not exists bloom_storefront_order_events_order_id_idx on public.bloom_storefront_order_events(order_id);

-- bloom_storefront_preview_tokens
create index if not exists bloom_storefront_preview_tokens_created_by_idx on public.bloom_storefront_preview_tokens(created_by);

-- bloom_vendor_profiles
create index if not exists bloom_vendor_profiles_shop_id_idx on public.bloom_vendor_profiles(shop_id);
create index if not exists bloom_vendor_profiles_supplier_id_idx on public.bloom_vendor_profiles(supplier_id);

-- bloom_website_page_versions
create index if not exists bloom_website_page_versions_page_id_idx on public.bloom_website_page_versions(page_id);
create index if not exists bloom_website_page_versions_shop_id_idx on public.bloom_website_page_versions(shop_id);

-- bloom_website_pages
create index if not exists bloom_website_pages_shop_id_idx on public.bloom_website_pages(shop_id);

-- customer_portal_access
create index if not exists customer_portal_access_customer_id_idx on public.customer_portal_access(customer_id);

-- email_campaigns
create index if not exists email_campaigns_created_by_idx on public.email_campaigns(created_by);

-- florist_community_comments
create index if not exists florist_community_comments_author_user_id_idx on public.florist_community_comments(author_user_id);
create index if not exists florist_community_comments_shop_id_idx on public.florist_community_comments(shop_id);

-- florist_community_follows
create index if not exists florist_community_follows_shop_id_idx on public.florist_community_follows(shop_id);

-- florist_community_likes
create index if not exists florist_community_likes_shop_id_idx on public.florist_community_likes(shop_id);

-- florist_community_notifications
create index if not exists florist_community_notifications_actor_user_id_idx on public.florist_community_notifications(actor_user_id);
create index if not exists florist_community_notifications_comment_id_idx on public.florist_community_notifications(comment_id);
create index if not exists florist_community_notifications_post_id_idx on public.florist_community_notifications(post_id);
create index if not exists florist_community_notifications_shop_id_idx on public.florist_community_notifications(shop_id);

-- florist_community_posts
create index if not exists florist_community_posts_answered_comment_id_idx on public.florist_community_posts(answered_comment_id);

-- florist_community_recipes
create index if not exists florist_community_recipes_author_shop_id_idx on public.florist_community_recipes(author_shop_id);
create index if not exists florist_community_recipes_author_user_id_idx on public.florist_community_recipes(author_user_id);

-- florist_community_reports
create index if not exists florist_community_reports_reporter_shop_id_idx on public.florist_community_reports(reporter_shop_id);
create index if not exists florist_community_reports_reporter_user_id_idx on public.florist_community_reports(reporter_user_id);

-- florist_wire_orders
create index if not exists florist_wire_orders_created_by_idx on public.florist_wire_orders(created_by);
create index if not exists florist_wire_orders_source_order_id_idx on public.florist_wire_orders(source_order_id);

-- florist_wire_ratings
create index if not exists florist_wire_ratings_rater_shop_id_idx on public.florist_wire_ratings(rater_shop_id);

-- gift_card_transactions
create index if not exists gift_card_transactions_actor_user_id_idx on public.gift_card_transactions(actor_user_id);
create index if not exists gift_card_transactions_gift_card_id_idx on public.gift_card_transactions(gift_card_id);
create index if not exists gift_card_transactions_order_id_idx on public.gift_card_transactions(order_id);
create index if not exists gift_card_transactions_shop_id_idx on public.gift_card_transactions(shop_id);

-- gift_cards
create index if not exists gift_cards_issued_by_idx on public.gift_cards(issued_by);

-- holiday_peaks
create index if not exists holiday_peaks_created_by_idx on public.holiday_peaks(created_by);

-- house_account_statements
create index if not exists house_account_statements_house_account_id_idx on public.house_account_statements(house_account_id);
create index if not exists house_account_statements_shop_id_idx on public.house_account_statements(shop_id);

-- house_account_transactions
create index if not exists house_account_transactions_actor_user_id_idx on public.house_account_transactions(actor_user_id);
create index if not exists house_account_transactions_house_account_id_idx on public.house_account_transactions(house_account_id);
create index if not exists house_account_transactions_order_id_idx on public.house_account_transactions(order_id);
create index if not exists house_account_transactions_shop_id_idx on public.house_account_transactions(shop_id);

-- house_accounts
create index if not exists house_accounts_customer_id_idx on public.house_accounts(customer_id);

-- integration_events
create index if not exists integration_events_shop_id_idx on public.integration_events(shop_id);

-- lily_action_audit
create index if not exists lily_action_audit_user_id_idx on public.lily_action_audit(user_id);

-- lily_conversations
create index if not exists lily_conversations_shop_id_idx on public.lily_conversations(shop_id);

-- lily_messages
create index if not exists lily_messages_shop_id_idx on public.lily_messages(shop_id);
create index if not exists lily_messages_user_id_idx on public.lily_messages(user_id);

-- marketing_campaigns
create index if not exists marketing_campaigns_created_by_idx on public.marketing_campaigns(created_by);

-- marketing_promotions
create index if not exists marketing_promotions_activated_by_idx on public.marketing_promotions(activated_by);
create index if not exists marketing_promotions_campaign_id_idx on public.marketing_promotions(campaign_id);
create index if not exists marketing_promotions_created_by_idx on public.marketing_promotions(created_by);

-- order_status_history
create index if not exists order_status_history_changed_by_idx on public.order_status_history(changed_by);
create index if not exists order_status_history_order_id_idx on public.order_status_history(order_id);

-- orders
create index if not exists orders_customer_id_idx on public.orders(customer_id);
create index if not exists orders_user_id_idx on public.orders(user_id);

-- payment_hub_payment_links
create index if not exists payment_hub_payment_links_customer_id_idx on public.payment_hub_payment_links(customer_id);

-- payment_hub_recovery_attempts
create index if not exists payment_hub_recovery_attempts_order_id_idx on public.payment_hub_recovery_attempts(order_id);
create index if not exists payment_hub_recovery_attempts_payment_id_idx on public.payment_hub_recovery_attempts(payment_id);
create index if not exists payment_hub_recovery_attempts_payment_link_id_idx on public.payment_hub_recovery_attempts(payment_link_id);

-- payment_hub_recurring_runs
create index if not exists payment_hub_recurring_runs_order_id_idx on public.payment_hub_recurring_runs(order_id);
create index if not exists payment_hub_recurring_runs_payment_id_idx on public.payment_hub_recurring_runs(payment_id);
create index if not exists payment_hub_recurring_runs_subscription_id_idx on public.payment_hub_recurring_runs(subscription_id);

-- payment_hub_refunds
create index if not exists payment_hub_refunds_actor_user_id_idx on public.payment_hub_refunds(actor_user_id);
create index if not exists payment_hub_refunds_payment_id_idx on public.payment_hub_refunds(payment_id);

-- payment_hub_saved_methods
create index if not exists payment_hub_saved_methods_customer_id_idx on public.payment_hub_saved_methods(customer_id);

-- payments
create index if not exists payments_customer_id_idx on public.payments(customer_id);
create index if not exists payments_received_by_idx on public.payments(received_by);

-- platform_admin_audit
create index if not exists platform_admin_audit_admin_user_id_idx on public.platform_admin_audit(admin_user_id);
create index if not exists platform_admin_audit_shop_id_idx on public.platform_admin_audit(shop_id);

-- platform_admin_notifications
create index if not exists platform_admin_notifications_shop_id_idx on public.platform_admin_notifications(shop_id);

-- platform_agent_fix_requests
create index if not exists platform_agent_fix_requests_requested_by_idx on public.platform_agent_fix_requests(requested_by);
create index if not exists platform_agent_fix_requests_shop_id_idx on public.platform_agent_fix_requests(shop_id);
create index if not exists platform_agent_fix_requests_ticket_id_idx on public.platform_agent_fix_requests(ticket_id);

-- platform_announcements
create index if not exists platform_announcements_created_by_idx on public.platform_announcements(created_by);

-- platform_beta_feedback
create index if not exists platform_beta_feedback_shop_id_idx on public.platform_beta_feedback(shop_id);
create index if not exists platform_beta_feedback_user_id_idx on public.platform_beta_feedback(user_id);

-- platform_feature_flags
create index if not exists platform_feature_flags_updated_by_idx on public.platform_feature_flags(updated_by);

-- platform_library_photos
create index if not exists platform_library_photos_created_by_idx on public.platform_library_photos(created_by);

-- platform_settings
create index if not exists platform_settings_updated_by_idx on public.platform_settings(updated_by);

-- platform_support_items
create index if not exists platform_support_items_assigned_to_idx on public.platform_support_items(assigned_to);
create index if not exists platform_support_items_shop_id_idx on public.platform_support_items(shop_id);
create index if not exists platform_support_items_user_id_idx on public.platform_support_items(user_id);

-- pos_quotes
create index if not exists pos_quotes_created_by_idx on public.pos_quotes(created_by);
create index if not exists pos_quotes_customer_id_idx on public.pos_quotes(customer_id);

-- product_recipes
create index if not exists product_recipes_inventory_id_idx on public.product_recipes(inventory_id);
create index if not exists product_recipes_shop_id_idx on public.product_recipes(shop_id);

-- profiles
create index if not exists profiles_default_shop_id_idx on public.profiles(default_shop_id);

-- shop_admin_config
create index if not exists shop_admin_config_updated_by_idx on public.shop_admin_config(updated_by);

-- shop_referral_attributions
create index if not exists shop_referral_attributions_referrer_shop_id_idx on public.shop_referral_attributions(referrer_shop_id);

-- shop_subscription_events
create index if not exists shop_subscription_events_actor_user_id_idx on public.shop_subscription_events(actor_user_id);

-- shop_subscription_exit_surveys
create index if not exists shop_subscription_exit_surveys_actor_user_id_idx on public.shop_subscription_exit_surveys(actor_user_id);

-- shops
create index if not exists shops_owner_id_idx on public.shops(owner_id);
create index if not exists shops_owner_user_id_idx on public.shops(owner_user_id);

-- staff_time_entries
create index if not exists staff_time_entries_shop_id_idx on public.staff_time_entries(shop_id);

-- suppliers
create index if not exists suppliers_shop_id_idx on public.suppliers(shop_id);

-- wedding_checklist_items
create index if not exists wedding_checklist_items_shop_id_idx on public.wedding_checklist_items(shop_id);

-- wedding_projects
create index if not exists wedding_projects_created_by_idx on public.wedding_projects(created_by);
create index if not exists wedding_projects_customer_id_idx on public.wedding_projects(customer_id);
create index if not exists wedding_projects_order_id_idx on public.wedding_projects(order_id);

notify pgrst, 'reload schema';
