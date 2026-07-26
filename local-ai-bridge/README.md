# Bloom Local AI Bridge

This small local service lets the Bloom website use Ollama running on the same computer. It binds to `127.0.0.1` only.

## Start

```bash
npm install
npm start
```

Default bridge URL: `http://127.0.0.1:11435`
Default Ollama model: `llama3.1:8b`

Optional environment variables: `BLOOM_AI_MODEL`, `OLLAMA_URL`, `BLOOM_AI_PORT`, and `BLOOM_ALLOWED_ORIGINS`.
