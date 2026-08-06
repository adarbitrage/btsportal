/**
 * Copywriting Foundations — series PDF renderer (Task #2005).
 *
 * Renders each markdown doc in docs/copywriting-foundations/ to a branded,
 * mobile-first PDF via an HTML/CSS series template printed with the system
 * (nix) Chromium. One command regenerates everything:
 *
 *   pnpm --filter @workspace/scripts run render-foundations-pdfs
 *
 * Or a single doc:
 *
 *   pnpm --filter @workspace/scripts run render-foundations-pdfs -- 03
 *
 * Toolchain decision (explicit): HTML/CSS + headless Chromium print-to-PDF
 * (playwright-core driving the nix `chromium` binary with --no-sandbox — the
 * bundled Playwright build lacks libgbm here). Chromium gives us real CSS
 * layout (callouts, page-break control, internal TOC links, embedded subset
 * fonts) that pure-JS PDF libs make painful. PDFs are generated at BUILD time
 * and committed — prod never runs Chromium.
 *
 * Format spec: SYNTHESIS.md Rulings 12-14 + FORMAT-RESEARCH.md — portrait,
 * single column, 12.5pt sans body, 1.55 line height, 0.75in margins, numbered
 * cover, clickable TOC, running footers (series · doc title · page),
 * selectable text, embedded fonts (Liberation Sans, committed under
 * scripts/pdf-assets/fonts), high contrast, print-conscious light tints
 * (Option B: one file serves screen + print).
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { marked, Renderer } from "marked";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DOCS_DIR = path.join(REPO_ROOT, "docs/copywriting-foundations");
const OUT_DIR = path.join(
  REPO_ROOT,
  "artifacts/api-server/src/assets/copywriting-foundations",
);
const FONTS_DIR = path.join(REPO_ROOT, "scripts/pdf-assets/fonts");

const SERIES_NAME = "Copywriting Foundations";

// ── Palette (print-conscious: light tints + borders, no saturated fills) ────
const C = {
  ink: "#1c2733",
  navy: "#1a3a5c",
  slate: "#4a5a6a",
  line: "#d7dee6",
  // Callout accents
  anatomy: "#1a5c8a", // blue — structural
  why: "#8a6116", // amber — insight
  fit: "#2e6b46", // green — placement
  swipeBg: "#f3f6f9",
  calloutTint: "#fbfcfd",
  calibBg: "#f5f8fb",
  takeBg: "#f4f8f5",
  danger: "#a03030",
  dangerBg: "#fbf4f4",
  green: "#2e7d32",
  yellow: "#b8860b",
};

interface DocMeta {
  file: string;
  num: number;
  title: string;
  metaLine: string; // the italic series line
  startNote: string | null; // "start here" note when present
  bodyMd: string; // markdown after the leading hr
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseDoc(file: string): DocMeta {
  const raw = fs.readFileSync(path.join(DOCS_DIR, file), "utf-8");
  const lines = raw.split("\n");
  let title = "";
  let metaLine = "";
  let startNote: string | null = null;
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      continue;
    }
    if (line === "---") {
      i++;
      break;
    }
    if (line.startsWith("*") && line.includes(SERIES_NAME)) {
      metaLine = line.replace(/^\*|\*$/g, "").trim();
      continue;
    }
    // Any other pre-rule paragraph is the "start here" note
    startNote = (startNote ? startNote + " " : "") + line;
  }
  const numMatch = file.match(/^(\d+)/);
  const num = numMatch ? parseInt(numMatch[1], 10) : 0;
  return { file, num, title, metaLine, startNote, bodyMd: lines.slice(i).join("\n") };
}

// ── Markdown → HTML with ids on h2 ──────────────────────────────────────────

/**
 * Plain text straight from the raw marked tokens (no HTML entities ever enter
 * the string — parseInline() output escapes `"` → `&quot;` etc., which then got
 * double-escaped by the TOC template; see Task #2014).
 */
function tokensToPlainText(tokens: Array<Record<string, unknown>>): string {
  return tokens
    .map((t) => {
      const child = t.tokens as Array<Record<string, unknown>> | undefined;
      if (child && child.length) return tokensToPlainText(child);
      if (typeof t.text === "string") return t.text;
      return typeof t.raw === "string" ? t.raw : "";
    })
    .join("");
}

function renderMarkdown(md: string): { html: string; toc: Array<{ id: string; text: string }> } {
  const toc: Array<{ id: string; text: string }> = [];
  const renderer = new Renderer();
  renderer.heading = ({ tokens, depth }) => {
    const text = (renderer.parser?.parseInline(tokens) ?? "").trim();
    const plain = tokensToPlainText(tokens as Array<Record<string, unknown>>).trim();
    if (depth === 2) {
      const id = slugify(plain);
      toc.push({ id, text: plain });
      return `<h2 id="${id}">${text}</h2>\n`;
    }
    return `<h${depth}>${text}</h${depth}>\n`;
  };
  const html = marked.parse(md, { renderer, async: false }) as string;
  return { html, toc };
}

