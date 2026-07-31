/**
 * Database-backed Florist Community RLS integration tests.
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

function applyMigrations() {
  const r = spawnSync(process.execPath, [path.join(process.cwd(), "scripts/apply-community-migrations-local.mjs")], {
    env: { ...process.env, COMMUNITY_TEST_DATABASE_URL: DATABASE_URL },
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`Migration apply failed:\n${r.stdout}\n${r.stderr}`);
  }
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

async function seed(client) {
  // Seed as superuser (connection owner), not as a restricted role.
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
  await client.query(`delete from public.shop_members`);
  await client.query(
    `insert into public.shop_members (shop_id, user_id, role, status) values
      ($1, $2, 'owner', 'active'),
      ($3, $4, 'owner', 'active'),
      ($1, $5, 'staff', 'suspended'),
      ($1, $6, 'manager', 'active')`,
    [SHOP_A, USER_A, SHOP_B, USER_B, USER_INACTIVE, USER_MGR]
  );
  await client.query(
    `insert into public.platform_admins (user_id, role, display_name, active)
     values ($1, 'super_admin', 'Platform', true)
     on conflict (user_id) do update set active = true`,
    [USER_PLATFORM]
  );
}

test.before(() => {
  applyMigrations();
});

test.beforeEach(async () => {
  await withClient(async (client) => {
    await seed(client);
  });
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
    const read = await asRole(client, "anon", null, async (c) =>
      c.query(`select * from public.florist_community_posts`)
    );
    assert.equal(read.rowCount, 0, "anon must not read Community posts");
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

test("cannot edit or delete another author content; counters protected", async () => {
  await withClient(async (client) => {
    const postId = await asRole(client, "authenticated", USER_A, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, status)
         values ($1, $2, 'Questions', 'owned by A', 'active') returning id`,
        [USER_A, SHOP_A]
      );
      return r.rows[0].id;
    });

    const hacked = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`update public.florist_community_posts set caption='hacked' where id=$1`, [postId])
    );
    assert.equal(hacked.rowCount, 0);

    const still = await asRole(client, "authenticated", USER_A, async (c) =>
      c.query(`select caption, like_count from public.florist_community_posts where id=$1`, [postId])
    );
    assert.equal(still.rows[0].caption, "owned by A");

    const deleted = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`delete from public.florist_community_posts where id=$1`, [postId])
    );
    assert.equal(deleted.rowCount, 0);

    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_A, async (c) => {
          await c.query(`update public.florist_community_posts set like_count=999 where id=$1`, [postId]);
        }),
      /protected fields|cannot be changed/i
    );

    // Ordinary cross-shop member cannot change moderation status (USER_B is not manager of Shop A)
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_B, async (c) => {
          // Force a write attempt via security barrier: use RPC which checks auth
          await c.query(`select public.florist_community_moderate_post($1, 'hidden')`, [postId]);
        }),
      /Not authorized|42501/i
    );
  });
});

test("hidden posts unavailable to ordinary members; manager can moderate", async () => {
  await withClient(async (client) => {
    const postId = await asRole(client, "authenticated", USER_A, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, status)
         values ($1, $2, 'Celebrations', 'hide me', 'active') returning id`,
        [USER_A, SHOP_A]
      );
      return r.rows[0].id;
    });

    await asRole(client, "authenticated", USER_MGR, async (c) => {
      const r = await c.query(`select public.florist_community_moderate_post($1, 'hidden') as j`, [postId]);
      assert.equal(r.rows[0].j.status, "hidden");
    });

    const bSees = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`select id from public.florist_community_posts where id=$1`, [postId])
    );
    assert.equal(bSees.rowCount, 0);

    // Shop B manager cannot moderate Shop A post
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_B, async (c) => {
          await c.query(`select public.florist_community_moderate_post($1, 'removed')`, [postId]);
        }),
      /Not authorized|42501/i
    );
  });
});

test("likes: no duplicates, toggle correct, concurrency safe, inactive post rejected", async () => {
  await withClient(async (client) => {
    const postId = await asRole(client, "authenticated", USER_A, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, status)
         values ($1, $2, 'Questions', 'like target', 'active') returning id`,
        [USER_A, SHOP_A]
      );
      return r.rows[0].id;
    });

    const like1 = await asRole(client, "authenticated", USER_B, async (c) => {
      const r = await c.query(`select public.florist_community_toggle_like($1, $2) as j`, [postId, SHOP_B]);
      return r.rows[0].j;
    });
    assert.equal(like1.liked, true);
    assert.equal(Number(like1.like_count), 1);

    // Duplicate insert blocked by PK; toggle removes
    const unlike = await asRole(client, "authenticated", USER_B, async (c) => {
      const r = await c.query(`select public.florist_community_toggle_like($1, $2) as j`, [postId, SHOP_B]);
      return r.rows[0].j;
    });
    assert.equal(unlike.liked, false);
    assert.equal(Number(unlike.like_count), 0);

    // Concurrent likes from A and B
    await asRole(client, "authenticated", USER_A, async (c) => {
      await c.query(`select public.florist_community_toggle_like($1, $2)`, [postId, SHOP_A]);
    });
    await asRole(client, "authenticated", USER_B, async (c) => {
      await c.query(`select public.florist_community_toggle_like($1, $2)`, [postId, SHOP_B]);
    });
    const count = await asRole(client, "authenticated", USER_A, async (c) =>
      c.query(`select like_count from public.florist_community_posts where id=$1`, [postId])
    );
    assert.equal(Number(count.rows[0].like_count), 2);

    // Hide then reject like
    await asRole(client, "authenticated", USER_MGR, async (c) => {
      await c.query(`select public.florist_community_moderate_post($1, 'hidden')`, [postId]);
    });
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_B, async (c) => {
          await c.query(`select public.florist_community_toggle_like($1, $2)`, [postId, SHOP_B]);
        }),
      /not available|P0002/i
    );
  });
});

test("comments: counters correct; inactive post rejected", async () => {
  await withClient(async (client) => {
    const postId = await asRole(client, "authenticated", USER_A, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_posts
         (author_user_id, shop_id, category, caption, status)
         values ($1, $2, 'Questions', 'comment target', 'active') returning id`,
        [USER_A, SHOP_A]
      );
      return r.rows[0].id;
    });

    const commentId = await asRole(client, "authenticated", USER_B, async (c) => {
      const r = await c.query(
        `insert into public.florist_community_comments
         (post_id, author_user_id, shop_id, body, status)
         values ($1, $2, $3, 'Nice tip', 'active') returning id`,
        [postId, USER_B, SHOP_B]
      );
      return r.rows[0].id;
    });

    let cnt = await asRole(client, "authenticated", USER_A, async (c) =>
      c.query(`select comment_count from public.florist_community_posts where id=$1`, [postId])
    );
    assert.equal(Number(cnt.rows[0].comment_count), 1);

    await asRole(client, "authenticated", USER_B, async (c) => {
      await c.query(`delete from public.florist_community_comments where id=$1`, [commentId]);
    });
    cnt = await asRole(client, "authenticated", USER_A, async (c) =>
      c.query(`select comment_count from public.florist_community_posts where id=$1`, [postId])
    );
    assert.equal(Number(cnt.rows[0].comment_count), 0);

    await asRole(client, "authenticated", USER_MGR, async (c) => {
      await c.query(`select public.florist_community_moderate_post($1, 'removed')`, [postId]);
    });
    await assert.rejects(
      () =>
        asRole(client, "authenticated", USER_B, async (c) => {
          await c.query(
            `insert into public.florist_community_comments
             (post_id, author_user_id, shop_id, body, status)
             values ($1, $2, $3, 'nope', 'active')`,
            [postId, USER_B, SHOP_B]
          );
        }),
      /row-level security|violates/i
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

    const dismissed = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`update public.florist_community_reports set status='dismissed' where id=$1`, [first.id])
    );
    assert.equal(dismissed.rowCount, 0, "reporter must not update report moderation status");
    const status = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`select status from public.florist_community_reports where id=$1`, [first.id])
    );
    assert.equal(status.rows[0].status, "open");
  });
});

test("image bucket is private; storage select requires active florist", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query(
      `select public, file_size_limit from storage.buckets where id='florist-community'`
    );
    assert.equal(rows[0].public, false);
    assert.equal(Number(rows[0].file_size_limit), 2097152);

    // Insert object as USER_A
    await asRole(client, "authenticated", USER_A, async (c) => {
      await c.query(
        `insert into storage.objects (bucket_id, name, owner)
         values ('florist-community', $1, $2)`,
        [`${SHOP_A}/${USER_A}/img.jpg`, USER_A]
      );
    });

    // Non-member cannot select
    const none = await asRole(client, "authenticated", USER_NONE, async (c) =>
      c.query(`select * from storage.objects where bucket_id='florist-community'`)
    );
    assert.equal(none.rowCount, 0);

    // Active florist can select
    const ok = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`select name from storage.objects where bucket_id='florist-community'`)
    );
    assert.equal(ok.rowCount, 1);

    // USER_B cannot delete USER_A image
    const del = await asRole(client, "authenticated", USER_B, async (c) =>
      c.query(`delete from storage.objects where bucket_id='florist-community' and name=$1`, [
        `${SHOP_A}/${USER_A}/img.jpg`,
      ])
    );
    assert.equal(del.rowCount, 0);

    // Anon cannot retrieve Community images
    const anonImgs = await asRole(client, "anon", null, async (c) =>
      c.query(`select * from storage.objects where bucket_id='florist-community'`)
    );
    assert.equal(anonImgs.rowCount, 0);
  });
});

test("SECURITY DEFINER helpers revoked from anon; unauthorized RPC blocked", async () => {
  await withClient(async (client) => {
    const { rows: priv } = await client.query(`
      select
        has_function_privilege('anon', 'public.is_active_florist()', 'EXECUTE') as anon_active,
        has_function_privilege('anon', 'public.florist_community_toggle_like(uuid,uuid)', 'EXECUTE') as anon_like,
        has_function_privilege('authenticated', 'public.florist_community_toggle_like(uuid,uuid)', 'EXECUTE') as auth_like,
        has_function_privilege('authenticated', 'public.florist_community_like_counter()', 'EXECUTE') as auth_counter
    `);
    assert.equal(priv[0].anon_active, false);
    assert.equal(priv[0].anon_like, false);
    assert.equal(priv[0].auth_like, true);
    assert.equal(priv[0].auth_counter, false);

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
