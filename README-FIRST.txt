BLOOM STABILIZATION UPDATE — REDESIGN-V22

This package contains six source files plus the marketplace architecture note.

What it changes:
1. Trims embedded logos, website photos, receipt images, base64 data, long strings, arrays, and nested objects before any AI request leaves the browser.
2. Repeats the same safety checks inside the Netlify AI function, so oversized requests cannot reach Cloudflare even if the browser cache is stale.
3. Reduces ai-context database results to recent, relevant records.
4. Sends signup confirmation links back to the current Netlify branch or production login page instead of localhost.
5. Records the recommended Florist / Wholesaler / Platform Admin marketplace design.

Files to replace in the Bloom repository:
- app.js
- public/app.js
- netlify/functions/ai-assistant.js
- netlify/functions/ai-context.js
- netlify/functions/auth-signup.js
- MARKETPLACE_ARCHITECTURE.md (new planning file)

Recommended commit message:
Fix Bloom AI payload and signup redirect

After Netlify deploys redesign-v22:
1. Open the branch site.
2. Press Ctrl+Shift+R.
3. Test “Lily write this.”
4. In Network > ai-assistant > Response, a successful response may include promptChars. It should be well below 42,000, not hundreds of thousands.
5. Do not publish to production until Lily, Rose, and signup confirmation are tested on the branch.
