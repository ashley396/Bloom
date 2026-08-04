#!/usr/bin/env node
/**
 * P0-07A R4 — Strict safety validator for florisyn-live-schema-snapshot.sql
 *
 * Does not connect to any database. Enforces:
 *   1) Exact three-statement grammar: BEGIN READ ONLY; WITH…SELECT…; ROLLBACK
 *   2) Forbidden DML/DDL and session/side-effect commands
 *   3) Unqualified function-call allowlist (no schema-qualified calls)
 *   4) Fail-closed token-aware FROM/JOIN/comma/nested relation allowlist
 *      (WITH ORDINALITY + alias/column forms; unknown FROM-item suffixes fail)
 *   5) CTE names must not shadow allowlisted catalog relation names
 *   6) No double-quoted identifiers in executable SQL
 *   7) Exactly one structural filtered proconfig search_path extraction
 *   8) No secret-prone config dumps / capture timestamps
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_SNAPSHOT_SQL_PATH = "scripts/sql/florisyn-live-schema-snapshot.sql";

export const FORBIDDEN_STATEMENT_TOKENS = Object.freeze([
  "INSERT",
  "UPDATE",
  "DELETE",
  "UPSERT",
  "MERGE",
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "COPY",
  "CALL",
  "DO",
  "EXECUTE",
  "VACUUM",
  "ANALYZE",
  "REFRESH",
  "SET ROLE",
  "COMMIT",
  "PREPARE TRANSACTION",
  "COMMIT PREPARED",
  "ROLLBACK PREPARED",
  "SET TRANSACTION",
  "SET SESSION CHARACTERISTICS",
  "RESET",
  "DISCARD",
  "LOCK",
  "LISTEN",
  "UNLISTEN",
  "NOTIFY",
  "SECURITY LABEL",
  "CLUSTER",
  "REINDEX"
]);

/** Top-level-only transaction terminators (not CASE … END). */
export const FORBIDDEN_TOP_LEVEL_STATEMENTS = Object.freeze([
  "COMMIT",
  "END",
  "PREPARE TRANSACTION",
  "COMMIT PREPARED",
  "ROLLBACK PREPARED"
]);

