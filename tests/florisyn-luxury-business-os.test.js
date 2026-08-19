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
  assert.match(pageHtml, /Revenue Opportunity/);
  assert.match(pageHtml, /Marketing Suggestion/);
  assert.match(pageHtml, /Operational Alert/);
  assert.match(pageHtml, /Lily says:/);
  assert.match(pageHtml, /rose-portrait\.png/);
  assert.match(pageHtml, /lily-portrait\.png/);
  assert.match(pageHtml, /id="bosMessages"/);
  assert.match(pageHtml, /id="bosChatForm"/);
  assert.match(pageHtml, /id="bosPrompt"/);
  assert.match(router, /"\/business-os":\s*\{\s*page:\s*"ecosystemPage"/);
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

test("Business OS chat chips and insight actions are functional", () => {
  assert.match(js, /FlorisynBusinessOs/);
  assert.match(js, /askRose/);
  assert.match(js, /data-bos-chip/);
  assert.match(js, /appendMessage\("user"/);
  assert.match(js, /appendMessage\("assistant"/);
  assert.match(js, /create-post/);
  assert.match(js, /add-task/);
  assert.match(js, /pricing strategy/);
  assert.match(appJs, /FlorisynBusinessOs\?\.boot/);
  assert.match(pageHtml, /data-bos-chip="Pricing strategy"/);
  assert.match(pageHtml, /data-bos-action="apply"/);
  assert.match(pageHtml, /data-bos-action="create-post"/);
  assert.match(pageHtml, /data-bos-action="add-task"/);
});
