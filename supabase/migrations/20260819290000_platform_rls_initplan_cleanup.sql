-- Platform-wide auth_rls_initplan cleanup. Same category, same fix, and
-- the same safety guarantee as the marketplace-scoped pass in
-- 20260819250000_marketplace_rls_performance_cleanup.sql: wrapping a
-- direct auth.<fn>() call in a policy's USING/WITH CHECK clause as
-- (select auth.<fn>()) makes Postgres evaluate it once per statement
-- instead of once per row. Pure query-plan optimization, zero change to
-- which rows any policy allows.
--
-- Unlike the marketplace pass, these 29 findings span 15 core platform
-- tables (shops, shop_members, profiles, the florist_community_* family,
-- lily_conversations/messages/action_audit, and
-- bloom_library_duplicate_reviews) rather than one feature area — the
-- marketplace-scoped auth_rls_initplan and multiple_permissive_policies
-- categories are already fully resolved (#123/#124), so this continues
-- the same category platform-wide. Every touched policy was read live
-- from pg_policies before being rewritten here, and only the direct
-- auth.<fn>() calls are wrapped — calls to this codebase's own
-- SECURITY DEFINER/INVOKER helper functions (is_active_florist(),
-- is_shop_member(), is_active_member_of(), user_is_shop_owner(),
-- is_shop_manager_of(), is_platform_admin_user(), etc.) are left exactly
-- as they were; whatever those functions do internally is out of scope
-- for this advisor category and untouched by this migration.
--
-- IMPORTANT DIFFERENCE FROM THE MARKETPLACE PASS: every marketplace
-- policy touched in 20260819250000 happened to already be scoped to
-- `public` in its original CREATE POLICY (no `to authenticated` was ever
-- specified for those, verified against the baseline migration), so
-- recreating them without a `to` clause was a no-op for role scope. That
-- is NOT true here — several of these platform tables' policies (all of
-- florist_community_comments/posts/likes/recipes/reports/profiles,
-- profiles, shop_members, shops) are genuinely scoped to `authenticated`
-- only (confirmed live via pg_policies.roles). Every DROP+CREATE below
-- therefore explicitly repeats the exact original `to <role>` (or omits
-- it, matching a genuinely `public`-scoped original) so role scope is
-- byte-for-byte preserved — a real regression this migration is careful
-- not to introduce.

-- =====================================================================
-- shops
-- =====================================================================

drop policy if exists "shops active member select" on public.shops;
create policy "shops active member select" on public.shops
for select to authenticated using (is_shop_member(id) OR (owner_id = (select auth.uid())) OR (owner_user_id = (select auth.uid())));

-- =====================================================================
-- shop_members
-- =====================================================================

drop policy if exists "members self or owner select" on public.shop_members;
create policy "members self or owner select" on public.shop_members
for select to authenticated using ((user_id = (select auth.uid())) OR user_is_shop_owner(shop_id));

-- =====================================================================
-- profiles
-- =====================================================================

drop policy if exists "profiles own select" on public.profiles;
create policy "profiles own select" on public.profiles
for select to authenticated using (id = (select auth.uid()));

drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update" on public.profiles
for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- =====================================================================
-- florist_community_profiles
-- =====================================================================

drop policy if exists "community profiles insert own" on public.florist_community_profiles;
create policy "community profiles insert own" on public.florist_community_profiles
for insert to authenticated with check ((user_id = (select auth.uid())) AND is_active_member_of(shop_id));

drop policy if exists "community profiles update own" on public.florist_community_profiles;
create policy "community profiles update own" on public.florist_community_profiles
for update to authenticated using ((user_id = (select auth.uid())) AND is_active_florist()) with check ((user_id = (select auth.uid())) AND is_active_member_of(shop_id));

-- =====================================================================
-- florist_community_posts
-- =====================================================================

