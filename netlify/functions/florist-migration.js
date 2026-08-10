import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";
import { parseFloristExport, summarizeImportPreview } from "../../lib/migration/florist-import.js";

function missingTable(error) {
  const msg = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || msg.includes("does not exist");
}

async function insertBatch(client, table, shopId, rows) {
  let inserted = 0;
  const errors = [];
  for (const row of rows) {
    const payload = { shop_id: shopId, ...row };
    const { error } = await client.from(table).insert(payload);
    if (error) errors.push(error.message);
    else inserted += 1;
  }
  return { inserted, errors };
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    const { client, shopId } = await currentUser(event);
    const body = bodyOf(event);
    const action = body.action || event.queryStringParameters?.action || "preview";

    if (action === "preview") {
      const preview = parseFloristExport(body.text || body.csv || "", {
        entity: body.entity === "customers" ? "customers" : "products",
        source: body.source
      });
      return json(200, { preview: summarizeImportPreview(preview), rows: preview.rows, errors: preview.errors });
    }

    if (action === "apply") {
      const preview = parseFloristExport(body.text || body.csv || "", {
        entity: body.entity === "customers" ? "customers" : "products",
        source: body.source
      });
      const table = preview.entity === "customers" ? "customers" : "products";
      const rows = preview.rows.slice(0, Math.min(Number(body.limit) || 500, 500));
      const result = await insertBatch(client, table, shopId, rows);
      return json(200, {
        ok: true,
        entity: preview.entity,
        source: preview.source,
        ...result,
        skipped: Math.max(0, preview.rows.length - rows.length)
      });
    }

    return json(400, { error: "Unknown migration action." });
  } catch (error) {
    if (missingTable(error)) {
      return json(503, { error: "Database tables missing for import. Apply latest Supabase migrations." });
    }
    return fail(error);
  }
}
