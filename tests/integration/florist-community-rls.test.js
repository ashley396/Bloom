/**
 * Database-backed Florist Community RLS integration tests (Correction R2).
 * Requires local Postgres with community migrations applied.
 *
 * Setup:
 *   node scripts/apply-community-migrations-local.mjs
 *   npm run test:community-rls
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const DATABASE_URL =
  process.env.COMMUNITY_TEST_DATABASE_URL ||
  "postgres://florisyn_test:florisyn_test@127.0.0.1:5432/florisyn_community_test";

const SHOP_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const USER_INACTIVE = "33333333-3333-3333-3333-333333333333";
const USER_NONE = "44444444-4444-4444-4444-444444444444";
const USER_MGR = "55555555-5555-5555-5555-555555555555";
const USER_PLATFORM = "66666666-6666-6666-6666-666666666666";

function applyMigrations(mode = "reset") {
  const r = spawnSync(process.execPath, [path.join(process.cwd(), "scripts/apply-community-migrations-local.mjs")], {
    env: { ...process.env, COMMUNITY_TEST_DATABASE_URL: DATABASE_URL, COMMUNITY_APPLY_MODE: mode },
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`Migration apply failed (mode=${mode}):\n${r.stdout}\n${r.stderr}`);
  }
  return r.stdout;
}

async function withClient(fn) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function asRole(client, role, userId, fn) {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    if (userId) {
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    } else {
      await client.query(`select set_config('request.jwt.claim.sub', '', true)`);
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/** Separate connection + simultaneous transaction for real concurrency tests. */
async function asRoleOnNewConnection(role, userId, fn) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    if (userId) {
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    } else {
      await client.query(`select set_config('request.jwt.claim.sub', '', true)`);
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    await client.end();
  }
}

async function seed(client) {
  const users = [USER_A, USER_B, USER_INACTIVE, USER_NONE, USER_MGR, USER_PLATFORM];
  for (const id of users) {
    await client.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
      id,
      `${id.slice(0, 8)}@test.local`,
    ]);
  }
  await client.query(`insert into public.shops (id, name) values ($1, 'Shop A'), ($2, 'Shop B') on conflict do nothing`, [
    SHOP_A,
    SHOP_B,
  ]);
  await client.query(`delete from public.florist_community_reports`);
  await client.query(`delete from public.florist_community_likes`);
  await client.query(`delete from public.florist_community_comments`);
  await client.query(`delete from public.florist_community_posts`);
  await client.query(`delete from public.florist_community_profiles`);
  await client.query(`delete from storage.objects`);
  await client.query(`delete from public.platform_admin_audit`);
  await client.query(`delete from public.shop_members`);
  await client.query(
    `insert into public.shop_members (shop_id, user_id, role, status) values
      ($1, $2, 'owner', 'active'),
      ($3, $4, 'owner', 'active'),
      ($1, $5, 'staff', 'suspended'),
      ($1, $6, 'manager', 'active')`,
    [SHOP_A, USER_A, SHOP_B, USER_B, USER_INACTIVE, USER_MGR]
  );
  // Platform admin is NOT a shop member — moderation-only persona.
  await client.query(
    `insert into public.platform_admins (user_id, role, display_name, active)
     values ($1, 'super_admin', 'Platform', true)
     on conflict (user_id) do update set active = true`,
    [USER_PLATFORM]
  );
}

test.before(() => {
  applyMigrations("reset");
});

test.beforeEach(async () => {
  await withClient(async (client) => {
    await seed(client);
  });
});

