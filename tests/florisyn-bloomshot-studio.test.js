import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

function bloomshotSection() {
  const start = html.indexOf('id="bloomshotPage"');
  const end = html.indexOf('id="aiStudioPage"', start);
  return html.slice(start, end);
}

test("Background dropdown keeps the classic options and adds a Luxury group", () => {
  const select = html.slice(html.indexOf('id="shotBackground"'), html.indexOf("</select>", html.indexOf('id="shotBackground"')));
  assert.match(select, /value="#ffffff">White studio</, "White studio must stay the default first option");
  assert.match(select, /value="#f8f3f6">Soft blush</);
  assert.match(select, /value="#f3efe8">Warm ivory</);
  assert.match(select, /value="#eef3ea">Soft garden</);
  assert.match(select, /value="transparent">Transparent</);
  assert.match(select, /<optgroup label="Luxury">/);
  for (const key of ["luxury-charcoal", "luxury-champagne", "luxury-emerald", "luxury-marble", "luxury-noir"]) {
    assert.match(select, new RegExp(`value="${key}"`), `${key} option must exist`);
  }
  // White studio option must come before the Luxury group, not replace it.
  assert.ok(select.indexOf('value="#ffffff"') < select.indexOf("<optgroup"));
});

test("Luxury background dropdown values resolve to real gradients, not raw CSS colors", () => {
  const stylesStart = app.indexOf("const SHOT_BACKGROUND_STYLES=");
  assert.ok(stylesStart >= 0, "SHOT_BACKGROUND_STYLES must exist");
  const stylesBlock = app.slice(stylesStart, app.indexOf("};", stylesStart) + 2);
  for (const key of ["luxury-charcoal", "luxury-champagne", "luxury-emerald", "luxury-marble", "luxury-noir"]) {
    assert.match(stylesBlock, new RegExp(`"${key}":\\{type:"gradient"`), `${key} must be a defined gradient`);
  }
  // drawBloomShot must look named styles up instead of using the dropdown
  // value directly as a CSS color (which would render "luxury-charcoal"
  // as an invalid/black fill).
  const drawStart = app.indexOf("function drawBloomShot(");
  const drawFn = app.slice(drawStart, drawStart + 900);
  assert.match(drawFn, /SHOT_BACKGROUND_STYLES\[s\.background\]/);
});

test("Photo Studio has a clear Remove photo control alongside Restore original", () => {
  const section = bloomshotSection();
  assert.match(section, /id="bloomshotRestore"[^>]*>Restore original</);
  assert.match(section, /id="bloomshotRemovePhoto"[^>]*>Remove photo</);
  // Remove photo must be wired in app.js and fully reset image state so a
  // new photo can be chosen (not just visually cleared).
  const start = app.indexOf('$("#bloomshotRemovePhoto")');
  assert.ok(start >= 0, "bloomshotRemovePhoto must be wired");
  const handler = app.slice(start, start + 700);
  assert.match(handler, /shotImage=null/);
  assert.match(handler, /shotCutout=null/);
  assert.match(handler, /shotSavedProductId=null/);
  assert.match(handler, /file\.value=""/, "must clear the file input so re-selecting the same file re-fires change");
});

test("Photo Studio has clear Save controls distinct from Post", () => {
  const section = bloomshotSection();
  assert.match(section, /id="shotSaveDraft"[^>]*>Save draft \(this device\)</);
  assert.match(section, /id="shotAddProduct"[^>]*>[^<]*Save to Products</);
});

test("Photo Studio Post block offers website, community, and social destinations", () => {
  const section = bloomshotSection();
  const blockStart = section.indexOf("bloomshot-post-block");
  assert.ok(blockStart >= 0, "bloomshot-post-block must exist");
  const block = section.slice(blockStart, blockStart + 900);
  assert.match(block, /id="shotPostWebsite"/);
  assert.match(block, /id="shotPostCommunity"/);
  assert.match(block, /id="shotPostSocial"/);
  assert.match(block, /id="shotPost"[^>]*>[^<]*Post</);
  // Styling exists so the block isn't a bare unstyled list of checkboxes.
  assert.match(css, /\.bloomshot-post-block\{/);
});

test("Post requires approval and at least one destination before doing anything", () => {
  const start = app.indexOf('$("#shotPost")?.addEventListener');
  assert.ok(start >= 0, "shotPost handler must exist");
  const handler = app.slice(start, start + 2200);
  assert.match(handler, /shotPostWebsite.*checked/);
  assert.match(handler, /shotPostCommunity.*checked/);
  assert.match(handler, /shotPostSocial.*checked/);
  assert.match(handler, /Choose at least one place to post to/);
  assert.match(handler, /shotApproved.*checked/);
});

test("Posting to website reuses the same saved product (no duplicate drafts) and publishes it", () => {
  assert.match(app, /async function shotSaveToProducts\(/);
  const fnStart = app.indexOf("async function shotSaveToProducts(");
  const fnEnd = app.indexOf("\n$(\"#shotAddProduct\")", fnStart);
  const fn = app.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 1200);
  assert.match(fn, /shotSavedProductId/, "must track the created product id to avoid duplicate saves");
  assert.match(fn, /method:"PATCH"/);
  assert.match(fn, /method:"POST"/);

  const postStart = app.indexOf('$("#shotPost")?.addEventListener');
  const postHandler = app.slice(postStart, postStart + 2200);
  assert.match(postHandler, /shotSaveToProducts\(\{availableOnline:true\}\)/, "website destination must publish (available_online:true)");
});

test("Posting to Community feed calls the real florist-community create_post action", () => {
  const postStart = app.indexOf('$("#shotPost")?.addEventListener');
  const postHandler = app.slice(postStart, postStart + 2200);
  assert.match(postHandler, /api\("florist-community"/);
  assert.match(postHandler, /action:"create_post"/);
  assert.match(postHandler, /category:"Arrangement Share"/);
  assert.match(postHandler, /image_data_url:/);
});

test("Posting for social downloads the image and copies the caption (no fake API integration claimed)", () => {
  const postStart = app.indexOf('$("#shotPost")?.addEventListener');
  const postHandler = app.slice(postStart, postStart + 2200);
  assert.match(postHandler, /toDataURL\("image\/png"/);
  assert.match(postHandler, /navigator\.clipboard/);
});
