import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const outPath = path.join(
  REPO_ROOT,
  "artifacts/portal/public/docs/tips-and-tricks-categorization-sop.pdf"
);

const doc = new PDFDocument({ margin: 50, size: "LETTER" });
const stream = fs.createWriteStream(outPath);
doc.pipe(stream);

const GRAY = "#444444";
const BLACK = "#111111";
const BLUE = "#1a3a5c";

function heading1(text) {
  doc.moveDown(0.5);
  doc.fontSize(16).font("Helvetica-Bold").fillColor(BLUE).text(text);
  doc.moveDown(0.3);
}

function heading2(text) {
  doc.moveDown(0.4);
  doc.fontSize(12).font("Helvetica-Bold").fillColor(BLACK).text(text);
  doc.moveDown(0.2);
}

function body(text, opts = {}) {
  doc.fontSize(10).font("Helvetica").fillColor(GRAY).text(text, { lineGap: 3, ...opts });
}

function bullet(text, indent = 10) {
  doc.fontSize(10).font("Helvetica").fillColor(GRAY).text(`\u2022  ${text}`, { indent, lineGap: 3 });
}

function numberedItem(n, text, indent = 10) {
  doc.fontSize(10).font("Helvetica").fillColor(GRAY).text(`${n}.  ${text}`, { indent, lineGap: 3 });
}

function tableRow(col1, col2, isHeader = false) {
  const font = isHeader ? "Helvetica-Bold" : "Helvetica";
  const color = isHeader ? BLACK : GRAY;
  const x = doc.page.margins.left;
  const colW = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2;
  const y = doc.y;
  doc.font(font).fontSize(10).fillColor(color);
  doc.text(col1, x, y, { width: colW - 10, lineGap: 2 });
  const leftH = doc.y;
  doc.text(col2, x + colW, y, { width: colW, lineGap: 2 });
  const rightH = doc.y;
  doc.y = Math.max(leftH, rightH) + 4;
}

function hr() {
  doc.moveDown(0.3);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor("#cccccc")
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.3);
}

// ── Title ──────────────────────────────────────────────────────────────────
doc.fontSize(20).font("Helvetica-Bold").fillColor(BLUE).text("Tips-and-Tricks Categorization SOP", { align: "center" });
doc.moveDown(0.3);
doc
  .fontSize(9)
  .font("Helvetica")
  .fillColor(GRAY)
  .text(
    "Audience: Any BTS admin reviewing KB drafts  ·  Applies to: weekly tips content (Nano Banana, Grok, Anstrex, headlines)  ·  Where: Admin → Knowledge Base → Document Review",
    { align: "center" }
  );
doc.moveDown(0.8);
hr();

// ── What tips content is ──────────────────────────────────────────────────
heading1("What \u201Ctips and tricks\u201D content is");
body(
  "Short, tool-driven walkthroughs that show a member how to get one specific thing done \u2014 usually make or improve a creative, or write copy \u2014 often with a named piece of software. Not full curriculum modules and not coaching-call recordings. Current examples:"
);
doc.moveDown(0.2);
bullet("Nano Banana \u2014 make / resize ad creatives in Google AI Studio (Gemini).");
bullet("Grok Imagine \u2014 turn a static image into a short video / animated GIF.");
bullet("Anstrex + Claude \u2014 find winning native ads and rewrite the copy.");
bullet("Headlines in a specific style \u2014 generate headlines with Claude using the copy docs.");
bullet("Caterpillar creative optimization \u2014 refresh a working campaign\u2019s creatives with AI.");
hr();

// ── The two things that never change ───────────────────────────────────────
heading1("The fields you leave as-is (set at intake)");
tableRow("Field", "Value / Why", true);
doc.moveDown(0.1);
tableRow("Format (source folder)", "Other Video (other_video) \u2014 short single-presenter videos.");
doc.moveDown(0.1);
tableRow("Authority", "Curriculum \u2014 a BTS presenter is teaching; no dialogue to attribute.");
doc.moveDown(0.1);
tableRow("Doc class", "transcript (training-only, NON-CITABLE) \u2014 tips are mined as source, never cited to members. Do not promote to curated/overview.");
doc.moveDown(0.3);
body("If any of these arrive set to something else, correct them back to the values above.");
hr();