// ── Post-processing: series visual language ─────────────────────────────────

function badgeSpan(kind: "green" | "yellow"): string {
  const label = kind === "green" ? "ANY SURFACE" : "PRELANDER ONLY";
  return `<span class="tier tier-${kind}"><span class="dot"></span>${label}</span>`;
}

function applyVisualLanguage(html: string): string {
  let out = html;

  // Tier badges: replace raw emoji with styled, selectable badges.
  out = out.replace(/🟢/g, badgeSpan("green"));
  out = out.replace(/🟡/g, badgeSpan("yellow"));

  // Swipe blocks: blockquotes whose first strong is "Swipe:".
  out = out.replace(
    /<blockquote>\s*<p><strong>Swipe:<\/strong>/g,
    `<blockquote class="swipe"><div class="swipe-tag">Swipe</div><p class="swipe-line">`,
  );

  // The three fixed callouts inside swipe blocks.
  const callouts: Array<[RegExp, string, string]> = [
    [/<li><strong>(The )?Anatomy:<\/strong>/g, "anatomy", "Anatomy"],
    [/<li><strong>Why It Works:<\/strong>/g, "why", "Why It Works"],
    [/<li><strong>Funnel Fit:<\/strong>/g, "fit", "Funnel Fit"],
  ];
  for (const [re, cls, label] of callouts) {
    out = out.replace(
      re,
      `<li class="callout callout-${cls}"><span class="callout-label callout-label-${cls}">${label}</span>`,
    );
  }
  return out;
}

/**
 * Wraps whole h2-sections in styled panels: the calibration section and the
 * Key Takeaways section get their recurring series treatment; the Do-Not-Use
 * section (Palette doc) is visually quarantined.
 */
function wrapSections(html: string): string {
  const parts = html.split(/(?=<h2 )/);
  return parts
    .map((part) => {
      const m = part.match(/<h2 id="[^"]*">([^<]+)<\/h2>/);
      if (!m) return part;
      const heading = m[1];
      if (/^calibrat|calibrating/i.test(heading)) {
        return `<section class="panel panel-calibration">${part}</section>`;
      }
      if (/key takeaways/i.test(heading)) {
        return `<section class="panel panel-takeaways">${part}</section>`;
      }
      if (/do-not-use/i.test(heading)) {
        return `<section class="panel panel-danger">${part}</section>`;
      }
      return part;
    })
    .join("");
}

// ── Template ────────────────────────────────────────────────────────────────

function fontFace(name: string, file: string, weight: string, style: string): string {
  // Inlined as base64: pages loaded via setContent() cannot fetch file:// URLs.
  const b64 = fs.readFileSync(path.join(FONTS_DIR, file)).toString("base64");
  return `@font-face { font-family: "${name}"; src: url("data:font/ttf;base64,${b64}") format("truetype"); font-weight: ${weight}; font-style: ${style}; }`;
}

