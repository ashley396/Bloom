import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/florisyn-luxury-orders.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public/florisyn-luxury-orders.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

const pageHtml = html.slice(html.indexOf('id="ordersPage"'), html.indexOf('id="deliveriesPage"'));

test("Orders Figma shell and assets are wired", () => {
  assert.match(html, /florisyn-luxury-orders\.css/);
  assert.match(html, /florisyn-luxury-orders\.js/);
  assert.match(pageHtml, /florisyn-lux-orders/);
  assert.match(pageHtml, /<h1>Orders<\/h1>/);
  assert.match(pageHtml, /Manage and track all customer orders/);
  assert.match(pageHtml, /ordExportBtn/);
  assert.match(pageHtml, /\+ New Order/);
  assert.match(pageHtml, /ordTabs/);
  assert.match(pageHtml, /Search orders\.\.\./);
  // The date-range button used to hardcode "May 1 - May 12, 2026" as
  // permanent, unchanging label text — a completely fake control that
  // never filtered anything. It's now a real popover with a dynamic
  // label (defaults to "All dates") and real from/to date inputs.
  assert.doesNotMatch(pageHtml, /May 1 - May 12, 2026/);
  assert.match(pageHtml, /id="ordDateRangeLabel"/);
  assert.match(pageHtml, />All dates</);
  assert.match(pageHtml, /id="ordDatePanel"/);
  assert.match(pageHtml, /id="ordDateFrom"/);
  assert.match(pageHtml, /id="ordDateTo"/);
  assert.match(pageHtml, /id="ordFilterPanel"/);
  assert.match(pageHtml, /id="ordFilterFulfillment"/);
  assert.match(pageHtml, /id="ordFilterPayment"/);
  assert.match(pageHtml, /ord-table-card/);
  assert.match(pageHtml, /id="ordTable"/);
  assert.match(pageHtml, /id="ordTableBody"/);
  assert.match(pageHtml, /data-open="orderDialog"/);
  // Table replaced by a rectangle-tile grid 2026-08-15 (owner request) —
  // no more <table>/<thead> with clickable sort-header columns.
  assert.doesNotMatch(pageHtml, /<table/);
  assert.doesNotMatch(pageHtml, /<thead/);
  assert.doesNotMatch(pageHtml, /data-ord-sort=/);
  assert.match(pageHtml, /ord-tile-grid/);
  assert.match(pageHtml, /id="ordSortSelect"/);
  assert.match(pageHtml, /id="ordSelectAll"/);
});

