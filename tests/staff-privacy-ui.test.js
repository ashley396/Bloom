import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const staffApi = fs.readFileSync(new URL("../netlify/functions/staff.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

const PRIVATE_FIELDS = [
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

test("GET /staff returns summary only", () => {
  assert.match(staffApi, /const staffSummary = \(row\) => \(\{/);
  assert.match(staffApi, /\.map\(staffSummary\)/);
  const getBlock = staffApi.slice(
    staffApi.indexOf('if (event.httpMethod === "GET")'),
    staffApi.indexOf('if (event.httpMethod === "POST")')
  );
  assert.match(getBlock, /select\("id,name,active,pin_hash,created_at"\)/);
  assert.match(getBlock, /open_shifts:/);
  assert.doesNotMatch(getBlock, /time_entries:/);
  for (const field of PRIVATE_FIELDS) {
    assert.doesNotMatch(getBlock, new RegExp(field));
  }
});

test("POST create saves public and private fields atomically behind the new PIN", () => {
  assert.match(staffApi, /PUBLIC_STAFF_FIELDS/);
  assert.match(staffApi, /PRIVATE_STAFF_FIELDS/);
  assert.match(staffApi, /copyFields\(body, PUBLIC_STAFF_FIELDS, payload\)/);
  assert.match(staffApi, /requirePinFormat\(body\.pin\)/);
  assert.match(staffApi, /payload\.pin_hash = hashPin\(body\.pin\)/);
  assert.match(staffApi, /copyFields\(body, PRIVATE_STAFF_FIELDS, payload\)/);
});

test("PATCH sensitive fields require private_file_pin or current_pin", () => {
  assert.match(staffApi, /private_file_pin \|\| body\.current_pin/);
  assert.match(staffApi, /requirePrivateFileUnlock/);
  assert.match(
    staffApi,
    /Private employee file PIN is required to edit pay, tax, contact, or PIN settings/
  );
  for (const field of PRIVATE_FIELDS) {
    assert.match(staffApi, new RegExp(`"${field}"`));
  }
});

test("PATCH new PIN requires private-file unlock PIN", () => {
  const patchBlock = staffApi.slice(
    staffApi.indexOf('if (event.httpMethod === "PATCH")'),
    staffApi.indexOf('if (event.httpMethod === "DELETE")')
  );
  assert.match(patchBlock, /wantsNewPin/);
  assert.match(patchBlock, /requirePrivateFileUnlock/);
  assert.match(patchBlock, /payload\.pin_hash = hashPin\(body\.pin\)/);
});

test("manager session alone cannot edit private payroll fields without unlock PIN", () => {
  const patchBlock = staffApi.slice(
    staffApi.indexOf('if (event.httpMethod === "PATCH")'),
    staffApi.indexOf('if (event.httpMethod === "DELETE")')
  );
  assert.match(patchBlock, /wantsPrivate \|\| wantsNewPin/);
  assert.match(patchBlock, /requirePrivateFileUnlock\(event, client, shopId, body\.id, body\)/);
  assert.ok(
    patchBlock.indexOf("requirePrivateFileUnlock") <
      patchBlock.indexOf("copyFields(body, PRIVATE_STAFF_FIELDS")
  );
});

test("Staff front page stays name + Clock In/Out only", () => {
  const cardFn = app.slice(app.indexOf("function staffCard(x)"), app.indexOf("async function loadStaff"));
  assert.match(cardFn, /bloom-staff-name-only/);
  assert.match(cardFn, /Clock Out|Clock In/);
  for (const leak of [...PRIVATE_FIELDS, "hours_worked", "payroll"]) {
    assert.doesNotMatch(cardFn, new RegExp(leak, "i"));
  }
  assert.match(index, /id="staffDialog"/);
  assert.match(index, /name="hourly_rate"/);
  assert.match(index, /id="staffTimeHistoryHost"/);
});

test("POST create ignores zero-value private numeric defaults", () => {
  assert.match(staffApi, /Number\(value\) === 0/);
  assert.match(staffApi, /hourly_rate/);
});

test("UI create saves the employee with one atomic request", () => {
  assert.match(app, /staffPrivateFieldFilled/);
  assert.match(app, /setAttribute\("required",""\)/);
  assert.match(app, /Employee PIN must be 4–8 digits/);
  assert.match(app, /const create=\{name:d\.name,role:d\.role,pin:d\.pin\}/);
  assert.match(app, /method:"POST",body:JSON\.stringify\(create\)/);
  assert.doesNotMatch(app, /const privatePatch=\{id:created\.item\.id/);
});

test("UI sends private_file_pin after opening the private employee file", () => {
  assert.match(app, /lastPrivateFilePin/);
  assert.match(app, /private_file_pin:d\.pin|private_file_pin: lastPrivateFilePin|private_file_pin=lastPrivateFilePin|patch\.private_file_pin=lastPrivateFilePin/);
  assert.match(app, /action:"OPEN_FILE"/);
  assert.ok(app.indexOf("lastPrivateFilePin=pin") < app.indexOf("openStaffEditor(result.item)"));
});
