/**
 * Generic Campaign Checklist — PDF renderer, VERSION 2 (Task #2022, PRIVATE).
 *
 * Sibling of render-campaign-checklist.ts. Reads the same canonical roadmap
 * (@workspace/campaign-roadmap) and applies v2-only presentation overrides —
 * the canonical data, the v1 script, and the committed v1 PDF are untouched.
 *
 *   pnpm --filter @workspace/scripts run render-campaign-checklist-v2-pdf
 *
 * V2 differences from v1 (all local to this script):
 *   - Subtitle: "The 17-step campaign roadmap" (no "— Build, Test, Scale").
 *   - Italic ordering note directly beneath the subtitle.
 *   - Step 1 description replaced (Finding Your Edge / 21 Day Blitz).
 *   - "Know the gates" retitled "Understand the testing reality" with a
 *     rewritten description (user-approved wording).
 *   - The two DIYTrax substeps render as ONE checkbox using the existing
 *     merged member-facing line.
 *   - Flat layout: NO phase section headers.
 *   - Step 17 (Scale) omitted entirely.
 *
 * DRIFT SAFETY: every override below is keyed to the canonical content it
 * replaces (assertCanonical). If the roadmap wording changes upstream, this
 * script FAILS LOUDLY instead of silently rendering stale overrides.
 *
 * PRIVACY: output goes to scripts/private-pdfs/ — NOT the seeded
 * artifacts/api-server/src/assets/campaign-checklist dir. No Drive seed or
 * served route references it; it is delivered to the user directly in chat.
 *
 * Toolchain: identical to v1 — HTML/CSS + headless Chromium print-to-PDF
 * (nix `chromium`, --no-sandbox), fonts inlined as base64.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { chromium } from "playwright-core";
import {
  CAMPAIGN_ROADMAP,
  CAMPAIGN_STEP_COUNT,
  type CampaignNetwork,
  type CampaignStep,
  type CampaignSubstep,
  type StepLifecycle,
} from "@workspace/campaign-roadmap";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
// PRIVATE output dir — deliberately NOT under artifacts/api-server/src/assets
// (that dir feeds the Creative Drive boot-seed). Nothing serves this path.
const OUT_DIR = path.join(REPO_ROOT, "scripts/private-pdfs");
const OUT_FILE = path.join(OUT_DIR, "campaign-checklist-v2.pdf");
const FONTS_DIR = path.join(REPO_ROOT, "scripts/pdf-assets/fonts");

const DOC_TITLE = "Campaign Checklist";
const DOC_SUBTITLE = "The 16-step campaign roadmap";
const ORDER_NOTE =
  "Note: The order of this checklist may differ from the order of the videos in the Blitz. The checklist is organized to put your initial focus where it matters most — your marketing assets.";

// ── V2 overrides, keyed to the canonical content they replace ───────────────

/** Fail loudly if the canonical value an override was written against drifts. */
function assertCanonical(label: string, actual: string | undefined, expected: string): void {
  if (actual !== expected) {
    throw new Error(
      `V2 override drift: ${label} changed upstream.\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}\nUpdate the v2 override in render-campaign-checklist-v2.ts deliberately.`,
    );
  }
}

const ORIENT_DESC_V2 = 'Familiarize yourself with "Finding Your Edge" and "The 21 Day Blitz"';
const GATES_TITLE_V2 = "Understand the testing reality";
const GATES_DESC_V2 =
  "Each round of testing has its own budget and purpose. Moving from one round to the next is not automatic — it requires favorable results before you advance.";
const GATES_CHECKBOX_V2 = "Review Caterpillar Round 1/2/3 budget and testing guidelines";
const ROUND2_TITLE_V2 = "Round 2 — image test";
const CATERPILLAR_TRAFFIC_NOTE_V2 =
  ' (before creating ads, make sure campaign is "active" in Basic Settings tab, and subcampaigns are set to "off" until all ads are approved and you have completed the final QA)';

