import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOOM_VERSION_LABEL,
  BLOOM_VERSION_CODE,
  KNOWN_ISSUES_V1,
  MIGRATION_MANIFEST,
  probeMigrationStatus
} from "../netlify/functions/_shared/bloom-release.js";

/** Minimal stand-in for the Supabase client's .from().select().limit() chain. */
function fakeClient(errorByTable = {}) {
  return {
    from(table) {
      return {
        select() {
          return {
            limit() {
              return Promise.resolve({ error: errorByTable[table] || null });
            }
          };
        }
      };
    }
  };
}

test("Florisyn version label matches product naming", () => {
  assert.match(BLOOM_VERSION_LABEL, /Florisyn 1\.0/);
  assert.equal(BLOOM_VERSION_CODE, "founder-1.0");
});
test("migration manifest includes release candidate feedback migration", () => {
  assert.ok(MIGRATION_MANIFEST.some((m) => m.file.includes("release_candidate_v1")));
});

test("known issues documents university gap", () => {
  assert.ok(KNOWN_ISSUES_V1.some((i) => i.id === "university"));
});

test("probeMigrationStatus reports 'applied' for a real table with no id column", async () => {
  // Regression: platform_feature_flags exists (its key is flag_key, not id) but the
  // probe used to select("id", ...), so a real, applied migration reported "error"
  // in the admin Migration status panel even though nothing was actually wrong.
  const client = fakeClient({});
  const results = await probeMigrationStatus(client);
  const commandCenter = results.find((r) => r.id === "command_center");
  assert.equal(commandCenter.status, "applied");
});

test("probeMigrationStatus reports 'missing' when the probe table does not exist", async () => {
  const client = fakeClient({
    platform_feature_flags: { message: 'relation "public.platform_feature_flags" does not exist' }
  });
  const results = await probeMigrationStatus(client);
  const commandCenter = results.find((r) => r.id === "command_center");
  assert.equal(commandCenter.status, "missing");
});

test("probeMigrationStatus reports 'error' for a genuine, unrelated failure", async () => {
  const client = fakeClient({ platform_feature_flags: { message: "permission denied for table platform_feature_flags" } });
  const results = await probeMigrationStatus(client);
  const commandCenter = results.find((r) => r.id === "command_center");
  assert.equal(commandCenter.status, "error");
});
