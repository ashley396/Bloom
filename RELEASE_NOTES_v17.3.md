# Bloom X v17.3 — Lily & Rose Bridge Repair

- Rebuilt the local AI bridge with Node.js built-in modules only.
- Removed the npm install and Express requirement.
- Added reliable Windows Node.js detection, including `C:\Program Files\nodejs\node.exe`.
- Added working `/health`, `/models`, `/chat`, `/generate`, and `/models/install` routes.
- Added CORS and Private Network Access headers for the Netlify-hosted Bloom app.
- Changed the default local model to `llama3.1:latest`, matching the installed Ollama model.
- Preserved the existing Bloom POS, Stripe, Supabase, orders, customers, inventory, and production features.

No Supabase migration is required.