export const SENSITIVE_REFERENCE_PATTERNS = Object.freeze([
  { id: "auth.users", re: /\bauth\s*\.\s*users\b/i },
  { id: "storage.objects", re: /\bstorage\s*\.\s*objects\b/i },
  { id: "vault", re: /\bvault\b/i },
  { id: "decrypted_secrets", re: /\bdecrypted[_]?secrets?\b/i },
  { id: "prosrc", re: /\bprosrc\b/i },
  { id: "pg_get_functiondef", re: /\bpg_get_functiondef\s*\(/i },
  { id: "routine_definition", re: /\broutine_definition\b/i },
  { id: "all_config", re: /\ball_config\b/i }
]);

/** Exact safe unqualified functions permitted in the approved metadata query. */
export const ALLOWED_FUNCTION_CALLS = Object.freeze([
  "jsonb_agg",
  "jsonb_build_object",
  "json_build_object",
  "coalesce",
  "unnest",
  "to_jsonb",
  "pg_get_userbyid",
  "pg_get_function_identity_arguments",
  "pg_get_function_result",
  "pg_get_indexdef",
  "current_setting",
  "exists"
]);

/** No schema-qualified function calls are allowlisted for this pack. */
export const ALLOWED_QUALIFIED_FUNCTION_CALLS = Object.freeze([]);

/**
 * Exact relations permitted after FROM / JOIN in the approved snapshot SQL.
 * CTE names declared in the WITH clause are permitted separately (unless they shadow).
 */
export const ALLOWED_RELATIONS = Object.freeze([
  "pg_namespace",
  "information_schema.schemata",
  "information_schema.tables",
  "information_schema.columns",
  "pg_class",
  "pg_policies",
  "information_schema.role_table_grants",
  "pg_proc",
  "pg_language",
  "information_schema.routine_privileges",
  "information_schema.triggers",
  "information_schema.table_constraints",
  "pg_index",
  "storage.buckets"
]);

/**
 * Complete approved proconfig extraction (whitespace-flexible).
 * All pieces must belong to the same scalar subquery; strings kept via commentStripped.
 */
export const APPROVED_PROCONFIG_EXTRACTION =
  /COALESCE\s*\(\s*\(\s*SELECT\s+jsonb_agg\s*\(\s*cfg\s+ORDER\s+BY\s+cfg\s*\)\s+FROM\s+unnest\s*\(\s*COALESCE\s*\(\s*p\.proconfig\s*,\s*ARRAY\s*\[\s*\]\s*::\s*text\s*\[\s*\]\s*\)\s*\)\s+(?:AS\s+)?cfg\s+WHERE\s+cfg\s+LIKE\s+'search_path=%'\s*\)\s*,\s*'\[\]'\s*::\s*jsonb\s*\)/i;

/** @deprecated R2 fragment — retained export for older references; R3 uses APPROVED_PROCONFIG_EXTRACTION. */
export const APPROVED_PROCONFIG_UNNEST =
  /unnest\s*\(\s*COALESCE\s*\(\s*p\.proconfig\s*,\s*ARRAY\s*\[\s*\]\s*::\s*text\s*\[\s*\]\s*\)\s*\)/i;

const FORBIDDEN_FUNCTION_CALLS = Object.freeze([
  "dblink",
  "dblink_exec",
  "dblink_connect",
  "http",
  "http_get",
  "http_post",
  "lo_import",
  "lo_export",
  "pg_read_file",
  "pg_write_file",
  "pg_notify",
  "set_config",
  "now",
  "clock_timestamp",
  "statement_timestamp",
  "transaction_timestamp",
  "timeofday"
]);

const SQL_KEYWORDS_AS_CALLS = new Set([
  "select", "from", "where", "and", "or", "not", "in", "on", "join", "left", "right",
  "inner", "outer", "cross", "case", "when", "then", "else", "end", "as", "order",
  "group", "having", "limit", "offset", "union", "except", "intersect", "with",
  "values", "into", "set", "between", "like", "ilike", "is", "null", "true", "false",
  "array", "all", "any", "some", "distinct", "filter", "over", "partition", "rows",
  "range", "ascending", "descending", "asc", "desc", "nulls", "first", "last",
  "returning", "lateral", "only", "using", "natural", "full"
]);

/** Tokens that end a FROM-item (comma / JOIN / clauses / close-paren / EOF). */
const FROM_ITEM_BOUNDARY_IDENTS = new Set([
  "where", "group", "having", "order", "limit", "offset", "union", "except",
  "intersect", "fetch", "for", "window", "returning", "on", "using", "join",
  "left", "right", "inner", "cross", "full", "outer", "natural"
]);

/**
 * Lex SQL into code text with comments/strings removed, while detecting
 * unterminated constructs and supporting nested PostgreSQL block comments.
 * Double-quoted identifiers in executable SQL are rejected.
 * Returns { ok, code, errors }.
 */
export function lexSql(sql) {
  const src = String(sql ?? "");
  const errors = [];
  let out = "";
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === "-" && next === "-") {
      i += 2;
      while (i < src.length && src[i] !== "\n") i += 1;
      out += " ";
      continue;
    }

    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth += 1;
          i += 2;
          continue;
        }
        if (src[i] === "*" && src[i + 1] === "/") {
          depth -= 1;
          i += 2;
          continue;
        }
        i += 1;
      }
      if (depth !== 0) {
        errors.push("Unterminated block comment");
        return { ok: false, code: out, errors };
      }
      out += " ";
      continue;
    }

    if (ch === "$") {
      const dollar = src.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (dollar) {
        const delim = dollar[0];
        const end = src.indexOf(delim, i + delim.length);
        if (end === -1) {
          errors.push("Unterminated dollar quote");
          return { ok: false, code: out, errors };
        }
        i = end + delim.length;
        out += " ";
        continue;
      }
    }

    if (ch === "'") {
      i += 1;
      let closed = false;
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (src[i] === "'") {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        errors.push("Unterminated single-quoted string");
        return { ok: false, code: out, errors };
      }
      out += " ";
      continue;
    }

    if (ch === '"') {
      i += 1;
      let closed = false;
      while (i < src.length) {
        if (src[i] === '"' && src[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (src[i] === '"') {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        errors.push("Unterminated double-quoted identifier");
        return { ok: false, code: out, errors };
      }
      errors.push("Double-quoted identifiers are forbidden in executable SQL");
      out += " ";
      continue;
    }

    out += ch;
    i += 1;
  }

  return { ok: errors.length === 0, code: out, errors };
}

/** Backward-compatible strip helper used by older tests. */
export function stripSqlCommentsAndStrings(sql) {
  const lexed = lexSql(sql);
  return lexed.code;
}

/**
 * Remove comments only (keep string/dollar literals) so payload-key and
 * structural proconfig checks can see string contents without comment
 * false positives.
 */
export function stripSqlCommentsOnly(sql) {
  const src = String(sql ?? "");
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "-" && next === "-") {
      i += 2;
      while (i < src.length && src[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth += 1;
          i += 2;
          continue;
        }
        if (src[i] === "*" && src[i + 1] === "/") {
          depth -= 1;
          i += 2;
          continue;
        }
        i += 1;
      }
      out += " ";
      continue;
    }
    if (ch === "$") {
      const dollar = src.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (dollar) {
        const delim = dollar[0];
        const end = src.indexOf(delim, i + delim.length);
        if (end === -1) {
          out += src.slice(i);
          break;
        }
        out += src.slice(i, end + delim.length);
        i = end + delim.length;
        continue;
      }
    }
    if (ch === "'") {
      out += ch;
      i += 1;
      while (i < src.length) {
        out += src[i];
        if (src[i] === "'" && src[i + 1] === "'") {
          out += src[i + 1];
          i += 2;
          continue;
        }
        if (src[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      out += ch;
      i += 1;
      while (i < src.length) {
        out += src[i];
        if (src[i] === '"' && src[i + 1] === '"') {
          out += src[i + 1];
          i += 2;
          continue;
        }
        if (src[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Split lexed SQL code into top-level statements on semicolons outside
 * parentheses (comments/quotes already removed by lexSql).
 */
export function splitTopLevelStatements(code) {
  const statements = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }
    current += ch;
  }
  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

function normalizeWs(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/**
 * Extract CTE names declared in a WITH … SELECT statement.
 * Walks top-level `name AS (` binders before the main SELECT.
 */
export function extractCteNames(withSelectStmt) {
  const src = String(withSelectStmt ?? "");
  const names = [];
  const withMatch = src.match(/^\s*WITH(?:\s+RECURSIVE)?\b/i);
  if (!withMatch) return names;

  let i = withMatch[0].length;
  let depth = 0;
  let expectingCteName = true;

  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (i >= src.length) break;

    if (depth === 0 && expectingCteName) {
      if (/^SELECT\b/i.test(src.slice(i))) break;
      const id = src.slice(i).match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (!id) break;
      const name = id[1];
      i += name.length;
      while (i < src.length && /\s/.test(src[i])) i += 1;
      const mat = src.slice(i).match(/^(NOT\s+MATERIALIZED|MATERIALIZED)\b/i);
      if (mat) {
        i += mat[0].length;
        while (i < src.length && /\s/.test(src[i])) i += 1;
      }
      const asMatch = src.slice(i).match(/^AS\s*\(/i);
      if (!asMatch) break;
      names.push(name);
      i += asMatch[0].length;
      depth = 1;
      expectingCteName = false;
      continue;
    }

    const ch = src[i];
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        while (i < src.length && /\s/.test(src[i])) i += 1;
        if (src[i] === ",") {
          i += 1;
          expectingCteName = true;
          continue;
        }
        break;
      }
    }
    i += 1;
  }

  return names;
}

/** Identifiers / punctuation tokens for relation walking (code already stripped). */
export function tokenizeSqlCode(code) {
  const src = String(code ?? "");
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      tokens.push({ type: "ident", value: src.slice(i, j), index: i });
      i = j;
      continue;
    }
    tokens.push({ type: "punct", value: ch, index: i });
    i += 1;
  }
  return tokens;
}

function skipBalancedParen(tokens, openIndex) {
  if (tokens[openIndex]?.value !== "(") return openIndex + 1;
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    if (tokens[i].value === "(") depth += 1;
    else if (tokens[i].value === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return tokens.length;
}

function isFromItemBoundary(token) {
  if (!token) return true; // statement / list end
  if (token.value === "," || token.value === ")") return true;
  if (token.type === "ident" && FROM_ITEM_BOUNDARY_IDENTS.has(token.value.toLowerCase())) {
    return true;
  }
  return false;
}

/**
 * Consume PostgreSQL FROM-item suffix after the primary relation/function/subquery:
 *   [ WITH ORDINALITY ] [ AS ] [ alias ] [ (column_list) ]
 * Fail closed if unexpected tokens remain before a recognized boundary.
 */
function parseFromItemSuffix(tokens, start, parseErrors) {
  let i = start;

  if (tokens[i]?.type === "ident" && /^WITH$/i.test(tokens[i].value)) {
    if (tokens[i + 1]?.type === "ident" && /^ORDINALITY$/i.test(tokens[i + 1].value)) {
      i += 2;
    } else {
      parseErrors.push(
        "Unexpected WITH in FROM item (only WITH ORDINALITY is supported after a FROM item)"
      );
      while (i < tokens.length && !isFromItemBoundary(tokens[i])) {
        if (tokens[i].value === "(") i = skipBalancedParen(tokens, i);
        else i += 1;
      }
      return i;
    }
  }

  if (tokens[i]?.type === "ident" && /^AS$/i.test(tokens[i].value)) {
    i += 1;
    if (!tokens[i] || tokens[i].type !== "ident" || isFromItemBoundary(tokens[i])) {
      parseErrors.push("Expected alias identifier after AS in FROM item");
      while (i < tokens.length && !isFromItemBoundary(tokens[i])) {
        if (tokens[i].value === "(") i = skipBalancedParen(tokens, i);
        else i += 1;
      }
      return i;
    }
    i += 1;
  } else if (
    tokens[i]?.type === "ident" &&
    !isFromItemBoundary(tokens[i]) &&
    !/^WITH$/i.test(tokens[i].value)
  ) {
    // Bare alias (WITH alone is never a bare alias — handled above / fail-closed).
    i += 1;
  }

  if (tokens[i]?.value === "(") {
    i = skipBalancedParen(tokens, i);
  }

  if (!isFromItemBoundary(tokens[i])) {
    const near = tokens[i]?.value ?? "<eof>";
    parseErrors.push(`Unsupported FROM-item suffix near '${near}'`);
    while (i < tokens.length && !isFromItemBoundary(tokens[i])) {
      if (tokens[i].value === "(") i = skipBalancedParen(tokens, i);
      else i += 1;
    }
  }

  return i;
}

/**
 * Parse one FROM/JOIN item (fail-closed).
 * Subqueries are skipped here; nested FROM/JOIN inside them are discovered by
 * the global walker. Table-function calls (ident followed by '(') are not relations.
 */
function parseFromItem(tokens, start, relations, parseErrors) {
  let i = start;
  if (tokens[i]?.type === "ident" && /^LATERAL$/i.test(tokens[i].value)) {
    i += 1;
  }

  if (tokens[i]?.value === "(") {
    i = skipBalancedParen(tokens, i);
    return parseFromItemSuffix(tokens, i, parseErrors);
  }

  if (!tokens[i] || tokens[i].type !== "ident") {
    if (tokens[i] && !isFromItemBoundary(tokens[i])) {
      parseErrors.push(
        `Unexpected token starting FROM item: '${tokens[i].value}'`
      );
      while (i < tokens.length && !isFromItemBoundary(tokens[i])) {
        if (tokens[i].value === "(") i = skipBalancedParen(tokens, i);
        else i += 1;
      }
    }
    return i;
  }

  let name = tokens[i].value.toLowerCase();
  i += 1;
  if (tokens[i]?.value === "." && tokens[i + 1]?.type === "ident") {
    name = `${name}.${tokens[i + 1].value.toLowerCase()}`;
    i += 2;
  }

  // Table / set-returning function call — not a relation.
  if (tokens[i]?.value === "(") {
    i = skipBalancedParen(tokens, i);
    return parseFromItemSuffix(tokens, i, parseErrors);
  }

  relations.push(name);
  return parseFromItemSuffix(tokens, i, parseErrors);
}

function parseFromList(tokens, start, relations, parseErrors) {
  let i = parseFromItem(tokens, start, relations, parseErrors);
  while (tokens[i]?.value === ",") {
    i += 1;
    i = parseFromItem(tokens, i, relations, parseErrors);
  }
  return i;
}

/**
 * Fail-closed relation analysis.
 * Returns { relations, parseErrors }.
 */
export function analyzeFromJoinRelations(code) {
  const tokens = tokenizeSqlCode(code);
  const relations = [];
  const parseErrors = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== "ident") continue;

    if (/^FROM$/i.test(t.value)) {
      // Peek-parse the FROM list; do not advance i past nested tokens.
      parseFromList(tokens, i + 1, relations, parseErrors);
      continue;
    }
    if (/^JOIN$/i.test(t.value)) {
      // Peek-parse the join item; sequential scan still visits LATERAL bodies.
      parseFromItem(tokens, i + 1, relations, parseErrors);
    }
  }

  return { relations, parseErrors };
}

/**
 * Compatibility wrapper: relation names only (ignores parseErrors).
 * Main validation uses analyzeFromJoinRelations() and rejects parseErrors.
 */
export function extractFromJoinRelations(code) {
  return analyzeFromJoinRelations(code).relations;
}

/**
 * Names CTEs must not shadow: each full ALLOWED_RELATIONS entry, plus the
 * schema prefix of any qualified entry (e.g. storage, information_schema).
 * Unqualified relation-name suffixes alone (e.g. tables from
 * information_schema.tables) are not treated as shadows — qualified catalog
 * references remain unambiguous.
 */
export function allowlistShadowNames() {
  const parts = new Set();
  for (const rel of ALLOWED_RELATIONS) {
    const lower = rel.toLowerCase();
    parts.add(lower);
    if (lower.includes(".")) {
      parts.add(lower.split(".")[0]);
    }
  }
  return parts;
}

function statementKind(stmt) {
  const n = normalizeWs(stmt);
  if (/^BEGIN\s+READ\s+ONLY$/i.test(n)) return "BEGIN_READ_ONLY";
  if (/^ROLLBACK$/i.test(n)) return "ROLLBACK";
  if (/^WITH\b/i.test(n) && /\bSELECT\b/i.test(n)) return "WITH_SELECT";
  if (/^BEGIN\b/i.test(n) || /^START\s+TRANSACTION\b/i.test(n)) return "OTHER_BEGIN";
  if (/^END$/i.test(n) || /^COMMIT\b/i.test(n)) return "FORBIDDEN_TERMINATOR";
  if (/^PREPARE\s+TRANSACTION\b/i.test(n) || /^COMMIT\s+PREPARED\b/i.test(n) || /^ROLLBACK\s+PREPARED\b/i.test(n)) {
    return "FORBIDDEN_TERMINATOR";
  }
  return "OTHER";
}

function findForbiddenInCode(code) {
  const hits = [];
  for (const token of FORBIDDEN_STATEMENT_TOKENS) {
    const re =
      token.includes(" ")
        ? new RegExp(`\\b${token.replace(/\s+/g, "\\s+")}\\b`, "i")
        : new RegExp(`\\b${token}\\b`, "i");
    if (re.test(code)) hits.push(token);
  }
  return hits;
}

function findSensitiveReferences(code) {
  const hits = [];
  for (const { id, re } of SENSITIVE_REFERENCE_PATTERNS) {
    if (re.test(code)) hits.push(id);
  }
  return hits;
}

/**
 * Extract function calls. Returns { unqualified: string[], qualified: string[] }.
 */
export function extractFunctionCallsDetailed(code) {
  const unqualified = new Set();
  const qualified = new Set();
  const re = /\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const full = m[1];
    const base = full.includes(".") ? full.split(".").pop() : full;
    if (SQL_KEYWORDS_AS_CALLS.has(base.toLowerCase())) continue;
    if (full.includes(".")) qualified.add(full.toLowerCase());
    else unqualified.add(base.toLowerCase());
  }
  return {
    unqualified: [...unqualified].sort(),
    qualified: [...qualified].sort()
  };
}

function extractFunctionCalls(code) {
  const detailed = extractFunctionCallsDetailed(code);
  return [...detailed.unqualified, ...detailed.qualified].sort();
}

function validateProconfigUsage(fullyStripped, commentStripped) {
  const errors = [];
  if (
    /'all_config'\s*,/i.test(commentStripped) ||
    /"all_config"\s*,/i.test(commentStripped) ||
    /\ball_config\s*:/i.test(commentStripped)
  ) {
    errors.push("Forbidden secret-prone key/output: all_config");
  }

  const structural = [
    ...commentStripped.matchAll(new RegExp(APPROVED_PROCONFIG_EXTRACTION.source, "gi"))
  ];
  if (structural.length !== 1) {
    errors.push(
      `Expected exactly one complete approved proconfig search_path extraction scalar subquery, found ${structural.length}`
    );
  }

  const proconfigHits = fullyStripped.match(/\bproconfig\b/gi) || [];
  if (proconfigHits.length !== 1) {
    errors.push(
      `Expected exactly one executable proconfig reference, found ${proconfigHits.length}`
    );
  }

  if (structural.length === 1 && proconfigHits.length === 1) {
    const match = structural[0];
    const outside =
      commentStripped.slice(0, match.index) +
      commentStripped.slice(match.index + match[0].length);
    const outsideLex = lexSql(outside);
    if (outsideLex.ok && /\bproconfig\b/i.test(outsideLex.code)) {
      errors.push("proconfig reference found outside the approved structural extraction");
    }
  }

  return errors;
}

function validateRelations(code, withSelectStmt) {
  const errors = [];
  const allowed = new Set(ALLOWED_RELATIONS.map((r) => r.toLowerCase()));
  const shadow = allowlistShadowNames();
  const cteList = extractCteNames(withSelectStmt).map((n) => n.toLowerCase());
  const ctes = new Set(cteList);
  const analysis = analyzeFromJoinRelations(code);
  const relations = analysis.relations;
  const parseErrors = analysis.parseErrors;

  for (const pe of parseErrors) {
    errors.push(`FROM-item parse error: ${pe}`);
  }

  for (const cte of cteList) {
    if (shadow.has(cte)) {
      errors.push(`CTE name shadows allowlisted catalog relation: ${cte}`);
    }
  }

  const usableCtes = new Set([...ctes].filter((c) => !shadow.has(c)));

  for (const rel of relations) {
    if (usableCtes.has(rel) || allowed.has(rel)) continue;

    if (rel.startsWith("auth.")) {
      errors.push(`Forbidden auth relation: ${rel}`);
      continue;
    }
    if (rel.startsWith("storage.") && rel !== "storage.buckets") {
      errors.push(`Forbidden storage relation (only storage.buckets is allowed): ${rel}`);
      continue;
    }
    if (rel.startsWith("public.")) {
      errors.push(`Forbidden public/application relation: ${rel}`);
      continue;
    }
    errors.push(`Relation not on allowlist and not a declared CTE: ${rel}`);
  }

  return { errors, relations, parseErrors, ctes: cteList };
}

function validateDeterminism(commentStripped, fullyStripped) {
  const errors = [];
  if (
    /'captured_at'\s*,/i.test(commentStripped) ||
    /"captured_at"\s*,/i.test(commentStripped) ||
    /\bcaptured_at\b/i.test(fullyStripped)
  ) {
    errors.push("captured_at must not appear in snapshot JSON payload");
  }
  if (
    /\bNOW\s*\(/i.test(fullyStripped) ||
    /\bCLOCK_TIMESTAMP\s*\(/i.test(fullyStripped) ||
    /\bSTATEMENT_TIMESTAMP\s*\(/i.test(fullyStripped) ||
    /\bTRANSACTION_TIMESTAMP\s*\(/i.test(fullyStripped) ||
    /\bTIMEOFDAY\s*\(/i.test(fullyStripped)
  ) {
    errors.push("Capture/clock timestamp function is forbidden in snapshot SQL");
  }
  if (
    /'transaction_read_only'\s*,\s*true\b/i.test(commentStripped) ||
    /"transaction_read_only"\s*,\s*true\b/i.test(commentStripped)
  ) {
    errors.push(
      "Hardcoded transaction_read_only: true is forbidden; query current_setting('transaction_read_only')"
    );
  }
  if (!/current_setting\s*\(\s*'transaction_read_only'\s*\)/i.test(commentStripped)) {
    errors.push("Must report transaction_read_only via current_setting('transaction_read_only')");
  }
  return errors;
}

/**
 * Validate snapshot SQL text. Returns { ok, errors[], warnings[], statements[], stripped }.
 */
export function validateSchemaSnapshotSql(sqlText) {
  const errors = [];
  const warnings = [];
  const raw = String(sqlText ?? "");
  if (!raw.trim()) {
    errors.push("SQL text is empty");
    return { ok: false, errors, warnings, statements: [], stripped: "" };
  }

  const lexed = lexSql(raw);
  if (!lexed.ok) {
    return { ok: false, errors: lexed.errors, warnings, statements: [], stripped: lexed.code };
  }
  const code = lexed.code;
  const statements = splitTopLevelStatements(code);

  if (statements.length !== 3) {
    errors.push(
      `Expected exactly 3 top-level statements (BEGIN READ ONLY; WITH…SELECT…; ROLLBACK), found ${statements.length}`
    );
  } else {
    const kinds = statements.map(statementKind);
    if (kinds[0] !== "BEGIN_READ_ONLY") {
      errors.push("Statement 1 must be exactly BEGIN READ ONLY");
    }
    if (kinds[1] !== "WITH_SELECT") {
      errors.push("Statement 2 must be a single WITH … SELECT snapshot statement");
    }
    if (kinds[2] !== "ROLLBACK") {
      errors.push("Statement 3 must be exactly ROLLBACK (final significant statement)");
    }
    if (kinds.includes("OTHER_BEGIN")) {
      errors.push("Additional BEGIN/START TRANSACTION is forbidden");
    }
    for (let i = 0; i < kinds.length; i += 1) {
      if (kinds[i] === "OTHER") {
        errors.push(
          `Unrecognized top-level statement at position ${i + 1}: ${normalizeWs(statements[i]).slice(0, 80)}`
        );
      }
    }
  }

  const beginCount = (code.match(/\bBEGIN\b/gi) || []).length;
  if (beginCount !== 1) {
    errors.push(`Expected exactly one BEGIN, found ${beginCount}`);
  }
  if (/\bSTART\s+TRANSACTION\b/i.test(code)) {
    errors.push("START TRANSACTION is forbidden; use a single BEGIN READ ONLY");
  }

  const forbidden = findForbiddenInCode(code);
  for (const token of forbidden) {
    errors.push(`Forbidden statement token: ${token}`);
  }

  for (const stmt of statements) {
    const n = normalizeWs(stmt);
    for (const bad of FORBIDDEN_TOP_LEVEL_STATEMENTS) {
      const re = new RegExp(`^${bad.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (re.test(n)) {
        errors.push(`Forbidden top-level statement: ${bad}`);
      }
    }
  }

  if (statements.length >= 1) {
    const last = statementKind(statements[statements.length - 1]);
    if (last !== "ROLLBACK") {
      errors.push("ROLLBACK must be the final significant statement");
    }
  }

  for (const id of findSensitiveReferences(code)) {
    errors.push(`Sensitive catalog/data reference: ${id}`);
  }

  const commentStripped = stripSqlCommentsOnly(raw);
  errors.push(...validateProconfigUsage(code, commentStripped));
  errors.push(...validateDeterminism(commentStripped, code));

  const withSelect = statements.length >= 2 ? statements[1] : code;
  const relationResult = validateRelations(code, withSelect);
  errors.push(...relationResult.errors);

  if (!/\bORDER\s+BY\b/i.test(code) || (code.match(/\bORDER\s+BY\b/gi) || []).length < 3) {
    errors.push("Missing deterministic ordering markers (expected multiple ORDER BY clauses)");
  }

  if (!/\bjsonb_build_object\s*\(/i.test(code)) {
    errors.push("Expected a jsonb_build_object result payload");
  }

  if (!/\bspecific_name\b/i.test(commentStripped)) {
    errors.push(
      "function_execute_privileges must include specific_name (information_schema overload identifier)"
    );
  }

  const detailedCalls = extractFunctionCallsDetailed(code);
  const allowedFns = new Set(ALLOWED_FUNCTION_CALLS.map((n) => n.toLowerCase()));
  const allowedQualified = new Set(
    ALLOWED_QUALIFIED_FUNCTION_CALLS.map((n) => n.toLowerCase())
  );

  for (const name of detailedCalls.qualified) {
    if (!allowedQualified.has(name)) {
      errors.push(`Schema-qualified function call is forbidden: ${name}`);
    }
  }
  for (const name of detailedCalls.unqualified) {
    if (!allowedFns.has(name)) {
      errors.push(`Function call not on allowlist: ${name}`);
    }
  }
  for (const bad of FORBIDDEN_FUNCTION_CALLS) {
    const re = new RegExp(`\\b${bad}\\s*\\(`, "i");
    if (re.test(code)) {
      errors.push(`Prohibited side-effect/unsafe function call: ${bad}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    statements,
    stripped: code,
    functionCalls: extractFunctionCalls(code),
    functionCallsDetailed: detailedCalls,
    relations: relationResult.relations,
    parseErrors: relationResult.parseErrors,
    ctes: relationResult.ctes
  };
}

export function validateSchemaSnapshotFile(filePath) {
  const abs = path.resolve(filePath);
  const sql = fs.readFileSync(abs, "utf8");
  const result = validateSchemaSnapshotSql(sql);
  return { ...result, filePath: abs };
}

function main(argv = process.argv.slice(2)) {
  const target = argv[0] || DEFAULT_SNAPSHOT_SQL_PATH;
  const result = validateSchemaSnapshotFile(target);
  if (!result.ok) {
    console.error(`Schema snapshot SQL validation FAILED: ${result.filePath}`);
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Schema snapshot SQL validation passed: ${result.filePath}`);
}

const isDirect =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirect) {
  main();
}

export default validateSchemaSnapshotSql;
