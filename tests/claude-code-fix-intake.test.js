import test from "node:test";
import assert from "node:assert/strict";

import { handleFixIntake } from "../netlify/functions/claude-code-fix-intake.js";
import { verifyFixIntakeToken, validateFixRequestPayload } from "../lib/support/fix-requests.js";
import { createFakeSupabaseClient } from "./helpers/fake-supabase-client.mjs";

function withEnv(vars, fn) {
  const prior = {};
  for (const [key, value] of Object.entries(vars)) {
    prior[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function postEvent(body, token) {
  return {
    httpMethod: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body)
  };
}

test("verifyFixIntakeToken: fails closed (503) when no token is configured at all", () => {
  const result = verifyFixIntakeToken({ authorization: "Bearer whatever" }, {});
  assert.equal(result.ok, false);
  assert.equal(result.error.statusCode, 503);
});

test("verifyFixIntakeToken: rejects a missing or wrong bearer token", () => {
  const env = { CLAUDE_CODE_FIX_WEBHOOK_TOKEN: "correct-token" };
  assert.equal(verifyFixIntakeToken({}, env).ok, false);
  const wrong = verifyFixIntakeToken({ authorization: "Bearer wrong-token" }, env);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error.statusCode, 401);
});

test("verifyFixIntakeToken: accepts the correct bearer token", () => {
  const env = { CLAUDE_CODE_FIX_WEBHOOK_TOKEN: "correct-token" };
  assert.equal(verifyFixIntakeToken({ authorization: "Bearer correct-token" }, env).ok, true);
});

test("validateFixRequestPayload: rejects a payload with no subject", () => {
  assert.equal(validateFixRequestPayload({}).ok, false);
});

test("validateFixRequestPayload: normalizes a real admin-command-center.js fixRequest payload", () => {
  const v = validateFixRequestPayload({
    ticket_id: "t1",
    item_type: "bug_report",
    subject: "Delete button broken",
    body: "Details here",
    shop_id: "shop_1",
    requested_by: "user_1",
    policy_doc: "docs/FLORISYN_AI_AGENT_AUTONOMY_POLICY.md"
  });
  assert.equal(v.ok, true);
  assert.equal(v.payload.ticket_id, "t1");
  assert.equal(v.payload.subject, "Delete button broken");
  assert.equal(v.payload.policy_doc, "docs/FLORISYN_AI_AGENT_AUTONOMY_POLICY.md");
});

test("fix intake handler: rejects an unauthenticated request before touching the database", () =>
  withEnv({ CLAUDE_CODE_FIX_WEBHOOK_TOKEN: "secret-token" }, async () => {
    const client = createFakeSupabaseClient([]);
    const response = await handleFixIntake(postEvent({ subject: "x" }), { admin: () => client });
    assert.equal(response.statusCode, 401);
    assert.equal(client.calls.length, 0);
  }));

test("fix intake handler: queues an authenticated request into platform_agent_fix_requests", () =>
  withEnv({ CLAUDE_CODE_FIX_WEBHOOK_TOKEN: "secret-token" }, async () => {
    const client = createFakeSupabaseClient([{ data: { id: "fix_1", status: "queued" }, error: null }]);
    const response = await handleFixIntake(
      postEvent({ subject: "Delete button broken", shop_id: "shop_1" }, "secret-token"),
      { admin: () => client }
    );
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.equal(body.id, "fix_1");
    assert.equal(body.status, "queued");

    const insertCall = client.calls.find((c) => c.table === "platform_agent_fix_requests");
    assert.ok(insertCall);
    assert.equal(insertCall.payload.status, "queued");
    assert.equal(insertCall.payload.subject, "Delete button broken");
  }));
