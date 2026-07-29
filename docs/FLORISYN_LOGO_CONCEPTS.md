# Florisyn — Official Logo Concepts (Founder Review)

Three premium marks per the **Stem F / Hidden Flower / Monoline** brief. Not literal flowers — abstract **F** with stem, leaf, and layered crown structure only.

## Concept A — Stem F

**Idea:** A confident letter **F** where the vertical stroke is the stem (sage), crossbars read as leaf blades, and a soft layered cap suggests peony/hydrangea volume without depicting petals.

| Variant | File |
|---------|------|
| Full color (ivory field) | `public/assets/florisyn/concepts/concept-a-stem-f/florisyn-concept-a-color.svg` |
| Black mono | `florisyn-concept-a-black.svg` |
| White on charcoal | `florisyn-concept-a-white.svg` |
| Favicon 32×32 | `florisyn-concept-a-favicon.svg` |

**Best for:** App icon, sidebar mark, product chrome.

---

## Concept B — Hidden Flower

**Idea:** Rounded layered forms (abstract floral mass). **Ivory channels** cut through sage layers so negative space reads as **F** at a glance.

| Variant | File |
|---------|------|
| Full color | `public/assets/florisyn/concepts/concept-b-hidden-flower/florisyn-concept-b-color.svg` |
| Black mono | `florisyn-concept-b-black.svg` |
| White on charcoal | `florisyn-concept-b-white.svg` |
| Favicon | `florisyn-concept-b-favicon.svg` |

**Best for:** Marketing hero, splash, social avatars.

---

## Concept C — Monoline

**Idea:** Single continuous stroke: stem rises, loops into a soft crown (one stroke), crossbar completes the **F**. Champagne gold dot = accent only.

| Variant | File |
|---------|------|
| Full color | `public/assets/florisyn/concepts/concept-c-monoline/florisyn-concept-c-color.svg` |
| Black mono | `florisyn-concept-c-black.svg` |
| White on charcoal | `florisyn-concept-c-white.svg` |
| Favicon | `florisyn-concept-c-favicon.svg` |

**Best for:** Favicon, watermark, small UI, monochrome embroidery.

---

## Palette (all concepts)

| Role | Hex |
|------|-----|
| Sage (primary) | `#6B8F7A` / deep `#4D6B5C` |
| Dusty rose | `#C4A4A4` |
| Ivory | `#FAF7F2` |
| Charcoal | `#2F2A2C` |
| Champagne gold (accent dot) | `#C9A962` |

No heavy gradients. Flat, software-grade fills and strokes.

---

## PNG & 1024 app icon

SVG is source. Export from Figma, Inkscape, or CLI:

```bash
# Example: Inkscape
inkscape florisyn-concept-a-color.svg -w 1024 -h 1024 -o florisyn-app-icon-1024.png
```

Use **12% padding** on 1024 canvas. Favicon: use `*-favicon.svg` or export color SVG at 16×16 and 32×32.

---

## Preview in browser

Open `public/assets/florisyn/concepts/preview.html` locally to compare all three at app-icon and favicon sizes.

---

## Recommendation (for discussion)

- **Product default:** Concept **A** (clearest F at 16px, most “Linear/Notion” tone).  
- **Brand campaigns:** Concept **B**.  
- **Monochrome-only contexts:** Concept **C**.

Founder picks one concept → refine spacing, wordmark lockup, then replace production assets in `public/assets/florisyn/`.
