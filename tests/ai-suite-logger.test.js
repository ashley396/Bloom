import test from "node:test";
import assert from "node:assert/strict";
import { logAiSuiteEvent, logAiSuiteError } from "../lib/ai-suite/logger.js";

// lib/ai-suite/logger.js had zero test coverage. It is the only structured
// logging path for the AI Suite micro-modules, so it's worth confirming it
// actually routes to the right console method and produces valid,
// traceable JSON rather than just trusting the comment.

test("logAiSuiteEvent: an 'error' level logs via console.error, not console.log", (t) => {
  const errorMock = t.mock.method(console, "error", () => {});
  const logMock = t.mock.method(console, "log", () => {});
  logAiSuiteEvent("error", "generation_failed", { shopId: "shop-1" });
  assert.equal(errorMock.mock.calls.length, 1);
  assert.equal(logMock.mock.calls.length, 0);
});

test("logAiSuiteEvent: a 'warn' level logs via console.warn", (t) => {
  const warnMock = t.mock.method(console, "warn", () => {});
  logAiSuiteEvent("warn", "rate_limited", {});
  assert.equal(warnMock.mock.calls.length, 1);
});

test("logAiSuiteEvent: any other level (e.g. 'info') falls back to console.log", (t) => {
  const logMock = t.mock.method(console, "log", () => {});
  logAiSuiteEvent("info", "generation_started", {});
  assert.equal(logMock.mock.calls.length, 1);
});

test("logAiSuiteEvent: the logged line is valid JSON carrying the service name, level, event, and a real timestamp", (t) => {
  const logMock = t.mock.method(console, "log", () => {});
  logAiSuiteEvent("info", "photo_generated", { shopId: "shop-42" });
  const line = logMock.mock.calls[0].arguments[0];
  const parsed = JSON.parse(line);
  assert.equal(parsed.service, "florisyn-ai-suite");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.event, "photo_generated");
  assert.equal(parsed.shopId, "shop-42");
  assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/, "ts must be a real ISO timestamp");
});

test("logAiSuiteEvent: returns the same structured entry object it logs, for callers that want to reuse it", (t) => {
  t.mock.method(console, "log", () => {});
  const entry = logAiSuiteEvent("info", "test_event", { shopId: "s1" });
  assert.equal(entry.event, "test_event");
  assert.equal(entry.shopId, "s1");
});

test("logAiSuiteError: always logs at 'error' level regardless of what's passed", (t) => {
  const errorMock = t.mock.method(console, "error", () => {});
  logAiSuiteError("photo_generation_failed", new Error("provider timeout"));
  assert.equal(errorMock.mock.calls.length, 1);
  const parsed = JSON.parse(errorMock.mock.calls[0].arguments[0]);
  assert.equal(parsed.level, "error");
});

test("logAiSuiteError: extracts a real message and code from an Error object", (t) => {
  const errorMock = t.mock.method(console, "error", () => {});
  const err = new Error("connection refused");
  err.code = "ECONNREFUSED";
  logAiSuiteError("provider_call_failed", err, { shopId: "shop-9" });
  const parsed = JSON.parse(errorMock.mock.calls[0].arguments[0]);
  assert.equal(parsed.message, "connection refused");
  assert.equal(parsed.code, "ECONNREFUSED");
  assert.equal(parsed.shopId, "shop-9");
});

test("logAiSuiteError: handles a non-Error thrown value (e.g. a plain string) without crashing", (t) => {
  const errorMock = t.mock.method(console, "error", () => {});
  logAiSuiteError("weird_throw", "just a string");
  const parsed = JSON.parse(errorMock.mock.calls[0].arguments[0]);
  assert.equal(parsed.message, "just a string");
  assert.equal(parsed.code, null);
});
