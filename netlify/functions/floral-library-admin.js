import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { fail } from "./_shared/supabase.js";
import { platformAdmin, writeAdminAudit } from "./_shared/platform-admin.js";
import {
  dryRunImport,
  approveImportBatch,
  duplicateReviewQueue,
  duplicateReviewAction,
  libraryQualityDashboard,
  parseCsvImport,
  assertMasterLibraryImmutable
} from "./_shared/floral-library-admin.js";
import { STARTER_FLORAL_LIBRARY } from "./_shared/floral-library-core.js";

const inMemoryBatches = new Map();
const inMemoryQueue = [];

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  if (!["GET", "POST"].includes(event.httpMethod)) return methodNotAllowed();

  try {
    const { client, user } = await platformAdmin(event, ["super_admin", "content_admin"]);
    const qs = event.queryStringParameters || {};
    const body = event.httpMethod === "POST" ? bodyOf(event) : {};
    const action = String(body.action || qs.action || "quality").toLowerCase();

    if (action === "quality" && event.httpMethod === "GET") {
      let products = STARTER_FLORAL_LIBRARY;
      try {
        const { data } = await client.from("bloom_floral_library_master").select("id,data,review_status,image_license");
        if (data?.length) products = data.map((r) => ({ ...r.data, id: r.id, review_status: r.review_status, image_license: r.image_license }));
      } catch {
        /* table optional */
      }
      return json(200, { dashboard: libraryQualityDashboard(products) });
    }

    if (action === "dry_run" || action === "import_validate") {
      const rows = body.rows || (body.csv ? parseCsvImport(body.csv) : body.manifest || []);
      const report = dryRunImport(rows);
      const batchId = `batch-${Date.now()}`;
      inMemoryBatches.set(batchId, { id: batchId, manifest: rows, report, status: "pending_review" });
      await writeAdminAudit(client, user.id, null, "library_import_dry_run", { batchId, valid: report.valid.length, invalid: report.invalid.length });
      return json(200, { batch_id: batchId, ...report });
    }

    if (action === "approve_batch") {
      const batch = inMemoryBatches.get(body.batch_id);
      if (!batch) return json(404, { error: "Batch not found." });
      const imm = assertMasterLibraryImmutable({ scope: body.as_shop ? "shop" : "master" });
      if (!imm.allowed && !body.admin_master_write) return json(403, { error: imm.error });
      const result = approveImportBatch(batch, { approveIds: body.approve_ids || [], rejectIds: body.reject_ids || [] });
      batch.status = result.status;
      batch.audit = result.audit;
      inMemoryBatches.set(body.batch_id, batch);
      await writeAdminAudit(client, user.id, null, "library_import_approve", { batch_id: body.batch_id, ...result.audit });
      return json(200, result);
    }

    if (action === "duplicate_queue") {
      const queue = duplicateReviewQueue(body.items?.length ? body.items : inMemoryQueue, STARTER_FLORAL_LIBRARY);
      return json(200, { items: queue });
    }

    if (action === "duplicate_review") {
      const item = body.item;
      if (!item) return json(400, { error: "item required" });
      const result = duplicateReviewAction(item, body.review_action, body.note);
      if (!result.ok) return json(400, result);
      await writeAdminAudit(client, user.id, null, "library_duplicate_review", result.audit);
      return json(200, result);
    }

    if (action === "audit_history") {
      const { data } = await client
        .from("platform_admin_audit")
        .select("*")
        .ilike("action", "library_%")
        .order("created_at", { ascending: false })
        .limit(50);
      return json(200, { items: data || [] });
    }

    return json(200, { ok: true, actions: ["quality", "dry_run", "approve_batch", "duplicate_queue", "duplicate_review"] });
  } catch (error) {
    return fail(error);
  }
}
