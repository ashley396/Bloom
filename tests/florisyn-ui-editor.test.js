import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const editorJs = fs.readFileSync(path.join(root, "public/florisyn-ui-editor.js"), "utf8");
const editorCss = fs.readFileSync(path.join(root, "public/florisyn-ui-editor.css"), "utf8");
const overrides = fs.readFileSync(path.join(root, "public/florisyn-design-overrides.json"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "public/admin.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const voiceJs = fs.readFileSync(path.join(root, "public/assistant-voice.js"), "utf8");

test("design overrides JSON is visual-only config", () => {
  const doc = JSON.parse(overrides);
  assert.equal(doc.version, 1);
  assert.ok(doc.cssVars && doc.texts && doc.styles && doc.images && doc.layout && doc.voices);
  assert.ok(doc.characters && doc.characters.Lily && doc.characters.Rose && doc.characters.Daisy);
  assert.ok(Array.isArray(doc.library));
  assert.ok("Lily" in doc.voices && "Rose" in doc.voices && "Daisy" in doc.voices);
});

test("UI editor is admin-gated and visual-only", () => {
  assert.match(editorJs, /bloom_admin_session/);
  assert.match(editorJs, /Enter Design Mode|enterDesignMode/);
  assert.match(editorJs, /Exit Design Mode|exitDesignMode/);
  assert.match(editorJs, /Enter Image Edit Mode|enterImageEditMode/);
  assert.match(editorJs, /Exit Image Edit Mode|exitImageEditMode/);
  assert.match(editorJs, /florisyn_design_overrides_v1/);
  assert.match(editorJs, /florisyn-image-edit-mode/);
  assert.match(editorJs, /uploadVoice/);
  assert.match(editorJs, /Ashley image library/);
  assert.match(editorJs, /backgroundImage|Background image URL/);
  assert.match(editorJs, /contenteditable|enableInlineTextEditing/);
  assert.match(editorJs, /applyCharacters|Character text/);
  assert.match(editorJs, /Sidebar \/ section position|flexDirection/);
  assert.match(editorJs, /isForbiddenTextSelector|isSafeTextTarget|sanitizeDesignDoc/);
  assert.match(editorJs, /resetDesignOverrides|Reset visuals/);
  assert.match(editorJs, /restoreAdminDesignPanel|ensureAdminDesignRoot/);
  assert.doesNotMatch(editorJs, /create-checkout|auth-login|membership|createClient\(|from\(['"]/i);
  assert.match(editorCss, /#florisynDesignBar/);
  assert.match(editorCss, /\.florisyn-design-selected/);
  assert.match(editorCss, /florisyn-image-edit-mode/);
  assert.match(editorCss, /contenteditable/);
});

test("design import refuses shell-flattening text selectors", () => {
  assert.match(editorJs, /FORBIDDEN_TEXT_SELECTOR_RE/);
  assert.match(editorJs, /#uiDesignModeRoot/);
  assert.match(editorJs, /never flatten structured UI|isSafeTextTarget/);
  assert.match(editorJs, /Please choose a \.json design file|not valid design JSON/);
});

test("Admin page exposes UI Design Mode and Image Edit Mode", () => {
  assert.match(adminHtml, /data-view="uiDesignMode"/);
  assert.match(adminHtml, /id="uiDesignModeRoot"/);
  assert.match(adminHtml, /florisyn-ui-editor\.js/);
  assert.match(adminJs, /uiDesignMode/);
  assert.match(adminJs, /FlorisynUiEditor/);
  assert.match(adminJs, /florisyn-admin-authenticated/);
  assert.match(editorJs, /florisyn-admin-authenticated/);
  assert.match(editorJs, /Upload Lily voice|uploadVoice/);
  assert.match(editorJs, /Daisy/);
  assert.match(editorJs, /replaceSelectedWithSrc|Image replaced instantly/);
  assert.match(editorJs, /removeSelectedImage/);
  assert.match(editorJs, /adminSaveCharacters|Save character text/);
  assert.match(editorJs, /adminSaveCssVars|Brand colors/);
});

test("florist app loads design overrides and custom voice playback wiring", () => {
  assert.match(indexHtml, /florisyn-ui-editor\.js/);
  assert.match(indexHtml, /florisyn-ui-editor\.css/);
  assert.match(voiceJs, /playUploadedVoice/);
  assert.match(voiceJs, /preferUploadedVoice/);
  assert.match(voiceJs, /persona === "Daisy"/);
});
