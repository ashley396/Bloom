-- Supabase's "duplicate_index" advisor flagged two tables where the exact
-- same index (same table, same columns, same index type) exists twice
-- under two different names:
--
--   public.deliveries: {deliveries_shop_id_idx, deliveries_shop_idx}
--   public.products:   {products_shop_id_idx,   products_shop_idx}
--
-- Both pairs are byte-identical plain btree(shop_id) indexes (verified live
-- via pg_indexes) and neither index in either pair backs a constraint
-- (verified via pg_constraint — no PK/unique/FK depends on any of the
-- four). This is a stronger safety guarantee than a typical "unused index"
-- finding: it isn't a traffic-dependent judgment call, it's two indexes
-- with the literal same definition, so the query planner could never have
-- a reason to prefer one over the other. Keeping both only costs storage
-- and doubles the write-time maintenance on every insert/update to these
-- tables for zero benefit.
--
-- The `_shop_idx` name (no "id") is the one created by the tracked
-- greenfield baseline migration (20260804000000_greenfield_baseline.sql:
-- `create index if not exists products_shop_idx on public.products(shop_id);`
-- and the equivalent for deliveries). The `_shop_id_idx` twin isn't
-- created anywhere in supabase/migrations or supabase/legacy_migrations —
-- it was added directly against the database outside the tracked
-- migration chain at some point, so it's the one dropped here in favor of
-- keeping the index whose creation is part of the source-of-truth history.
drop index if exists public.deliveries_shop_id_idx;
drop index if exists public.products_shop_id_idx;

notify pgrst, 'reload schema';
