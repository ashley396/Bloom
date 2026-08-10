(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  async function api(action, extra = {}) {
    const fn = window.api;
    if (!fn) throw new Error("Sign in to import data.");
    return fn("florist-migration", { method: "POST", body: JSON.stringify({ action, ...extra }) });
  }

  function mount(root) {
    if (!root) return;
    root.innerHTML = `<section class="panel migration-wizard">
      <p class="eyebrow">SWITCH TO FLORISYN</p>
      <h2>Migration wizard</h2>
      <p class="subtle">Import products or customers from CSV, Floranext, or Hana exports.</p>
      <div class="two">
        <label>Import type<select id="migrationEntity"><option value="products">Products</option><option value="customers">Customers</option></select></label>
        <label>Source<select id="migrationSource"><option value="csv">CSV / spreadsheet</option><option value="floranext">Floranext export</option><option value="hana">Hana POS export</option></select></label>
      </div>
      <label>Paste CSV or export file contents<textarea id="migrationText" rows="8" placeholder="Paste column headers in row 1…"></textarea></label>
      <div class="card-actions">
        <button type="button" class="secondary" id="migrationPreview">Preview import</button>
        <button type="button" class="primary" id="migrationApply" disabled>Import into Florisyn</button>
      </div>
      <div id="migrationResult" class="subtle" aria-live="polite"></div>
    </section>`;

    let lastRows = [];
    root.querySelector("#migrationPreview")?.addEventListener("click", async () => {
      const out = root.querySelector("#migrationResult");
      out.textContent = "Analyzing file…";
      try {
        const d = await api("preview", {
          entity: root.querySelector("#migrationEntity").value,
          source: root.querySelector("#migrationSource").value,
          text: root.querySelector("#migrationText").value
        });
        lastRows = d.rows || [];
        out.innerHTML = `<strong>${esc(d.preview.vendorLabel)}</strong> — ${d.preview.rowCount} rows ready${
          d.preview.errorCount ? ` · ${d.preview.errorCount} warnings` : ""
        }<pre class="migration-sample">${esc(JSON.stringify(d.preview.sample, null, 2))}</pre>`;
        root.querySelector("#migrationApply").disabled = !lastRows.length;
      } catch (e) {
        out.textContent = e.message;
      }
    });

    root.querySelector("#migrationApply")?.addEventListener("click", async () => {
      const out = root.querySelector("#migrationResult");
      out.textContent = "Importing…";
      try {
        const d = await api("apply", {
          entity: root.querySelector("#migrationEntity").value,
          source: root.querySelector("#migrationSource").value,
          text: root.querySelector("#migrationText").value
        });
        out.textContent = `Imported ${d.inserted} ${d.entity}. ${d.errors?.length ? d.errors.length + " rows skipped." : ""}`;
        window.toast?.(`Imported ${d.inserted} ${d.entity}`);
        root.querySelector("#migrationApply").disabled = true;
      } catch (e) {
        out.textContent = e.message;
      }
    });
  }

  window.BloomMigrationWizard = { mount };
})();