test("legacy no-status schema: R1 adds status and requires exact active", async () => {
  const bootstrap = fs.readFileSync(
    path.join(process.cwd(), "tests/fixtures/community-rls-bootstrap.sql"),
    "utf8"
  );
  assert.match(bootstrap, /Legacy \/ canonical shape: no status column/);
  assert.doesNotMatch(
    bootstrap,
    /create table if not exists public\.shop_members \([\s\S]*status text/
  );

  const r1 = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260731_florist_community_beta_v1_r1_security.sql"),
    "utf8"
  );
  assert.match(r1, /add column status text/);
  assert.match(r1, /sm\.status = 'active'/);
  assert.doesNotMatch(r1, /coalesce\s*\(\s*sm\.status/i);

  await withClient(async (client) => {
    const { rows } = await client.query(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='shop_members' and column_name='status'
    `);
    assert.equal(rows.length, 1, "R1 must add status onto legacy shop_members");

    const { rows: idx } = await client.query(`
      select indexname from pg_indexes
      where schemaname='public' and indexname='shop_members_active_user_idx'
    `);
    assert.equal(idx.length, 1);

    const active = await asRole(client, "authenticated", USER_A, async (c) =>
      c.query(`select public.is_active_florist() as ok`)
    );
    assert.equal(active.rows[0].ok, true);
    const inactive = await asRole(client, "authenticated", USER_INACTIVE, async (c) =>
      c.query(`select public.is_active_florist() as ok`)
    );
    assert.equal(inactive.rows[0].ok, false);
  });
});

test("R1 migration applies twice without schema reset", async () => {
  const out = applyMigrations("r1-again");
  assert.match(out, /R1 re-applied successfully/);
  await withClient(async (client) => {
    const { rows } = await client.query(
      `select count(*)::int as n from pg_policies where tablename like 'florist_community%'`
    );
    assert.ok(rows[0].n > 0);
    const { rows: modPolicies } = await client.query(`
      select policyname from pg_policies
      where tablename='florist_community_posts'
        and policyname in ('community posts update author content', 'community posts update moderator')
      order by policyname
    `);
    assert.ok(modPolicies.some((r) => r.policyname === "community posts update author content"));
    assert.ok(!modPolicies.some((r) => r.policyname === "community posts update moderator"));

    // Security behavior unchanged: inactive still denied after second apply
    const read = await asRole(client, "authenticated", USER_INACTIVE, async (c) =>
      c.query(`select * from public.florist_community_posts`)
    );
    assert.equal(read.rowCount, 0);
  });
  // Re-seed after second apply for subsequent tests
  await withClient(seed);
});

test("local community migrations apply cleanly", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(
      `select count(*)::int as n from pg_policies where tablename like 'florist_community%'`
    );
    assert.ok(rows[0].n > 0);
  });
});

test("persona matrix: anonymous denied", async () => {
  await withClient(async (client) => {
    // Anon has no table privilege (production-shaped) — not merely RLS empty set.
    await assert.rejects(
      () =>
        asRole(client, "anon", null, async (c) => {
          await c.query(`select * from public.florist_community_posts`);
        }),
      /permission denied|42501/i
    );
    await assert.rejects(
      () =>
        asRole(client, "anon", null, async (c) => {
          await c.query(
            `insert into public.florist_community_posts
             (author_user_id, shop_id, category, caption, status)
             values ($1, $2, 'Questions', 'anon', 'active')`,
            [USER_A, SHOP_A]
          );
        }),
      /row-level security|permission denied|42501|violates/i
    );
  });
});

test("persona matrix: authenticated non-member denied", async () => {
  await withClient(async (client) => {
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_NONE, async (c) => {
          const r = await c.query(`select * from public.florist_community_posts`);
          assert.equal(r.rowCount, 0);
          await c.query(
            `insert into public.florist_community_posts
             (author_user_id, shop_id, category, caption, status)
             values ($1, $2, 'Questions', 'x', 'active')`,
            [USER_NONE, SHOP_A]
          );
        }),
      /row-level security|violates|permission denied|42501|Active florist|membership/i
    );
  });
});

test("persona matrix: inactive member denied read/write", async () => {
  await withClient(async (client) => {
    const { rows: activeCheck } = await asRole(client, "authenticated", USER_INACTIVE, async (c) =>
      c.query(`select public.is_active_florist() as ok`)
    );
    assert.equal(activeCheck[0].ok, false);

    const read = await asRole(client, "authenticated", USER_INACTIVE, async (c) =>
      c.query(`select * from public.florist_community_posts`)
    );
    assert.equal(read.rowCount, 0);

    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_INACTIVE, async (c) => {
          await c.query(
            `insert into public.florist_community_posts
             (author_user_id, shop_id, category, caption, status)
             values ($1, $2, 'Questions', 'inactive post', 'active')`,
            [USER_INACTIVE, SHOP_A]
          );
        }),
      /row-level security|violates/i
    );
  });
});

test("cross-shop: active A and B can read each others active posts", async () => {
  await withClient(async (client) => {
    const postA = await asRole(client, "authenticated", USER_A, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, status)
         values ($1, $2, 'Design Help', 'Shop A tip', 'active')
         returning id`,
        [USER_A, SHOP_A]
      );
      return r.rows[0].id;
    });
    const postB = await asRole(client, "authenticated", USER_B, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, status)
         values ($1, $2, 'Business Advice', 'Shop B tip', 'active')
         returning id`,
        [USER_B, SHOP_B]
      );
      return r.rows[0].id;
    });

    const aSees = await asRole(client, "authenticated", USER_A, async (c) =>
      c.query(`select id, caption from public.florist_community_posts where status='active' order by caption`)
    );
    assert.equal(aSees.rowCount, 2);
    assert.ok(aSees.rows.some((r) => r.id === postB));

    const bSees = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`select id from public.florist_community_posts where status='active'`)
    );
    assert.ok(bSees.rows.some((r) => r.id === postA));
  });
});

test("shop A cannot create content assigned to shop B", async () => {
  await withClient(async (client) => {
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, async (c) => {
          await c.query(
            `insert into public.florist_community_posts
             (author_user_id, shop_id, category, caption, status)
             values ($1, $2, 'Questions', 'spoof', 'active')`,
            [USER_A, SHOP_B]
          );
        }),
      /row-level security|violates|permission denied|42501/i
    );
  });
});

test("cannot impersonate another author", async () => {
  await withClient(async (client) => {
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, async (c) => {
          await c.query(
            `insert into public.florist_community_posts
             (author_user_id, shop_id, category, caption, status)
             values ($1, $2, 'Questions', 'impersonate', 'active')`,
            [USER_B, SHOP_A]
          );
        }),
      /row-level security|violates|permission denied|42501/i
    );
  });
});

test("manager cannot rewrite another florist content or hard-delete", async () => {
  await withClient(async (client) => {
    const postId = await asRole(client, "authenticated", USER_A, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, body, status)
         values ($1, $2, 'Questions', 'owned by A', 'original body', 'active') returning id`,
        [USER_A, SHOP_A]
      );
      return r.rows[0].id;
    });

    const hacked = await asRole(client, "authenticated", USER_MGR, async (c) =>
      c.query(
        `update public.florist_community_posts
         set caption='manager rewrite', body='rewritten', category='Celebrations'
         where id=$1`,
        [postId]
      )
    );
    assert.equal(hacked.rowCount, 0, "manager must not UPDATE content fields via PostgREST policy");

    const deleted = await asRole(client, "authenticated", USER_MGR, async (c) =>
      c.query(`delete from public.florist_community_posts where id=$1`, [postId])
    );
    assert.equal(deleted.rowCount, 0, "manager hard-delete must be unavailable");

    const still = await asRole(client, "authenticated", USER_A, async (c) =>
      c.query(`select caption, body, category from public.florist_community_posts where id=$1`, [postId])
    );
    assert.equal(still.rows[0].caption, "owned by A");
    assert.equal(still.rows[0].body, "original body");

    // Manager may status-moderate via RPC only
    await asRole(client, "authenticated", USER_MGR, async (c) => {
      const r = await c.query(`select public.florist_community_moderate_post($1, 'hidden') as j`, [postId]);
      assert.equal(r.rows[0].j.status, "hidden");
    });
  });
});

