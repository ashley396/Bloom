# Bloom v20.0 — Low-Cost AI + BloomShot Studio

## Added
- BloomShot Studio with browser-based photo correction, presets, canvas sizes, backgrounds, rotation, watermarking, and PNG export.
- Fully editable product name, description, caption, SEO title, alt text, price, and occasion fields.
- Mandatory review/approval before adding AI-created product content.
- Local device drafts and restore-original controls.
- Smart AI routing: optional Cloudflare Workers AI first, free Ollama bridge fallback second.
- AI results identify their provider and never auto-publish.

## Cost controls
- Core Bloom operations do not use AI.
- Standard BloomShot adjustments run inside the browser and do not create API charges.
- Cloud AI is optional and only used for requested writing/creative work.
- Ollama remains the free local fallback.
- No automatic image-generation calls were added.

## Honest limitation
Background replacement and object removal that require generative image AI are not silently simulated. v20 provides free solid studio backgrounds and professional correction tools. Generative editing can be added later behind an optional paid usage control.
