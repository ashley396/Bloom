# Bloom Local AI Bridge

This local service lets the Bloom website use Ollama on the same Windows computer. It binds to `127.0.0.1` only and uses only Node.js built-in features, so no `npm install` is required.

## Windows

Extract the project ZIP first, then double-click `START-BLOOM-AI-WINDOWS.bat` from the extracted folder. Keep the black window open while using Lily or Rose.

## Manual start

```bash
node local-ai-bridge/server.js
```

Default bridge URL: `http://127.0.0.1:11435`
Default Ollama model: `llama3.1:latest`

Optional environment variables: `BLOOM_AI_MODEL`, `OLLAMA_URL`, `BLOOM_AI_PORT`, and `BLOOM_ALLOWED_ORIGINS`.
