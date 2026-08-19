import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/florisyn-luxury-ai-studio.css"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

const studioHtml = html.slice(html.indexOf('id="aiStudioPage"'), html.indexOf('id="websitePage"'));

test("Lily AI Studio Figma shell and assets are wired", () => {
  assert.match(html, /florisyn-luxury-ai-studio\.css/);
  assert.match(studioHtml, /florisyn-lux-ai-studio/);
  assert.match(studioHtml, /CREATIVE STUDIO/);
  assert.match(studioHtml, /Lily AI Studio/);
  assert.match(studioHtml, /Talk to your creative brand assistant/);
  assert.match(studioHtml, /lux-ai-tabs/);
  assert.match(studioHtml, /Ask Lily/);
  assert.match(studioHtml, /Website Studio/);
  assert.match(studioHtml, /Learn More/);
  assert.match(studioHtml, /Send to Lily →/);
  assert.match(studioHtml, /Apply to Store/);
  assert.match(studioHtml, /Change preview/);
  assert.match(studioHtml, /Nothing is saved until you approve it/);
  assert.match(studioHtml, /Always preview first!/);
  assert.match(studioHtml, /id="aiStudioMessages"/);
  assert.match(studioHtml, /id="aiStudioForm"/);
  assert.match(studioHtml, /id="aiStudioPrompt"/);
  assert.match(studioHtml, /id="aiStudioApply"/);
  assert.match(studioHtml, /id="aiStudioUndo"/);
  assert.match(studioHtml, /id="aiStudioChangeList"/);
  assert.match(studioHtml, /lily-portrait\.png/);
  assert.match(studioHtml, /rose-portrait\.png/);
  assert.doesNotMatch(studioHtml, /daisy-portrait|bloomDog|puppy|dog/i);
});

test("AI Studio chat uses navy/rose tokens without green CTAs", () => {
  assert.match(css, /#1a1f3c/);
  assert.match(css, /#e06b85/i);
  assert.match(css, /#fbf6f7/i);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1\.5fr\)/);
  assert.match(css, /\.lux-ai-bubble/);
  assert.match(css, /\.lux-ai-site-mock/);
  assert.doesNotMatch(css, /background:\s*#547428|background:\s*#486329/i);
});

test("AI Studio keeps functional hooks and pre-fills chips", () => {
  assert.match(appJs, /function aiStudioMessage/);
  assert.match(appJs, /function runAiStudio/);
  assert.match(appJs, /function renderAiStudioDraft/);
  assert.match(appJs, /syncAiStudioMock/);
  assert.match(appJs, /lily-portrait\.png/);
  assert.match(appJs, /input\.value\s*=\s*b\.dataset\.aiPrompt/);
  assert.match(appJs, /\$\("#aiStudioApply"\)\.disabled\s*=\s*!cards\.length/);
  assert.match(studioHtml, /data-ai-prompt="Make my homepage feel more luxurious and welcoming\."/);
  assert.match(studioHtml, /Luxury Blooms/);
  assert.match(studioHtml, /Rose Bliss/);
  assert.match(studioHtml, /disabled>Apply to Store/);
});