// ── The decision ───────────────────────────────────────────────────────────
heading1("The one decision you make: home root + node");
heading2("Step 1 \u2014 Pick the home root");
body("Ask: is this a repeatable step in building a campaign, or a transferable skill?");
doc.moveDown(0.2);
bullet("A repeatable campaign build step (\u201Cdo this, then this to produce the asset\u201D) \u2192 Process (process).");
bullet("A cross-campaign skill or principle (how to think about copy / angles / testing) \u2192 Concepts & Skills (concepts).");
bullet("Tips are almost never Operations (that root is membership / billing / support).");

heading2("Step 2 \u2014 Pick the dominant node");
body("Process nodes (most tips land here):");
doc.moveDown(0.1);
bullet("creative-assets \u2014 THE DEFAULT for tips. Making, resizing, animating, or editing images / video / GIFs.");
bullet("Other process nodes only if clearly that stage: tracking-and-setup, launch, testing, scaling, network-and-offer, foundations, compliance.");
doc.moveDown(0.2);
body("Concepts nodes (skill/principle tips):");
doc.moveDown(0.1);
bullet("headlines-and-copy \u2014 writing headlines, descriptions, ad copy.");
bullet("creative-strategy \u2014 how to THINK about creatives (vs the mechanical steps of building one).");
bullet("testing-methodology \u2014 how to structure / read tests.");
bullet("angles \u2014 choosing the marketing angle.");

heading2("Step 3 \u2014 One tip, one dominant node");
body(
  "A tip often touches several nodes. Pick the SINGLE most dominant node \u2014 the thing the tip is really teaching. Do not record every related node here; secondary links are added later, automatically, at synthesis."
);
doc.moveDown(0.2);
body(
  "Rule of thumb: if the payoff is an ASSET you produced, it\u2019s Process / creative-assets. If the payoff is a WAY OF WRITING OR THINKING you\u2019d reuse, it\u2019s a Concepts node."
);
hr();

// ── Software is a tag ──────────────────────────────────────────────────────
heading1("Software is a tool tag, never a node");
body(
  "The specific software a tip uses (Nano Banana, Grok, Claude, Anstrex, Canva\u2026) is a tool TAG, not a node. Never create or pick a node named after a tool."
);
doc.moveDown(0.2);
bullet("If the tool is already in the tag list, add it as a tag (0\u20134 tags per doc).");
bullet("If the tool is new, the AI analysis records it in the tool-tag PROPOSAL QUEUE for an admin to approve \u2014 it does not become a live tag on its own.");
hr();

// ── Worked examples ────────────────────────────────────────────────────────
heading1("Worked examples (the current queue)");
tableRow("Tip \u2014 Home root / Node", "Tool tags / Why", true);
doc.moveDown(0.1);
tableRow("Nano Banana \u2014 process / creative-assets", "nano-banana, caterpillar \u2014 produces an ad image (build step).");
doc.moveDown(0.1);
tableRow("Grok Imagine \u2014 process / creative-assets", "grok \u2014 produces a video/GIF creative (build step).");
doc.moveDown(0.1);
tableRow("Anstrex + Claude \u2014 concepts / headlines-and-copy", "anstrex, claude \u2014 teaches how to write copy (reusable skill).");
doc.moveDown(0.1);
tableRow("Headlines in a specific style \u2014 concepts / headlines-and-copy", "claude \u2014 teaches a headline-writing method (reusable skill).");
doc.moveDown(0.1);
tableRow("Caterpillar creative optimization \u2014 process / creative-assets", "caterpillar \u2014 refreshes/edits campaign creatives (build step).");
doc.moveDown(0.3);
body(
  "Each also links to a secondary node in real life (e.g. the Anstrex tip touches creative-strategy). You still pick only the dominant node \u2014 synthesis handles the rest."
);
hr();

// ── Nothing auto-publishes ─────────────────────────────────────────────────
heading1("Nothing auto-publishes");
body(
  "The AI analysis only SUGGESTS the home root, node, tags, and cleaned title. Every suggestion lands in needs_review for you to accept or change, and nothing goes to members until a human approves it. Edit any suggestion you disagree with \u2014 your choice is the one that sticks."
);

doc.end();

stream.on("finish", () => {
  console.log(`PDF written to ${outPath}`);
});
stream.on("error", (err) => {
  console.error("PDF write error:", err);
  process.exit(1);
});
