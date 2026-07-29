(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  async function adminApi(action, extra = {}) {
    const session = JSON.parse(localStorage.getItem("bloom_admin_session") || "null");
    const headers = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch(`/.netlify/functions/floral-library-admin?action=${encodeURIComponent(action)}`, {
      method: extra.method || "POST",
      headers,
      body: extra.body ? JSON.stringify(extra.body) : JSON.stringify({ action, ...extra })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Admin request failed");
    return data;
  }

  function mount(root) {
    if (!root || root.dataset.libraryAdminMounted) return;
    root.dataset.libraryAdminMounted = "1";
    root.innerHTML = `<div class="panel">
      <p class="eyebrow">FLORAL LIBRARY ADMIN</p>
      <h2>Import & quality</h2>
      <div id="libraryQuality" class="metric-grid"></div>
      <label class="wide">CSV manifest<textarea id="libraryCsv" rows="6" placeholder="product_id,product_name,image_url,license_source,attribution,category,retail_price"></textarea></label>
      <div class="card-actions">
        <button type="button" class="secondary" id="libraryDryRun">Dry-run validate</button>
        <button type="button" class="primary" id="libraryPartialApprove">Partial approve</button>
      </div>
      <h3>Duplicate review queue</h3>
      <div id="duplicateQueue"></div>
      <pre id="libraryImportReport" class="import-report"></pre>
    </div>`;

    adminApi("quality", { method: "GET" })
      .then((d) => {
        const q = d.dashboard || {};
        root.querySelector("#libraryQuality").innerHTML = Object.entries(q)
          .filter(([k]) => typeof q[k] === "number")
          .slice(0, 8)
          .map(([k, v]) => `<div class="metric-box"><span>${esc(k.replace(/_/g, " "))}</span><strong>${v}</strong></div>`)
          .join("");
      })
      .catch((e) => {
        root.querySelector("#libraryQuality").innerHTML = `<p>${esc(e.message)}</p>`;
      });

    let lastBatch = null;
    root.querySelector("#libraryDryRun")?.addEventListener("click", async () => {
      const csv = root.querySelector("#libraryCsv").value;
      const d = await adminApi("dry_run", { csv });
      lastBatch = d.batch_id;
      root.querySelector("#libraryImportReport").textContent = JSON.stringify(d, null, 2);
    });

    root.querySelector("#libraryPartialApprove")?.addEventListener("click", async () => {
      if (!lastBatch) return alert("Run dry-run first.");
      const d = await adminApi("approve_batch", { batch_id: lastBatch, approve_ids: [], reject_ids: [], admin_master_write: true });
      root.querySelector("#libraryImportReport").textContent = JSON.stringify(d, null, 2);
    });

    adminApi("duplicate_queue", { items: [] })
      .then((d) => {
        root.querySelector("#duplicateQueue").innerHTML = (d.items || [])
          .map((item) => `<article class="card"><p>Hash ${esc(item.hash)} · matches ${esc((item.products || []).join(", "))}</p></article>`)
          .join("") || "<p class=\"quiet\">Queue empty.</p>";
      })
      .catch(() => {});
  }

  window.BloomLibraryAdmin = { mount };
})();
