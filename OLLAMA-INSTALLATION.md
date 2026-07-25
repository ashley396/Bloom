# Bloom v17 — Ollama Installation

## 1. Install Ollama
Install Ollama from its official website on Windows or macOS. On Linux, use Ollama's official Linux installation instructions.

## 2. Install the recommended model
```bash
ollama pull llama3.1
```

## 3. Start Bloom Local AI Bridge
### Windows
Double-click `START-BLOOM-AI-WINDOWS.bat`.
### macOS
Double-click `start-bloom-ai.command`, or run `./start-bloom-ai.command`.
### Linux
Run `./start-bloom-ai.sh`.

Keep the terminal window open while using Lily or Rose. Bloom's POS, Stripe, Supabase, orders, and inventory continue working if AI is offline.

Diagnostics: open Bloom → Settings → Run diagnostics. Bridge health URL: `http://127.0.0.1:11435/health`.
