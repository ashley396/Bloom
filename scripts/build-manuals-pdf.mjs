#!/usr/bin/env node
/**
 * Renders docs/manuals/*.md into branded PDFs at public/manuals/*.pdf,
 * using this sandbox's pre-installed Chromium via Playwright's page.pdf().
 *
 * Deliberately dependency-free: a small hand-rolled Markdown->HTML pass
 * (headings, bold/italic, bullet lists, hr, paragraphs) is enough for the
 * manuals' actual content and avoids adding a markdown-parser dependency
 * for three documents.
 *
 * Run: node scripts/build-manuals-pdf.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANUALS_DIR = path.join(ROOT, "docs/manuals");
const OUT_DIR = path.join(ROOT, "public/manuals");

const MANUALS = [
  { md: "florisyn-florist-manual.md", pdf: "florisyn-florist-manual.pdf", accent: "rose", favicon: "🌸" },
  { md: "florisyn-admin-manual.md", pdf: "florisyn-admin-manual.pdf", accent: "gold", favicon: "🛡️" },
  { md: "florisyn-wholesaler-manual.md", pdf: "florisyn-wholesaler-manual.pdf", accent: "navy", favicon: "📦" },
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<em>$1</em>");
  return out;
}

/** Minimal Markdown -> HTML: headings, hr, bullet lists, paragraphs. */
function mdToHtml(md) {
  const lines = md.split("\n");
  const out = [];
  let list = null; // open <ul>?

  function closeList() {
    if (list) {
      out.push("</ul>");
      list = null;
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      closeList();
      out.push("<hr>");
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const li = line.match(/^-\s+(.*)$/);
    if (li) {
      if (!list) {
        out.push("<ul>");
        list = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

const ACCENTS = {
  rose: "#c4708a",
  gold: "#c9a962",
  navy: "#2c3c66",
};

function pageHtml({ title, bodyHtml, accentHex }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: Letter; margin: 20mm 18mm 22mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    color: #1c2333;
    font-size: 11.5pt;
    line-height: 1.55;
  }
  .titlepage {
    height: 247mm;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    page-break-after: always;
    border-top: 6px solid ${accentHex};
    padding-top: 28mm;
  }
  .titlepage .eyebrow {
    font-family: -apple-system, "Segoe UI", Arial, sans-serif;
    font-size: 10pt;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: ${accentHex};
    font-weight: 700;
    margin: 0 0 10mm 0;
  }
  .titlepage h1 {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 34pt;
    font-weight: 600;
    color: #0f1830;
    margin: 0 0 8mm 0;
    line-height: 1.15;
  }
  .titlepage .lede {
    font-family: -apple-system, "Segoe UI", Arial, sans-serif;
    font-size: 12.5pt;
    color: #6b6f80;
    max-width: 120mm;
    line-height: 1.6;
  }
  .titlepage .brandmark {
    margin-top: auto;
    font-family: -apple-system, "Segoe UI", Arial, sans-serif;
    font-size: 10pt;
    color: #6b6f80;
    letter-spacing: 0.04em;
  }
  .brandmark strong { color: #0f1830; }
  h1 { font-size: 20pt; color: #0f1830; margin: 0 0 4mm 0; }
  h2 {
    font-size: 15pt;
    color: #0f1830;
    margin: 10mm 0 3mm 0;
    padding-bottom: 2mm;
    border-bottom: 1.5px solid ${accentHex};
    page-break-after: avoid;
  }
  h3 {
    font-size: 12.5pt;
    color: ${accentHex};
    margin: 6mm 0 2mm 0;
    page-break-after: avoid;
  }
  h4 {
    font-size: 11pt;
    color: #1c2333;
    margin: 4mm 0 1mm 0;
    font-style: italic;
  }
  p { margin: 0 0 3mm 0; }
  ul { margin: 0 0 4mm 0; padding-left: 6mm; }
  li { margin: 0 0 1.5mm 0; }
  strong { color: #0f1830; }
  em { color: #6b6f80; }
  hr { border: none; border-top: 1px solid #e3e0e6; margin: 6mm 0; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

async function build() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  for (const manual of MANUALS) {
    const mdPath = path.join(MANUALS_DIR, manual.md);
    const md = fs.readFileSync(mdPath, "utf8");
    const lines = md.split("\n");
    const titleLine = lines.find((l) => l.startsWith("# ")) || "# Florisyn Manual";
    const title = titleLine.replace(/^#\s+/, "").replace(/^Florisyn — /, "");
    const ledeLine = lines.find((l) => l.startsWith("*") && l.endsWith("*") && !l.startsWith("**"));
    const lede = ledeLine ? ledeLine.replace(/^\*|\*$/g, "") : "";

    // Body starts after the title + optional lede + the first "---" rule.
    const firstHrIndex = lines.findIndex((l) => /^---+$/.test(l.trim()));
    const bodyMd = lines.slice(firstHrIndex + 1).join("\n");
    const bodyHtml = mdToHtml(bodyMd);

    const accentHex = ACCENTS[manual.accent] || ACCENTS.navy;
    const titlepage = `<div class="titlepage">
      <p class="eyebrow">Florisyn — The Operating System for Modern Florists</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="lede">${escapeHtml(lede)}</p>
      <p class="brandmark"><strong>Florisyn</strong> · florisyn.com</p>
    </div>`;

    const html = pageHtml({ title, bodyHtml: titlepage + bodyHtml, accentHex });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const outPath = path.join(OUT_DIR, manual.pdf);
    await page.pdf({
      path: outPath,
      format: "Letter",
      printBackground: true,
      margin: { top: "20mm", bottom: "22mm", left: "18mm", right: "18mm" },
    });
    await page.close();
    const size = fs.statSync(outPath).size;
    console.log(`wrote ${path.relative(ROOT, outPath)} (${(size / 1024).toFixed(0)} KB)`);
  }

  await browser.close();
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
