BLOOM — LILY [object Object] DISPLAY FIX

This update fixes the Website Studio helper showing [object Object].

Replace only:
- app.js
- public/app.js

The AI connection is working. The issue was that Cloudflare sometimes returned the generated wording inside a nested JSON object, and Bloom assigned that object directly to the text field. Bloom now safely extracts the actual wording.

Commit message:
Fix Lily generated text display
