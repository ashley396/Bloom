import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

function read(path) {
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertMatch(text, re, message) {
  assert(re.test(text), message);
}

const head = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
const netlifyToml = read("netlify.toml");
const backupRecovery = read("docs/production/BACKUP-RECOVERY.md");
const deployChecklist = read("docs/production/DEPLOYMENT-CHECKLIST.md");
const migrationOrder = read("docs/production/MIGRATION-ORDER.md");
const ownerChecklist = read("docs/FLORISYN_RC1_OWNER_DEPLOYMENT_CHECKLIST.md");

const rollbackFiles = [
  "supabase/rollback/20260730_delivery_proofs_storage_rollback.sql",
  "supabase/legacy_migrations/20260730_foundation_daily_loop_v1_rollback.sql"
];

assertMatch(netlifyToml, /^\[build\][\s\S]*publish = "public"/m, "Netlify publish directory must remain public.");
assertMatch(netlifyToml, /functions = "netlify\/functions"/, "Netlify functions directory must remain netlify/functions.");
assertMatch(netlifyToml, /X-Frame-Options = "DENY"/, "Security headers must be present in netlify.toml.");

for (const file of rollbackFiles) {
  assert(existsSync(file), `Missing rollback file: ${file}`);
  const sql = read(file);
  assertMatch(sql, /rollback|emergency|drop policy|drop trigger|alter table/i, `${file} does not look like rollback SQL.`);
}

assertMatch(backupRecovery, /Netlify.*Deploys.*Publish|publish previous/i, "Backup recovery doc must include Netlify rollback.");
assertMatch(backupRecovery, /Database.*Backups|PITR|pg_dump/i, "Backup recovery doc must include database backup/restore.");
assertMatch(deployChecklist, /production-health/, "Deployment checklist must include production-health verification.");
assertMatch(deployChecklist, /Stripe webhooks point to staging URL first/i, "Deployment checklist must include staging webhook check.");
assertMatch(migrationOrder, /Never apply a historical `DOWN` or rollback SQL file as a forward migration/i, "Migration order must prohibit forward rollback SQL.");
assertMatch(ownerChecklist, /Current Netlify deploy ID.*recorded/i, "Owner checklist must record rollback deploy ID.");
assertMatch(ownerChecklist, /Database rollback is \*\*last resort\*\*/i, "Owner checklist must keep DB rollback as last resort.");

console.log(JSON.stringify({
  ok: true,
  branch,
  head,
  checks: {
    netlify_config: "ok",
    rollback_files: rollbackFiles,
    rollback_docs: "ok",
    local_verification: [
      "npm run check",
      "node --test tests/*.test.js",
      "npm --prefix frontend run build"
    ]
  }
}, null, 2));