function verifyCanonicalAnchors(): void {
  const byId = new Map(CAMPAIGN_ROADMAP.map((s) => [s.id, s]));

  const orient = byId.get("orient");
  assertCanonical(
    'step "orient" description',
    orient?.description,
    "Start with the 7 Pillars and the three-phase path (Build → Test → Scale).",
  );

  const gates = byId.get("know-the-gates");
  assertCanonical('step "know-the-gates" title', gates?.title, "Know the gates");
  assertCanonical(
    'step "know-the-gates" description',
    gates?.description,
    "Each phase has an exit gate; know the testing budgets before you start; compliance approval is required before any ad creative or landing page creative runs.",
  );

  const scale = byId.get("scale");
  assertCanonical('step 17 id "scale" title', scale?.title, "Scale");
  if (scale?.number !== CAMPAIGN_STEP_COUNT) {
    throw new Error(`V2 override drift: "scale" is no longer the final step (#${scale?.number})`);
  }

  const round1 = byId.get("round-1-headline-test");
  assertCanonical(
    'step "round-1-headline-test" description',
    round1?.description,
    "Prepare Round 2 image assets while Round 1 runs.",
  );

  const round2 = byId.get("round-2-image-test");
  assertCanonical(
    'step "round-2-image-test" title',
    round2?.title,
    "Round 2 — image (visual creative) test",
  );

  const trafficTab = byId
    .get("caterpillar-go-live")
    ?.substeps.find((s) => s.substepId === "caterpillar-go-live-traffic-source-tab");
  assertCanonical(
    "caterpillar traffic-source substep",
    trafficTab?.action,
    "Configure the Traffic Source tab for Caterpillar: select product, create subcampaigns, create ads.",
  );

  // Merged DIYTrax line: both group members + the merged member action.
  const diytrax = byId.get("create-diytrax-campaign");
  const create = diytrax?.substeps.find((s) => s.substepId === "create-diytrax-campaign-create");
  const basic = diytrax?.substeps.find((s) => s.substepId === "create-diytrax-campaign-basic-info");
  assertCanonical(
    "diytrax merge groups",
    `${create?.member?.mergeGroup}|${basic?.member?.mergeGroup}`,
    "diytrax-create-basic-info|diytrax-create-basic-info",
  );
  assertCanonical(
    "diytrax merged member line",
    create?.member?.action,
    "Create the campaign in DIYTrax and fill in the Basic Info tab (and save).",
  );
}

/** The 16 steps this PDF renders (Scale intentionally omitted). */
function v2Steps(): CampaignStep[] {
  return CAMPAIGN_ROADMAP.filter((s) => s.id !== "scale");
}

// ── De-branding (identical to v1) ───────────────────────────────────────────

