#!/usr/bin/env node
/**
 * Concatenate GROWTH + Community migrations for one-shot apply in Supabase SQL Editor.
 *
 * Usage:
 *   node scripts/bundle-growth-migrations.mjs > growth-bundle.sql
 *
 * Apply only after backup. Stop on the first error in Supabase.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = [
  "supabase/migrations/20260808210000_holiday_weddings_email_v1.sql",
  "supabase/migrations/20260810130000_florist_network_growth_v1.sql",
  "supabase/migrations/20260810150000_florist_network_zero_platform_fee.sql",
  "supabase/migrations/20260810160000_florist_wire_stripe_settlement.sql",
  "supabase/legacy_migrations/20260731_florist_community_beta_v1.sql",
  "supabase/legacy_migrations/20260731_florist_community_beta_v1_r1_security.sql",
  "supabase/migrations/20260810210000_growth_rpc_grants.sql",
  "supabase/migrations/20260810230000_florist_community_profile_avatar.sql",
];

function cleanSql(sql) {
  return sql.replace(/notify pgrst,\s*'reload schema';/gi, "-- notify omitted in bundled apply");
}

process.stdout.write("-- Florisyn GROWTH migration bundle (generated)\n");
process.stdout.write(`-- Generated: ${new Date().toISOString()}\n\n`);

for (const rel of files) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(`Missing migration file: ${rel}`);
    process.exit(1);
  }
  process.stdout.write(`\n-- ===== ${rel} =====\n\n`);
  process.stdout.write(cleanSql(fs.readFileSync(abs, "utf8")));
  process.stdout.write("\n");
}