test("author cannot change moderation status or restore hidden content", async () => {
  await withClient(async (client) => {
    const postId = await asRole(client, "authenticated", USER_A, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, status)
         values ($1, $2, 'Questions', 'mine', 'active') returning id`,
        [USER_A, SHOP_A]
      );
      return r.rows[0].id;
    });

    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, async (c) => {
          await c.query(`update public.florist_community_posts set status='hidden' where id=$1`, [postId]);
        }),
      /moderation status|moderate RPC|protected/i
    );

    await asRole(client, "authenticated", USER_MGR, async (c) => {
      await c.query(`select public.florist_community_moderate_post($1, 'hidden')`, [postId]);
    });

    const editHidden = await asRole(client, "authenticated", USER_A, async (c) =>
      c.query(`update public.florist_community_posts set caption='restore attempt' where id=$1`, [postId])
    );
    assert.equal(editHidden.rowCount, 0, "author cannot edit/restore hidden posts via policy");
  });
});

test("hidden posts/comments/likes/images locked for ordinary florists", async () => {
  await withClient(async (client) => {
    const imagePath = `${SHOP_A}/${USER_A}/hide-me.jpg`;
    const postId = await asRole(client, "authenticated", USER_A, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, status, image_path)
         values ($1, $2, 'Celebrations', 'hide me', 'active', $3) returning id`,
        [USER_A, SHOP_A, imagePath]
      );
      return r.rows[0].id;
    });

    await asRole(client, "authenticated", USER_A, async (c) => {
      await c.query(
        `insert into storage.objects (bucket_id, name, owner)
         values ('florist-community', $1, $2)`,
        [imagePath, USER_A]
      );
    });

    const commentId = await asRole(client, "authenticated", USER_B, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_comments
         (post_id, author_user_id, shop_id, body, status)
         values ($1, $2, $3, 'nice', 'active') returning id`,
        [postId, USER_B, SHOP_B]
      );
      return r.rows[0].id;
    });

    await asRole(client, "authenticated", USER_B, async (c) => {
      await c.query(`select public.florist_community_toggle_like($1, $2)`, [postId, SHOP_B]);
    });

    // Ordinary florist can read image while active
    const before = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`select name from storage.objects where bucket_id='florist-community' and name=$1`, [imagePath])
    );
    assert.equal(before.rowCount, 1);

    await asRole(client, "authenticated", USER_MGR, async (c) => {
      await c.query(`select public.florist_community_moderate_post($1, 'hidden')`, [postId]);
    });

    const bSeesPost = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`select id from public.florist_community_posts where id=$1`, [postId])
    );
    assert.equal(bSeesPost.rowCount, 0);

    const bSeesComment = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`select id from public.florist_community_comments where id=$1`, [commentId])
    );
    assert.equal(bSeesComment.rowCount, 0);

    const bSeesLike = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`select post_id from public.florist_community_likes where post_id=$1`, [postId])
    );
    assert.equal(bSeesLike.rowCount, 0);

    const bSeesImage = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`select name from storage.objects where bucket_id='florist-community' and name=$1`, [imagePath])
    );
    assert.equal(bSeesImage.rowCount, 0, "known path must not renew access after moderation");

    const readable = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`select public.florist_community_image_readable($1) as ok`, [imagePath])
    );
    assert.equal(readable.rows[0].ok, false);

    // Author exception: may still see own moderated post
    const authorSees = await asRole(client, "authenticated", USER_A, async (c) =>
      c.query(`select id, status from public.florist_community_posts where id=$1`, [postId])
    );
    assert.equal(authorSees.rowCount, 1);
    assert.equal(authorSees.rows[0].status, "hidden");
  });
});

test("real concurrency: likes, comments, duplicate reports", async () => {
  const postId = await withClient(async (client) => {
    const r = await asRole(client, "authenticated", USER_A, async (c) =>
      c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, status)
         values ($1, $2, 'Questions', 'concurrent target', 'active') returning id`,
        [USER_A, SHOP_A]
      )
    );
    return r.rows[0].id;
  });

  // Concurrent likes from different users on separate connections
  const likeResults = await Promise.all([
    asRoleOnNewConnection("authenticated", USER_A, async (c) => {
      const r = await c.query(`select public.florist_community_toggle_like($1, $2) as j`, [postId, SHOP_A]);
      return r.rows[0].j;
    }),
    asRoleOnNewConnection("authenticated", USER_B, async (c) => {
      const r = await c.query(`select public.florist_community_toggle_like($1, $2) as j`, [postId, SHOP_B]);
      return r.rows[0].j;
    }),
  ]);
  assert.equal(likeResults.filter((j) => j.liked === true).length, 2);

  await withClient(async (client) => {
    const { rows } = await client.query(
      `select like_count from public.florist_community_posts where id=$1`,
      [postId]
    );
    assert.equal(Number(rows[0].like_count), 2);
    const { rows: likeRows } = await client.query(
      `select count(*)::int as n from public.florist_community_likes where post_id=$1`,
      [postId]
    );
    assert.equal(likeRows[0].n, 2);
  });

  // Concurrent duplicate toggles from same user — must not throw uniqueness errors;
  // final like_count must match row count (race may end liked or unliked).
  await Promise.all([
    asRoleOnNewConnection("authenticated", USER_B, async (c) => {
      await c.query(`select public.florist_community_toggle_like($1, $2)`, [postId, SHOP_B]);
    }),
    asRoleOnNewConnection("authenticated", USER_B, async (c) => {
      await c.query(`select public.florist_community_toggle_like($1, $2)`, [postId, SHOP_B]);
    }),
  ]);
  await withClient(async (client) => {
    const { rows: cnt } = await client.query(
      `select like_count from public.florist_community_posts where id=$1`,
      [postId]
    );
    const { rows: likes } = await client.query(
      `select count(*)::int as n from public.florist_community_likes where post_id=$1`,
      [postId]
    );
    assert.equal(Number(cnt[0].like_count), likes[0].n);
    assert.ok(likes[0].n === 1 || likes[0].n === 2);
  });

  // Concurrent comments from different users
  await Promise.all([
    asRoleOnNewConnection("authenticated", USER_A, async (c) => {
      await c.query(
        `insert into public.florist_community_comments
         (post_id, author_user_id, shop_id, body, status)
         values ($1, $2, $3, 'comment A', 'active')`,
        [postId, USER_A, SHOP_A]
      );
    }),
    asRoleOnNewConnection("authenticated", USER_B, async (c) => {
      await c.query(
        `insert into public.florist_community_comments
         (post_id, author_user_id, shop_id, body, status)
         values ($1, $2, $3, 'comment B', 'active')`,
        [postId, USER_B, SHOP_B]
      );
    }),
  ]);

  await withClient(async (client) => {
    const { rows } = await client.query(
      `select comment_count from public.florist_community_posts where id=$1`,
      [postId]
    );
    const { rows: comments } = await client.query(
      `select count(*)::int as n from public.florist_community_comments where post_id=$1`,
      [postId]
    );
    assert.equal(Number(rows[0].comment_count), comments[0].n);
    assert.equal(comments[0].n, 2);
  });

  // Concurrent repeated reports from same reporter — one row, both succeed
  const reportResults = await Promise.all([
    asRoleOnNewConnection("authenticated", USER_B, async (c) => {
      const r = await c.query(`select public.florist_community_report_post($1, $2, $3) as j`, [
        postId,
        SHOP_B,
        "Looks spammy concurrent A",
      ]);
      return r.rows[0].j;
    }),
    asRoleOnNewConnection("authenticated", USER_B, async (c) => {
      const r = await c.query(`select public.florist_community_report_post($1, $2, $3) as j`, [
        postId,
        SHOP_B,
        "Looks spammy concurrent B",
      ]);
      return r.rows[0].j;
    }),
  ]);
  assert.ok(reportResults.every((j) => j.ok === true));
  assert.equal(new Set(reportResults.map((j) => j.id)).size, 1);

  await withClient(async (client) => {
    const { rows } = await client.query(
      `select count(*)::int as n, min(status) as status, min(reason) as reason
       from public.florist_community_reports
       where post_id=$1 and reporter_user_id=$2`,
      [postId, USER_B]
    );
    assert.equal(rows[0].n, 1);
    assert.equal(rows[0].status, "open");
  });
});