test("Orders palette uses navy/rose tokens without green CTAs", () => {
  assert.match(css, /#1a1f3c/);
  assert.match(css, /#e06b85/i);
  assert.match(css, /#fbf6f7/i);
  assert.match(css, /#e8f5f0/i);
  assert.match(css, /#fff3e0/i);
  assert.match(css, /#e3f2fd/i);
  assert.match(css, /\.ord-status\.delivered/);
  assert.match(css, /\.ord-status\.cancelled/);
  assert.doesNotMatch(css, /background:\s*#547428|background:\s*#486329/i);
  assert.doesNotMatch(css, /\.ord-new[^{]*\{[^}]*#547428/i);
});

test("no fabricated demo orders remain — a shop with zero real orders gets an honest empty state", () => {
  // Removed 2026-08-15: normalizeOrders() used to silently fall back to
  // fake customers/order numbers/a fake 186-order total whenever the real
  // API returned empty, with nothing distinguishing it from real data —
  // a real shop with zero orders was seeing 100% fabricated content.
  assert.doesNotMatch(js, /FLR-7342/);
  assert.doesNotMatch(js, /Sarah Johnson/);
  assert.doesNotMatch(js, /Clara Kensington/);
  assert.doesNotMatch(js, /Wedding Package/);
  assert.doesNotMatch(js, /Blush Serenity Bouquet/);
  assert.doesNotMatch(js, /DEMO_ROWS/);
  assert.doesNotMatch(js, /DEMO_TOTAL/);
  assert.doesNotMatch(js, /TAB_COUNTS/);
  assert.doesNotMatch(js, /usingDemo/);

  const normStart = js.indexOf("function normalizeOrders(");
  const normBody = js.slice(normStart, js.indexOf("\n  }", normStart));
  assert.match(normBody, /return \[\];/, "empty/invalid input must normalize to a real empty array, not fake rows");

  const renderStart = js.indexOf("function renderTable(");
  const renderBody = js.slice(renderStart, js.indexOf("\n  function render(", renderStart));
  assert.match(renderBody, /ord-empty/, "renderTable must render a real empty state when there's nothing to show");
  assert.match(renderBody, /No orders yet/);
});

test("orders render as tiles with real Edit + Delete actions, not a demo table", () => {
  assert.match(js, /FlorisynLuxuryOrders/);
  assert.match(js, /data-ord-tab/);
  assert.match(js, /ordExportBtn/);
  assert.match(js, /PAGE_SIZE/);
  assert.match(appJs, /FlorisynLuxuryOrders\?\.boot/);

  const renderStart = js.indexOf("function renderTable(");
  const renderBody = js.slice(renderStart, js.indexOf("\n  function render(", renderStart));
  assert.match(renderBody, /class="ord-tile\$\{selected\}"/, "each order renders as a .ord-tile card");
  assert.match(renderBody, /data-edit-order="\$\{esc\(r\.raw\.id\)\}"/, "Edit button must carry the real order id so app.js's existing data-edit-order handler (openOrderEditor) can find it");
  assert.match(renderBody, />Edit</);

  // "Delete" is a deliberate relabel of the existing safe cancel flow
  // (status: CANCELLED), never a hard delete of a financial record —
  // per explicit owner choice 2026-08-15.
  assert.match(js, /data-cancel-order/);
  assert.match(js, /status:\s*"CANCELLED"/);
  assert.match(js, />Delete</);
  assert.doesNotMatch(js, /Cancel Order/, "button must be relabeled Delete, not the old Cancel Order text");
  assert.match(js, /e\.target\.closest\("\[data-cancel-order\]"\)/);
  assert.match(js, /never a hard delete/i, "the safety trade-off must stay documented in source, not just in the commit message");
});

test("sort control replaces clickable column headers and drives real comparator state", () => {
  assert.match(js, /#ordSortSelect/);
  const wireStart = js.indexOf("function wire(");
  const wireBody = js.slice(wireStart, js.indexOf("\n  function boot(", wireStart));
  assert.match(wireBody, /ordSortSelect.*addEventListener\("change"/s);
  assert.match(wireBody, /state\.sortKey\s*=\s*key/);
  assert.match(wireBody, /state\.sortDir\s*=\s*dir === "asc" \? "asc" : "desc"/);
});

test("mobile date-range/filter buttons wrap onto their own row instead of being squeezed and clipped", () => {
  // .ord-date has white-space:nowrap and no min-width:0, so a shared flex
  // row with .ord-search left it squeezed to ~45px against a ~154px text
  // content need (live-measured 2026-08-15) — "May 1 - May 12, 2026" was
  // effectively invisible/clipped on narrow screens.
  const start = css.indexOf("@media (max-width: 900px)");
  const end = css.indexOf("@media", start + 1);
  const block = css.slice(start, end > start ? end : start + 1200);
  assert.match(block, /\.ord-tools\s*\{[^}]*flex-wrap:\s*wrap/s, "tools row must be allowed to wrap");
  assert.match(block, /\.ord-search\s*\{[^}]*flex:\s*1 1 100%/s, "search takes the full first row");
  assert.match(block, /\.ord-date,[^{]*\.ord-filter-btn\s*\{[^}]*flex:\s*0 0 auto/s, "date/filter buttons size to their own content on the wrapped row");
});

// Switching Barrier Register, Wave 7: wire order manual intake screen — a real
// entry point for orders received by phone/fax/legacy wire portal from
// FTD/Teleflora/BloomNet/FSN, so they flow into the same board, inventory,
// and delivery pipeline as any other order instead of living outside Florisyn.
test("Orders page has a real Wire Order intake entry point and dialog", () => {
  assert.match(pageHtml, /\+ Wire Order/);
  assert.match(pageHtml, /data-open="wireOrderDialog"/);
  const dialogStart = html.indexOf('id="wireOrderDialog"');
  const dialogEnd = html.indexOf("</dialog>", dialogStart);
  const dialog = html.slice(dialogStart, dialogEnd);
  assert.match(dialog, /id="wireOrderForm"/);
  assert.match(dialog, /name="wire_service"/);
  assert.match(dialog, /<option value="FTD">FTD<\/option>/);
  assert.match(dialog, /<option value="Teleflora">Teleflora<\/option>/);
  assert.match(dialog, /<option value="BloomNet">BloomNet<\/option>/);
  assert.match(dialog, /name="wire_reference_number"/);
  assert.match(dialog, /name="wire_cost"/);
  assert.match(dialog, /name="recipient_name" required/);
  assert.match(dialog, /name="subtotal" type="number" min="0" step="\.01" required/);
  // Must not silently pretend Florisyn's own payment ledger settles a wire
  // order — the wire service, not a card/cash tender through Florisyn, does.
  assert.match(dialog, /settled by the wire service, not through Florisyn/);
});

test("wire order submit builds a real order payload (order_source + metadata) instead of a fake local-only record", () => {
  assert.match(appJs, /\$\("#wireOrderForm"\)\.onsubmit=async e=>\{/);
  const start = appJs.indexOf('$("#wireOrderForm").onsubmit=async e=>{');
  const end = appJs.indexOf('"Save wire order"}\n};', start) + '"Save wire order"}\n};'.length;
  const body = appJs.slice(start, end);
  assert.match(body, /api\("orders",\{method:"POST"/, "must create a real order through the existing orders API, not a parallel table");
  assert.match(body, /order_source:`Wire — \$\{wireService\}`/);
  assert.match(body, /metadata:\{wire_service:wireService,wire_reference_number:d\.wire_reference_number\|\|"",wire_cost:Number\(d\.wire_cost\|\|0\)\}/);
  assert.match(body, /loadOrders\(\)/, "board must refresh so the new wire order actually shows up");
});

test("a wire order's tile shows a real service badge and a one-click path to log its commission as an expense", () => {
  assert.match(js, /o\.metadata && o\.metadata\.wire_service/);
  assert.match(js, /class="ord-wire-badge"/);
  assert.match(js, /data-log-wire-expense="\$\{esc\(r\.raw\.id\)\}"/);
  assert.match(css, /\.ord-wire-badge\s*\{/);

  assert.match(appJs, /data-log-wire-expense/);
  const start = appJs.indexOf('data-log-wire-expense]")){');
  const line = appJs.slice(start, appJs.indexOf("return openExpense(", start) + 400);
  assert.match(line, /openExpense\(\{vendor:wire\.wire_service,amount:Number\(wire\.wire_cost\|\|0\)/, "must hand off to the real existing Expenses feature, not a new parallel one");
});
