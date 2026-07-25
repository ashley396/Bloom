# Bloom v17.0 — Local AI Platform

## Added
- Local Ollama bridge, automatic detection, health checks, model selector, one-click model pull, test button, and AI status dashboard.
- Llama 3.1 8B as the recommended default.
- Structured JSON generation endpoint.
- Authenticated shop-context endpoint for Lily and Rose.
- Offline-first fallback preserving POS, Stripe, Supabase, orders, and inventory.
- Windows, macOS, and Linux launchers.

## Removed
- Required OpenAI credentials and direct OpenAI calls.

## Limitation
- Photo inventory scanning needs a local vision-model integration and is disabled in this foundation release. CSV import remains available.