function deBrand(s: string): string {
  return s
    .replace(/Behind the Scenes\s*/gi, "")
    .replace(/\bBTS\b\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Content assembly ────────────────────────────────────────────────────────

const NETWORK_TAG: Record<CampaignNetwork, string> = {
  "media-mavens": "MM",
  clickbank: "CB",
};

const LIFECYCLE_LABEL: Record<Exclude<StepLifecycle, "per-campaign">, string> = {
  "one-time-initial": "One-time setup",
  "one-time-brand-domain": "Once per brand domain",
};

/**
 * V2: unlike v1, merge-group substeps DO collapse into the shared merged
 * member-facing line — the first group member renders it, later members are
 * skipped (see stepSubstepLines).
 */
function substepText(sub: CampaignSubstep): string {
  const base = sub.member?.action !== undefined ? deBrand(sub.member.action) : deBrand(sub.action);
  // V2: appended operational note on the Caterpillar Traffic Source line.
  if (sub.substepId === "caterpillar-go-live-traffic-source-tab") {
    return base + CATERPILLAR_TRAFFIC_NOTE_V2;
  }
  return base;
}

function stepTitle(step: CampaignStep): string {
  if (step.id === "know-the-gates") return GATES_TITLE_V2;
  if (step.id === "round-2-image-test") return ROUND2_TITLE_V2;
  return deBrand(step.member?.title ?? step.title);
}

function stepDescription(step: CampaignStep): string | undefined {
  if (step.id === "orient") return ORIENT_DESC_V2;
  if (step.id === "know-the-gates") return GATES_DESC_V2;
  if (step.id === "round-1-headline-test") return undefined; // V2: description dropped.
  const d = step.member?.description ?? step.description;
  return d === undefined ? undefined : deBrand(d);
}

/** V2 checkbox text for a step with no substeps: no "Complete:" prefix. */
function stepCheckboxText(step: CampaignStep): string {
  if (step.id === "know-the-gates") return GATES_CHECKBOX_V2;
  return stepTitle(step);
}

function tagHtml(text: string, cls: string): string {
  return `<span class="tag tag-${cls}">${escapeHtml(text)}</span>`;
}

function lifecycleTagHtml(lifecycle: StepLifecycle): string {
  if (lifecycle === "per-campaign") return "";
  return tagHtml(LIFECYCLE_LABEL[lifecycle], "life");
}

function checkboxLine(text: string, network: CampaignNetwork | undefined, lifecycle: StepLifecycle): string {
  const net = network ? tagHtml(`[${NETWORK_TAG[network]}]`, network === "clickbank" ? "cb" : "mm") : "";
  return `<li class="item"><span class="box"></span><span class="itemtext">${net}${escapeHtml(
    text,
  )} ${lifecycleTagHtml(lifecycle)}</span></li>`;
}

/** Substep lines for a step, collapsing merge groups to ONE checkbox. */
function stepSubstepLines(step: CampaignStep): string[] {
  const seenGroups = new Set<string>();
  const lines: string[] = [];
  for (const sub of step.substeps) {
    const group = sub.member?.mergeGroup;
    if (group !== undefined) {
      if (seenGroups.has(group)) continue;
      seenGroups.add(group);
    }
    lines.push(checkboxLine(substepText(sub), sub.network, sub.lifecycle));
  }
  return lines;
}

function buildBody(): string {
  const out: string[] = [];
  // V2: flat layout — no phase headers.
  for (const step of v2Steps()) {
    const desc = stepDescription(step);
    out.push(`<section class="step">`);
    out.push(
      `<div class="stephead"><span class="stepnum">${step.number}</span><h3 class="steptitle">${escapeHtml(
        stepTitle(step),
      )} ${lifecycleTagHtml(step.lifecycle)}</h3></div>`,
    );
    if (desc) out.push(`<p class="stepdesc">${escapeHtml(desc)}</p>`);
    if (step.substeps.length === 0) {
      out.push(`<ul class="items">${checkboxLine(stepCheckboxText(step), undefined, step.lifecycle)}</ul>`);
    } else {
      out.push(`<ul class="items">${stepSubstepLines(step).join("\n")}</ul>`);
    }
    out.push(`</section>`);
  }
  return out.join("\n");
}

// ── Template (identical styling to v1, plus the ordernote rule) ─────────────

function fontFace(name: string, file: string, weight: string, style: string): string {
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
  font-size: 11.5pt; line-height: 1.5; color: #222; margin: 0;
}

/* ── Title block + legend (page 1, no separate cover page) ── */
.titleblock { border-bottom: 3px solid #222; padding-bottom: 14px; margin-bottom: 16px; }
h1 { font-size: 26pt; margin: 0 0 4px; color: #111; }
.subtitle { font-size: 12.5pt; color: #555; }
.ordernote { font-size: 10.5pt; color: #555; font-style: italic; margin-top: 8px; }
.legend {
  border: 1px solid #bbb; border-radius: 4px; background: #f6f6f6;
  padding: 10px 14px; margin: 0 0 20px; font-size: 10.5pt; break-inside: avoid;
}
.legend h4 { margin: 0 0 6px; font-size: 10.5pt; text-transform: uppercase; letter-spacing: 0.12em; color: #444; }
.legend p { margin: 0 0 4px; }
.legend p:last-child { margin-bottom: 0; }

/* ── Steps (flat — no phase headers in v2) ── */
section.step { break-inside: avoid; margin: 0 0 14px; }
.stephead { display: flex; align-items: baseline; gap: 10px; page-break-after: avoid; }
.stepnum {
  flex: none; width: 26px; height: 26px; border: 1.5px solid #444; border-radius: 50%;
  text-align: center; line-height: 24px; font-weight: 700; font-size: 11.5pt; color: #333;
  align-self: center;
}
h3.steptitle { font-size: 13pt; margin: 0; color: #111; }
p.stepdesc { margin: 4px 0 4px 36px; color: #555; font-size: 10.5pt; }

/* ── Checkbox lines ── */
ul.items { list-style: none; margin: 6px 0 0; padding: 0 0 0 36px; }
li.item { display: flex; gap: 9px; margin: 0 0 7px; break-inside: avoid; }
.box {
  flex: none; width: 13px; height: 13px; border: 1.4px solid #555; border-radius: 2px;
  margin-top: 3px; background: #fff;
}
.itemtext { flex: 1; }

/* ── Tags ── */
.tag {
  display: inline-block; font-size: 8pt; font-weight: 700; letter-spacing: 0.06em;
  border-radius: 3px; padding: 0px 6px; vertical-align: 1px; white-space: nowrap;
}
.tag-mm { color: #222; border: 1px solid #777; background: #eee; margin-right: 7px; }
.tag-cb { color: #222; border: 1px solid #777; background: #fff; margin-right: 7px; }
.tag-life { color: #555; border: 1px solid #aaa; background: #f7f7f7; margin-left: 4px; font-weight: 400; }
`;

function buildHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body>
  <div class="titleblock">
    <h1>${escapeHtml(DOC_TITLE)}</h1>
    <div class="subtitle">${escapeHtml(DOC_SUBTITLE)}</div>
    <div class="ordernote">${escapeHtml(ORDER_NOTE)}</div>
  </div>
  <div class="legend">
    <h4>How to read this checklist</h4>
    <p><strong>[MM]</strong> = Media Mavens · <strong>[CB]</strong> = ClickBank. Items tagged [MM] or [CB] apply only to that affiliate network — items with no tag apply to both.</p>
    <p><strong>One-time setup</strong> = done once ever, during initial setup. <strong>Once per brand domain</strong> = done once for each brand domain you use. Everything else repeats for every new campaign.</p>
  </div>
  ${buildBody()}
</body></html>`;
}

// ── Guards (v2-adjusted: 16 steps, merged DIYTrax line, no phase headers) ───

function plainText(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function runGuards(html: string): void {
  const text = plainText(html);

  // 1. No brand mentions anywhere in rendered text.
  if (/\bBTS\b/.test(text) || /behind the scenes/i.test(text)) {
    throw new Error('Brand guard failed: rendered checklist text contains "BTS" or "Behind the Scenes"');
  }

  // 2. Coverage: all steps except the intentionally-omitted Scale step; every
  //    substep covered either directly or via its merged member line.
  if (CAMPAIGN_ROADMAP.length !== CAMPAIGN_STEP_COUNT) {
    throw new Error(`Roadmap has ${CAMPAIGN_ROADMAP.length} steps, expected ${CAMPAIGN_STEP_COUNT}`);
  }
  const steps = v2Steps();
  if (steps.length !== CAMPAIGN_STEP_COUNT - 1) {
    throw new Error(`V2 expects ${CAMPAIGN_STEP_COUNT - 1} rendered steps, got ${steps.length}`);
  }
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const haystack = normalize(text);
  for (const step of steps) {
    if (!haystack.includes(normalize(stepTitle(step)))) {
      throw new Error(`Coverage guard failed: step title missing for "${step.id}"`);
    }
    for (const sub of step.substeps) {
      // Merge-group members are covered by the group's ONE rendered line
      // (the first member's display text).
      const group = sub.member?.mergeGroup;
      const rendered =
        group === undefined
          ? sub
          : step.substeps.find((s) => s.member?.mergeGroup === group) ?? sub;
      if (!haystack.includes(normalize(substepText(rendered)))) {
        throw new Error(`Coverage guard failed: substep missing "${sub.substepId}"`);
      }
    }
  }

  // 3. V2-specific assertions.
  if (haystack.includes("Build, Test, Scale")) {
    throw new Error('V2 guard failed: subtitle still contains "Build, Test, Scale"');
  }
  if (/Phase \d —/.test(haystack)) {
    throw new Error("V2 guard failed: phase section headers present");
  }
  if (haystack.includes("Complete:")) {
    throw new Error('V2 guard failed: "Complete:" checkbox prefix still rendered');
  }
  if (haystack.includes("Prepare Round 2 image assets")) {
    throw new Error("V2 guard failed: Round 1 description still rendered");
  }
  if (haystack.includes("(visual creative)")) {
    throw new Error('V2 guard failed: "(visual creative)" still rendered');
  }
  for (const needle of [
    ORDER_NOTE,
    ORIENT_DESC_V2,
    GATES_TITLE_V2,
    GATES_DESC_V2,
    GATES_CHECKBOX_V2,
    ROUND2_TITLE_V2,
    CATERPILLAR_TRAFFIC_NOTE_V2.trim(),
  ]) {
    if (!haystack.includes(normalize(needle))) {
      throw new Error(`V2 guard failed: required v2 text missing: "${needle.slice(0, 60)}..."`);
    }
  }
  if (haystack.includes("Know the gates")) {
    throw new Error('V2 guard failed: old "Know the gates" title still rendered');
  }
  // Scale step omitted (its unique description must not appear).
  if (haystack.includes("Master Publisher")) {
    throw new Error("V2 guard failed: Scale step content leaked into the PDF");
  }
  // Merged DIYTrax line rendered ONCE; unmerged siblings absent.
  const mergedLine = "Create the campaign in DIYTrax and fill in the Basic Info tab (and save).";
  const occurrences = haystack.split(mergedLine).length - 1;
  if (occurrences !== 1) {
    throw new Error(`V2 guard failed: merged DIYTrax line appears ${occurrences}× (expected 1)`);
  }

  // 4. Both network tags + legend present.
  for (const needle of ["[MM]", "[CB]", "Media Mavens", "ClickBank"]) {
    if (!haystack.includes(needle)) {
      throw new Error(`Legend guard failed: "${needle}" missing from rendered text`);
    }
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

function chromiumPath(): string {
  return execSync("which chromium").toString().trim();
}

async function main() {
  verifyCanonicalAnchors();
  const html = buildHtml();
  runGuards(html);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const footer = `
      <div style="width:100%; font-size:7.5pt; font-family:'Liberation Sans',Arial,sans-serif; color:#666; padding:0 0.75in; display:flex; justify-content:space-between;">
        <span>${escapeHtml(DOC_TITLE)}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`;
    await page.pdf({
      path: OUT_FILE,
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: footer,
      margin: { top: "0.75in", bottom: "0.85in", left: "0.75in", right: "0.75in" },
    });
    const kb = Math.round(fs.statSync(OUT_FILE).size / 1024);
    console.log(`✓ ${path.basename(OUT_FILE)} (${kb} KB)`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