drop policy if exists "community posts select" on public.florist_community_posts;
create policy "community posts select" on public.florist_community_posts
for select to authenticated using ((is_active_florist() AND (status = 'active'::text)) OR (is_active_florist() AND (author_user_id = (select auth.uid()))) OR is_platform_admin_user() OR (is_active_florist() AND is_shop_manager_of(shop_id)));

drop policy if exists "community posts insert" on public.florist_community_posts;
create policy "community posts insert" on public.florist_community_posts
for insert to authenticated with check ((author_user_id = (select auth.uid())) AND is_active_member_of(shop_id) AND (status = 'active'::text) AND (like_count = 0) AND (comment_count = 0) AND ((image_path IS NULL) OR (image_path ~ (((('^'::text || (shop_id)::text) || '/'::text) || (author_user_id)::text) || '/.+'::text))));

drop policy if exists "community posts update author content" on public.florist_community_posts;
create policy "community posts update author content" on public.florist_community_posts
for update to authenticated using ((author_user_id = (select auth.uid())) AND is_active_florist() AND (status = 'active'::text)) with check ((author_user_id = (select auth.uid())) AND is_active_member_of(shop_id) AND (status = 'active'::text) AND ((image_path IS NULL) OR (image_path ~ (((('^'::text || (shop_id)::text) || '/'::text) || (author_user_id)::text) || '/.+'::text))));

drop policy if exists "community posts delete" on public.florist_community_posts;
create policy "community posts delete" on public.florist_community_posts
for delete to authenticated using ((author_user_id = (select auth.uid())) AND is_active_florist());

-- =====================================================================
-- florist_community_comments
-- =====================================================================

drop policy if exists "community comments select" on public.florist_community_comments;
create policy "community comments select" on public.florist_community_comments
for select to authenticated using (florist_community_post_visible(post_id) AND ((is_active_florist() AND (status = 'active'::text) AND (EXISTS ( SELECT 1 FROM florist_community_posts p WHERE ((p.id = florist_community_comments.post_id) AND (p.status = 'active'::text))))) OR (is_active_florist() AND (author_user_id = (select auth.uid()))) OR is_platform_admin_user() OR (is_active_florist() AND is_shop_manager_of(shop_id))));

drop policy if exists "community comments insert" on public.florist_community_comments;
create policy "community comments insert" on public.florist_community_comments
for insert to authenticated with check ((author_user_id = (select auth.uid())) AND is_active_member_of(shop_id) AND (status = 'active'::text) AND (EXISTS ( SELECT 1 FROM florist_community_posts p WHERE ((p.id = florist_community_comments.post_id) AND (p.status = 'active'::text)))));

drop policy if exists "community comments update author content" on public.florist_community_comments;
create policy "community comments update author content" on public.florist_community_comments
for update to authenticated using ((author_user_id = (select auth.uid())) AND is_active_florist() AND (status = 'active'::text)) with check ((author_user_id = (select auth.uid())) AND is_active_member_of(shop_id) AND (status = 'active'::text));

drop policy if exists "community comments delete" on public.florist_community_comments;
create policy "community comments delete" on public.florist_community_comments
for delete to authenticated using ((author_user_id = (select auth.uid())) AND is_active_florist());

-- =====================================================================
-- florist_community_likes
-- =====================================================================

drop policy if exists "community likes select" on public.florist_community_likes;
create policy "community likes select" on public.florist_community_likes
for select to authenticated using (is_active_florist() AND ((EXISTS ( SELECT 1 FROM florist_community_posts p WHERE ((p.id = florist_community_likes.post_id) AND (p.status = 'active'::text)))) OR is_platform_admin_user() OR (EXISTS ( SELECT 1 FROM florist_community_posts p WHERE ((p.id = florist_community_likes.post_id) AND ((p.author_user_id = (select auth.uid())) OR is_shop_manager_of(p.shop_id)))))));

