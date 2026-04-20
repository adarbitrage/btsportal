import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../../..");
const SRC_MANIFEST = resolve(ROOT, "exports/heygen-scripts/manifest.json");
const SRC_SCRIPTS_DIR = resolve(ROOT, "exports/heygen-scripts/scripts");
const OUT_DIR = resolve(ROOT, "exports/heygen-app-training-scripts");

interface AppEntry {
  appKey: string;
  displayName: string;
  tagline: string;
  vidalyticsId: string;
}

const APPS: AppEntry[] = [
  { appKey: "flexy", displayName: "Flexy", tagline: "Drag & Drop Landing Pages", vidalyticsId: "mxMJcb1ABTOgkKiW" },
  { appKey: "diytrax", displayName: "DIYTrax", tagline: "URL & Lander Rotator", vidalyticsId: "EqqoE4li5xO0wrjq" },
  { appKey: "metricmover", displayName: "MetricMover", tagline: "Lander Split Tester", vidalyticsId: "9FQkRbOSSrI3JMML" },
  { appKey: "scrapebot", displayName: "ScrapeBot", tagline: "Google/Bing Image Scraper", vidalyticsId: "wnf8YlB9rxQ3XCUm" },
  { appKey: "cropbot", displayName: "CropBot", tagline: "Image Cropper & Resizer", vidalyticsId: "zIbcTMBKHnyz_UOo" },
  { appKey: "gifster", displayName: "Gifster", tagline: "Ad Images, Automated", vidalyticsId: "ucrw84JSj_OoMMQE" },
  { appKey: "pixelpress", displayName: "PixelPress", tagline: "Bulk Banner Creator", vidalyticsId: "vA7IOa_12U66yEFl" },
  { appKey: "concierge", displayName: "BTS Concierge", tagline: "Concierge service overview", vidalyticsId: "W2EWjAXnSz8UjQvB" },
];

interface ManifestEntry {
  number: number;
  file: string;
  title: string;
  originalTitle: string;
  videoId: string;
  cleanupError: string | null;
  wordCount: number;
}

function main() {
  const manifest: ManifestEntry[] = JSON.parse(readFileSync(SRC_MANIFEST, "utf8"));

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(OUT_DIR, "scripts"), { recursive: true });

  const results: Array<{
    app: AppEntry;
    found: boolean;
    sourceTitle?: string;
    bundledFile?: string;
    wordCount?: number;
  }> = [];

  const masterParts: string[] = [
    "# BTS App Training Scripts — HeyGen-Ready",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Apps covered: ${APPS.length}`,
    "",
    "One cleaned, BTS-branded script per app, ready to drop into HeyGen for AI avatar narration.",
    "Each script corresponds to the training video that plays inside that app's card in the BTS portal.",
    "",
    "---",
    "",
  ];

  for (const app of APPS) {
    const match = manifest.find((m) => m.videoId === app.vidalyticsId);
    if (!match || match.cleanupError) {
      results.push({ app, found: false });
      console.warn(`  ! No clean script found for ${app.displayName} (videoId ${app.vidalyticsId})`);
      continue;
    }
    const srcPath = join(SRC_SCRIPTS_DIR, match.file.replace(/^scripts\//, ""));
    const raw = readFileSync(srcPath, "utf8");
    const splitIdx = raw.indexOf("\n---\n\n");
    const scriptBody = splitIdx >= 0 ? raw.slice(splitIdx + 6).trim() : raw.trim();

    const outName = `${app.appKey}-training.txt`;
    const fileBody =
      `App: ${app.displayName}\n` +
      `Tagline: ${app.tagline}\n` +
      `Vidalytics Video ID: ${app.vidalyticsId}\n` +
      `Original Video Title: ${match.originalTitle}\n` +
      `Cleaned Title: ${match.title}\n` +
      `Word Count: ${match.wordCount}\n` +
      `\n--- SCRIPT ---\n\n` +
      `${scriptBody}\n`;
    writeFileSync(join(OUT_DIR, "scripts", outName), fileBody, "utf8");

    masterParts.push(`## ${app.displayName} — ${app.tagline}`);
    masterParts.push("");
    masterParts.push(`*Vidalytics ID: \`${app.vidalyticsId}\` · ${match.wordCount} words · file: \`scripts/${outName}\`*`);
    masterParts.push("");
    masterParts.push(scriptBody);
    masterParts.push("");
    masterParts.push("---");
    masterParts.push("");

    results.push({
      app,
      found: true,
      sourceTitle: match.originalTitle,
      bundledFile: `scripts/${outName}`,
      wordCount: match.wordCount,
    });
  }

  writeFileSync(join(OUT_DIR, "ALL-APP-SCRIPTS.md"), masterParts.join("\n"), "utf8");
  writeFileSync(
    join(OUT_DIR, "manifest.json"),
    JSON.stringify(
      results.map((r) => ({
        app: r.app.appKey,
        displayName: r.app.displayName,
        vidalyticsId: r.app.vidalyticsId,
        found: r.found,
        sourceTitle: r.sourceTitle ?? null,
        file: r.bundledFile ?? null,
        wordCount: r.wordCount ?? null,
      })),
      null,
      2,
    ),
    "utf8",
  );

  const found = results.filter((r) => r.found).length;
  const readme =
    `# BTS App Training Scripts (HeyGen-Ready)\n\n` +
    `**${found} of ${APPS.length} app training videos**, transcribed, cleaned, BTS-branded, and ready for HeyGen AI avatar narration.\n\n` +
    `## Apps included\n\n` +
    results
      .map((r) =>
        r.found
          ? `- **${r.app.displayName}** — ${r.wordCount} words → \`${r.bundledFile}\``
          : `- **${r.app.displayName}** — ⚠️ no transcript found (Vidalytics ID \`${r.app.vidalyticsId}\` not in source set)`,
      )
      .join("\n") +
    `\n\n` +
    `## What's inside each script file\n\n` +
    `Each \`scripts/<app>-training.txt\` file has a metadata header and then the spoken script after the \`--- SCRIPT ---\` marker. Copy everything below that marker into HeyGen's script field.\n\n` +
    `## Cleaning applied\n\n` +
    `- Filler words removed (um, uh, you know, like, okay so, right?)\n` +
    `- Run-on sentences tightened, redundant repetition removed\n` +
    `- Transcription artifacts fixed (MediaMavens, ClickBank, DIYTrax, Flexy, Gifster casing)\n` +
    `- BTS branding swept (any residual TCE / "The Conversion Engine" replaced)\n` +
    `- Original instructional voice and second-person tone preserved\n` +
    `- No new facts, prices, URLs, or steps invented\n\n` +
    `## Source\n\n` +
    `These were extracted from the existing Build Test Scale knowledge base (the same 97-script set processed previously) and re-keyed to the seven Apps + Concierge cards shown in the BTS portal at \`/advantage\` and \`/apps\`.\n`;
  writeFileSync(join(OUT_DIR, "README.md"), readme, "utf8");

  console.log(`\nDone. ${found} / ${APPS.length} app scripts bundled into ${OUT_DIR}`);
}

main();
