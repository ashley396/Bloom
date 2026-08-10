/** Florist data migration — CSV, Floranext-style, Hana-style exports (pure). */

export const IMPORT_SOURCES = ["csv", "floranext", "hana", "generic"];

const HEADER_ALIASES = {
  name: ["name", "product name", "item name", "customer name", "full name"],
  email: ["email", "e-mail", "email address"],
  phone: ["phone", "telephone", "mobile", "cell"],
  price: ["price", "retail", "retail price", "amount", "total"],
  category: ["category", "type", "department"],
  sku: ["sku", "item #", "item number", "product code"],
  description: ["description", "notes", "details"],
  address: ["address", "street", "delivery address"],
  city: ["city"],
  state: ["state", "province"],
  zip: ["zip", "postal", "postal code", "zip code"]
};

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function mapHeaders(headers) {
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = headers.findIndex((h) => aliases.includes(normalizeHeader(h)));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseCsvText(text, { entity = "products" } = {}) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { entity, rows: [], errors: ["File is empty."] };
  const headers = parseCsvLine(lines[0]);
  const map = mapHeaders(headers);
  const rows = [];
  const errors = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (!cols.some(Boolean)) continue;
    const pick = (field) => (map[field] != null ? cols[map[field]] : "");
    if (entity === "customers") {
      const name = pick("name");
      if (!name) {
        errors.push(`Row ${i + 1}: missing customer name`);
        continue;
      }
      rows.push({
        name,
        email: pick("email") || null,
        phone: pick("phone") || null,
        address: [pick("address"), pick("city"), pick("state"), pick("zip")].filter(Boolean).join(", ") || null
      });
    } else {
      const name = pick("name");
      if (!name) {
        errors.push(`Row ${i + 1}: missing product name`);
        continue;
      }
      rows.push({
        name,
        sku: pick("sku") || null,
        category: pick("category") || "Everyday",
        description: pick("description") || "",
        price: Math.max(0, Number(pick("price") || 0))
      });
    }
  }
  return { entity, source: "csv", rows, errors, headers };
}

export function detectImportSource(text) {
  const head = String(text || "")
    .slice(0, 500)
    .toLowerCase();
  if (head.includes("floranext") || head.includes("fn_product")) return "floranext";
  if (head.includes("hana") || head.includes("hanapos")) return "hana";
  return "csv";
}

export function parseFloristExport(text, options = {}) {
  const entity = options.entity || "products";
  const forced = options.source;
  const source = forced && IMPORT_SOURCES.includes(forced) ? forced : detectImportSource(text);
  const parsed = parseCsvText(text, { entity });
  return { ...parsed, source, vendorLabel: source === "floranext" ? "Floranext" : source === "hana" ? "Hana POS" : "CSV" };
}

export function summarizeImportPreview(preview) {
  return {
    entity: preview.entity,
    source: preview.source,
    vendorLabel: preview.vendorLabel,
    rowCount: preview.rows?.length || 0,
    errorCount: preview.errors?.length || 0,
    sample: (preview.rows || []).slice(0, 5)
  };
}
