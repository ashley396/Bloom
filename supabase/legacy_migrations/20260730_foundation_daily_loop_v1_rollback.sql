-- =============================================================================
-- EMERGENCY / MANUAL ROLLBACK — Florisyn Foundation v1
-- =============================================================================
-- ⚠️  DO NOT RUN IN PRODUCTION WITHOUT EXPLICIT OWNER APPROVAL AND A FRESH BACKUP
--
-- This script reverses **non-destructive** schema additions from:
--   20260730_foundation_daily_loop_v1.sql
--
-- DEFAULT BEHAVIOR: Does NOT delete user data, order rows, or customer records.
-- It removes added constraints/columns/tables that were introduced by Foundation v1.
--
-- PREFERRED ROLLBACK: Restore Supabase from point-in-time backup taken before apply.
-- Use this file only when backup restore is unavailable and you accept losing:
--   • order_status_history rows
--   • audit_events rows inserted after migration (if table was created by v1)
--   • delivery proof column values
--   • new customer/inventory column values
--
-- Re-run the forward migration after rollback if you need to re-apply Foundation v1.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Restore prior order status constraint (legacy RC values only)
--    Adjust this list if your production DB had a wider constraint before v1.
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (
  status in ('NEW','DESIGNING','READY','OUT_FOR_DELIVERY','COMPLETED','CANCELLED')
);

-- ---------------------------------------------------------------------------
-- 2. Drop Foundation v1 tables (data in these tables will be lost)
-- ---------------------------------------------------------------------------
drop table if exists public.order_status_history;

-- Only drop audit_events if it was created empty by v1 and has no compliance retention requirement.
-- COMMENT OUT the next line if audit_events existed before Foundation v1 with production data:
-- drop table if exists public.audit_events;

-- ---------------------------------------------------------------------------
-- 3. Remove added delivery proof columns (values lost; deliveries rows kept)
-- ---------------------------------------------------------------------------
alter table public.deliveries drop column if exists proof_photo_url;
alter table public.deliveries drop column if exists signature_name;
alter table public.deliveries drop column if exists proof_captured_at;
alter table public.deliveries drop column if exists round_trip_origin;
alter table public.deliveries drop column if exists round_trip_returned_at;

-- ---------------------------------------------------------------------------
-- 4. Remove added customer columns (soft-delete metadata lost; rows kept)
-- ---------------------------------------------------------------------------
alter table public.customers drop column if exists deleted_at;
alter table public.customers drop column if exists contact_preferences;
alter table public.customers drop column if exists is_house_account;

-- ---------------------------------------------------------------------------
-- 5. Remove added inventory columns (metadata lost; rows kept)
-- ---------------------------------------------------------------------------
alter table public.inventory drop column if exists received_at;
alter table public.inventory drop column if exists use_by;
alter table public.inventory drop column if exists color;
alter table public.inventory drop column if exists markup_multiplier;
alter table public.inventory drop column if exists item_kind;

commit;

-- Netlify code rollback: redeploy commit before Foundation v1 (see docs/FOUNDATION_PRODUCTION_RUNBOOK.md)
