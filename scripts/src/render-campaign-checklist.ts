/**
 * Generic Campaign Checklist — PDF renderer (Task #2020).
 *
 * Renders the canonical 17-step campaign roadmap (@workspace/campaign-roadmap
 * — NEVER hand-copied text) into a clean, brand-neutral, print-friendly
 * checklist PDF for release to TCE members. One command regenerates it:
 *
 *   pnpm --filter @workspace/scripts run render-campaign-checklist-pdf
 *
 * Design constraints (deliberate):
 *   - NEUTRAL: no logo, no brand palette, no "BTS"/"Behind the Scenes"
 *     anywhere (a guard below fails the build if either string leaks into the
 *     rendered text). Tool names (DIYTrax, Flexy, MetricMover, Caterpillar,
 *     Grasshopper, Crane, Bridge Page Copy Bot, ...) are kept as-is.
 *   - ONE PDF for both networks: [MM]/[CB] tags on branch-specific lines,
 *     with an intro legend ([MM] = Media Mavens, [CB] = ClickBank; untagged
 *     items apply to both).
 *   - Lifecycle context preserved: one-time vs per-brand-domain vs
 *     per-campaign, via compact tags + the legend.
 *   - Steps grouped by phase (Build → Test → Scale), all 17 steps and every
 *     canonical substep rendered as a checkbox line (guard-verified).
 *
 * Toolchain: HTML/CSS + headless Chromium print-to-PDF (playwright-core
 * driving the nix `chromium` binary with --no-sandbox — the bundled
 * Playwright build lacks libgbm here), fonts inlined as base64 (setContent()
 * pages cannot fetch file:// URLs). The PDF is generated at BUILD time and
 * committed — prod never runs Chromium.
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
const OUT_DIR = path.join(REPO_ROOT, "artifacts/api-server/src/assets/campaign-checklist");
const OUT_FILE = path.join(OUT_DIR, "campaign-checklist.pdf");
const FONTS_DIR = path.join(REPO_ROOT, "scripts/pdf-assets/fonts");

const DOC_TITLE = "Campaign Checklist";
const DOC_SUBTITLE = "The 17-step campaign roadmap — Build, Test, Scale";

// ── De-branding ─────────────────────────────────────────────────────────────

/** Strip brand mentions from any rendered string (light-touch, word-safe). */
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

// ── Content assembly (canonical data only) ──────────────────────────────────

const NETWORK_TAG: Record<CampaignNetwork, string> = {
  "media-mavens": "MM",
  clickbank: "CB",
};

const LIFECYCLE_LABEL: Record<Exclude<StepLifecycle, "per-campaign">, string> = {
  "one-time-initial": "One-time setup",
  "one-time-brand-domain": "Once per brand domain",
};

/**
 * Display text for a substep: prefer the shared member-facing override when
 * present (it reads better for members), EXCEPT for merge-group substeps —
 * the merged member line would duplicate its sibling substep, and this PDF
 * renders every canonical substep as its own checkbox. Per-network overrides
 * are skipped: this single PDF covers both networks via canonical wording
 * (which already carries its own [MM]/[CB] cues) plus line tags.
 */
function substepText(sub: CampaignSubstep): string {
  if (sub.member?.mergeGroup === undefined && sub.member?.action !== undefined) {
    return deBrand(sub.member.action);
  }
  return deBrand(sub.action);
}

function stepTitle(step: CampaignStep): string {
  return deBrand(step.member?.title ?? step.title);
}

function stepDescription(step: CampaignStep): string | undefined {
  // Shared member description wins; per-network variants are skipped (one
  // PDF covers both networks) — fall back to canonical.
  const d = step.member?.description ?? step.description;
  return d === undefined ? undefined : deBrand(d);
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

const PHASE_LABELS: Record<string, string> = {
  build: "Phase 1 — Build",
  test: "Phase 2 — Test",
  scale: "Phase 3 — Scale",
};

function buildBody(): string {
  const out: string[] = [];
  let currentPhase: string | null = null;
  for (const step of CAMPAIGN_ROADMAP) {
    if (step.phase !== currentPhase) {
      currentPhase = step.phase;
      out.push(`<h2 class="phase">${escapeHtml(PHASE_LABELS[currentPhase])}</h2>`);
    }
    const desc = stepDescription(step);
    out.push(`<section class="step">`);
    out.push(
      `<div class="stephead"><span class="stepnum">${step.number}</span><h3 class="steptitle">${escapeHtml(
        stepTitle(step),
      )} ${lifecycleTagHtml(step.lifecycle)}</h3></div>`,
    );
    if (desc) out.push(`<p class="stepdesc">${escapeHtml(desc)}</p>`);
    if (step.substeps.length === 0) {
      out.push(`<ul class="items">${checkboxLine(`Complete: ${stepTitle(step)}`, undefined, step.lifecycle)}</ul>`);
    } else {
      out.push(
        `<ul class="items">${step.substeps
          .map((sub) => checkboxLine(substepText(sub), sub.network, sub.lifecycle))
          .join("\n")}</ul>`,
      );
    }
    out.push(`</section>`);
  }
  return out.join("\n");
}

// ── Template (neutral grayscale, print-friendly) ────────────────────────────

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
.legend {
  border: 1px solid #bbb; border-radius: 4px; background: #f6f6f6;
  padding: 10px 14px; margin: 0 0 20px; font-size: 10.5pt; break-inside: avoid;
}
.legend h4 { margin: 0 0 6px; font-size: 10.5pt; text-transform: uppercase; letter-spacing: 0.12em; color: #444; }
.legend p { margin: 0 0 4px; }
.legend p:last-child { margin-bottom: 0; }

/* ── Phases & steps ── */
h2.phase {
  font-size: 16pt; color: #111; margin: 1.6em 0 0.6em;
  border-bottom: 2px solid #999; padding-bottom: 5px;
  letter-spacing: 0.04em; page-break-after: avoid;
}
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
  </div>
  <div class="legend">
    <h4>How to read this checklist</h4>
    <p><strong>[MM]</strong> = Media Mavens · <strong>[CB]</strong> = ClickBank. Items tagged [MM] or [CB] apply only to that affiliate network — items with no tag apply to both.</p>
    <p><strong>One-time setup</strong> = done once ever, during initial setup. <strong>Once per brand domain</strong> = done once for each brand domain you use. Everything else repeats for every new campaign.</p>
  </div>
  ${buildBody()}
</body></html>`;
}

// ── Guards ──────────────────────────────────────────────────────────────────

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

  // 2. Every step and every canonical substep is covered.
  if (CAMPAIGN_ROADMAP.length !== CAMPAIGN_STEP_COUNT) {
    throw new Error(`Roadmap has ${CAMPAIGN_ROADMAP.length} steps, expected ${CAMPAIGN_STEP_COUNT}`);
  }
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const haystack = normalize(text);
  for (const step of CAMPAIGN_ROADMAP) {
    if (!haystack.includes(normalize(stepTitle(step)))) {
      throw new Error(`Coverage guard failed: step title missing for "${step.id}"`);
    }
    for (const sub of step.substeps) {
      if (!haystack.includes(normalize(substepText(sub)))) {
        throw new Error(`Coverage guard failed: substep missing "${sub.substepId}"`);
      }
    }
  }

  // 3. Both network tags + legend present.
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
