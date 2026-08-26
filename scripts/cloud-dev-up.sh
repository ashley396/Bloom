#!/usr/bin/env bash
# Cloud dev bootstrap for the Bloom / Floravia florist SaaS.
# Brings up Docker + local Supabase, applies the database schema in the correct
# order, and writes a local .env. Safe to run repeatedly (idempotent).
#
# After this finishes, start the app with:  netlify dev --offline --port 8888
#
# NOTE: This is a manual/dev helper. It intentionally starts services and is NOT
# part of the automatic startup update script.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Ensuring Docker daemon is running"
if ! docker info >/dev/null 2>&1; then
  sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
  if ! docker info >/dev/null 2>&1; then
    echo "    starting dockerd..."
    sudo bash -c 'nohup dockerd >/tmp/dockerd.log 2>&1 &'
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
    sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
  fi
fi
docker info >/dev/null 2>&1 || { echo "Docker failed to start; see /tmp/dockerd.log"; exit 1; }

echo "==> Starting local Supabase (no-op if already running)"
supabase start 2>/dev/null || true
# Ensure generated local files are owned by the current user (netlify dev watches them).
sudo chown -R "$(id -un)":"$(id -gn)" supabase/.temp 2>/dev/null || true

DB=$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -1)
[ -n "$DB" ] || { echo "Supabase DB container not found"; exit 1; }
psql() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "==> Applying database schema (idempotent)"
psql < supabase/schema.sql >/dev/null
# Compatibility columns the current app code expects but the base schema lacks.
# (shop_members.status is required by _shared/supabase.js currentUser(); it must
#  exist before the Floravia migration, whose SQL functions reference it.)
psql -c "alter table public.shop_members add column if not exists status text not null default 'active';
         alter table public.shops add column if not exists updated_at timestamptz not null default now();" >/dev/null

APPLY_ORDER=(
  supabase/migrations/v4.1.sql
  supabase/migrations/v4.2.sql
  supabase/migrations/v6.0.sql
  supabase/migrations/v7.0.sql
  supabase/migrations/v8.0.sql
  supabase/migration_v8.5.2_delivery_tracking.sql
  supabase/migration_v9.0_integrated.sql
  supabase/migration_v9.0.1_settings_delivery_fee.sql
  supabase/migration_v9.0.2_receipts.sql
  supabase/migration_v9.0.3_settings_schema.sql
  supabase/migration_v9.0.5_delivery_address.sql
  supabase/migration_v9.1_integrated_workflow.sql
  supabase/migration_v10.1_inventory_pro.sql
  supabase/migration_v11.3_branding.sql
  supabase/migration_v12.0_luxury_branding.sql
  supabase/migration_v13.6_staff_timeclock_payroll.sql
  supabase/migration_v16_profit_intelligence.sql
  supabase/migration_floravia_saas_foundation_v1.sql
  supabase/migration_v18.5_payment_integrity_security.sql
  supabase/migration_v19.1_order_status_hotfix.sql
  supabase/migration_v20.5_admin_control_center.sql
  supabase/migration_v20.6_subscriber_intelligence.sql
  supabase/migration_v21_platform_edition.sql
)
for f in "${APPLY_ORDER[@]}"; do
  printf '    %-60s' "$f"
  if psql < "$f" >/dev/null 2>/tmp/sql_err; then echo "ok"; else echo "FAILED"; cat /tmp/sql_err; exit 1; fi
done

echo "==> Granting API-role privileges (tables created via psql need explicit grants)"
psql <<'SQL' >/dev/null
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
notify pgrst, 'reload schema';
SQL

echo "==> Writing .env"
status_env=$(supabase status -o env)
get() { echo "$status_env" | grep "^$1=" | head -1 | cut -d'"' -f2; }
cat > .env <<EOF
SUPABASE_URL=$(get API_URL)
SUPABASE_ANON_KEY=$(get ANON_KEY)
SUPABASE_SERVICE_ROLE_KEY=$(get SERVICE_ROLE_KEY)
SITE_URL=http://localhost:8888
BLOOM_MARKETPLACE_FEE_PERCENT=5
EOF

echo "==> Done. Start the app with:  netlify dev --offline --port 8888"
echo "    Supabase Studio: $(get STUDIO_URL 2>/dev/null || echo http://localhost:54323)"
