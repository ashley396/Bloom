(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  async function api(method, body) {
    const fn = window.api;
    if (!fn) throw new Error("Sign in required.");
    if (method === "GET") return fn("peak-readiness");
    return fn("peak-readiness", { method: "POST", body: JSON.stringify(body || {}) });
  }

  function bandLabel(band) {
    return (
      {
        ready: "Ready for Mother's Day",
        almost_there: "Almost ready",
        in_progress: "In progress",
        getting_started: "Getting started"
      }[band] || band
    );
  }

  function render(root, data) {
    const score = data.score || {};
    root.innerHTML = `<article class="panel mothers-day-ready" aria-labelledby="mdReadyTitle">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">PEAK SEASON</p>
          <h2 id="mdReadyTitle">Mother's Day Ready</h2>
          <p class="subtle">${esc(bandLabel(score.band))} · ${score.complete}/${score.total} complete (${score.score}%)</p>
        </div>
        <span class="badge ${score.score >= 90 ? "good" : score.score >= 70 ? "" : "warn"}">${score.score}%</span>
      </div>
      <ul class="md-checklist">${(data.checklist || [])
        .map(
          (item) => `<li><label class="check"><input type="checkbox" data-md-id="${esc(item.id)}" ${
            item.completed ? "checked" : ""
          }> ${esc(item.label)}${item.auto ? " <small>(auto)</small>" : ""}</label></li>`
        )
        .join("")}</ul>
      <div class="card-actions">
        <button type="button" class="secondary" data-page="holidayPage">Open Holiday Command</button>
        <button type="button" class="secondary" data-page="floristNetworkPage">Florist Network</button>
      </div>
    </article>`;

    root.querySelectorAll("[data-md-id]").forEach((cb) => {
      cb.addEventListener("change", async () => {
        try {
          await api("POST", { checklist_id: cb.dataset.mdId, completed: cb.checked });
          const refreshed = await api("GET");
          render(root, refreshed);
        } catch (e) {
          window.toast?.(e.message);
        }
      });
    });
    root.querySelectorAll("[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => window.showPage?.(btn.dataset.page));
    });
  }

  async function load(root = document.getElementById("mothersDayReadyRoot")) {
    if (!root) return;
    root.innerHTML = `<p class="subtle">Loading readiness checklist…</p>`;
    try {
      render(root, await api("GET"));
    } catch (e) {
      root.innerHTML = `<p class="subtle">${esc(e.message)}</p>`;
    }
  }

  window.BloomMothersDayReady = { load };
})();
