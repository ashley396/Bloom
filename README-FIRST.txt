BLOOM AI ROUTER FIX — redesign-v22

This update changes only two files:
  netlify/functions/ai-assistant.js
  netlify/functions/ai-context.js

What it fixes:
- Stops Bloom from sending the entire shop database to Cloudflare AI.
- Routes each request to a focused area: florist, business, inventory, website, marketing, customer, delivery, or reports.
- Keeps Lily and Rose personalities.
- Limits arrays, strings, object depth, and total prompt size.
- Reduces AI context records returned from Supabase.
- Gives a clearer message if a request is still too large.

How to install:
1. Keep GitHub Desktop on the redesign-v22 branch.
2. Extract this ZIP.
3. Copy the included netlify folder into the root Bloom folder.
4. Choose Replace the files in the destination when Windows asks.
5. In GitHub Desktop, confirm ONLY these two files are selected.
6. Commit with: Fix Lily and Rose AI context routing
7. Push origin. Netlify will create one branch deploy.
8. Test Lily and Rose on the redesign-v22 branch site before publishing production.

No Supabase migration is needed.
The existing CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_API_TOKEN variables remain unchanged.
