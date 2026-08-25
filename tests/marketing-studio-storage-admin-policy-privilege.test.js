import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createMarketingStudioHandler } from "../netlify/functions/marketing-studio.js";
import { createFakeSupabaseClient, createFakeSupabaseStorage } from "./helpers/fake-supabase-client.mjs";

// The 06f9d07 audit-client fix was real, but it did NOT fix Ashley's actual
// live failure. Live Supabase Postgres logs for her exact request window
// (2026-08-25 ~16:3x UTC) show the REAL failing query:
//
//   application_name: "Supabase Storage API", user_name: "supabase_storage_admin"
//   query: SELECT "id" FROM storage.objects WHERE name=$1 AND bucket_id=$2 LIMIT 1
//   sql_state: 42501 ("permission denied for table platform_admins")
//   hint: "GRANT SELECT ON public.platform_admins TO authenticated"
//
// This is Supabase Storage's own pre-upload existence check (triggered by
// uploadWebsiteMedia()'s `upsert: false` — see ai-image-engine.js's
// generateImage() -> website-media.js's uploadWebsiteMedia(), called from
// generate_content for any non-text_post content type, using Ashley's real
// authenticated client). It has nothing to do with platform_admin_audit.
//
// Root cause: 20260816180000_platform_library_photo_manager.sql's
// "platform library media admin write" policy on storage.objects is
// `for all to authenticated` and checks admin status with a RAW inline
// `exists (select 1 from public.platform_admins pa ...)` instead of the
// established public.is_platform_admin_user() SECURITY DEFINER helper.
// Because that policy is attached to storage.objects for the `authenticated`
// role, Postgres must be able to plan/evaluate it for EVERY authenticated
// operation on that table — regardless of which bucket_id is actually being
// touched — which requires `authenticated` to hold real SELECT privilege on
// platform_admins. It doesn't (by design), so ANY authenticated upload to
// ANY bucket fails this way, not just uploads to platform-library-media.
//
// No application code ever calls `.from("platform_admins")` on this path —
// confirmed below by driving generate_content with a client that throws on
// any such call and observing it never fires. The bug is entirely inside a
// Postgres RLS policy, invisible to a Node-level fake Supabase client except
// as whatever error the real `.storage.upload()` call would return.

const migrationsDir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

/**
 * Minimal, tailored parser for this repo's own `create policy "<name>" on
 * <table> for <cmd> to <role> using (...) with check (...);` shape — not a
 * general SQL parser. Walks every migration in filename (chronological)
 * order and keeps only the LAST body seen for each (table, policy name)
 * pair, exactly mirroring how Postgres migrations actually behave
 * (drop-and-recreate, last writer wins) — so a policy fixed in a later
 * migration is correctly judged by its current, not historical, body.
 */
function currentPolicyBodies() {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const current = new Map(); // key: "table::name" -> body text
  const policyRe = /create policy\s+"([^"]+)"\s+on\s+([a-zA-Z0-9_.]+)([\s\S]*?);/gi;
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    let m;
    policyRe.lastIndex = 0;
    while ((m = policyRe.exec(sql))) {
      const [, name, table, body] = m;
      current.set(`${table}::${name}`, { body, file });
    }
  }
  return current;
}

