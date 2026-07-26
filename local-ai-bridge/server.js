import http from "node:http";
import { spawn } from "node:child_process";
import { URL } from "node:url";

const HOST = process.env.BLOOM_AI_HOST || "127.0.0.1";
const PORT = Number(process.env.BLOOM_AI_PORT || 11435);
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const DEFAULT_MODEL = process.env.BLOOM_AI_MODEL || "llama3.1:latest";
const ALLOWED_ORIGINS = new Set(
  (process.env.BLOOM_ALLOWED_ORIGINS || "https://bloom-technologies.netlify.app,http://localhost:8888,http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+(?:--[a-z0-9-]+)?\.netlify\.app$/i.test(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.headers["access-control-request-private-network"] === "true") {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
  }
  return !origin || isAllowedOrigin(origin);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readJson(req, maxBytes = 12 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request is too large.");
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
  const timeout = setTimeout(() => controller.abort(), Number(options.timeout || 90000));
  try {
    const response = await fetch(`${OLLAMA_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Ollama returned ${response.status}`);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The local AI request timed out.");
    if (/fetch failed|ECONNREFUSED/i.test(String(error.message))) {
      throw new Error("Ollama is not running. Open Ollama, then try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function status() {
  try {
    const data = await ollama("/api/tags", { method: "GET", timeout: 5000 });
    const models = (data.models || []).map((model) => ({
      name: model.name,
      size: model.size,
      modified_at: model.modified_at,
    }));
    return {
      bridge: true,
      ollama: true,
      healthy: true,
      defaultModel: DEFAULT_MODEL,
      models,
      defaultAvailable: models.some(
        (model) => model.name === DEFAULT_MODEL || model.name.startsWith(`${DEFAULT_MODEL.split(":")[0]}:`),
      ),
    };
  } catch (error) {
    return {
      bridge: true,
      ollama: false,
      healthy: false,
      defaultModel: DEFAULT_MODEL,
      models: [],
      defaultAvailable: false,
      error: error.message,
    };
  }
}

const personaInstructions = {
  Lily: "You are Lily, Bloom's creative florist assistant. Be warm, upbeat, practical, florist-focused, and concise. Help with floral recipes, pricing, product descriptions, marketing, substitutions, sympathy wording, weddings, and waste reduction. Never invent shop facts, inventory, prices, or customer details.",
  Rose: "You are Rose, Bloom's seasoned flower-shop business manager. Be direct, protective of profit, gently witty, and never rude. Help with sales, margins, expenses, unpaid balances, inventory, deliveries, staffing, and business decisions. Never invent shop numbers.",
};

async function installModel(model) {
  return await new Promise((resolve, reject) => {
    const child = spawn("ollama", ["pull", model], { shell: process.platform === "win32" });
    let output = "";
    child.stdout.on("data", (data) => { output += data.toString(); });
    child.stderr.on("data", (data) => { output += data.toString(); });
    child.once("error", () => reject(new Error("Ollama is not installed or could not be started.")));
    child.once("close", (code) => {
      if (code === 0) resolve({ ok: true, model, message: `${model} is installed.` });
      else reject(new Error(`Model installation failed (code ${code}). ${output.slice(-1000)}`));
    });
  });
}

async function route(req, res) {
  if (!setCors(req, res)) return sendJson(res, 403, { error: "This website is not allowed to use Bloom Local AI." });
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/models")) {
    return sendJson(res, 200, await status());
  }

  if (req.method === "POST" && url.pathname === "/models/install") {
    try {
      const body = await readJson(req);
      const model = String(body.model || DEFAULT_MODEL).trim();
      if (!/^[a-zA-Z0-9._:/-]+$/.test(model)) return sendJson(res, 400, { error: "Invalid model name." });
      return sendJson(res, 200, await installModel(model));
    } catch (error) {
      return sendJson(res, 503, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/chat") {
    try {
      const body = await readJson(req);
      const model = String(body.model || DEFAULT_MODEL);
      const prompt = String(body.prompt || "").trim();
      const persona = body.persona === "Rose" ? "Rose" : "Lily";
      const context = body.context || {};
      if (!prompt) return sendJson(res, 400, { error: "Enter a question first." });
      const data = await ollama("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          model,
          stream: false,
          format: body.format === "json" ? "json" : undefined,
          options: { temperature: persona === "Rose" ? 0.2 : 0.45, num_predict: 700 },
          messages: [
            { role: "system", content: personaInstructions[persona] },
            { role: "user", content: `SHOP DATA (use only when relevant):\n${JSON.stringify(context)}\n\nQUESTION:\n${prompt}` },
          ],
        }),
        timeout: 120000,
      });
      const answer = String(data.message?.content || "").trim();
      if (!answer) throw new Error("The model returned an empty response.");
      return sendJson(res, 200, { answer, persona, model, local: true });
    } catch (error) {
      return sendJson(res, 503, { error: error.message || "Bloom Local AI is unavailable." });
    }
  }

  if (req.method === "POST" && url.pathname === "/generate") {
    try {
      const body = await readJson(req);
      const model = String(body.model || DEFAULT_MODEL);
      const task = String(body.task || "content");
      const input = body.input || {};
      const schema = body.schema || { result: "string" };
      const prompt = `You are Bloom's florist operations engine. Complete the ${task} task. Return VALID JSON ONLY matching this example shape: ${JSON.stringify(schema)}. Do not use markdown. INPUT: ${JSON.stringify(input)}`;
      const data = await ollama("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          model,
          stream: false,
          format: "json",
          options: { temperature: 0.25, num_predict: 900 },
          messages: [
            { role: "system", content: "You produce accurate florist-focused structured data. Never invent shop-specific facts. Return JSON only." },
            { role: "user", content: prompt },
          ],
        }),
        timeout: 120000,
      });
      const raw = String(data.message?.content || "");
      let result;
      try { result = JSON.parse(raw); } catch { throw new Error("The model returned invalid structured data. Try again."); }
      return sendJson(res, 200, { result, model, local: true });
    } catch (error) {
      return sendJson(res, 503, { error: error.message || "Structured generation failed." });
    }
  }

  return sendJson(res, 404, { error: "Bloom Local AI route not found." });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => sendJson(res, 500, { error: error.message || "Unexpected bridge error." }));
});

server.listen(PORT, HOST, () => {
  console.log(`Bloom Local AI Bridge running at http://${HOST}:${PORT}`);
  console.log(`Ollama: ${OLLAMA_URL}`);
  console.log(`Default model: ${DEFAULT_MODEL}`);
});

if (process.argv.includes("--check")) {
  setTimeout(async () => {
    console.log(await status());
    server.close();
  }, 300);
}