const CSS = `
${fontFace("Liberation Sans", "LiberationSans-Regular.ttf", "400", "normal")}
${fontFace("Liberation Sans", "LiberationSans-Bold.ttf", "700", "normal")}
${fontFace("Liberation Sans", "LiberationSans-Italic.ttf", "400", "italic")}
${fontFace("Liberation Sans", "LiberationSans-BoldItalic.ttf", "700", "italic")}

* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: "Liberation Sans", Arial, sans-serif;
  font-size: 12.5pt;
  line-height: 1.55;
  color: ${C.ink};
  margin: 0;
}
p { margin: 0 0 0.7em; orphans: 3; widows: 3; }
strong { color: #16202b; }
a { color: ${C.navy}; }

/* ── Cover ── */
.cover {
  page-break-after: always;
  display: flex; flex-direction: column; justify-content: space-between;
  height: 9.2in; padding-top: 0.4in;
}
.cover .series {
  font-size: 11pt; letter-spacing: 0.28em; text-transform: uppercase;
  color: ${C.navy}; font-weight: 700;
}
.cover .rule { width: 52px; height: 4px; background: ${C.navy}; margin: 14px 0 42px; }
.cover .docnum {
  font-size: 92pt; font-weight: 700; color: ${C.navy}; line-height: 1;
  opacity: 0.14; margin-bottom: -18px;
}
.cover h1 { font-size: 30pt; line-height: 1.18; margin: 0 0 14px; color: #14212e; }
.cover .of { font-size: 12pt; color: ${C.slate}; }
.cover .startnote {
  margin-top: 34px; font-size: 11.5pt; color: ${C.slate};
  border-left: 3px solid ${C.line}; padding: 6px 0 6px 14px; max-width: 5.4in;
}
.cover .footerline {
  font-size: 9.5pt; color: ${C.slate}; border-top: 1px solid ${C.line};
  padding-top: 10px; letter-spacing: 0.08em; text-transform: uppercase;
}

/* ── TOC ── */
.toc { page-break-after: always; }
.toc h2 { font-size: 15pt; letter-spacing: 0.18em; text-transform: uppercase; color: ${C.navy}; }
.toc ol { list-style: none; margin: 18px 0 0; padding: 0; }
.toc li { margin: 0; border-bottom: 1px solid ${C.line}; }
.toc a {
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  text-decoration: none; color: ${C.ink}; padding: 9px 2px; font-size: 12pt;
}
.toc .n { color: ${C.navy}; font-weight: 700; min-width: 22px; }

/* ── Headings ── */
h2 {
  font-size: 17.5pt; color: ${C.navy}; line-height: 1.25;
  margin: 1.5em 0 0.5em; page-break-after: avoid;
  border-bottom: 2px solid ${C.line}; padding-bottom: 6px;
}
h3 { font-size: 13.5pt; margin: 1.2em 0 0.4em; page-break-after: avoid; }
ul, ol { margin: 0 0 0.8em; padding-left: 1.35em; }
li { margin-bottom: 0.35em; }
hr { border: none; border-top: 1px solid ${C.line}; margin: 1.4em 0; }

/* ── Generic blockquote (before/after examples) ── */
blockquote {
  margin: 0.8em 0 1em; padding: 10px 16px;
  border-left: 3px solid ${C.navy}; background: ${C.swipeBg};
  break-inside: avoid; font-size: 12pt;
}
blockquote p:last-child { margin-bottom: 0; }

/* ── Swipe blocks ── */
blockquote.swipe {
  border: 1px solid ${C.line}; border-left: 4px solid ${C.navy};
  background: ${C.swipeBg}; border-radius: 4px;
  padding: 14px 18px 12px; margin: 1em 0 1.1em; break-inside: avoid;
}
.swipe-tag {
  display: inline-block; font-size: 8.5pt; font-weight: 700;
  letter-spacing: 0.22em; text-transform: uppercase; color: #fff;
  background: ${C.navy}; border-radius: 3px; padding: 2px 9px; margin-bottom: 8px;
}
.swipe-line { font-size: 13pt; font-style: italic; margin-bottom: 0.6em; }
blockquote.swipe ul { list-style: none; padding-left: 0; margin-bottom: 0; }

/* ── The three fixed callouts ── */
li.callout {
  border: 1px solid ${C.line}; background: ${C.calloutTint};
  border-radius: 4px; padding: 7px 12px; margin: 0 0 7px; font-size: 11.5pt;
  break-inside: avoid;
}
.callout-label {
  display: inline-block; font-size: 8.5pt; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; border-radius: 3px;
  padding: 1px 8px; margin-right: 8px; vertical-align: 1px; color: #fff;
}
.callout-label-anatomy { background: ${C.anatomy}; }
.callout-label-why { background: ${C.why}; }
.callout-label-fit { background: ${C.fit}; }
li.callout-anatomy { border-left: 3px solid ${C.anatomy}; }
li.callout-why { border-left: 3px solid ${C.why}; }
li.callout-fit { border-left: 3px solid ${C.fit}; }

/* ── Recurring section panels ── */
section.panel {
  border: 1px solid ${C.line}; border-radius: 6px;
  padding: 4px 20px 12px; margin: 1.4em 0;
}
section.panel h2 { border-bottom: none; margin-top: 0.8em; }
.panel-calibration { background: ${C.calibBg}; border-left: 4px solid ${C.navy}; }
.panel-calibration h2::before { content: "◧ "; color: ${C.navy}; }
.panel-takeaways { background: ${C.takeBg}; border-left: 4px solid ${C.fit}; }
.panel-takeaways h2 { color: ${C.fit}; }
.panel-takeaways h2::before { content: "✓ "; }
.panel-danger { background: ${C.dangerBg}; border: 1.5px solid ${C.danger}; border-left: 5px solid ${C.danger}; }
.panel-danger h2 { color: ${C.danger}; }
.panel-danger h2::before { content: "⨯ "; }

/* ── Tier badges (Palette) ── */
.tier {
  display: inline-block; white-space: nowrap; font-size: 8pt; font-weight: 700;
  letter-spacing: 0.1em; border-radius: 3px; padding: 1px 7px 1px 5px;
  vertical-align: 1px; margin-right: 4px;
}
.tier .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; }
.tier-green { color: ${C.green}; border: 1px solid ${C.green}; background: #f2f8f2; }
.tier-green .dot { background: ${C.green}; }
.tier-yellow { color: ${C.yellow}; border: 1px solid ${C.yellow}; background: #fbf7ec; }
.tier-yellow .dot { background: ${C.yellow}; }

/* Word-run paragraphs in the Palette stay readable at phone width: they are
   plain wrapping text (no tables), styled as a light list box. */
.palette-doc h3 + p em, .palette-doc h3 + p { }
.palette-doc h3 + p:has(em:first-child) { }
.palette-doc p.wordrun {
  background: ${C.swipeBg}; border: 1px solid ${C.line}; border-radius: 4px;
  padding: 10px 14px; font-size: 11.5pt; line-height: 1.7;
}
`;

