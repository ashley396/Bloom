import test from "node:test";
import assert from "node:assert/strict";
import {
  productVisibleOnPublicSite,
  STARTER_FLORAL_LIBRARY,
} from "../netlify/functions/_shared/floral-library-core.js";

const publicSync = { available_online: true, out_of_stock_behavior: "show" };

test("public Floral Library excludes non-vase starter products", () => {
  const bridal = STARTER_FLORAL_LIBRARY.find(item => item.id === "lib-wedding-bridal");
  const greenery = STARTER_FLORAL_LIBRARY.find(item => item.id === "lib-greenery-bundle");
  assert.equal(productVisibleOnPublicSite({ ...bridal, sync: publicSync }), false);
  assert.equal(productVisibleOnPublicSite({ ...greenery, sync: publicSync }), false);
});

test("public Floral Library excludes replacement-needed and unapproved images", () => {
  const base = {
    scope: "master",
    arrangement_type: "vase_arrangement",
    publish_status: "published",
    sync: publicSync,
    image_license: { review_status: "approved" },
  };
  assert.equal(productVisibleOnPublicSite({ ...base, needs_image_replacement: true }), false);
  assert.equal(productVisibleOnPublicSite({ ...base, image_license: { review_status: "pending" } }), false);
  assert.equal(productVisibleOnPublicSite({ ...base, image_license: undefined }), false);
});

test("public Floral Library includes an approved finished vase arrangement", () => {
  const vase = STARTER_FLORAL_LIBRARY.find(item => item.id === "lib-luxury-garden");
  assert.equal(vase.arrangement_type, "vase_arrangement");
  assert.equal(productVisibleOnPublicSite({ ...vase, sync: publicSync }), true);
});
