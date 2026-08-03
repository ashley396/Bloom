#!/usr/bin/env node
/**
 * Static compatibility audit for staging Supabase API keys vs Florisyn Netlify expectations.
 *
 * DOES NOT:
 * - Connect to hosted Supabase
 * - Print secret values
 * - Mutate Netlify / Supabase settings
 *
 * Optionally accepts env vars already present in the local shell. Values are never printed —
 * only presence, shape, and JWT-header/role claims (decoded payload role only) are reported.
 */
import process from "node:process";
import { resolveSupabaseClientKey, resolveSupabaseServerKey } from "../netlify/functions/_shared/supabase.js";

function b64urlJson(segment) {
  const pad = "=".repeat((4 - (segment.length % 4)) % 4);
  const raw = Buffer.from((segment + pad).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(raw);
}

function inspectJwtShape(name, value) {
  if (!value) return { name, present: false };
  const parts = String(value).split(".");
  const out = {
    name,
    present: true,
    length: String(value).length,
    looksLikeJwt: parts.length === 3,
    alg: null,
    role: null,
    ref: null,
    issues: [],
  };
  // Never include the raw value.
  if (parts.length !== 3) {
    out.issues.push("not a three-segment JWT (legacy anon/service keys are JWTs)");
    return out;
  }
  try {
    const header = b64urlJson(parts[0]);
    const payload = b64urlJson(parts[1]);
    out.alg = header.alg || null;
    out.role = payload.role || null;
    out.ref = payload.ref || null;
    if (!payload.role) out.issues.push("JWT payload missing role claim");
  } catch {
    out.issues.push("JWT header/payload could not be decoded");
  }
  return out;
}

function inspectUrl(name, value) {
  if (!value) return { name, present: false };
  const out = { name, present: true, host: null, https: false, issues: [] };
  try {
    const u = new URL(String(value).trim());
    out.host = u.hostname;
    out.https = u.protocol === "https:";
    if (u.protocol !== "https:" && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
      out.issues.push("SUPABASE_URL should be https for hosted staging");
    }
    if (!u.hostname.includes("supabase.co") && !["127.0.0.1", "localhost"].includes(u.hostname)) {
      out.issues.push("host is not *.supabase.co (may still be valid custom domain — verify manually)");
    }
  } catch {
    out.issues.push("not a valid URL");
  }
  return out;
}

function main() {
  const env = process.env;
  const urlInfo = inspectUrl("SUPABASE_URL", env.SUPABASE_URL);

  const client = resolveSupabaseClientKey(env);
  const server = resolveSupabaseServerKey(env);

  const clientInfo = inspectJwtShape(client?.name || "SUPABASE_ANON_KEY|SUPABASE_PUBLISHABLE_KEY", client?.value);
  const serverInfo = inspectJwtShape(server?.name || "SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY", server?.value);

  // Compatibility matrix expected by netlify/functions/_shared/supabase.js
  const expectations = [
    {
      id: "url_required",
      ok: urlInfo.present && !urlInfo.issues.includes("not a valid URL"),
      detail: "SUPABASE_URL must be set for Netlify functions",
    },
    {
      id: "client_key_alias",
      ok: Boolean(client),
      detail: "Client key must be SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY",
    },
    {
      id: "server_key_alias",
      ok: Boolean(server),
      detail: "Server key must be SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY",
    },
    {
      id: "client_role_anon",
      ok: !client || clientInfo.role === "anon" || clientInfo.role === "authenticated" || !clientInfo.looksLikeJwt,
      detail: "Client JWT role should be anon (classic) when JWT-shaped",
    },
    {
      id: "server_role_service",
      ok: !server || serverInfo.role === "service_role" || !serverInfo.looksLikeJwt,
      detail: "Service JWT role should be service_role when JWT-shaped",
    },
    {
      id: "keys_not_swapped",
      ok:
        !client ||
        !server ||
        !clientInfo.role ||
        !serverInfo.role ||
        clientInfo.role !== serverInfo.role,
      detail: "Client and service keys must not share the same role claim",
    },
    {
      id: "community_flag_off_for_bootstrap",
      ok: !env.FLORISYN_FLAG_COMMUNITY_BETA || String(env.FLORISYN_FLAG_COMMUNITY_BETA).toLowerCase() !== "true",
      detail: "FLORISYN_FLAG_COMMUNITY_BETA must be missing/false during staging migration bootstrap",
    },
  ];

  const report = {
    mode: "static-metadata-only",
    connectedToHostedSupabase: false,
    secretsPrinted: false,
    url: {
      present: urlInfo.present,
      host: urlInfo.host,
      https: urlInfo.https,
      issues: urlInfo.issues,
    },
    clientKey: {
      envName: client?.name || null,
      present: clientInfo.present,
      looksLikeJwt: clientInfo.looksLikeJwt,
      alg: clientInfo.alg,
      role: clientInfo.role,
      ref: clientInfo.ref,
      length: clientInfo.length,
      issues: clientInfo.issues,
    },
    serverKey: {
      envName: server?.name || null,
      present: serverInfo.present,
      looksLikeJwt: serverInfo.looksLikeJwt,
      alg: serverInfo.alg,
      role: serverInfo.role,
      ref: serverInfo.ref,
      length: serverInfo.length,
      issues: serverInfo.issues,
    },
    communityFlag: {
      present: Object.prototype.hasOwnProperty.call(env, "FLORISYN_FLAG_COMMUNITY_BETA"),
      enabled: String(env.FLORISYN_FLAG_COMMUNITY_BETA || "").toLowerCase() === "true",
    },
    expectations,
    summary: {
      pass: expectations.filter((e) => e.ok).length,
      fail: expectations.filter((e) => !e.ok).length,
      keysAvailableInShell: Boolean(client && server && urlInfo.present),
    },
    guidance: [
      "For a brand-new Supabase staging project: copy Project URL → SUPABASE_URL",
      "Copy anon/publishable key → SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY",
      "Copy service_role/secret key → SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY (Netlify only)",
      "Scope these to deploy-preview / staging context — do not reuse production project keys",
      "Keep FLORISYN_FLAG_COMMUNITY_BETA unset/false until migrations + persona checks pass",
      "This audit never prints key material",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
  if (report.summary.fail > 0 && report.summary.keysAvailableInShell) {
    process.exitCode = 1;
  }
}

main();