function buildHtml(doc: DocMeta, totalDocs: number): string {
  const { html: rawBody, toc } = renderMarkdown(doc.bodyMd);
  let body = wrapSections(applyVisualLanguage(rawBody));

  const isPalette = /word palette/i.test(doc.title);
  if (isPalette) {
    // Style the big italic word-run paragraphs as boxed lists (phone-legible
    // reflowing text, not shrunken tables).
    body = body.replace(/<p><em>([\s\S]*?)<\/em><\/p>/g, (m, inner) =>
      inner.split("·").length > 8 ? `<p class="wordrun"><em>${inner}</em></p>` : m,
    );
    body = body.replace(
      /<p>(<span class="tier[\s\S]*?)<\/p>/g,
      (m, inner) => `<p class="wordrun">${inner}</p>`,
    );
  }

  const tocHtml = toc
    .map(
      (t, i) =>
        `<li><a href="#${t.id}"><span><span class="n">${i + 1}</span> ${escapeHtml(t.text)}</a></li>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body class="${isPalette ? "palette-doc" : ""}">
  <div class="cover">
    <div>
      <div class="series">${SERIES_NAME}</div>
      <div class="rule"></div>
      <div class="docnum">${String(doc.num).padStart(2, "0")}</div>
      <h1>${escapeHtml(doc.title)}</h1>
      <div class="of">Document ${doc.num} of ${totalDocs}${isPalette ? " · Reference tool" : ""}</div>
      ${doc.startNote ? `<div class="startnote">${escapeHtml(doc.startNote)}</div>` : ""}
    </div>
    <div class="footerline">${SERIES_NAME} · ${escapeHtml(doc.title)}</div>
  </div>
  <div class="toc">
    <h2>Contents</h2>
    <ol>${tocHtml}</ol>
  </div>
  ${body}
</body></html>`;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function chromiumPath(): string {
  return execSync("which chromium").toString().trim();
}

async function main() {
  const only = process.argv[2]; // optional numeric prefix filter, e.g. "03"
  const files = fs
    .readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (files.length === 0) throw new Error(`No markdown docs found in ${DOCS_DIR}`);
  // Series guard (Task #2095): exactly 9 docs, numbered 01–09, no gaps/dupes.
  const EXPECTED_COUNT = 9;
  const prefixes = files.map((f) => f.slice(0, 2)).sort();
  const expected = Array.from({ length: EXPECTED_COUNT }, (_, i) => String(i + 1).padStart(2, "0"));
  if (files.length !== EXPECTED_COUNT || prefixes.join(",") !== expected.join(",")) {
    throw new Error(
      `Copywriting Foundations series guard: expected exactly ${EXPECTED_COUNT} docs with prefixes 01–0${EXPECTED_COUNT}, found: ${files.join(", ")}`,
    );
  }
  const docs = files.map(parseDoc);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    for (const doc of docs) {
      if (only && !doc.file.startsWith(only)) continue;
      const html = buildHtml(doc, docs.length);
      // Guard: double-escaped entities must never appear (Task #2014).
      const doubleEscaped = html.match(/&amp;(quot|#39|amp);/);
      if (doubleEscaped) {
        throw new Error(
          `Double-escaped entity "${doubleEscaped[0]}" found in rendered HTML for ${doc.file}`,
        );
      }
      await page.setContent(html, { waitUntil: "networkidle" });
      const outFile = path.join(OUT_DIR, doc.file.replace(/\.md$/, ".pdf"));
      const footer = `
        <div style="width:100%; font-size:7.5pt; font-family:'Liberation Sans',Arial,sans-serif; color:#5a6a7a; padding:0 0.75in; display:flex; justify-content:space-between;">
          <span>${SERIES_NAME} · ${escapeHtml(doc.title)}</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>`;
      await page.pdf({
        path: outFile,
        format: "Letter",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: footer,
        margin: { top: "0.75in", bottom: "0.85in", left: "0.75in", right: "0.75in" },
      });
      const kb = Math.round(fs.statSync(outFile).size / 1024);
      console.log(`✓ ${path.basename(outFile)} (${kb} KB)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
