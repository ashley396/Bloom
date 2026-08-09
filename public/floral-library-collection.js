/**
 * Florisyn Signature Collection — a curated set of ultra-realistic, everyday
 * floral arrangements shipped as local assets.
 *
 * Purpose:
 *  - Seeds the Floral Library with approachable, "everyday" designs.
 *  - Acts as an elegant populated fallback when the server master catalog
 *    (floral-library function) is empty or unavailable, so the Library is
 *    never blank.
 *
 * Item shape matches what floral-library-ui.js expects, so the same renderer,
 * "Add to My Shop", and preview paths work for both server and local items.
 */
(function (global) {
  "use strict";

  var BASE = "/assets/floral-library/";

  function item(cfg) {
    var retail = cfg.retail;
    var recipe = cfg.recipe || [];
    return {
      id: cfg.id,
      source: "florisyn_signature",
      name: cfg.name,
      categories: cfg.categories,
      short_description: cfg.short,
      description: cfg.description || cfg.short,
      recipe: recipe,
      suggested_retail: { default: retail },
      // Everyday designs run a healthy ~58% product margin by default.
      suggested_cost: cfg.cost != null ? cfg.cost : Math.round(retail * 0.42 * 100) / 100,
      primary_image: { url: BASE + cfg.image, alt: cfg.alt || cfg.name + " floral arrangement" },
      image_license: { source: "Florisyn Studio", review_status: "approved" }
    };
  }

  var COLLECTION = [
    item({
      id: "sig-everyday-garden-medley",
      name: "Everyday Garden Medley",
      categories: ["Everyday"],
      retail: 64.99,
      image: "florisyn-everyday-garden-medley.jpg",
      alt: "Loose garden bouquet of pink roses, white daisies and greenery in a mason jar",
      short: "A loose, cheerful garden mix in a simple mason jar — perfect for any day.",
      recipe: [
        { name: "Garden Roses", qty: 5 },
        { name: "White Daisies", qty: 6 },
        { name: "Blue Statice", qty: 3 },
        { name: "Mixed Greenery", qty: 5 }
      ]
    }),
    item({
      id: "sig-everyday-sunny-bouquet",
      name: "Sunny Day Bouquet",
      categories: ["Everyday", "Get Well"],
      retail: 59.99,
      image: "florisyn-everyday-sunny-bouquet.jpg",
      alt: "Cheerful bouquet of sunflowers, daisies and spray roses in a glass vase",
      short: "Sunflowers and daisies to brighten someone's whole week.",
      recipe: [
        { name: "Sunflowers", qty: 3 },
        { name: "Yellow Daisies", qty: 6 },
        { name: "Orange Spray Roses", qty: 4 },
        { name: "Greenery", qty: 4 }
      ]
    }),
    item({
      id: "sig-everyday-market-wildflowers",
      name: "Market Fresh Wildflowers",
      categories: ["Everyday"],
      retail: 54.99,
      image: "florisyn-everyday-market-wildflowers.jpg",
      alt: "Rustic wildflower gathering in soft pinks, lavender and white",
      short: "A relaxed, just-picked wildflower gathering with airy texture.",
      recipe: [
        { name: "Seasonal Wildflowers", qty: 9 },
        { name: "Lavender Stems", qty: 4 },
        { name: "Airy Grasses", qty: 5 }
      ]
    }),
    item({
      id: "sig-everyday-rose-pitcher",
      name: "Simple Rose Pitcher",
      categories: ["Love & Romance", "Everyday"],
      retail: 69.99,
      image: "florisyn-everyday-rose-pitcher.jpg",
      alt: "Cream and blush roses with eucalyptus in a white ceramic pitcher",
      short: "Cream and blush roses in a sweet ceramic pitcher — soft and simple.",
      recipe: [
        { name: "Cream Roses", qty: 6 },
        { name: "Blush Roses", qty: 6 },
        { name: "Eucalyptus", qty: 4 },
        { name: "Baby's Breath", qty: 3 }
      ]
    }),
    item({
      id: "sig-everyday-spring-pastels",
      name: "Spring Pastels",
      categories: ["Everyday", "New Baby"],
      retail: 62.99,
      image: "florisyn-everyday-spring-pastels.jpg",
      alt: "Pastel tulips, ranunculus and daffodils in a clear glass vase",
      short: "Fresh tulips and ranunculus in soft pastels — a breath of spring.",
      recipe: [
        { name: "Pastel Tulips", qty: 7 },
        { name: "Ranunculus", qty: 5 },
        { name: "Daffodils", qty: 4 },
        { name: "Foliage", qty: 3 }
      ]
    }),
    item({
      id: "sig-everyday-daisies-tulips",
      name: "Daisies & Tulips",
      categories: ["Everyday", "Birthday"],
      retail: 49.99,
      image: "florisyn-everyday-daisies-tulips.jpg",
      alt: "White daisies and soft pink tulips with greenery in a glass jar",
      short: "Bright white daisies and pink tulips — simple, happy, everyday.",
      recipe: [
        { name: "White Daisies", qty: 8 },
        { name: "Pink Tulips", qty: 6 },
        { name: "Greenery", qty: 4 }
      ]
    }),
    item({
      id: "sig-signature-blush-garden",
      name: "Signature Blush Garden",
      categories: ["Everyday", "Love & Romance"],
      retail: 74.99,
      image: "florisyn-arrangement-signature-blush.jpg",
      alt: "Blush garden roses with blue and white hydrangea and eucalyptus",
      short: "Our signature blush garden roses with soft hydrangea and eucalyptus.",
      recipe: [
        { name: "Blush Garden Roses", qty: 6 },
        { name: "Blue Hydrangea", qty: 2 },
        { name: "White Hydrangea", qty: 1 },
        { name: "Ranunculus", qty: 4 },
        { name: "Eucalyptus", qty: 5 }
      ]
    })
  ];

  if (global) global.FlorisynLibraryCollection = COLLECTION;
  if (typeof module !== "undefined" && module.exports) module.exports = COLLECTION;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
