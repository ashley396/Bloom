import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("AI Agent Autonomy Policy exists and defines the three tiers", () => {
  const policy = read("../docs/FLORISYN_AI_AGENT_AUTONOMY_POLICY.md");
  assert.match(policy, /Tier 1 — Fix and propose immediately/);
  assert.match(policy, /Tier 2 — Requires explicit human approval/);
  assert.match(policy, /## Never/);
  // The core distinction the whole policy rests on.
  assert.match(policy, /Diagnosing and preparing a fix is not the same action as shipping it/);
  // No live support-ticket-to-agent trigger exists yet — the doc must say
  // so plainly, not read like a description of a system already running.
  assert.match(policy, /no live trigger connecting a support ticket/);
});

test("Governance Map and Architecture Bible both point to the autonomy policy", () => {
  const governanceMap = read("../docs/FLORISYN_GOVERNANCE_MAP.md");
  const bible = read("../docs/FLORISYN_MASTER_ARCHITECTURE_BIBLE.md");
  assert.match(governanceMap, /FLORISYN_AI_AGENT_AUTONOMY_POLICY\.md/);
  assert.match(bible, /FLORISYN_AI_AGENT_AUTONOMY_POLICY\.md/);
});

test("deploying, merging own PRs, and applying migrations stay in the Never section", () => {
  const policy = read("../docs/FLORISYN_AI_AGENT_AUTONOMY_POLICY.md");
  const neverSection = policy.slice(policy.indexOf("## Never"), policy.indexOf("## When the tier is ambiguous"));
  assert.match(neverSection, /Deploying to production/i);
  assert.match(neverSection, /Applying a migration to a live database/i);
  assert.match(neverSection, /Merging its own pull request/i);
});
