/**
 * Lily Website Quick Start — multi-step florist interview → wizard_generate.
 */
(function () {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  async function api(action, extra = {}) {
    return window.api("instant-website", { method: "POST", body: JSON.stringify({ action, ...extra }) });
  }

  function mountLilyWizard(root) {
    if (!root || root.querySelector(".lily-wizard-shell")) return;

    const wrap = document.createElement("div");
    wrap.className = "lily-wizard-shell panel bloom-rc1-wizard";
    wrap.innerHTML = `
      <div class="lily-wizard-head">
        <img src="/assets/assistants/lily-portrait.png" alt="" width="48" height="48">
        <div>
          <p class="eyebrow">LILY QUICK START</p>
          <h2>Build your florist website in minutes</h2>
          <p class="subtle">Answer a few questions — Lily generates pages, sections, SEO, and starter products. You approve before anything goes live.</p>
        </div>
        <button type="button" class="primary" id="lilyWizardOpen">Start with Lily</button>
      </div>
      <dialog id="lilyWizardDialog" class="lily-wizard-dialog">
        <form method="dialog" class="lily-wizard-form">
          <div class="lily-wizard-progress"><div id="lilyWizardBar"></div></div>
          <p class="lily-bubble" id="lilyWizardBubble"></p>
          <h3 id="lilyWizardStepTitle"></h3>
          <div id="lilyWizardFields"></div>
          <div class="card-actions">
            <button type="button" class="secondary" id="lilyWizardBack">Back</button>
            <button type="button" class="primary" id="lilyWizardNext">Continue</button>
          </div>
          <p id="lilyWizardStatus" class="subtle" aria-live="polite"></p>
        </form>
      </dialog>`;
    root.insertBefore(wrap, root.firstChild);

    let steps = [];
    let stepIndex = 0;
    const answers = {};

    api("lily_interview_steps")
      .then((d) => {
        steps = d.steps || [];
      })
      .catch(() => {
        steps = [];
      });

    function renderStep() {
      const step = steps[stepIndex];
      if (!step) return;
      const pct = Math.round(((stepIndex + 1) / steps.length) * 100);
      wrap.querySelector("#lilyWizardBar").style.width = `${pct}%`;
      wrap.querySelector("#lilyWizardBubble").textContent = step.lily || "";
      wrap.querySelector("#lilyWizardStepTitle").textContent = step.title || "";
      wrap.querySelector("#lilyWizardBack").hidden = stepIndex === 0;
      wrap.querySelector("#lilyWizardNext").textContent = stepIndex >= steps.length - 1 ? "Generate my website" : "Continue";

      const fields = wrap.querySelector("#lilyWizardFields");
      if (!step.fields?.length) {
        fields.innerHTML = step.id === "review" ? `<p class="subtle">Ready to generate your florist website draft with ${Object.keys(answers).length} preferences saved.</p>` : "";
        return;
      }
      fields.innerHTML = step.fields
        .map((f) => {
          if (f.type === "textarea") {
            return `<label>${esc(f.label)}<textarea data-key="${esc(f.key)}" rows="3" placeholder="${esc(f.placeholder || "")}">${esc(answers[f.key] || "")}</textarea></label>`;
          }
          if (f.type === "checkbox") {
            const checked = answers[f.key] !== undefined ? answers[f.key] : f.default !== false;
            return `<label class="check"><input type="checkbox" data-key="${esc(f.key)}" ${checked ? "checked" : ""}> ${esc(f.label)}</label>`;
          }
          if (f.type === "select") {
            const opts = (f.options || []).map((o) => {
              const val = typeof o === "object" ? o.value : o;
              const lab = typeof o === "object" ? o.label : o;
              const sel = (answers[f.key] || "") === val ? " selected" : "";
              return `<option value="${esc(val)}"${sel}>${esc(lab)}</option>`;
            });
            return `<label>${esc(f.label)}<select data-key="${esc(f.key)}">${opts.join("")}</select></label>`;
          }
          return `<label>${esc(f.label)}<input data-key="${esc(f.key)}" value="${esc(answers[f.key] || "")}" placeholder="${esc(f.placeholder || "")}"></label>`;
        })
        .join("");
    }

    function collectFields() {
      wrap.querySelectorAll("#lilyWizardFields [data-key]").forEach((el) => {
        const key = el.dataset.key;
        if (el.type === "checkbox") answers[key] = el.checked;
        else answers[key] = el.value;
      });
    }

    wrap.querySelector("#lilyWizardOpen")?.addEventListener("click", () => {
      stepIndex = 0;
      wrap.querySelector("#lilyWizardDialog").showModal();
      renderStep();
    });

    wrap.querySelector("#lilyWizardBack")?.addEventListener("click", () => {
      if (stepIndex > 0) {
        collectFields();
        stepIndex -= 1;
        renderStep();
      }
    });

    wrap.querySelector("#lilyWizardNext")?.addEventListener("click", async () => {
      collectFields();
      const status = wrap.querySelector("#lilyWizardStatus");
      if (stepIndex < steps.length - 1) {
        stepIndex += 1;
        renderStep();
        return;
      }
      status.textContent = "Lily is building your florist website…";
      wrap.querySelector("#lilyWizardNext").disabled = true;
      try {
        const result = await api("lily_wizard_generate", { answers });
        status.textContent = result.note || "Website draft ready — review in the editor below.";
        window.toast?.("Lily created your website draft");
        wrap.querySelector("#lilyWizardDialog").close();
        await window.BloomWebsiteStudioV2?.load?.();
        await window.BloomWebsiteEditor?.load?.();
        if (window.renderWebsite) window.renderWebsite();
      } catch (e) {
        status.textContent = e.message || "Could not generate website. Try again.";
      } finally {
        wrap.querySelector("#lilyWizardNext").disabled = false;
      }
    });
  }

  function load() {
    const page = document.getElementById("websitePage");
    if (page) mountLilyWizard(page);
  }

  window.BloomLilyWebsiteWizard = { load, mountLilyWizard };
})();
