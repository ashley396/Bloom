import { normalizeMarketplaceCategory } from "./marketplace-categories.js";

const REQUIRED_CSV_COLUMNS = ["product_name", "price"];

export function parseMarketplaceCsv(text = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return { valid: false, errors: ["CSV is empty."], headers: [], rows: [] };
  }

  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_CSV_COLUMNS.filter((col) => !headers.includes(col));
  if (missing.length) {
    return {
      valid: false,
      errors: [`Missing required columns: ${missing.join(", ")}`],
      headers,
      rows: []
    };
  }

  const rows = [];
  const errors = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    const price = Number(row.price);
    if (!String(row.product_name || "").trim()) {
      errors.push(`Row ${i + 1}: product_name is required.`);
    }
    if (Number.isNaN(price) || price < 0) {
      errors.push(`Row ${i + 1}: price must be a non-negative number.`);
    }
    if (row.category) {
      row.category_normalized = normalizeMarketplaceCategory(row.category);
    }
    rows.push(row);
  }

  return {
    valid: errors.length === 0,
    errors,
    headers,
    rows
  };
}

export function marketplaceCsvTemplate() {
  return [
    "product_name,supplier_name,sku,category,unit,price,minimum_quantity,available_quantity,description,image_url,publish_status,delivery_notes,allows_shipping,allows_local_pickup",
    "Garden Rose Bundle,Acme Growers,ROSE-001,Fresh Flowers,bunch,24.50,1,100,Premium roses for events,,draft,Ships cold-packed,true,false"
  ].join("\n");
}

function splitCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}
