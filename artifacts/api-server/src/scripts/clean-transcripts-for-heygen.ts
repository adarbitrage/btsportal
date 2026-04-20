import { openai } from "@workspace/integrations-openai-ai-server";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../../..");
const SRC = resolve(ROOT, "artifacts/api-server/src/knowledge-base/video-transcripts.txt");
const OUT_DIR = resolve(ROOT, "exports/heygen-scripts");
const RAW_FILE = readFileSync(SRC, "utf8");

interface Entry {
  index: number;
  rawTitle: string;
  videoId: string;
  rawTranscript: string;
}

function parseEntries(text: string): Entry[] {
  const blocks = text.split(/\n---\n/).map((b) => b.trim()).filter(Boolean);
  const entries: Entry[] = [];
  let idx = 0;
  for (const block of blocks) {
    const titleMatch = block.match(/^Title:\s*(.+)$/m);
    const idMatch = block.match(/^Video ID:\s*(.+)$/m);
    if (!titleMatch || !idMatch) continue;
    const headerEnd = block.indexOf("\n\n", block.indexOf("Video ID:"));
    if (headerEnd < 0) continue;
    const transcript = block.slice(headerEnd).trim();
    if (transcript.length < 100) continue;
    idx++;
    entries.push({
      index: idx,
      rawTitle: titleMatch[1].trim(),
      videoId: idMatch[1].trim(),
      rawTranscript: transcript,
    });
  }
  return entries;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function applyBrandSweep(s: string): string {
  return s
    .replace(/\bThe Conversion Engine\b/gi, "Build Test Scale")
    .replace(/\bTCE\b/g, "BTS");
}

const SYSTEM_PROMPT = `You are an expert script editor preparing transcripts of training videos for re-recording with an AI avatar tool (HeyGen).

You will receive ONE raw verbatim transcript of an instructional video. Your job is to produce a CLEAN, POLISHED SCRIPT that an AI avatar can read aloud naturally.

REQUIREMENTS:
1. Preserve the speaker's voice, tone, and intent. Keep it conversational and instructional — first person ("I'll show you...") and second person ("you'll see...").
2. Remove all filler: "um", "uh", "you know", "like", "okay so", "right?", "so basically", repeated false starts, mid-sentence corrections.
3. Tighten run-on sentences into clear, speakable sentences. Aim for sentences a human can read in one breath.
4. Remove redundant repetition (the speaker often repeats the same point 2-3 times). Keep the clearest expression once.
5. Fix transcription artifacts: "MediaMavens" not "Media Mavens" or "Mediamavens"; "ClickBank" not "Clickbank"; "DIYTrax" not "Diy Tracks" or "DIY Trax"; "Flexy" not "Flexi"; "Gifster" not "Gifster" (correct casing); "advertorial" lowercase.
6. Branding: Use "Build Test Scale" or "BTS" — never "TCE" or "The Conversion Engine".
7. Do NOT invent new facts, steps, URLs, prices, commission rates, or screenshots. Only restructure what's actually said.
8. Do NOT add headings, bullets, markdown, stage directions, or "[pause]" notes. Output is plain prose paragraphs the avatar will read aloud.
9. Open with a clean hook sentence (no "okay so in this video..." mumble — instead something like "In this video, I'll show you...").
10. Close cleanly. If the original trails off mid-sentence, end on the last complete thought.

OUTPUT FORMAT (STRICT):
First line: a short, polished video title (no numbering, no "(1)" suffixes, no dashes — just a clean title like "Choosing Your ClickBank Product").
Then a blank line.
Then the cleaned script as plain prose paragraphs (2-6 paragraphs typical).
Nothing else. No preamble, no JSON, no markdown.`;

async function cleanOne(entry: Entry): Promise<{
  entry: Entry;
  cleanedTitle: string;
  script: string;
  error?: string;
}> {
  try {
    const swept = applyBrandSweep(entry.rawTranscript);
    const userMsg = `Original title: ${entry.rawTitle}\n\nRaw transcript:\n${swept}`;
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
    });
    const out = resp.choices[0]?.message?.content?.trim() ?? "";
    const lines = out.split("\n");
    const cleanedTitle = applyBrandSweep(lines[0].trim().replace(/^#+\s*/, "").replace(/^["']|["']$/g, ""));
    const script = applyBrandSweep(lines.slice(1).join("\n").trim());
    return { entry, cleanedTitle, script };
  } catch (err: unknown) {
    return {
      entry,
      cleanedTitle: entry.rawTitle,
      script: applyBrandSweep(entry.rawTranscript),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runBatched<T, R>(items: T[], fn: (item: T) => Promise<R>, batchSize: number): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const out = await Promise.all(batch.map(fn));
    results.push(...out);
    console.log(`  Processed ${Math.min(i + batchSize, items.length)} / ${items.length}`);
  }
  return results;
}

async function main() {
  console.log("Parsing transcripts...");
  const entries = parseEntries(RAW_FILE);
  console.log(`Found ${entries.length} transcripts.`);

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(OUT_DIR, "scripts"), { recursive: true });

  console.log("Cleaning transcripts with GPT-4o-mini (8 in parallel)...");
  const cleaned = await runBatched(entries, cleanOne, 8);

  let errors = 0;
  const masterParts: string[] = [
    "# BTS Training Video Scripts — HeyGen-Ready",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Total scripts: ${cleaned.length}`,
    "",
    "Each script below has been cleaned of filler words, tightened for natural delivery,",
    "and rebranded to Build Test Scale (BTS). Feed individual files into HeyGen as the",
    "spoken script for your AI avatar.",
    "",
    "---",
    "",
  ];

  for (const c of cleaned) {
    if (c.error) {
      errors++;
      console.warn(`  ! Error on "${c.entry.rawTitle}": ${c.error}`);
    }
    const num = String(c.entry.index).padStart(3, "0");
    const slug = slugify(c.cleanedTitle || c.entry.rawTitle) || `video-${num}`;
    const filename = `${num}-${slug}.txt`;
    const fileBody =
      `Title: ${c.cleanedTitle}\n` +
      `Original Title: ${c.entry.rawTitle}\n` +
      `Video ID: ${c.entry.videoId}\n` +
      `${c.error ? `WARNING: AI cleanup failed (${c.error}). Showing brand-swept raw transcript.\n` : ""}` +
      `\n---\n\n` +
      `${c.script}\n`;
    writeFileSync(join(OUT_DIR, "scripts", filename), fileBody, "utf8");

    masterParts.push(`## ${num}. ${c.cleanedTitle}`);
    masterParts.push("");
    masterParts.push(`*Original title: ${c.entry.rawTitle} · Video ID: ${c.entry.videoId}*`);
    masterParts.push("");
    masterParts.push(c.script);
    masterParts.push("");
    masterParts.push("---");
    masterParts.push("");
  }

  writeFileSync(join(OUT_DIR, "ALL-SCRIPTS.md"), masterParts.join("\n"), "utf8");

  const manifest = cleaned.map((c) => ({
    number: c.entry.index,
    file: `scripts/${String(c.entry.index).padStart(3, "0")}-${slugify(c.cleanedTitle || c.entry.rawTitle) || `video-${c.entry.index}`}.txt`,
    title: c.cleanedTitle,
    originalTitle: c.entry.rawTitle,
    videoId: c.entry.videoId,
    cleanupError: c.error ?? null,
    wordCount: c.script.split(/\s+/).filter(Boolean).length,
  }));
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const readme =
    `# BTS Training Video Scripts (HeyGen-Ready)\n\n` +
    `**${cleaned.length} scripts** cleaned from raw video transcripts and prepared for AI avatar narration in HeyGen.\n\n` +
    `## What's inside\n\n` +
    `- **scripts/** — One \`.txt\` file per video. The first three lines are metadata; everything below the \`---\` is the spoken script ready to paste into HeyGen.\n` +
    `- **ALL-SCRIPTS.md** — All 97 scripts in one document for easy review.\n` +
    `- **manifest.json** — Machine-readable index (filename, title, video ID, word count).\n\n` +
    `## How they were cleaned\n\n` +
    `Each raw transcript was processed by GPT-4o-mini with instructions to:\n` +
    `- Strip filler words (um, uh, you know, like, okay so, right?)\n` +
    `- Tighten run-on sentences and remove redundant repetition\n` +
    `- Fix transcription artifacts (correct casing for MediaMavens, ClickBank, DIYTrax, Flexy)\n` +
    `- Preserve the original instructional voice and second-person tone\n` +
    `- Apply BTS branding (any residual TCE / "The Conversion Engine" mentions swept)\n` +
    `- Open with a clean hook and close on a complete thought\n\n` +
    `**No new facts, URLs, prices, or steps were invented** — only existing content was restructured.\n\n` +
    `## Using with HeyGen\n\n` +
    `1. Open any \`scripts/NNN-*.txt\` file.\n` +
    `2. Copy everything below the \`---\` line.\n` +
    `3. Paste into the HeyGen script field for your avatar.\n` +
    `4. Adjust voice, pacing, and pauses inside HeyGen as needed.\n\n` +
    `${errors > 0 ? `## Notes\n\n${errors} script(s) failed AI cleanup and fall back to the brand-swept raw transcript — search for "WARNING:" in the script files.\n` : ""}`;
  writeFileSync(join(OUT_DIR, "README.md"), readme, "utf8");

  console.log(`\nDone. ${cleaned.length} scripts written to ${OUT_DIR}/ (${errors} cleanup errors).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
