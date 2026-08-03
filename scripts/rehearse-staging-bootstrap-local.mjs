#!/usr/bin/env node
/**
 * Rehearse the greenfield staging bootstrap plan against a clean local PostgreSQL database.
 *
 * - Applies the ordered SQL chain (local stub + foundation + bridges + migrations).
 * - Stops on first failure.
 * - Verifies required schemas/objects for PR #13 tip readiness.
 * - Does NOT connect to hosted Supabase / staging.
 * - Does NOT apply Staff A2 or rollback SQL.
 *
 * Env:
 *   STAGING_BOOTSTRAP_DATABASE_URL  (required) — local Postgres URL only
 *   STAGING_BOOTSTRAP_RESET=1       (optional) — drop+recreate public/auth/storage schemas first
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const DATABASE_URL = process.env.STAGING_BOOTSTRAP_DATABASE_URL || "";
const RESET = String(process.env.STAGING_BOOTSTRAP_RESET || "") === "1";

/** Ordered greenfield apply list for a brand-new project targeting PR #13 tip. */
export const STAGING_BOOTSTRAP_ORDER = [
  // Local-only stub (skip on hosted Supabase — documented in plan)
  { file: "scripts/sql/local-supabase-compat-stub.sql", phase: "local-stub", localOnly: true },

  // Foundation + greenfield bridges
  { file: "supabase/migration_floravia_saas_foundation_v1.sql", phase: "foundation" },
  { file: "scripts/sql/greenfield-core-pos-bridge.sql", phase: "greenfield-bridge" },
  { file: "scripts/sql/greenfield-shop-members-status-align.sql", phase: "greenfield-bridge" },

  // Commercial ladder in migrations/
  { file: "supabase/migrations/v4.1.sql", phase: "commercial" },
  { file: "supabase/migrations/v4.2.sql", phase: "commercial" },
  { file: "supabase/migrations/v6.0.sql", phase: "commercial" },
  { file: "supabase/migrations/v7.0.sql", phase: "commercial" },
  { file: "supabase/migrations/v8.0.sql", phase: "commercial" },

  // Legacy version chain (platform_admins, payments integrity, etc.)
  { file: "supabase/migration_v8.5.2_delivery_tracking.sql", phase: "legacy-version" },
  { file: "supabase/migration_v9.0_integrated.sql", phase: "legacy-version" },
  { file: "supabase/migration_v9.0.1_settings_delivery_fee.sql", phase: "legacy-version" },
  { file: "supabase/migration_v9.0.2_receipts.sql", phase: "legacy-version" },
  { file: "supabase/migration_v9.0.3_settings_schema.sql", phase: "legacy-version" },
  { file: "supabase/migration_v9.0.5_delivery_address.sql", phase: "legacy-version" },
  { file: "supabase/migration_v9.1_integrated_workflow.sql", phase: "legacy-version" },
  { file: "supabase/migration_v10.1_inventory_pro.sql", phase: "legacy-version" },
  { file: "supabase/migration_v11.3_branding.sql", phase: "legacy-version" },
  { file: "supabase/migration_v12.0_luxury_branding.sql", phase: "legacy-version" },
  { file: "supabase/migration_v13.6_staff_timeclock_payroll.sql", phase: "legacy-version" },
  { file: "supabase/migration_v16_profit_intelligence.sql", phase: "legacy-version" },
  { file: "supabase/migration_v18.5_payment_integrity_security.sql", phase: "legacy-version" },
  { file: "supabase/migration_v19.1_order_status_hotfix.sql", phase: "legacy-version" },
  { file: "supabase/migration_v20.5_admin_control_center.sql", phase: "legacy-version" },
  { file: "supabase/migration_v20.6_subscriber_intelligence.sql", phase: "legacy-version" },
  { file: "supabase/migration_v21_platform_edition.sql", phase: "legacy-version" },
  { file: "supabase/migration_v22.1_growth_foundation.sql", phase: "legacy-version" },

  // Dated marketplace / payments / RC / foundation
  { file: "supabase/migrations/20260727_marketplace_verification_production_v1.sql", phase: "dated" },
  { file: "supabase/migrations/20260727_marketplace_security_hardening_v1.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_marketplace_milestone_v2.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_wholesale_seller_v1.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_command_center_v1.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_lily_ai_platform_v1.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_release_candidate_v1.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_business_ecosystem_v1.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_subscription_center_v1.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_payment_hub_v1.sql", phase: "dated" },
  { file: "supabase/migrations/20260729_post_order_payment_v185.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_payment_hub_pro_v1.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_payment_experience_v1_2.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_payments_live_wiring_v1_3.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_bloom_rc1_instant_websites.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_bloom_rc1_1_storefront.sql", phase: "dated" },
  { file: "supabase/migrations/20260728_bloom_rc1_2_commerce.sql", phase: "dated" },
  { file: "supabase/migrations/20260730_foundation_daily_loop_v1.sql", phase: "dated" },
  { file: "supabase/migrations/20260730_delivery_proofs_storage.sql", phase: "dated" },

  // PR #13 set
  { file: "supabase/migrations/20260731_florist_community_beta_v1.sql", phase: "pr13" },
  { file: "supabase/migrations/20260731_florist_community_beta_v1_r1_security.sql", phase: "pr13" },
  { file: "supabase/migrations/20260801_p0_01_floral_library_schema_lock_v1.sql", phase: "pr13" },
];

