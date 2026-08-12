import crypto from "node:crypto";
import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail, requireRoles, admin } from "./_shared/supabase.js";
import { checkRateLimit } from "./_shared/production.js";

/** Visible on Staff front page / create without private-file unlock. */
const PUBLIC_STAFF_FIELDS = ["name", "role", "active"];

/** Pay, tax, contact — only after private-file PIN unlock. */
const PRIVATE_STAFF_FIELDS = [
  "email",
  "phone",
  "hourly_rate",
  "hire_date",
  "federal_tax_rate",
  "state_tax_rate",
  "local_tax_rate",
  "other_deduction_rate",
  "fixed_deduction",
];

const cleanStaff = (row) => {
  if (!row) return row;
  const { pin_hash, ...safe } = row;
  return { ...safe, pin_set: Boolean(pin_hash) };
};
const staffSummary = (row) => ({
  id: row.id,
  name: row.name,
  active: row.active,
  pin_set: Boolean(row.pin_hash),
});
const hashPin = (pin) => {
  const salt = crypto.randomBytes(16).toString("hex"),
    hash = crypto.scryptSync(String(pin), salt, 64).toString("hex");
  return `${salt}:${hash}`;
};
const validPin = (pin, stored) => {
  try {
    const [salt, hex] = String(stored || "").split(":");
    if (!salt || !hex) return false;
    const actual = crypto.scryptSync(String(pin), salt, 64),
      expected = Buffer.from(hex, "hex");
    return (
      actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
};
function deny(message, statusCode = 403) {
  const e = new Error(message);
  e.statusCode = statusCode;
  throw e;
}
const requirePinFormat = (pin) => {
  if (!/^\d{4,8}$/.test(String(pin || "")))
    deny("Employee PIN must be 4–8 digits.", 400);
};
function pinRateLimit(event, staffId) {
  const limit = checkRateLimit(event, {
    key: `staff-pin:${staffId}`,
    limit: 12,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    const e = new Error("Too many PIN attempts. Wait a minute and try again.");
    e.statusCode = 429;
    throw e;
  }
}
function hasAssignedValue(body, field) {
  if (!Object.prototype.hasOwnProperty.call(body, field)) return false;
  const value = body[field];
  if (value === "" || value == null) return false;
  if (
    [
      "hourly_rate",
      "federal_tax_rate",
      "state_tax_rate",
      "local_tax_rate",
      "other_deduction_rate",
      "fixed_deduction",
    ].includes(field) &&
    Number(value) === 0
  ) {
    return false;
  }
  return true;
}
function copyFields(body, fields, payload) {
  for (const f of fields) {
    if (hasAssignedValue(body, f)) payload[f] = body[f];
  }
}
function unlockPinFromBody(body) {
  return String(body.private_file_pin || body.current_pin || "").trim();
}
async function requirePrivateFileUnlock(event, client, shopId, staffId, body) {
  pinRateLimit(event, staffId || "unknown");
  const { data: employee, error } = await client
    .from("staff")
    .select("id,pin_hash")
    .eq("id", staffId)
    .eq("shop_id", shopId)
    .single();
  if (error) throw error;
  // Legacy / setup rows with no PIN yet may receive the first private-file write.
  if (!employee.pin_hash) return employee;
  const unlock = unlockPinFromBody(body);
  if (!unlock || !validPin(unlock, employee.pin_hash)) {
    deny("Private employee file PIN is required to edit pay, tax, contact, or PIN settings.");
  }
  return employee;
}

export async function handler(event) {
  const ready = preflight(event);
  if (ready) return ready;
  try {
    const ctx = await currentUser(event);
    requireRoles(ctx, ["owner", "manager"]);
    const shopId = ctx.shopId;
    const client = admin();
    if (event.httpMethod === "GET") {
      const { data: staff, error } = await client
        .from("staff")
        .select("id,name,active,pin_hash,created_at")
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const { data: openShifts, error: openShiftError } = await client
        .from("staff_time_entries")
        .select("staff_id,clock_in")
        .eq("shop_id", shopId)
        .is("clock_out", null)
        .order("clock_in", { ascending: false });
      if (openShiftError) throw openShiftError;
      return json(200, {
        items: (staff || []).map(staffSummary),
        open_shifts: openShifts || [],
      });
    }
    if (event.httpMethod === "POST") {
      const body = bodyOf(event);
      if (
        body.action === "OPEN_FILE" ||
        body.action === "CLOCK_IN" ||
        body.action === "CLOCK_OUT"
      ) {
        pinRateLimit(event, body.staff_id || "unknown");
      }
      if (body.action === "OPEN_FILE") {
        const { data: employee, error: employeeError } = await client
          .from("staff")
          .select("*")
          .eq("id", body.staff_id)
          .eq("shop_id", shopId)
          .single();
        if (employeeError) throw employeeError;
        if (employee.pin_hash && !validPin(body.pin, employee.pin_hash))
          deny("Incorrect employee PIN.", 401);
        const { data: timeEntries, error: timeEntriesError } = await client
          .from("staff_time_entries")
          .select("id,staff_id,clock_in,clock_out,hours_worked,created_at")
          .eq("shop_id", shopId)
          .eq("staff_id", employee.id)
          .order("clock_in", { ascending: false })
          .limit(100);
        if (timeEntriesError) throw timeEntriesError;
        return json(200, {
          item: cleanStaff(employee),
          time_entries: timeEntries || [],
          setup_required: !employee.pin_hash,
        });
      }
      if (body.action === "CLOCK_IN" || body.action === "CLOCK_OUT") {
        const { data: employee, error: employeeError } = await client
          .from("staff")
          .select("id,pin_hash,active")
          .eq("id", body.staff_id)
          .eq("shop_id", shopId)
          .single();
        if (employeeError) throw employeeError;
        if (!employee.active) deny("This employee is inactive.", 403);
        if (!employee.pin_hash)
          deny(
            "A manager must set this employee’s PIN before clocking in.",
            400,
          );
        if (!validPin(body.pin, employee.pin_hash))
          deny("Incorrect employee PIN.", 401);
        if (body.action === "CLOCK_IN") {
          const { data: open } = await client
            .from("staff_time_entries")
            .select("id")
            .eq("shop_id", shopId)
            .eq("staff_id", body.staff_id)
            .is("clock_out", null)
            .maybeSingle();
          if (open) throw new Error("This employee is already clocked in.");
          const { data, error } = await client
            .from("staff_time_entries")
            .insert({
              shop_id: shopId,
              staff_id: body.staff_id,
              clock_in: new Date().toISOString(),
            })
            .select("*")
            .single();
          if (error) throw error;
          return json(201, { item: data });
        }
        const { data: open, error: oe } = await client
          .from("staff_time_entries")
          .select("*")
          .eq("shop_id", shopId)
          .eq("staff_id", body.staff_id)
          .is("clock_out", null)
          .order("clock_in", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (oe) throw oe;
        if (!open) throw new Error("This employee is not clocked in.");
        const out = new Date(),
          hours = Math.max(0, (out - new Date(open.clock_in)) / 3600000);
        const { data, error } = await client
          .from("staff_time_entries")
          .update({
            clock_out: out.toISOString(),
            hours_worked: Number(hours.toFixed(2)),
          })
          .eq("id", open.id)
          .eq("shop_id", shopId)
          .select("*")
          .single();
        if (error) throw error;
        return json(200, { item: data });
      }
      const payload = { shop_id: shopId, active: true };
      copyFields(body, PUBLIC_STAFF_FIELDS, payload);
      if (!String(payload.name || "").trim()) deny("Employee name is required.", 400);
      requirePinFormat(body.pin);
      payload.pin_hash = hashPin(body.pin);
      copyFields(body, PRIVATE_STAFF_FIELDS, payload);
      const { data, error } = await client
        .from("staff")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      return json(201, { item: cleanStaff(data) });
    }
    if (event.httpMethod === "PATCH") {
      const body = bodyOf(event);
      if (!body.id) deny("Missing employee id", 400);
      const wantsPrivate = PRIVATE_STAFF_FIELDS.some((f) => hasAssignedValue(body, f));
      const wantsNewPin = Boolean(String(body.pin || "").trim());
      if (wantsPrivate || wantsNewPin) {
        await requirePrivateFileUnlock(event, client, shopId, body.id, body);
      }
      const payload = {};
      copyFields(body, PUBLIC_STAFF_FIELDS, payload);
      if (wantsPrivate) copyFields(body, PRIVATE_STAFF_FIELDS, payload);
      if (wantsNewPin) {
        requirePinFormat(body.pin);
        payload.pin_hash = hashPin(body.pin);
      }
      if (!Object.keys(payload).length) deny("No employee changes provided.", 400);
      const { data, error } = await client
        .from("staff")
        .update(payload)
        .eq("id", body.id)
        .eq("shop_id", shopId)
        .select("*")
        .single();
      if (error) throw error;
      return json(200, { item: cleanStaff(data) });
    }
    if (event.httpMethod === "DELETE") {
      const body = bodyOf(event);
      if (!body.id) deny("Missing employee id", 400);
      const { error } = await client
        .from("staff")
        .delete()
        .eq("id", body.id)
        .eq("shop_id", shopId);
      if (error) throw error;
      return json(200, { ok: true });
    }
    return methodNotAllowed();
  } catch (error) {
    return fail(error);
  }
}
