import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const themeGalleryJs = fs.readFileSync(new URL("../public/theme-gallery-ui.js", import.meta.url), "utf8");
const shellJs = fs.readFileSync(new URL("../public/website-studio-shell.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/website-studio-v2.css", import.meta.url), "utf8");
const { LAUNCH_MODES } = await import("../netlify/functions/_shared/bloom-instant-website.js");

// Regression context: user-reported "Website is a little hard to use. I
// can't find the templates or how to do it." Root-caused to two real bugs:
// (1) every template card showed an identical hardcoded caption and no
// name — m.label existed in the data but was never rendered — so all 8
// templates looked like anonymous gradient blocks; (2) the tab that
// contained them was labeled "Look & feel", which doesn't read as
// "templates", and nothing on the first screen pointed to it.

test("every template card shows its real name — not just an anonymous gradient with an identical caption on every card", () => {
  assert.match(themeGalleryJs, /\$\{esc\(m\.label \|\| m\.id\)\}/, "card must render the template's actual label");
  assert.doesNotMatch(themeGalleryJs, /<p class="subtle">Serif \+ sans · product cards · soft buttons<\/p>/, "must not regress to the old identical-on-every-card caption");
});

test("card captions differentiate templates by their real font pairing, not one hardcoded string for all eight", () => {
  assert.match(themeGalleryJs, /FONT_PAIR_DESCRIPTIONS/);
  const pairIds = new Set(LAUNCH_MODES.map((m) => m.fontPair));
  pairIds.forEach((id) => {
    assert.match(themeGalleryJs, new RegExp(id), `FONT_PAIR_DESCRIPTIONS must cover fontPair "${id}" used by a real launch mode`);
  });
});

test("the tab that holds templates is actually labeled Templates, not an unrelated term", () => {
  const tabsBlock = shellJs.slice(shellJs.indexOf("const TABS = ["), shellJs.indexOf("];", shellJs.indexOf("const TABS = [")));
  assert.match(tabsBlock, /id: "look", label: "Templates"/);
  assert.doesNotMatch(tabsBlock, /Look & feel/);
});

test("Get Started tab explains the ways to start and links straight to Templates, Brand & photos, and the Editor", () => {
  assert.match(shellJs, /WAYS TO START/);
  assert.match(shellJs, /id="wsIntroTemplatesLink"/);
  assert.match(shellJs, /id="wsIntroBrandLink"/);
  assert.match(shellJs, /id="wsIntroEditorLink"/);
  assert.match(shellJs, /selectTab\(shell, "look"\)/);
  assert.match(shellJs, /selectTab\(shell, "brand"\)/);
  assert.match(shellJs, /selectTab\(shell, "editor"\)/);
});

test("the legacy Website Studio X builder is contained in its own Brand & photos tab, not left unconditionally rendered", () => {
  const tabsBlock = shellJs.slice(shellJs.indexOf("const TABS = ["), shellJs.indexOf("];", shellJs.indexOf("const TABS = [")));
  assert.match(tabsBlock, /id: "brand", label: "Brand & photos"/);
  const placementBlock = shellJs.slice(shellJs.indexOf("const PLACEMENT = {"), shellJs.indexOf("};", shellJs.indexOf("const PLACEMENT = {")));
  assert.match(placementBlock, /brand: \[".legacy-website-editor-shell"\]/);
});

test("template card name and the intro's link buttons have real, non-placeholder CSS", () => {
  assert.match(css, /\.theme-card-name\s*\{/);
  assert.match(css, /\.ws-shell-start-intro\s*\{/);
  assert.match(css, /\.linklike\s*\{/);
});
