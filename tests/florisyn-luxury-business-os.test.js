import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/florisyn-luxury-business-os.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public/florisyn-luxury-business-os.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const router = fs.readFileSync(path.join(root, "public/florisyn-router.js"), "utf8");

const pageHtml = html.slice(html.indexOf('id="ecosystemPage"'), html.indexOf('id="communityPage"'));

test("Business OS Rose advisor shell is wired on /business-os", () => {
  assert.match(html, /florisyn-luxury-business-os\.css/);
  assert.match(html, /florisyn-luxury-business-os\.js/);
  assert.match(pageHtml, /florisyn-lux-business-os/);
  assert.match(pageHtml, /BUSINESS ADVISOR/);
  assert.match(pageHtml, /<h1>Rose<\/h1>/);
  assert.match(pageHtml, /Your AI business strategist/);
  assert.match(pageHtml, /Chat with Rose/);
  assert.match(pageHtml, /Business Insights/);
  assert.match(pageHtml, /Action Items/);
  assert.match(pageHtml, /Send to Rose →/);
  assert.match(pageHtml, /Business Pulse/);
  assert.match(pageHtml, /id="bosPulseInsights"/);
  assert.match(pageHtml, /id="bosInsightsTabList"/);
  assert.match(pageHtml, /Lily says:/);
  assert.match(pageHtml, /rose-portrait\.png/);
  assert.match(pageHtml, /lily-portrait\.png/);
  assert.match(pageHtml, /id="bosMessages"/);
  assert.match(pageHtml, /id="bosChatForm"/);
  assert.match(pageHtml, /id="bosPrompt"/);
  assert.match(router, /"\/business-os":\s*\{\s*page:\s*"ecosystemPage"/);
});

test("Beta-blocker repair: fabricated Business OS statistics are gone from the page", () => {
  assert.doesNotMatch(pageHtml, /23%/, "fabricated 'bookings up 23%' claim must not remain anywhere on the page");
  assert.doesNotMatch(pageHtml, /15%/, "fabricated 15% price-increase recommendation must not remain");
  assert.doesNotMatch(pageHtml, /40% more engagement/i, "fabricated competitor-engagement claim must not remain");
  assert.doesNotMatch(pageHtml, /avoid stockout/i, "fabricated stockout alert (not tied to real inventory) must not remain");
  assert.doesNotMatch(pageHtml, /Revenue Opportunity|Marketing Suggestion|Operational Alert/, "the specific fabricated card titles must not remain");
  assert.doesNotMatch(pageHtml, /<time datetime="">/, "no more fake empty-datetime timestamps implying fresh analysis with nothing behind them");
});

test("Business OS uses gold/amber Rose tokens without green CTAs", () => {
  assert.match(css, /#1a1f3c/);
  assert.match(css, /#c8860a/i);
  assert.match(css, /#e06b85/i);
  assert.match(css, /#fbf6f7/i);
  assert.match(css, /#26263a/i);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1\.5fr\)/);
  assert.match(css, /\.bos-bubble/);
  assert.match(css, /\.bos-pulse/);
  assert.doesNotMatch(css, /background:\s*#547428|background:\s*#486329/i);
  assert.doesNotMatch(css, /\.bos-send[^{]*\{[^}]*#547428/i);
});

test("Business OS pulls real, shop-scoped suggestions from the existing business-ecosystem backend", () => {
  assert.match(js, /FlorisynBusinessOs/);
  assert.match(js, /function fetchInsights/);
  assert.match(js, /action:\s*"lily_coach"/, "must call the real lily_coach action, not invent a new endpoint");
  assert.match(js, /business-ecosystem/, "must reuse the existing business-ecosystem backend rather than rebuilding one");
  assert.match(js, /function loadInsights/);
  assert.match(js, /function renderInsights/);
  assert.match(js, /function insightCard/);
  assert.doesNotMatch(js, /TOPIC_REPLIES/, "the hardcoded canned-reply bank must be removed");
  assert.doesNotMatch(js, /function replyFor/, "the canned-reply generator must be removed");
});

test("Business Pulse and Business Insights show an honest empty/unavailable state, never invented numbers", () => {
  assert.match(js, /function emptyPulseState/);
  assert.match(js, /No specific recommendations right now/);
  assert.match(js, /couldn't load your shop's numbers/);
});

test("Rose's chat reports AI unavailability honestly instead of substituting canned advice", () => {
  assert.match(js, /ROSE_UNAVAILABLE/);
  assert.match(js, /temporarily unavailable/i);
  const askFn = js.slice(js.indexOf("async function askRose"), js.indexOf("function setTab"));
  assert.doesNotMatch(askFn, /replyFor/, "a failed or missing AI call must never fall back to canned template text");
  assert.match(askFn, /catch\s*\{[\s\S]*ROSE_UNAVAILABLE/, "a thrown/failed AI call must show the honest-unavailable message");
});

test("Rose's welcome message no longer claims to have already analyzed the shop before any question was asked", () => {
  const welcomeFn = js.slice(js.indexOf("function welcomeCopy"), js.indexOf("function appendMessage"));
  assert.doesNotMatch(welcomeFn, /23%/);
  assert.doesNotMatch(welcomeFn, /analyzing your shop performance/i);
  assert.doesNotMatch(welcomeFn, /already have.*ready for you/i);
});

test("Action items only persist real suggestion content, and legacy fabricated items are purged on load", () => {
  assert.match(js, /function isLegacyFabricatedItem/);
  assert.match(js, /LEGACY_FABRICATED_ITEM_NEEDLES/);
  const needlesBlock = js.slice(js.indexOf("LEGACY_FABRICATED_ITEM_NEEDLES"), js.indexOf("function isLegacyFabricatedItem"));
  assert.match(needlesBlock, /23%/);
  assert.match(needlesBlock, /15%/);
  assert.match(needlesBlock, /40% more engagement/i);
  assert.match(needlesBlock, /stockout/i);
  const loadFn = js.slice(js.indexOf("function loadActionItems"), js.indexOf("function saveActionItems"));
  assert.match(loadFn, /isLegacyFabricatedItem/, "loadActionItems must filter out any pre-fix fabricated entries");
  assert.match(appJs, /FlorisynBusinessOs\?\.boot/);
});

test("insight cards act on the real fetched suggestion, not a static apply/create-post claim of an executed action", () => {
  assert.doesNotMatch(js, /data-bos-action="apply"/, "no button may claim to have applied a business change Rose never actually executed");
  assert.doesNotMatch(js, /Rose applied:/i);
  assert.match(js, /data-bos-action="ask"/);
  assert.match(js, /data-bos-suggestion-id/);
  assert.match(js, /findSuggestion/);
});
