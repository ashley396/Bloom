# Bloom v19.2 — Local Lily

## Fixed
- Removed Lily and Rose cloud fallback calls to OpenAI.
- Removed the requirement for OpenAI API credits.
- Corrected the misleading “Lily Online” status when the local bridge was offline.
- Added clear local setup and offline messages.
- Preserved normal Bloom operations while local AI is unavailable.

## AI architecture
Lily and Rose now communicate only with the Bloom Local AI Bridge at `127.0.0.1:11435`, which communicates with Ollama at `127.0.0.1:11434`. No florist prompts are sent to OpenAI by this feature.

## Database
No Supabase migration is required.