drop policy if exists "community likes insert" on public.florist_community_likes;
create policy "community likes insert" on public.florist_community_likes
for insert to authenticated with check ((user_id = (select auth.uid())) AND is_active_member_of(shop_id) AND (EXISTS ( SELECT 1 FROM florist_community_posts p WHERE ((p.id = florist_community_likes.post_id) AND (p.status = 'active'::text)))));

drop policy if exists "community likes delete" on public.florist_community_likes;
create policy "community likes delete" on public.florist_community_likes
for delete to authenticated using ((user_id = (select auth.uid())) AND is_active_florist());

-- =====================================================================
-- florist_community_reports
-- =====================================================================

drop policy if exists "community reports insert" on public.florist_community_reports;
create policy "community reports insert" on public.florist_community_reports
for insert to authenticated with check ((reporter_user_id = (select auth.uid())) AND is_active_member_of(reporter_shop_id) AND (status = 'open'::text) AND (EXISTS ( SELECT 1 FROM florist_community_posts p WHERE ((p.id = florist_community_reports.post_id) AND (p.status = 'active'::text)))));

drop policy if exists "community reports select own or admin" on public.florist_community_reports;
create policy "community reports select own or admin" on public.florist_community_reports
for select to authenticated using ((is_active_florist() AND (reporter_user_id = (select auth.uid()))) OR is_platform_admin_user());

-- =====================================================================
-- florist_community_recipes
-- =====================================================================

drop policy if exists "community recipes insert own" on public.florist_community_recipes;
create policy "community recipes insert own" on public.florist_community_recipes
for insert to authenticated with check ((author_user_id = (select auth.uid())) AND is_active_member_of(author_shop_id));

drop policy if exists "community recipes update own" on public.florist_community_recipes;
create policy "community recipes update own" on public.florist_community_recipes
for update to authenticated using ((author_user_id = (select auth.uid())) AND is_active_florist()) with check ((author_user_id = (select auth.uid())) AND is_active_member_of(author_shop_id));

-- =====================================================================
-- florist_community_follows (roles = public in the original, unchanged)
-- =====================================================================

drop policy if exists "community follows insert" on public.florist_community_follows;
create policy "community follows insert" on public.florist_community_follows
for insert with check ((follower_user_id = (select auth.uid())) AND is_active_member_of(shop_id));

drop policy if exists "community follows delete" on public.florist_community_follows;
create policy "community follows delete" on public.florist_community_follows
for delete using ((follower_user_id = (select auth.uid())) AND is_active_florist());

-- =====================================================================
-- florist_community_notifications (roles = public in the original, unchanged)
-- =====================================================================

drop policy if exists "community notifications select own" on public.florist_community_notifications;
create policy "community notifications select own" on public.florist_community_notifications
for select using ((recipient_user_id = (select auth.uid())) AND is_active_florist());

drop policy if exists "community notifications mark read" on public.florist_community_notifications;
create policy "community notifications mark read" on public.florist_community_notifications
for update using ((recipient_user_id = (select auth.uid())) AND is_active_florist()) with check (recipient_user_id = (select auth.uid()));

-- =====================================================================
-- lily_conversations / lily_messages / lily_action_audit
-- (roles = public in the original, unchanged)
-- =====================================================================

drop policy if exists "lily conversations owner" on public.lily_conversations;
create policy "lily conversations owner" on public.lily_conversations
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "lily messages owner" on public.lily_messages;
create policy "lily messages owner" on public.lily_messages
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "lily action audit owner read" on public.lily_action_audit;
create policy "lily action audit owner read" on public.lily_action_audit
for select using ((select auth.uid()) = user_id);

-- =====================================================================
-- bloom_library_duplicate_reviews (roles = public in the original, unchanged)
-- =====================================================================

drop policy if exists "duplicate reviews admin" on public.bloom_library_duplicate_reviews;
create policy "duplicate reviews admin" on public.bloom_library_duplicate_reviews
for all using (EXISTS ( SELECT 1 FROM platform_admins pa WHERE ((pa.user_id = (select auth.uid())) AND pa.active)));

notify pgrst, 'reload schema';