test("platform-admin persona: reports, review, hide, status-only, no content rewrite", async () => {
  await withClient(async (client) => {
    // Confirm platform admin is not an ordinary Community participant
    const florist = await asRole(client, "authenticated", USER_PLATFORM, async (c) =>
      c.query(`select public.is_active_florist() as ok`)
    );
    assert.equal(florist.rows[0].ok, false);
    const isAdmin = await asRole(client, "authenticated", USER_PLATFORM, async (c) =>
      c.query(`select public.is_platform_admin_user() as ok`)
    );
    assert.equal(isAdmin.rows[0].ok, true);

    // Direct platform_admins table must not be readable via authenticated (no browser policy)
    const direct = await asRole(client, "authenticated", USER_PLATFORM, async (c) =>
      c.query(`select * from public.platform_admins`)
    );
    assert.equal(direct.rowCount, 0, "user client must not read platform_admins via PostgREST/RLS");

    const postId = await asRole(client, "authenticated", USER_A, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, body, status)
         values ($1, $2, 'Questions', 'report target', 'keep my words', 'active') returning id`,
        [USER_A, SHOP_A]
      );
      return r.rows[0].id;
    });

    const report = await asRole(client, "authenticated", USER_B, async (c) => {
      const r = await c.query(`select public.florist_community_report_post($1, $2, $3) as j`, [
        postId,
        SHOP_B,
        "guideline breach",
      ]);
      return r.rows[0].j;
    });

    // Platform admin can read open reports
    const reports = await asRole(client, "authenticated", USER_PLATFORM, async (c) =>
      c.query(`select id, reason, status from public.florist_community_reports where status='open'`)
    );
    assert.ok(reports.rows.some((r) => r.id === report.id));

    // Can review reported post
    const reviewedPost = await asRole(client, "authenticated", USER_PLATFORM, async (c) =>
      c.query(`select id, caption, body, status from public.florist_community_posts where id=$1`, [postId])
    );
    assert.equal(reviewedPost.rowCount, 1);
    assert.equal(reviewedPost.rows[0].caption, "report target");

    // Cannot rewrite content
    const rewrite = await asRole(client, "authenticated", USER_PLATFORM, async (c) =>
      c.query(`update public.florist_community_posts set caption='admin rewrite', body='nope' where id=$1`, [
        postId,
      ])
    );
    assert.equal(rewrite.rowCount, 0);

    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_PLATFORM, async (c) => {
          await c.query(`update public.florist_community_reports set reason='changed' where id=$1`, [
            report.id,
          ]);
        }),
      /permission denied|42501|protected fields|moderate RPC/i
    );

    // Hide via RPC
    await asRole(client, "authenticated", USER_PLATFORM, async (c) => {
      const r = await c.query(`select public.florist_community_moderate_post($1, 'hidden') as j`, [postId]);
      assert.equal(r.rows[0].j.status, "hidden");
    });

    // Update only report moderation status via RPC
    await asRole(client, "authenticated", USER_PLATFORM, async (c) => {
      const r = await c.query(`select public.florist_community_moderate_report($1, 'reviewed') as j`, [
        report.id,
      ]);
      assert.equal(r.rows[0].j.status, "reviewed");
      assert.equal(r.rows[0].j.reason_unchanged, true);
    });

    const reason = await asRole(client, "authenticated", USER_PLATFORM, async (c) =>
      c.query(`select reason, status from public.florist_community_reports where id=$1`, [report.id])
    );
    assert.equal(reason.rows[0].reason, "guideline breach");
    assert.equal(reason.rows[0].status, "reviewed");

    // Hard delete unavailable
    const hardDel = await asRole(client, "authenticated", USER_PLATFORM, async (c) =>
      c.query(`delete from public.florist_community_posts where id=$1`, [postId])
    );
    assert.equal(hardDel.rowCount, 0);

    // Audit record where architecture supports it (service_role insert)
    await asRole(client, "service_role", null, async (c) => {
      await c.query(
        `insert into public.platform_admin_audit (admin_user_id, shop_id, action, details)
         values ($1, $2, 'community_moderate_post', $3::jsonb)`,
        [USER_PLATFORM, SHOP_A, JSON.stringify({ post_id: postId, status: "hidden" })]
      );
    });
    const audit = await asRole(client, "service_role", null, async (c) =>
      c.query(
        `select action from public.platform_admin_audit
         where admin_user_id=$1 and action='community_moderate_post'`,
        [USER_PLATFORM]
      )
    );
    assert.ok(audit.rowCount >= 1);
  });
});

test("image_path must belong to shop/author prefix", async () => {
  await withClient(async (client) => {
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, async (c) => {
          await c.query(
            `insert into public.florist_community_posts
             (author_user_id, shop_id, category, caption, status, image_path)
             values ($1, $2, 'Questions', 'bad path', 'active', $3)`,
            [USER_A, SHOP_A, `${SHOP_B}/${USER_B}/stolen.jpg`]
          );
        }),
      /image_path|shop\/author|violates|row-level security/i
    );
  });
});

test("repeated reports are idempotent; reporter cannot change status", async () => {
  await withClient(async (client) => {
    const postId = await asRole(client, "authenticated", USER_A, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, status)
         values ($1, $2, 'Questions', 'report me', 'active') returning id`,
        [USER_A, SHOP_A]
      );
      return r.rows[0].id;
    });

    const first = await asRole(client, "authenticated", USER_B, async (c) => {
      const r = await c.query(`select public.florist_community_report_post($1, $2, $3) as j`, [
        postId,
        SHOP_B,
        "Looks spammy",
      ]);
      return r.rows[0].j;
    });
    assert.equal(first.already_reported, false);

    const second = await asRole(client, "authenticated", USER_B, async (c) => {
      const r = await c.query(`select public.florist_community_report_post($1, $2, $3) as j`, [
        postId,
        SHOP_B,
        "Looks spammy again",
      ]);
      return r.rows[0].j;
    });
    assert.equal(second.already_reported, true);
    assert.equal(second.id, first.id);

    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_B, async (c) => {
          await c.query(`update public.florist_community_reports set status='dismissed' where id=$1`, [
            first.id,
          ]);
        }),
      /permission denied|42501|moderate RPC|protected/i
    );
  });
});