export const EXCLUDED_FROM_BOOTSTRAP = [
  "supabase/migrations/marketplace_verification_schema.sql",
  "supabase/migrations/20260729_phase2a_a2_staff_time_entries_rls_v1.sql",
  "supabase/migrations/20260730_foundation_daily_loop_v1_rollback.sql",
  "supabase/schema.sql", // conflicts with foundation shops shape; superseded by foundation + core-pos bridge
];

const REQUIRED_RELATIONS = [
  "public.shops",
  "public.shop_members",
  "public.platform_admins",
  "public.customers",
  "public.orders",
  "public.inventory",
  "public.bloom_floral_library_master",
  "public.bloom_library_import_batches",
  "public.florist_community_profiles",
  "public.florist_community_posts",
  "public.florist_community_comments",
  "public.florist_community_likes",
  "public.florist_community_reports",
  "storage.buckets",
];

const REQUIRED_FUNCTIONS = [
  "public.is_shop_member",
  "public.is_platform_admin_user",
  "public.can_read_unapproved_floral_library_master",
  "public.florist_community_image_readable",
];

function assertLocalUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("STAGING_BOOTSTRAP_DATABASE_URL is not a valid URL");
  }
  const host = (u.hostname || "").toLowerCase();
  const local =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local");
  if (!local) {
    throw new Error(
      `Refusing to run rehearsal against non-local host '${host}'. Use 127.0.0.1/localhost only.`
    );
  }
  if (host.includes("supabase.co")) {
    throw new Error("Refusing to run rehearsal against supabase.co");
  }
}

async function applyFile(client, relPath) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) throw new Error(`Missing SQL file: ${relPath}`);
  const sql = fs.readFileSync(abs, "utf8");
  process.stdout.write(`APPLY ${relPath} ... `);
  try {
    await client.query(sql);
    process.stdout.write("ok\n");
    return { file: relPath, ok: true };
  } catch (err) {
    process.stdout.write("FAIL\n");
    throw Object.assign(err, { applyFile: relPath });
  }
}

async function resetSchemas(client) {
  process.stdout.write("RESET schemas public/auth/storage ... ");
  await client.query(`
    drop schema if exists public cascade;
    create schema public;
    grant all on schema public to public;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
  `);
  process.stdout.write("ok\n");
}

async function verify(client) {
  const missing = [];
  for (const reg of REQUIRED_RELATIONS) {
    const { rows } = await client.query("select to_regclass($1) as r", [reg]);
    if (!rows[0]?.r) missing.push(`relation ${reg}`);
  }
  for (const fn of REQUIRED_FUNCTIONS) {
    const { rows } = await client.query(
      `select 1 from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = $1 and p.proname = $2
       limit 1`,
      [fn.split(".")[0], fn.split(".")[1]]
    );
    if (!rows.length) missing.push(`function ${fn}`);
  }

  const { rows: bucketRows } = await client.query(
    `select id, public from storage.buckets where id = 'florist-community'`
  );
  if (!bucketRows.length) missing.push("storage.buckets florist-community");
  else if (bucketRows[0].public === true) missing.push("florist-community bucket must be private");

  const { rows: rlsRows } = await client.query(`
    select c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'florist_community_posts',
        'bloom_floral_library_master',
        'bloom_library_import_batches',
        'platform_admins'
      )
  `);
  for (const name of [
    "florist_community_posts",
    "bloom_floral_library_master",
    "bloom_library_import_batches",
    "platform_admins",
  ]) {
    const row = rlsRows.find((r) => r.relname === name);
    if (!row?.relrowsecurity) missing.push(`RLS disabled on public.${name}`);
  }

  return missing;
}

async function main() {
  if (!DATABASE_URL) {
    console.error("Set STAGING_BOOTSTRAP_DATABASE_URL to a local Postgres URL.");
    process.exitCode = 1;
    return;
  }

  let client;
  const results = [];
  try {
    assertLocalUrl(DATABASE_URL);
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();

    if (RESET) await resetSchemas(client);

    for (const step of STAGING_BOOTSTRAP_ORDER) {
      const r = await applyFile(client, step.file);
      results.push({ ...r, phase: step.phase, localOnly: !!step.localOnly });
    }

    const missing = await verify(client);
    if (missing.length) {
      console.error("VERIFY FAILED:");
      for (const m of missing) console.error(` - ${m}`);
      process.exitCode = 1;
      return;
    }

    console.log("VERIFY ok — required Florisyn relations/functions/RLS present");
    console.log(`Applied ${results.length} SQL files successfully`);
    console.log("Excluded (not applied):");
    for (const e of EXCLUDED_FROM_BOOTSTRAP) console.log(` - ${e}`);
    console.log("STOP — no hosted staging connection or mutation performed");
  } catch (err) {
    console.error(`Bootstrap rehearsal FAILED at ${err.applyFile || "unknown"}`);
    console.error(String(err.message || err));
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