test("no CURRENT storage.objects policy checks platform-admin status via a raw platform_admins subquery — the actual cause of Ashley's live failure", () => {
  const policies = currentPolicyBodies();
  const offenders = [];
  for (const [key, { body, file }] of policies) {
    if (!key.startsWith("storage.objects::")) continue;
    const referencesPlatformAdminsTable = /platform_admins/i.test(body);
    if (!referencesPlatformAdminsTable) continue;
    // Safe iff every reference is routed through a security-definer helper
    // (is_platform_admin_user(), the established pattern already granted
    // EXECUTE to `authenticated` — see greenfield baseline) rather than a
    // raw table subquery the calling role would need direct privilege for.
    const usesSafeHelper = /is_platform_admin_user\s*\(/.test(body);
    const hasRawSubquery = /from\s+public\.platform_admins/i.test(body) || /from\s+platform_admins/i.test(body);
    if (hasRawSubquery && !usesSafeHelper) offenders.push({ key, file });
  }
  assert.deepEqual(offenders, [], `storage.objects polic(y/ies) checking platform_admins directly instead of via is_platform_admin_user(): ${JSON.stringify(offenders)}`);
});

test("the fixed 'platform library media admin write' policy still requires an ACTIVE platform admin, via the safe security-definer helper, scoped to only its own bucket", () => {
  const policies = currentPolicyBodies();
  const entry = policies.get("storage.objects::platform library media admin write");
  assert.ok(entry, "expected the platform library media admin write policy to still exist");
  assert.match(entry.body, /is_platform_admin_user\s*\(\s*\)/, "must use the safe security-definer helper");
  assert.match(entry.body, /bucket_id\s*=\s*'platform-library-media'/, "must remain scoped to only its own bucket, not opened up to every bucket");
  assert.doesNotMatch(entry.body, /from\s+(public\.)?platform_admins/i, "must not fall back to a raw platform_admins subquery anywhere in its body");
});

// ── Confirms (rather than assumes) that no app-level code queries
// platform_admins on this path — a client that throws on any such access,
// driven through the real florist generate_content dispatch, never fires.

function throwingPlatformAdminsClient(baseResponses, storage) {
  const base = createFakeSupabaseClient(baseResponses, { storage });
  return {
    ...base,
    from(table) {
      if (table === "platform_admins") {
        throw new Error("permission denied for table platform_admins");
      }
      return base.from(table);
    }
  };
}

function floristDeps(client) {
  return { florist: { client, user: { id: "ashley-user-id" }, shopId: "shop-ashley", role: "owner" } };
}
function event(action, body) {
  return { httpMethod: "POST", queryStringParameters: { action }, headers: {}, body: JSON.stringify({ action, ...body }) };
}
function mockCloudflareDualModel({ copyJson, imageBase64 }) {
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_AI_API_TOKEN = "token-test";
  globalThis.fetch = async (url) => {
    const isImageModel = String(url).includes("flux");
    return {
      ok: true,
      json: async () =>
        isImageModel
          ? { success: true, result: { image: imageBase64 } }
          : { success: true, result: { response: JSON.stringify(copyJson) } }
    };
  };
  return {
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

let savedEnv;
test.before(() => {
  savedEnv = { ...process.env };
  delete process.env.FLORISYN_FLAG_MARKETING_STUDIO;
});
test.after(() => {
  process.env = { ...savedEnv };
});

test("generate_content for an image-bearing post (Ashley's real scenario, not text_post) never queries platform_admins directly — confirms the bug is not app-level table access", async () => {
  const mock = mockCloudflareDualModel({
    copyJson: {
      platform: "facebook",
      headline: "h",
      body: "b",
      cta: "c",
      visual_brief: "v",
      hashtags: [],
      asset_requirements: [],
      brand_traits_used: [],
      visual_traits_used: []
    },
    imageBase64: Buffer.from("fake-jpeg-bytes").toString("base64")
  });
  try {
    const storage = createFakeSupabaseStorage({});
    const client = throwingPlatformAdminsClient(
      [
        { data: { id: "item-1", content_type: "social_post", title: "t", brief: "b", status: "idea" }, error: null }, // currentItem
        { data: [{ id: "variant-1", platform: "facebook" }], error: null }, // variants
        { data: { marketing_monthly_budget_cents: null }, error: null }, // budget
        { data: null, error: null }, // content_items update -> generating
        { data: { name: "Test Florals" }, error: null }, // shopRow
        { data: null, error: null }, // loadBrandBrain
        { data: null, error: null }, // loadStyleMemory
        { data: [], error: null }, // loadGroundedInventory
        { data: [], error: null }, // audience: customers
        { data: [], error: null }, // audience: orders
        { data: null, error: null }, // recordUsage("copy")
        { data: null, error: null }, // recordUsage("image")
        { data: { id: "media-1" }, error: null }, // website_media insert
        { data: { id: "img-asset-1" }, error: null }, // persistGeneratedAsset
        { data: null, error: null }, // variant update
        { data: { id: "item-1", status: "draft" }, error: null } // final content_items update
      ],
      storage
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    // This must not throw "permission denied for table platform_admins"
    // itself — if it did, that would mean app code really does query the
    // table directly, which the live logs already disprove.
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 200, `expected a real success given a working (non-denied) storage upload: ${res.body}`);
  } finally {
    mock.restore();
  }
});

test("generate_content surfaces a real storage permission-denial cleanly (400, reverted status) rather than crashing — proves the app itself was never the crash point", async () => {
  const mock = mockCloudflareDualModel({
    copyJson: {
      platform: "facebook",
      headline: "h",
      body: "b",
      cta: "c",
      visual_brief: "v",
      hashtags: [],
      asset_requirements: [],
      brand_traits_used: [],
      visual_traits_used: []
    },
    imageBase64: Buffer.from("fake-jpeg-bytes").toString("base64")
  });
  try {
    // Simulates exactly what a real, still-unfixed storage.objects RLS
    // policy denial looks like from the JS client's own perspective.
    const storage = createFakeSupabaseStorage({
      uploadResponses: [{ data: null, error: { message: "permission denied for table platform_admins", code: "42501" } }]
    });
    const client = createFakeSupabaseClient(
      [
        { data: { id: "item-1", content_type: "social_post", title: "t", brief: "b", status: "idea" }, error: null },
        { data: [{ id: "variant-1", platform: "facebook" }], error: null },
        { data: { marketing_monthly_budget_cents: null }, error: null },
        { data: null, error: null }, // -> generating
        { data: { name: "Test Florals" }, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: null, error: null }, // recordUsage("copy")
        { data: null, error: null }, // -> reverted to idea after the failed upload
        { data: { id: "item-1", status: "idea" }, error: null } // revertToIdea's own update returns the row (not asserted further)
      ],
      { storage }
    );
    const handler = createMarketingStudioHandler(floristDeps(client));
    const res = await handler(event("generate_content", { content_item_id: "item-1" }));
    assert.equal(res.statusCode, 400, `a denied storage write must surface as a clean 400, never a 500/crash: ${res.body}`);
    assert.match(JSON.parse(res.body).error, /permission denied for table platform_admins/);
    const revertCall = client.calls.find(
      (c) => c.table === "marketing_content_items" && c.ops.some((op) => op[0] === "update" && op[1][0]?.status === "idea")
    );
    assert.ok(revertCall, "a failed generation must revert the item back to 'idea', never leave it stuck at 'generating'");
  } finally {
    mock.restore();
  }
});