test("image bucket is private; storage select requires readable active post", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(
      `select public, file_size_limit from storage.buckets where id='florist-community'`
    );
    assert.equal(rows[0].public, false);
    assert.equal(Number(rows[0].file_size_limit), 2097152);

    const imagePath = `${SHOP_A}/${USER_A}/img.jpg`;
    await asRole(client, "authenticated", USER_A, async (c) => {
      await c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, status, image_path)
         values ($1, $2, 'Questions', 'with image', 'active', $3)`,
        [USER_A, SHOP_A, imagePath]
      );
      await c.query(
        `insert into storage.objects (bucket_id, name, owner)
         values ('florist-community', $1, $2)`,
        [imagePath, USER_A]
      );
    });

    const none = await asRole(client, "authenticated", USER_NONE, async (c) =>
      c.query(`select * from storage.objects where bucket_id='florist-community'`)
    );
    assert.equal(none.rowCount, 0);

    const ok = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`select name from storage.objects where bucket_id='florist-community'`)
    );
    assert.equal(ok.rowCount, 1);

    const del = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`delete from storage.objects where bucket_id='florist-community' and name=$1`, [imagePath])
    );
    assert.equal(del.rowCount, 0);

    await assert.rejects(
      () =>
        asRole(client, "anon", null, async (c) => {
          await c.query(`select * from storage.objects where bucket_id='florist-community'`);
        }),
      /permission denied|42501/i
    );
  });
});

test("SECURITY DEFINER helpers revoked from anon; table grants exclude anon", async () => {
  await withClient(async (client) => {
    const { rows: priv } = await client.query(`
      select
        has_function_privilege('anon', 'public.is_active_florist()', 'EXECUTE') as anon_active,
        has_function_privilege('anon', 'public.florist_community_toggle_like(uuid,uuid)', 'EXECUTE') as anon_like,
        has_function_privilege('authenticated', 'public.florist_community_toggle_like(uuid,uuid)', 'EXECUTE') as auth_like,
        has_function_privilege('authenticated', 'public.florist_community_like_counter()', 'EXECUTE') as auth_counter,
        has_table_privilege('anon', 'public.florist_community_posts', 'SELECT') as anon_posts,
        has_table_privilege('authenticated', 'public.florist_community_posts', 'SELECT') as auth_posts
    `);
    assert.equal(priv[0].anon_active, false);
    assert.equal(priv[0].anon_like, false);
    assert.equal(priv[0].auth_like, true);
    assert.equal(priv[0].auth_counter, false);
    assert.equal(priv[0].anon_posts, false);
    assert.equal(priv[0].auth_posts, true);

    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_NONE, async (c) => {
          await c.query(`select public.florist_community_toggle_like($1::uuid, $2::uuid)`, [
            "77777777-7777-7777-7777-777777777777",
            SHOP_A,
          ]);
        }),
      /Active florist|membership|not available|42501/i
    );
  });
});

test("service_role can read for break-glass only", async () => {
  await withClient(async (client) => {
    await asRole(client, "service_role", null, async (c) => {
      const r = await c.query(`select count(*)::int as n from public.florist_community_posts`);
      assert.ok(Number.isInteger(r.rows[0].n));
    });
  });
});
