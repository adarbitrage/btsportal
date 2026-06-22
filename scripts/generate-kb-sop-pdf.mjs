import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const outPath = path.join(
  REPO_ROOT,
  "artifacts/portal/public/docs/kb-weekly-maintenance-sop.pdf"
);

const doc = new PDFDocument({ margin: 50, size: "LETTER" });
const stream = fs.createWriteStream(outPath);
doc.pipe(stream);

const GRAY = "#444444";
const BLACK = "#111111";
const BLUE = "#1a3a5c";

function heading1(text) {
  doc.moveDown(0.5);
  doc
    .fontSize(16)
    .font("Helvetica-Bold")
    .fillColor(BLUE)
    .text(text);
  doc.moveDown(0.3);
}

function heading2(text) {
  doc.moveDown(0.5);
  doc
    .fontSize(12)
    .font("Helvetica-Bold")
    .fillColor(BLACK)
    .text(text);
  doc.moveDown(0.2);
}

function body(text, opts = {}) {
  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor(GRAY)
    .text(text, { lineGap: 3, ...opts });
}

function bullet(text, indent = 10) {
  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor(GRAY)
    .text(`\u2022  ${text}`, { indent, lineGap: 3 });
}

function numberedItem(n, text, indent = 10) {
  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor(GRAY)
    .text(`${n}.  ${text}`, { indent, lineGap: 3 });
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
doc
  .fontSize(20)
  .font("Helvetica-Bold")
  .fillColor(BLUE)
  .text("Weekly Knowledge Base Maintenance SOP", { align: "center" });
doc.moveDown(0.3);
doc
  .fontSize(9)
  .font("Helvetica")
  .fillColor(GRAY)
  .text(
    "Audience: Any BTS admin  ·  Cadence: Once per week (Mon/Tue recommended)  ·  Time: ~15–30 min for a healthy queue",
    { align: "center" }
  );
doc.moveDown(0.8);
hr();

// ── What Feeds the Knowledge Base ─────────────────────────────────────────
heading1("What Feeds the Knowledge Base");
body("Here's what actually feeds the KB:");
doc.moveDown(0.2);
bullet(
  "Coaching call transcripts — 1-on-1 session recordings get parsed and turned into teaching/troubleshooting docs."
);
bullet(
  "Blitz training videos — video audio is transcribed and converted into structured guides."
);
bullet(
  "General video transcripts — bulk transcript files processed into KB-ready docs."
);
bullet(
  "Manual admin actions — merging duplicate docs, or adding/editing a doc by hand on the Live Documents page."
);
bullet("Seed data — baseline docs loaded during setup.");
hr();

// ── How the Auto-Triage System Works ──────────────────────────────────────
heading1("How the Auto-Triage System Works");
body(
  "New KB documents land in a staging area and are auto-scored by AI before a human sees them:"
);
doc.moveDown(0.4);
tableRow("AI outcome", "What happens automatically / What you do", true);
doc.moveDown(0.1);
tableRow(
  "High-confidence approve (≥ 85%)",
  "Auto-approved and queued for push. Nothing — verify in audit log if you want."
);
doc.moveDown(0.1);
tableRow(
  "Low-confidence reject (≤ 20%)",
  "Auto-rejected. Nothing — optionally audit and undo."
);
doc.moveDown(0.1);
tableRow(
  "In-between",
  "Flagged as needs_review. This is your weekly job."
);
doc.moveDown(0.4);
body(
  "Your only recurring task is clearing the needs_review queue. Pushed docs go live to the AI assistant immediately — no restart needed."
);
hr();

// ── Weekly Routine ─────────────────────────────────────────────────────────
heading1("Weekly Routine (Checklist)");
numberedItem(1, "Navigate — Admin panel → Knowledge Base → Document Review");
numberedItem(
  2,
  "Check the triage banner — Wait if triage is running; click Run AI Triage to score new arrivals first"
);
numberedItem(
  3,
  "Clear the needs_review queue — Use Review Queue guided mode. For each doc: approve (A), reject (R), edit inline (E, auto-approves), or Merge duplicates. Shortcuts: A/R/E · →/N next · ←/P previous"
);
numberedItem(
  4,
  "Push live — Click Push N to KB (pushes both human- and AI-approved docs at once)"
);
numberedItem(
  5,
  "Spot-check the assistant — Ask the member-facing chat a couple of questions on what you just pushed; fix via Live Documents if wrong"
);
numberedItem(
  6,
  "Quick audit (optional) — View Audit Log to review AI auto-actions; Undo anything wrong"
);
hr();

// ── Understanding the Page Controls ───────────────────────────────────────
heading1("Understanding the Page Controls");
body("Two buttons on the Document Review page only appear conditionally:");
doc.moveDown(0.2);
bullet(
  '"Review Queue (N)" — only shows up when there are documents waiting in the needs_review queue. If nothing currently needs review, the button is hidden.'
);
bullet(
  '"Push N to KB" — only shows up when there are approved documents ready to push. If you haven\'t approved anything (or AI hasn\'t auto-approved anything), it\'s hidden too.'
);
doc.moveDown(0.3);
body("The other controls are always there in the top-right of the page:");
doc.moveDown(0.2);
bullet("Run AI Triage (scores pending docs)");
bullet("Settings (the gear icon — auto-approve / auto-reject thresholds)");
bullet("View Audit Log (appears in the triage results banner)");
bullet("Merge (appears once you select two or more docs in the list)");
bullet(
  "The A / R / E and →/N · ←/P keyboard shortcuts work once you're inside Review Queue guided mode."
);
doc.moveDown(0.3);
body(
  "Note on View Audit Log: it only shows up after a triage run actually auto-approves or auto-rejects something. If everything is already pushed (nothing pending or needing review), there's nothing to report, so the banner — and the button — stay hidden. Add new docs, click Run AI Triage, and it'll reappear."
);
hr();

// ── Run Pipeline ───────────────────────────────────────────────────────────
heading1("Run Pipeline");
body(
  "The Run Pipeline button converts raw coaching-video transcripts into clean, structured knowledge-base draft articles. When clicked it:"
);
doc.moveDown(0.2);
numberedItem(1, "Reads the stored raw video transcripts.");
numberedItem(2, "Cleans them (removes filler words and messy speech).");
numberedItem(
  3,
  "Rewrites each one with AI into a structured training document (title, category, headings, numbered steps, key takeaways) with BTS branding enforced."
);
numberedItem(
  4,
  'Saves the results to the staging area as "pending review" (nothing goes live automatically).'
);
numberedItem(
  5,
  "Auto-triages the new drafts (auto-approve or flag for human review)."
);
doc.moveDown(0.4);
body(
  "It runs in the background. It will NOT run if the staging area already has documents — it stops and asks you to clear staging first, so clicking it repeatedly is safe (no duplicates). To publish reviewed drafts, use the separate \"Push to KB\" button."
);
doc.moveDown(0.3);
body(
  "Use this only when there are new raw transcripts to import; it is not a day-to-day action.",
  { continued: false }
);
hr();

// ── Managing Live Documents ────────────────────────────────────────────────
heading1("Managing Live Documents");
body(
  "Knowledge Base → Live Documents: search/filter, edit (live immediately), add manually, or delete."
);
doc.moveDown(0.2);
heading2("Categories:");
bullet("FAQ");
bullet("Platform Guide");
bullet("Marketing");
bullet("Compliance");
bullet("Advanced Strategy");
bullet("Troubleshooting");
hr();

// ── One-Time Backlog Cleanup ───────────────────────────────────────────────
heading1("One-Time Backlog Cleanup");
body(
  "Use this mode when the needs_review queue has piled up — for example, if it was ignored for a while. It's a temporary catch-up routine, not your regular weekly cadence:"
);
doc.moveDown(0.4);
tableRow("Step", "What it means", true);
doc.moveDown(0.1);
tableRow(
  "Run AI Triage first to shrink the queue",
  "Let the AI score everything in staging before you start manually reviewing. This auto-approves high-confidence docs and auto-rejects low-confidence ones, leaving only the genuinely ambiguous ones for you."
);
doc.moveDown(0.1);
tableRow(
  "Work needs_review in guided-mode sessions (prioritize coaching-call content)",
  "Go through what's left using Review Queue guided mode. If time is limited, tackle coaching-call documents first — they tend to be highest-value for the assistant's accuracy."
);
doc.moveDown(0.1);
tableRow(
  "Push incrementally",
  "Push batches as you go rather than waiting for the whole backlog to clear, so the assistant benefits from approved content right away."
);
doc.moveDown(0.1);
tableRow(
  "Repeat daily until clear, then return to weekly cadence",
  "Keep doing this once a day (instead of once a week) until the backlog is fully worked through, then go back to the normal Mon/Tue weekly routine."
);
hr();

// ── Adjusting AI Triage Thresholds ────────────────────────────────────────
heading1("Adjusting AI Triage Thresholds (Admin Only)");
body("Document Review → Settings (gear icon):");
doc.moveDown(0.2);
bullet("Auto-approve threshold (default 85%)");
bullet("Auto-reject threshold (default 20%)");
doc.moveDown(0.3);
body("Save and re-run triage to apply.");

doc.end();

stream.on("finish", () => {
  console.log(`PDF written to ${outPath}`);
});
stream.on("error", (err) => {
  console.error("PDF write error:", err);
  process.exit(1);
});
