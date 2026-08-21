(function () {
  const KEY = "bloom_first_run_rc2_done";

  function done() {
    return localStorage.getItem(KEY) === "1";
  }

  function markDone() {
    localStorage.setItem(KEY, "1");
  }

  function showWelcome() {
    if (done() || !document.getElementById("app") || document.getElementById("app").hidden) return;
    const overlay = document.createElement("dialog");
    overlay.id = "bloomFirstRun";
    overlay.className = "bloom-first-run";
    overlay.innerHTML = `<div class="bloom-first-run-inner">
      <img src="/assets/assistants/lily-portrait.png" alt="" class="first-run-lily" width="72" height="72">
      <img src="/assets/assistants/rose-portrait.png" alt="" class="first-run-rose" width="72" height="72">
      <img src="/assets/assistants/daisy-portrait.png" alt="" class="first-run-daisy" width="72" height="72">
      <p class="eyebrow">WELCOME TO FLORISYN</p>
      <h2>Meet Lily &amp; Rose</h2>
      <p id="firstRunLilyLine">Welcome to Florisyn! I'm Lily, your creative partner — and Rose helps you run the business side. We're here so you spend less time on paperwork and more time with the flowers.</p>
      <button type="button" class="primary" id="firstRunContinue">Get started</button>
    </div>`;
    document.body.appendChild(overlay);
    overlay.showModal();
    window.BloomLilyVoice?.speakLily?.(overlay.querySelector("#firstRunLilyLine")?.textContent);
    window.BloomDaisy?.gentleWag?.("Welcome");
    overlay.querySelector("#firstRunContinue")?.addEventListener("click", () => {
      markDone();
      overlay.close();
      overlay.remove();
    });
  }

  window.BloomFirstRun = { showWelcome, markDone, done };
})();
