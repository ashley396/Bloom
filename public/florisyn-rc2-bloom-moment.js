/**
 * Florisyn RC2 — Bloom Moment
 * Signature morning experience. UI enhancement only — no business logic changes.
 */
(function () {
  const ENTRIES = [
    {
      label: "Floral wisdom",
      text: "Flowers always make people better, happier, and more helpful; they are sunshine, food, and medicine for the soul.",
      attribution: "Luther Burbank",
    },
    {
      label: "Morning encouragement",
      text: "Every arrangement you create today carries someone's unspoken gratitude. Start gently — the day will unfold beautifully.",
    },
    {
      label: "Seasonal note",
      text: "Late summer calls for warm tones and airy textures. Consider garden roses, scabiosa, and trailing amaranth for effortless elegance.",
    },
    {
      label: "Customer kindness",
      text: "A handwritten note on a sympathy arrangement can mean more than the flowers themselves. Small gestures, lasting impact.",
    },
    {
      label: "Inspiration",
      text: "Where flowers bloom, so does hope.",
      attribution: "Lady Bird Johnson",
    },
    {
      label: "Floral wisdom",
      text: "Design with restraint. Three focal flowers often speak louder than twelve competing blooms.",
    },
    {
      label: "Business encouragement",
      text: "Your craft is irreplaceable. Technology supports your artistry — it never replaces the human touch at your design table.",
    },
  ];

  function getTodaysEntry() {
    const now = new Date();
    const dayIndex = now.getFullYear() * 366 + now.getMonth() * 31 + now.getDate();
    return ENTRIES[dayIndex % ENTRIES.length];
  }

  function mountBloomMoment() {
    if (document.getElementById("florisynBloomMoment")) return;

    const dashboard = document.getElementById("dashboardPage");
    const welcomeRow = dashboard?.querySelector(".pos-welcome-row");
    if (!welcomeRow) return;

    const entry = getTodaysEntry();
    const block = document.createElement("section");
    block.id = "florisynBloomMoment";
    block.setAttribute("role", "complementary");
    block.setAttribute("aria-label", "Bloom moment");

    const attrHtml = entry.attribution
      ? `<p class="bloom-moment-attribution">— ${entry.attribution}</p>`
      : "";

    block.innerHTML = `
      <p class="bloom-moment-label">Bloom moment · ${entry.label}</p>
      <blockquote class="bloom-moment-quote">&ldquo;${entry.text}&rdquo;</blockquote>
      ${attrHtml}`;

    welcomeRow.before(block);
  }

  function init() {
    document.body.classList.add("florisyn-rc2-luxury");
    mountBloomMoment();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.FlorisynRC2 = window.FlorisynRC2 || {};
  window.FlorisynRC2.mountBloomMoment = mountBloomMoment;
})();
