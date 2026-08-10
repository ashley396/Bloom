import http from "node:http";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import {
  systemPromptFor,
  temperatureForPersona,
  normalizePersona
} from "../netlify/functions/_shared/florist-ai-personas.js";

const HOST = process.env.BLOOM_AI_HOST || "127.0.0.1";
const PORT = Number(process.env.BLOOM_AI_PORT || 11435);
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const DEFAULT_MODEL = process.env.BLOOM_AI_MODEL || "llama3.1:latest";
const MAX_BODY_BYTES = 12 * 1024 * 1024;

const explicitlyAllowed = new Set(
  (process.env.BLOOM_ALLOWED_ORIGINS || "https://bloom-technologies.netlify.app")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

function originAllowed(origin = "") {
  if (!origin) return true;
  if (explicitlyAllowed.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)) return true;
    if (parsed.protocol === "https:" && parsed.hostname.endsWith(".netlify.app")) return true;
  } catch {}
  return false;
}

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (origin && originAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(req, res, statusCode, payload) {
  setCors(req, res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function ollama(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeout || 90000));
  try {
    const response = await fetch(`${OLLAMA_URL}${path}`, {
      method: options.method || "GET",
      body: options.body,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Ollama returned ${response.status}`);
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The local AI request timed out.");
    if (/fetch failed|ECONNREFUSED|connection refused/i.test(String(error?.message))) {
      throw new Error("Ollama is not running. Open Ollama, then try again.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function status() {
  try {
    const data = await ollama("/api/tags", { timeout: 5000 });
    const models = (data.models || []).map(({ name, size, modified_at }) => ({ name, size, modified_at }));
    const baseName = DEFAULT_MODEL.split(":")[0];
    return {
      bridge: true,
      ollama: true,
      healthy: true,
      defaultModel: DEFAULT_MODEL,
      models,
      defaultAvailable: models.some((model) => model.name === DEFAULT_MODEL || model.name.startsWith(`${baseName}:`))
    };
  } catch (error) {
    return {
      bridge: true,
      ollama: false,
      healthy: false,
      defaultModel: DEFAULT_MODEL,
      models: [],
      defaultAvailable: false,
      error: error.message
    };
  }
}

async function handleChat(body) {
  const prompt = String(body.prompt || "").trim();
  const persona = normalizePersona(body.persona);
  const model = String(body.model || DEFAULT_MODEL).trim();
  const context = body.context || {};
  if (!prompt) throw new Error("Enter a question first.");

  const data = await ollama("/api/chat", {
    method: "POST",
    timeout: 120000,
    body: JSON.stringify({
      model,
      stream: false,
      format: body.format === "json" ? "json" : undefined,
      options: { temperature: temperatureForPersona(persona, "chat"), num_predict: 700 },
      messages: [
        { role: "system", content: systemPromptFor(persona, "chat") },
        { role: "user", content: `SHOP DATA (use only when relevant):\n${JSON.stringify(context)}\n\nQUESTION:\n${prompt}` }
      ]
    })
  });

  const answer = String(data.message?.content || "").trim();
  if (!answer) throw new Error("The model returned an empty response.");
  return { answer, persona, model, local: true };
}

async function handleGenerate(body) {
  const persona = normalizePersona(body.persona || "Lily");
  const model = String(body.model || DEFAULT_MODEL).trim();
  const task = String(body.task || "content");
  const input = body.input || {};
  const schema = body.schema || { result: "string" };
  const prompt = `Complete this florist task: ${task}. Return VALID JSON ONLY matching this example shape: ${JSON.stringify(schema)}. Do not use markdown. INPUT: ${JSON.stringify(input)}`;
  const data = await ollama("/api/chat", {
    method: "POST",
    timeout: 120000,
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature: temperatureForPersona(persona, "generate"), num_predict: 900 },
      messages: [
        { role: "system", content: systemPromptFor(persona, "generate") },
        { role: "user", content: prompt }
      ]
    })
  });
  const raw = String(data.message?.content || "");
  try {
    return { result: JSON.parse(raw), model, local: true };
  } catch {
    throw new Error("The model returned invalid structured data. Try again.");
  }
}

async function installModel(body) {
  const model = String(body.model || DEFAULT_MODEL).trim();
  if (!/^[a-zA-Z0-9._:/-]+$/.test(model)) throw new Error("Invalid model name.");
  return await new Promise((resolve, reject) => {
    const child = spawn("ollama", ["pull", model], { shell: process.platform === "win32" });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.once("error", () => reject(new Error("Ollama is not installed or could not be started.")));
    child.once("close", (code) => {
      if (code === 0) resolve({ ok: true, model, message: `${model} is installed.` });
      else reject(new Error(`Model installation failed (code ${code}). ${output.slice(-1000)}`));
    });
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  if (!originAllowed(origin)) return sendJson(req, res, 403, { error: "This website is not allowed to use Bloom Local AI." });
  if (req.method === "OPTIONS") {
    setCors(req, res);
    res.writeHead(204);
    return res.end();
  }

  try {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/models")) {
      return sendJson(req, res, 200, await status());
    }
    if (req.method === "POST" && url.pathname === "/chat") {
      return sendJson(req, res, 200, await handleChat(await readJson(req)));
    }
    if (req.method === "POST" && url.pathname === "/generate") {
      return sendJson(req, res, 200, await handleGenerate(await readJson(req)));
    }
    if (req.method === "POST" && url.pathname === "/models/install") {
      return sendJson(req, res, 200, await installModel(await readJson(req)));
    }
    return sendJson(req, res, 404, { error: "Not found." });
  } catch (error) {
    return sendJson(req, res, 503, { error: error?.message || "Bloom Local AI is unavailable." });
  }
});

server.listen(PORT, HOST, async () => {
  console.log("====================================================");
  console.log(" Bloom Local AI Bridge is running");
  console.log(` Address: http://${HOST}:${PORT}`);
  console.log(` Ollama: ${OLLAMA_URL}`);
  console.log(` Model: ${DEFAULT_MODEL}`);
  console.log(" Keep this window open while using Lily and Rose.");
  console.log("====================================================");
  console.log(await status());
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. The Bloom bridge may already be running.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

if (process.argv.includes("--check")) {
  setTimeout(async () => {
    console.log(await status());
    server.close();
  }, 500);
}
