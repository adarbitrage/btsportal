import { getParam } from "../../lib/params";
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { kbStagingDocsTable, blitzLessonsTable } from "@workspace/db/schema";
import { eq, count, and, sql, inArray } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac.js";
import { execSync, execFile } from "child_process";
import { promisify } from "util";
import { createRequire } from "module";
import { matchVideoToCurriculum, type BlitzLesson } from "./blitz-curriculum.js";
import AdmZip from "adm-zip";
import { runTriageBackground } from "./knowledgebase-staging.js";
import { runAutoTriageOnDoc, type AutoTriageDocResult } from "../../lib/kb-triage.js";
import {
  loadMiningSources,
  decideMining,
  markSourceMined,
  originTypeForKind,
  detectLegacyRefs,
} from "../../lib/kb-mining.js";
import { ObjectStorageService } from "../../lib/objectStorage.js";
import mammoth from "mammoth";
import {
  buildTopicIndexBackground,
  getTopicIndexState,
  isTopicIndexRunning,
  getNodeLinkCounts,
  getLastTopicIndexRun,
  getTopicIndexHealth,
  runTopicIndexQualitySpotCheck,
  isQualityCheckRunning,
} from "../../lib/kb-topic-index.js";
import {
  synthesizeNode,
  synthesizeNodesBackground,
  getSynthesisState,
  getLastSynthesisRun,
  getFailedNodesPendingRetry,
  isSynthesisRunning,
  isValidSynthesisNode,
  resolveSynthesisScope,
  getAffectedNodes,
  getSynthesisCoverage,
  type SynthesisScope,
} from "../../lib/kb-synthesis.js";
import { ALL_NODES, HOME_ROOT_SLUGS } from "../../lib/kb-taxonomy.js";
import { scanCoreTrainingSourceChanges } from "../../lib/kb-source-change-scan.js";

const execFileAsync = promisify(execFile);
const _require = createRequire(import.meta.url);
const { PDFParse } = _require("pdf-parse") as {
  PDFParse: new (opts: { data: Uint8Array }) => {
    getText: () => Promise<{ text: string; total: number }>;
    destroy: () => Promise<void>;
  };
};

const KB_DIR = path.join(process.cwd(), "src/knowledge-base");

const router = Router();
router.use(requirePermission("chat:manage"));

function cleanTranscript(raw: string): string {
  let cleaned = raw;

  const fillers = [
    "uh huh",
    "uhm",
    "umm",
    "uhh",
    "hmm",
    "hm",
    "um",
    "uh",
    "ah",
    "ahh",
    "oh",
    "ooh",
    "eh",
    "you know what I mean",
    "know what I mean",
    "you know",
    "like I said",
    "as I said",
    "basically",
    "essentially",
    "literally",
    "so yeah",
    "and yeah",
    "but yeah",
    "I mean",
    "I guess",
    "sort of",
    "kind of",
    "at the end of the day",
  ];

  for (const filler of fillers) {
    const escaped = filler.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b[,\\s]*`, "gi");
    cleaned = cleaned.replace(regex, " ");
  }

  cleaned = cleaned.replace(/\bright\?\s*/gi, " ");
  cleaned = cleaned.replace(/\bokay\?\s*/gi, " ");
  cleaned = cleaned.replace(/\bokay\.\s*/gi, ". ");

  cleaned = cleaned.replace(/\s{2,}/g, " ");
  cleaned = cleaned.replace(/\s+([.,!?])/g, "$1");
  cleaned = cleaned.replace(/([.,!?])\s*([.,!?])/g, "$1");
  cleaned = cleaned.replace(/\.\s*\./g, ".");

  return cleaned.trim();
}

async function extractDocument(
  cleanedText: string,
  videoTitle: string,
): Promise<{
  title: string;
  category: string;
  topics: string;
  content: string;
}> {
  const systemPrompt = `You are converting a raw training video transcript into a clean, structured training document for a knowledge base. The source material is from a coaching session about affiliate marketing at Build Test Scale (BTS).

Your job is to extract the TEACHING CONTENT and produce a well-organized document that reads like a professional training guide — NOT like a transcript.

RULES:
- Write in clear, direct prose. No verbal fillers, no conversational padding.
- Organize with clear headings (## and ###)
- Extract actionable steps as numbered lists
- Extract key concepts, frameworks, and definitions clearly
- Include specific examples, numbers, or case studies mentioned (these are valuable)
- Remove tangents, repeated explanations, and off-topic asides
- If the speaker explains the same concept multiple ways, keep the clearest explanation and discard the rest
- Preserve any specific tools, platforms, metrics, or thresholds mentioned
- Preserve any warnings, common mistakes, or "don't do this" advice
- Do NOT add information that isn't in the transcript — only extract and organize
- Do NOT include phrases like "the speaker said" or "in this video" — write as if this is original training content
- Keep BTS branding. Never reference TCE, Cherrington, Charrington, or Adam.
- Target length: 300-800 words per document (dense, high-signal content). A 40-minute rambling transcript might produce a 500-word document — that's fine. Density > length.

OUTPUT FORMAT (return ONLY this, no other text):

# [Document Title]

**Category:** [curriculum | strategy | sop | faq | platform_guide]
**Topics:** [comma-separated topic tags for search]

## [First Section Heading]

[Clean, structured content...]

### [Sub-heading if needed]

[Content with numbered steps, key points, etc.]

## Key Takeaways

- [Bullet point summary of the most important points]`;

  const resp = await fetch(
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL + "/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Video title: "${videoTitle}"\n\nTranscript:\n${cleanedText}`,
          },
        ],
        max_completion_tokens: 2000,
      }),
      signal: AbortSignal.timeout(60000),
    },
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${err.substring(0, 200)}`);
  }

  const json = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const output = json.choices[0]?.message?.content || "";

  const titleMatch = output.match(/^#\s+(.+)/m);
  const categoryMatch = output.match(/\*\*Category:\*\*\s*(\w+)/);
  const topicsMatch = output.match(/\*\*Topics:\*\*\s*(.+)/);

  return {
    title: titleMatch ? titleMatch[1].trim() : videoTitle,
    category: categoryMatch ? categoryMatch[1].trim() : "curriculum",
    topics: topicsMatch ? topicsMatch[1].trim() : "",
    content: output,
  };
}

// ── RETIRED: flat-file transcript mining (Task #1533) ────────────────────────
//
// The "1 transcript → 1 draft" flat-file miners (video-transcripts.txt and the
// coaching .docx pools) are retired. Knowledge is now consolidated per taxonomy
// node ACROSS the whole ai_source_documents corpus by the Synthesis Engine:
// build the topic index (POST /build-topic-index) then synthesize
// (POST /synthesize or POST /synthesize/:node). These endpoints now 410 so no
// flat-file content can be mined into the review queue.
const RETIRED_MINING_MESSAGE =
  "Flat-file transcript mining has been retired. Knowledge is now consolidated per taxonomy node by the Synthesis Engine — build the topic index (POST /admin/knowledgebase/pipeline/build-topic-index) then run synthesis (POST /admin/knowledgebase/pipeline/synthesize).";

function retiredMining(_req: Request, res: Response): void {
  res.status(410).json({ error: RETIRED_MINING_MESSAGE, retired: true });
}

router.post("/process-transcripts", retiredMining);

router.post("/process-single/:index", retiredMining);

router.get("/process-status", async (_req: Request, res: Response) => {
  try {
    const results = await db
      .select({
        status: kbStagingDocsTable.status,
        cnt: count(),
      })
      .from(kbStagingDocsTable)
      .groupBy(kbStagingDocsTable.status);

    const total = results.reduce((s, r) => s + r.cnt, 0);
    res.json({ total, byStatus: results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

async function processTranscriptsBackground(
  sections: string[],
): Promise<void> {
  console.log(
    `[KB Pipeline] Starting processing of ${sections.length} transcripts`,
  );
  let processed = 0;
  let errors = 0;
  let skipped = 0;

  // Load the screened source registry once; gate + stamp each draft.
  const sources = await loadMiningSources();

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const videoTitle =
      section.match(/^Title:\s*(.+)/m)?.[1]?.trim() || "Unknown";
    const videoId =
      section.match(/^Video ID:\s*(.+)/m)?.[1]?.trim() || "";
    const transcriptBody = section
      .replace(/^Title:.*\n/m, "")
      .replace(/^Video ID:.*\n/m, "")
      .trim();

    // Skip quarantined / already-mined sources so a re-run doesn't reprocess.
    const decision = decideMining(`video:${videoTitle}`, sources);
    if (!decision.mine) {
      skipped++;
      console.log(`[KB Pipeline] Skip (${decision.skipReason}): ${videoTitle}`);
      continue;
    }

    try {
      const cleaned = cleanTranscript(transcriptBody);
      const doc = await extractDocument(cleaned, videoTitle);
      const staleRefs = detectLegacyRefs(doc.content);

      await db.insert(kbStagingDocsTable).values({
        title: doc.title,
        category: doc.category,
        content: doc.content,
        tags: doc.topics,
        sourceVideoTitle: videoTitle,
        sourceVideoId: videoId,
        status: "needs_review",
        sourceId: decision.source?.id ?? null,
        authorityRole: decision.source?.authorityRole ?? "curriculum",
        originType: originTypeForKind(decision.source?.sourceKind ?? "video"),
        staleReferences: staleRefs.length > 0 ? staleRefs : null,
      });

      if (decision.source) await markSourceMined(decision.source.id);

      processed++;
      console.log(
        `[KB Pipeline] ${processed}/${sections.length}: ${doc.title}`,
      );
    } catch (err) {
      errors++;
      console.error(
        `[KB Pipeline] Error processing "${videoTitle}":`,
        err instanceof Error ? err.message : err,
      );
    }

    if (i < sections.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.log(`[KB Pipeline] Complete. processed=${processed}, skipped=${skipped}, errors=${errors}`);

  if (processed > 0) {
    console.log(`[KB Pipeline] Analyzing ${processed} new docs…`);
    const newDocs = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.status, "needs_review"));
    runTriageBackground(newDocs).catch((err) =>
      console.error("[KB Pipeline] Triage error:", err),
    );
  }
}

function cleanBlitzTranscript(raw: string): string {
  let cleaned = cleanTranscript(raw);

  cleaned = cleaned.replace(/\bTCE\s*Blitz\b/gi, "The Blitz");
  cleaned = cleaned.replace(/\bTCE\s*Community\b/gi, "BTS Community");
  cleaned = cleaned.replace(/\bTCE\s*Concierge\b/gi, "BTS Concierge");
  cleaned = cleaned.replace(/\bTCE\b/gi, "BTS");
  cleaned = cleaned.replace(/\b(the\s+)?cherrington\s+experience\b/gi, "Build, Test, Scale");
  cleaned = cleaned.replace(/\bcherrington\s+media\b/gi, "Build, Test, Scale");
  cleaned = cleaned.replace(/\b(cherrington|charrington)\b/gi, "BTS");
  cleaned = cleaned.replace(/\bsupport@cherringtonmedia\.com\b/gi, "support@buildtestscale.com");
  cleaned = cleaned.replace(/\bcherringtonmedia\.com\b/gi, "buildtestscale.com");

  return cleaned;
}

function buildBlitzExtractionPrompt(lesson: BlitzLesson): string {
  return `You are converting a training video transcript into a clean, structured training document. This video is part of "The Blitz" — a sequential, step-by-step affiliate marketing training program by Build Test Scale (BTS).

CRITICAL CONTEXT:
- Phase: ${lesson.phase.toUpperCase()} (${lesson.phase === "build" ? "Create Your Foundation" : lesson.phase === "test" ? "Find Your Winners Through Data" : "Multiply Your Profits with Proven Winners"})
- Module: ${lesson.module}
- Lesson: ${lesson.lessonId} — "${lesson.title}"
- Lesson Type: ${lesson.lessonType}
- Network Path: ${lesson.networkPath}
- Publisher Path: ${lesson.publisherPath}

This lesson is part of a specific sequence. The member completed previous lessons before reaching this one. Write the document assuming the reader has that prior context.

RULES:
- Write in clear, direct prose. No verbal fillers or conversational padding.
- Organize with clear headings (## and ###)
- For technical walkthroughs: extract the exact step-by-step process as numbered lists. Be precise about which buttons to click, which fields to fill in, and what the expected result is.
- For conceptual training: extract the key frameworks, principles, and mental models being taught. Include specific examples.
- For strategy content: extract the decision criteria, success metrics, budgets, and rules of thumb.
- Preserve ALL specific numbers: budgets ($1,500, $500, $25/banner), metrics (20% ROI, 60% return threshold), character limits (90 chars), image dimensions (960x540, 16x9), and timeframes.
- Preserve tool names exactly: Flexy, MetricMover, DIYTrax, PixelPress, FreeAdCopy, AffiliateCMO, CropBot, Gifster, ScrapeBot
- Preserve publisher codenames: Caterpillar, Grasshopper, Crane, Master
- Preserve affiliate network names: Media Mavens, ClickBank, MaxWeb
- If this lesson applies to a specific network or publisher path, note that clearly at the top.
- Remove all verbal filler (uh, um, you know, basically, etc.)
- Remove tangents and off-topic asides
- Do NOT add information not in the transcript
- BTS branding only. Never use TCE, Cherrington, Charrington, or Adam's name. Use "your coach" or "the instructor" if referencing the speaker.
- Target length: 300-1000 words depending on lesson complexity.

OUTPUT FORMAT (return ONLY this, no other text):

# ${lesson.lessonId}: ${lesson.title}

**Phase:** ${lesson.phase.toUpperCase()}
**Module:** ${lesson.module}
**Category:** ${lesson.lessonType}
**Applies to:** ${lesson.networkPath === "universal" ? "All members" : lesson.networkPath.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) + " members"}
**Topics:** [comma-separated tags]

## Overview

[1-2 sentence summary of what this lesson teaches and why it matters at this point in the Blitz]

## [Main Content — Headings appropriate to the lesson type]

[Clean, structured content...]

## Key Takeaways

- [Bullet point summary of the most important points]

## Next Step

[What the member should do after completing this lesson — reference the next lesson in the sequence if applicable]`;
}

async function transcribeAudio(audioPath: string): Promise<string> {
  const fileSize = fs.statSync(audioPath).size;
  const MAX_SIZE = 24 * 1024 * 1024;
  const MAX_DURATION = 1400;

  const durationStr = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
    { encoding: "utf-8" },
  ).trim();
  const totalDuration = parseFloat(durationStr);

  if (fileSize <= MAX_SIZE && totalDuration <= MAX_DURATION) {
    return transcribeChunk(audioPath);
  }

  const chunkDuration = 600;
  const numChunks = Math.ceil(totalDuration / chunkDuration);

  console.log(`[Blitz] Splitting ${Math.round(totalDuration)}s audio into ${numChunks} chunks`);
  let fullTranscript = "";

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDuration;
    const chunkPath = audioPath.replace(".mp3", `_chunk${i}.mp3`);

    execSync(
      `ffmpeg -y -ss ${startTime} -t ${chunkDuration} -i "${audioPath}" -acodec libmp3lame -ab 64k -ar 16000 -ac 1 "${chunkPath}" 2>/dev/null`,
    );

    const chunkText = await transcribeChunk(chunkPath);
    fullTranscript += (fullTranscript ? " " : "") + chunkText;

    try { fs.unlinkSync(chunkPath); } catch {}
  }

  return fullTranscript;
}

async function transcribeChunk(filePath: string): Promise<string> {
  const formData = new FormData();
  const audioBuffer = fs.readFileSync(filePath);
  const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
  formData.append("file", blob, path.basename(filePath));
  formData.append("model", "gpt-4o-mini-transcribe");

  const resp = await fetch(
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL + "/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      },
      body: formData,
      signal: AbortSignal.timeout(120000),
    },
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Transcription error ${resp.status}: ${err.substring(0, 200)}`);
  }

  const json = (await resp.json()) as { text: string };
  return json.text;
}

async function extractBlitzDocument(
  cleanedText: string,
  lesson: BlitzLesson,
): Promise<{ title: string; category: string; topics: string; content: string }> {
  const systemPrompt = buildBlitzExtractionPrompt(lesson);

  const resp = await fetch(
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL + "/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Video title: "${lesson.title}"\n\nTranscript:\n${cleanedText}`,
          },
        ],
        max_completion_tokens: 3000,
      }),
      signal: AbortSignal.timeout(90000),
    },
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${err.substring(0, 200)}`);
  }

  const json = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
  const output = json.choices[0]?.message?.content || "";

  const topicsMatch = output.match(/\*\*Topics:\*\*\s*(.+)/);

  const categoryMap: Record<string, string> = {
    conceptual: "curriculum",
    technical: "sop",
    strategy: "strategy",
  };

  return {
    title: `${lesson.lessonId}: ${lesson.title}`,
    category: categoryMap[lesson.lessonType] || "curriculum",
    topics: topicsMatch ? topicsMatch[1].trim() : "",
    content: output,
  };
}

interface BlitzVideo {
  id: string;
  title: string;
  url: string;
}

let blitzProcessingStatus = { running: false, total: 0, processed: 0, errors: 0, currentVideo: "" };

router.post("/process-blitz", async (req: Request, res: Response) => {
  try {
    if (blitzProcessingStatus.running) {
      res.json({
        message: "Blitz pipeline is already running",
        status: blitzProcessingStatus,
      });
      return;
    }

    const apiKey = process.env.VIDALYTICS_API_KEY;
    if (!apiKey) {
      res.status(400).json({ error: "VIDALYTICS_API_KEY not configured" });
      return;
    }

    const videoResp = await fetch("https://api.vidalytics.com/public/v1/video", {
      headers: { "X-API-Key": apiKey, "Accept": "application/json" },
      signal: AbortSignal.timeout(30000),
    });

    if (!videoResp.ok) {
      res.status(500).json({ error: "Failed to fetch Vidalytics videos" });
      return;
    }

    const videoData = (await videoResp.json()) as { content?: { data?: BlitzVideo[] }; data?: BlitzVideo[] };
    const allVideos = videoData.content?.data || videoData.data || [];
    const blitzFolderId = "z6tZdpVO4j8rdBTf";
    const blitzVideos = allVideos.filter((v: any) => v.folder_id === blitzFolderId);

    if (blitzVideos.length === 0) {
      res.status(404).json({ error: "No Blitz videos found in Vidalytics" });
      return;
    }

    const matchResults: Array<{ video: BlitzVideo; lesson: BlitzLesson | null; score: number }> = [];
    const unmatched: BlitzVideo[] = [];

    for (const video of blitzVideos) {
      const result = matchVideoToCurriculum(video.title);
      if (result) {
        matchResults.push({ video, lesson: result.lesson, score: result.score });
      } else {
        unmatched.push(video);
      }
    }

    matchResults.sort((a, b) => (a.lesson?.blitzOrder || 0) - (b.lesson?.blitzOrder || 0));

    res.json({
      message: `Starting Blitz pipeline for ${matchResults.length} matched videos. ${unmatched.length} unmatched.`,
      matched: matchResults.length,
      unmatched: unmatched.map(v => v.title),
      status: "processing",
    });

    processBlitzBackground(matchResults).catch(err =>
      console.error("[Blitz Pipeline] Background error:", err),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/blitz-status", async (_req: Request, res: Response) => {
  try {
    const blitzDocs = await db
      .select({ status: blitzLessonsTable.status, cnt: count() })
      .from(blitzLessonsTable)
      .groupBy(blitzLessonsTable.status);

    const total = blitzDocs.reduce((s, r) => s + r.cnt, 0);

    res.json({
      total,
      byStatus: blitzDocs,
      processing: blitzProcessingStatus,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/blitz-match-preview", async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.VIDALYTICS_API_KEY;
    if (!apiKey) {
      res.status(400).json({ error: "VIDALYTICS_API_KEY not configured" });
      return;
    }

    const videoResp = await fetch("https://api.vidalytics.com/public/v1/video", {
      headers: { "X-API-Key": apiKey, "Accept": "application/json" },
      signal: AbortSignal.timeout(30000),
    });

    const videoData = (await videoResp.json()) as any;
    const allVideos = videoData.content?.data || videoData.data || [];
    const blitzVideos = allVideos.filter((v: any) => v.folder_id === "z6tZdpVO4j8rdBTf");

    const matches = blitzVideos.map((v: any) => {
      const result = matchVideoToCurriculum(v.title);
      return {
        videoTitle: v.title,
        videoId: v.id,
        matched: !!result,
        lessonId: result?.lesson.lessonId || null,
        lessonTitle: result?.lesson.title || null,
        phase: result?.lesson.phase || null,
        module: result?.lesson.module || null,
        score: result?.score || 0,
      };
    });

    matches.sort((a: any, b: any) => (a.lessonId || "zzz").localeCompare(b.lessonId || "zzz"));

    res.json({
      total: blitzVideos.length,
      matched: matches.filter((m: any) => m.matched).length,
      unmatched: matches.filter((m: any) => !m.matched).length,
      matches,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

async function processBlitzBackground(
  matchResults: Array<{ video: BlitzVideo; lesson: BlitzLesson | null; score: number }>,
): Promise<void> {
  const total = matchResults.length;
  blitzProcessingStatus = { running: true, total, processed: 0, errors: 0, currentVideo: "" };
  console.log(`[Blitz Pipeline] Starting processing of ${total} videos`);

  const tmpDir = "/tmp/blitz-audio";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  for (let i = 0; i < matchResults.length; i++) {
    const { video, lesson } = matchResults[i];
    if (!lesson) continue;

    blitzProcessingStatus.currentVideo = `${i + 1}/${total}: ${lesson.lessonId} - ${lesson.title}`;

    try {
      console.log(`[Blitz Pipeline] ${i + 1}/${total}: Downloading ${lesson.lessonId} - ${lesson.title}`);

      const mp4Url = video.url;
      if (!/^https:\/\/fast\.vidalytics\.com\//.test(mp4Url)) {
        console.error(`[Blitz Pipeline] Unexpected URL domain for ${video.title}: ${mp4Url}`);
        blitzProcessingStatus.errors++;
        continue;
      }
      const safeId = video.id.replace(/[^a-zA-Z0-9_-]/g, "");
      const videoPath = path.join(tmpDir, `${safeId}.mp4`);
      const audioPath = path.join(tmpDir, `${safeId}.mp3`);

      execSync(`curl -sL -o "${videoPath}" "${mp4Url}"`, { timeout: 600000 });

      const videoSize = fs.existsSync(videoPath) ? fs.statSync(videoPath).size : 0;
      if (videoSize < 10000) {
        console.error(`[Blitz Pipeline] Download too small (${videoSize}b) for ${video.title}`);
        blitzProcessingStatus.errors++;
        try { fs.unlinkSync(videoPath); } catch {}
        continue;
      }

      console.log(`[Blitz Pipeline] Downloaded ${(videoSize / 1024 / 1024).toFixed(1)}MB for ${lesson.lessonId}`);

      console.log(`[Blitz Pipeline] Extracting audio for ${lesson.lessonId}...`);
      execSync(
        `ffmpeg -y -i "${videoPath}" -vn -acodec libmp3lame -ab 64k -ar 16000 -ac 1 "${audioPath}" 2>/dev/null`,
        { timeout: 120000 },
      );

      try { fs.unlinkSync(videoPath); } catch {}

      console.log(`[Blitz Pipeline] Transcribing ${lesson.lessonId}...`);
      const rawTranscript = await transcribeAudio(audioPath);

      try { fs.unlinkSync(audioPath); } catch {}

      const cleaned = cleanBlitzTranscript(rawTranscript);
      console.log(`[Blitz Pipeline] Extracting document for ${lesson.lessonId}...`);
      const doc = await extractBlitzDocument(cleaned, lesson);

      const toolsMentioned: string[] = [];
      const toolNames = ["flexy", "metricmover", "diytrax", "pixelpress", "freeadcopy", "affiliatecmo", "cropbot", "gifster", "scrapebot", "media mavens", "clickbank", "maxweb"];
      for (const tool of toolNames) {
        if (cleaned.toLowerCase().includes(tool)) toolsMentioned.push(tool);
      }

      await db.insert(blitzLessonsTable).values({
        title: doc.title,
        category: doc.category,
        content: doc.content,
        tags: doc.topics + (toolsMentioned.length > 0 ? ", " + toolsMentioned.join(", ") : ""),
        sourceVideoTitle: video.title,
        sourceVideoId: video.id,
        status: "published",
        phase: lesson.phase,
        module: lesson.module,
        lessonId: lesson.lessonId,
        lessonType: lesson.lessonType,
        networkPath: lesson.networkPath,
        publisherPath: lesson.publisherPath,
        blitzOrder: lesson.blitzOrder,
      });

      blitzProcessingStatus.processed++;
      console.log(`[Blitz Pipeline] ${i + 1}/${total}: ✓ ${lesson.lessonId} - ${doc.title}`);
    } catch (err) {
      blitzProcessingStatus.errors++;
      console.error(
        `[Blitz Pipeline] Error processing ${lesson.lessonId} "${video.title}":`,
        err instanceof Error ? err.message : err,
      );
    }

    if (i < matchResults.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  blitzProcessingStatus.running = false;
  console.log(
    `[Blitz Pipeline] Complete. Processed: ${blitzProcessingStatus.processed}, Errors: ${blitzProcessingStatus.errors}`,
  );

  // Blitz lessons live in their own `blitz_lessons` table and are NOT AI
  // knowledge-base content, so there is intentionally no auto-triage step here.
}

router.post("/process-blitz-retry", async (req: Request, res: Response) => {
  try {
    if (blitzProcessingStatus.running) {
      res.json({ message: "Pipeline is already running", status: blitzProcessingStatus });
      return;
    }

    const apiKey = process.env.VIDALYTICS_API_KEY;
    if (!apiKey) { res.status(400).json({ error: "VIDALYTICS_API_KEY not configured" }); return; }

    const existingDocs = await db
      .select({ lessonId: blitzLessonsTable.lessonId })
      .from(blitzLessonsTable);

    const existingLessonIds = new Set(existingDocs.map(d => d.lessonId).filter(Boolean));

    const videoResp = await fetch("https://api.vidalytics.com/public/v1/video", {
      headers: { "X-API-Key": apiKey, "Accept": "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    const videoData = (await videoResp.json()) as any;
    const allVideos = videoData.content?.data || videoData.data || [];
    const blitzVideos = allVideos.filter((v: any) => v.folder_id === "z6tZdpVO4j8rdBTf");

    const matchResults: Array<{ video: BlitzVideo; lesson: BlitzLesson | null; score: number }> = [];

    for (const video of blitzVideos) {
      const result = matchVideoToCurriculum(video.title);
      if (result && !existingLessonIds.has(result.lesson.lessonId)) {
        matchResults.push({ video, lesson: result.lesson, score: result.score });
      }
    }

    if (matchResults.length === 0) {
      res.json({ message: "All videos already processed", existingCount: existingDocs.length });
      return;
    }

    matchResults.sort((a, b) => (a.lesson?.blitzOrder || 0) - (b.lesson?.blitzOrder || 0));

    res.json({
      message: `Retrying ${matchResults.length} failed/missing videos`,
      retrying: matchResults.map(m => m.lesson?.lessonId + ": " + m.lesson?.title),
    });

    processBlitzBackground(matchResults).catch(err =>
      console.error("[Blitz Pipeline] Retry error:", err),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.post("/process-blitz-supplementary", async (req: Request, res: Response) => {
  try {
    const supplementaryDocs = [
      {
        title: "Understanding the Testing Reality — Caterpillar",
        phase: "test", module: "Testing Strategy", lessonType: "strategy",
        networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 91,
        content: `Round 1 Budget: $1,500 total spend. Success criteria: At least one landing page achieving positive ROI or break-even. Timeline: Allow full $1,500 spend before making decisions. Round 2 Budget: Based on Round 1 winners, scale budget to $500-1,000 with optimized landing pages and new ad creatives. Round 3: Full optimization — cut underperformers aggressively and scale winners. Key metrics to track: CPA (Cost Per Acquisition), ROI per landing page, CTR on ads, and conversion rate on landing pages. Optimization timeline: Check daily, optimize weekly, make major decisions after each round completes.`,
      },
      {
        title: "Understanding the Testing Reality — Grasshopper & Crane",
        phase: "test", module: "Testing Strategy", lessonType: "strategy",
        networkPath: "universal", publisherPath: "grasshopper-crane", blitzOrder: 92,
        content: `Round 1 Budget: Test with minimum viable spend across multiple ad banners and placements. Success criteria: Identify at least 2-3 winning banner/placement combinations. Placement minimums vary by publisher. Round 2: Focus spend on winning placements, test new creative variations. Key differences from Caterpillar: Banner-based display ads vs native ads, different optimization levers, placement-level optimization is critical.`,
      },
      {
        title: "Publisher Overview — Know Your Options",
        phase: "build", module: "Ad Creation", lessonType: "strategy",
        networkPath: "universal", publisherPath: "all", blitzOrder: 93,
        content: `Caterpillar: Native ad publisher. Best for long-form native ads with headlines and descriptions. Supports image and video ad formats. Grasshopper: Display ad publisher. Banner-based advertising with various placement options. Crane: Display ad publisher. Similar to Grasshopper with different inventory and audience. Master: Premium publisher for scaling. Available after proving profitability with Caterpillar, Grasshopper, or Crane. Higher traffic volume, requires proven campaign performance.`,
      },
      {
        title: "What Happens After Round 1",
        phase: "test", module: "After Round 1", lessonType: "strategy",
        networkPath: "universal", publisherPath: "all", blitzOrder: 94,
        content: `After Round 1 completes ($1,500 spend for Caterpillar), analyze results and choose your path. Success criteria: At least one landing page variant showing positive ROI or near break-even. Option 1 (Promising results): Keep the winning landing page(s), create new headline variants, proceed to Round 2. Option 2 (No winners): Try a different offer from the same network. Do NOT change your entire approach — iterate on the offer, not the method. Decision tree: Calculate your overall ROI. If any single variant is profitable, move forward with that variant and optimize around it.`,
      },
      {
        title: "Preparing for Round 2",
        phase: "test", module: "Preparing for Round 2 — Caterpillar", lessonType: "strategy",
        networkPath: "universal", publisherPath: "all", blitzOrder: 95,
        content: `Landing page optimization: Take your Round 1 winners and optimize copy, hero shots, and CTAs. Round 2 setup: Create new ad creative variations based on winning elements from Round 1 — different images, GIF formats, video ads. Success criteria: Achieve consistent positive ROI at scale. Budget: Larger than Round 1 since you're working with proven elements.`,
      },
      {
        title: "Phase 3: SCALE — Multiplying Your Profits",
        phase: "scale", module: "Scaling Strategies", lessonType: "strategy",
        networkPath: "universal", publisherPath: "all", blitzOrder: 96,
        content: `Three scaling methods: 1) Increase budget on winning campaigns — gradually increase daily spend on proven winners. 2) Expand to new publishers — take winning creatives and landing pages to Grasshopper, Crane, or Master. 3) Launch new offers — apply the same Build, Test, Scale framework to additional affiliate offers. Master publisher criteria: Must have proven profitability on at least one other publisher before applying. Timeline: Begin scaling after 2-3 successful rounds. Scale gradually — increase spend by 20-30% increments, not all at once.`,
      },
      {
        title: "What's Working Now — Caterpillar Round 1 Recommendations",
        phase: "build", module: "Ad Creation", lessonType: "strategy",
        networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 97,
        content: `Current asset requirements for Caterpillar native ads: Headlines: 90 character limit. Test 5-10 headline variants. Use curiosity-driven, benefit-focused headlines. Images: 960x540 pixels (16:9 aspect ratio). Test static images, GIFs, and short video clips. Dynamic content macros: Use {city} and {state} macros in headlines for geo-personalization. Tips: Front-load the benefit in headlines. Use real-looking images (not stock photos). Test both emotional and logical angles.`,
      },
      {
        title: "What's Working Now — Grasshopper/Crane Round 1 Recommendations",
        phase: "build", module: "Ad Creation", lessonType: "strategy",
        networkPath: "universal", publisherPath: "grasshopper-crane", blitzOrder: 98,
        content: `Asset requirements for Grasshopper and Crane banner ads: Multiple banner sizes required — check publisher specs. Test at least 5 banner variants per placement. Placement recommendations: Start with highest-traffic placements, then expand. Monitor CTR by placement to quickly identify winners.`,
      },
      {
        title: "Round 1 Campaign Management Guide",
        phase: "test", module: "Round 1 Campaign Management", lessonType: "strategy",
        networkPath: "universal", publisherPath: "all", blitzOrder: 99,
        content: `Daily monitoring checklist: Check campaign spend, impressions, clicks, CTR, CPA. What metrics to track: Click-through rate (CTR) per ad, cost per acquisition (CPA) per landing page, conversion rate per landing page, ROI by variant. When to check: Review metrics daily, make optimization decisions after sufficient data (typically 48-72 hours per test). When to cut: Remove ads with CTR below threshold after adequate impression count. Remove landing pages with zero conversions after sufficient clicks. Never cut too early — let the data accumulate.`,
      },
      {
        title: "Your Blitz Roadmap",
        phase: "build", module: "Introduction", lessonType: "conceptual",
        networkPath: "universal", publisherPath: "all", blitzOrder: 100,
        content: `The Blitz is a structured 3-phase program: Phase 1 BUILD — Create your foundation. Choose an offer, build landing pages, create ads, set up tracking. Phase 2 TEST — Find your winners through data. Launch campaigns, monitor performance, identify winning elements. Phase 3 SCALE — Multiply your profits with proven winners. Scale budgets, expand to new publishers, launch new offers. At the end of The Blitz, you will have: A fully launched affiliate campaign, data-driven testing methodology, a proven offer/landing page/ad combination, and a framework for scaling.`,
      },
      {
        title: "BTS Support Guide",
        phase: "build", module: "Introduction", lessonType: "conceptual",
        networkPath: "universal", publisherPath: "all", blitzOrder: 101,
        content: `Support channels available to BTS members: BTS Concierge — Expert 1-on-1 support team for campaign-specific questions. BTS Community — Peer community for sharing wins, asking questions, and getting feedback. Live Coaching Calls — Weekly group coaching sessions with experienced coaches. When to use each channel: Use BTS Concierge for technical issues, campaign setup help, and specific troubleshooting. Use the Community for general questions, sharing progress, and networking. Use Live Coaching for strategic guidance, campaign reviews, and advanced optimization.`,
      },
      {
        title: "Copy Blocks Headline Writing Framework",
        phase: "build", module: "Landing Page Setup", lessonType: "conceptual",
        networkPath: "universal", publisherPath: "all", blitzOrder: 102,
        content: `Copy Blocks is a headline writing framework used in BTS for creating effective landing page headlines and ad copy. The framework provides structured templates for different types of hooks: curiosity hooks, benefit-driven hooks, problem-agitation hooks, and social proof hooks. Each Copy Block is a modular component that can be combined and customized for different offers and audiences.`,
      },
      {
        title: "Definitions: Landing Pages, Bridge Pages, Jump Pages, VSLs",
        phase: "build", module: "Landing Page Setup", lessonType: "conceptual",
        networkPath: "clickbank", publisherPath: "all", blitzOrder: 103,
        content: `Landing Page: The page a visitor sees after clicking your ad. Your first opportunity to convert. It should match the ad angle and pre-sell the offer. Bridge Page / Jump Page: Used interchangeably in BTS. A page between your ad and the offer's sales page. For ClickBank offers, this is your own page that "bridges" the visitor from the ad to the VSL. It warms up the visitor and sets expectations. VSL (Video Sales Letter): The offer owner's sales video page. This is NOT your page — it's the final step where the visitor watches the sales video and makes a purchase. Your job is to get qualified traffic to this page. Key distinction: You control your landing/bridge pages. You do NOT control the VSL — that's the offer owner's.`,
      },
    ];

    let created = 0;
    for (const doc of supplementaryDocs) {
      const systemPrompt = `You are formatting supplementary training content for the BTS Blitz program into a clean, structured training document. Format the provided content professionally with clear headings, bullet points where appropriate, and organized sections. Keep BTS branding only. Never reference TCE, Cherrington, or Adam's name.

OUTPUT FORMAT:

# ${doc.title}

**Phase:** ${doc.phase.toUpperCase()}
**Module:** ${doc.module}
**Category:** ${doc.lessonType}
**Applies to:** ${doc.publisherPath === "all" ? "All members" : doc.publisherPath.replace(/-/g, " ").replace(/\\b\\w/g, (c: string) => c.toUpperCase()) + " members"}
**Topics:** [extract relevant tags]

[Formatted content with headings and structure]`;

      const resp = await fetch(
        process.env.AI_INTEGRATIONS_OPENAI_BASE_URL + "/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-5",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: doc.content },
            ],
            max_completion_tokens: 2000,
          }),
          signal: AbortSignal.timeout(60000),
        },
      );

      if (!resp.ok) {
        console.error(`[Blitz Supplementary] Error for "${doc.title}": ${resp.status}`);
        continue;
      }

      const json = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
      const content = json.choices[0]?.message?.content || "";
      const topicsMatch = content.match(/\*\*Topics:\*\*\s*(.+)/);

      await db.insert(blitzLessonsTable).values({
        title: doc.title,
        category: doc.lessonType === "conceptual" ? "curriculum" : "strategy",
        content,
        tags: topicsMatch ? topicsMatch[1].trim() : "",
        sourceVideoTitle: null,
        sourceVideoId: null,
        status: "published",
        phase: doc.phase,
        module: doc.module,
        lessonId: null,
        lessonType: doc.lessonType,
        networkPath: doc.networkPath,
        publisherPath: doc.publisherPath,
        blitzOrder: doc.blitzOrder,
      });

      created++;
      console.log(`[Blitz Supplementary] Created: ${doc.title}`);
      await new Promise(r => setTimeout(r, 500));
    }

    res.json({ message: `Created ${created} supplementary documents`, total: created });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

function extractDocxText(filePath: string): string {
  try {
    const zip = new AdmZip(filePath);
    const docXml = zip.readAsText("word/document.xml");
    let text = docXml.replace(/<[^>]+>/g, " ").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

    text = text.replace(/^WEBVTT\s*/i, "");
    text = text.replace(/\d+\s+\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\s*/g, " ");
    text = text.replace(/\b[A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z]+:\s*/g, "");
    text = text.replace(/\s{2,}/g, " ");

    return text.trim();
  } catch {
    return "";
  }
}

function parseCoachingFilename(filePath: string): { coach: string; memberName: string; topic: string } {
  const parts = filePath.split("/");
  const coach = parts[parts.length - 2] || "Unknown";
  let filename = parts[parts.length - 1].replace(/\.docx$/, "").trim();
  filename = filename.replace(/\(\d+\)$/, "").trim();

  const emailPattern = /\s+\S+@\S+\.\S+/g;
  filename = filename.replace(emailPattern, "").trim();

  const sessionPattern = /\s*-\s*30-Minute Software Session with .+$/i;
  filename = filename.replace(sessionPattern, "").trim();

  let memberName = filename;
  let topic = "";
  const dashIdx = filename.indexOf(" - ");
  if (dashIdx > 0) {
    memberName = filename.substring(0, dashIdx).trim();
    topic = filename.substring(dashIdx + 3).trim();
  }

  return { coach, memberName, topic };
}

async function extractCoachingDocument(
  cleanedText: string,
  coach: string,
  memberName: string,
  topic: string,
): Promise<{ title: string; category: string; topics: string; content: string }> {
  const systemPrompt = `You are converting a raw 1-on-1 coaching call transcript into a clean, structured training document for a knowledge base. The source material is from a mentoring session at Build Test Scale (BTS), an affiliate marketing mentorship program.

The coach is helping a member with specific questions, problems, or setup tasks. Your job is to extract the TEACHING CONTENT and practical guidance into a reusable document.

RULES:
- Write in clear, direct prose as a training/reference document — NOT as a transcript
- Organize with clear headings (## and ###)
- Extract step-by-step instructions the coach gave as numbered lists
- Extract troubleshooting tips, common mistakes discussed, and solutions
- Extract specific tool configurations, settings, or platform workflows discussed
- Include specific examples, metrics, thresholds, or benchmarks mentioned
- Remove small talk, greetings, scheduling discussion, audio/video issues
- Remove member-specific personal details (names, account specifics) — keep the advice generic and reusable
- If the coach explains the same concept multiple ways, keep the clearest explanation
- Preserve any warnings, pitfalls, or "don't do this" advice
- Do NOT add information that isn't in the transcript
- Do NOT include phrases like "the coach said" or "in this call" — write as original training content
- Keep BTS branding. Never reference TCE, Cherrington, Charrington, or Adam.
- If the call is too short, administrative, or has no substantive teaching content, output ONLY the text: SKIP_NO_CONTENT
- Target length: 200-600 words per document (dense, high-signal content)

OUTPUT FORMAT (return ONLY this, no other text):

# [Document Title — descriptive of the topic, not the member name]

**Category:** [curriculum | strategy | sop | faq | troubleshooting | platform_guide]
**Topics:** [comma-separated topic tags for search]

## [First Section Heading]

[Clean, structured content...]

### [Sub-heading if needed]

[Content with numbered steps, key points, etc.]

## Key Takeaways

- [Bullet point summary of the most important points]`;

  const userContent = topic
    ? `Coaching call topic: "${topic}"\nCoach: ${coach}\n\nTranscript:\n${cleanedText.substring(0, 30000)}`
    : `Coach: ${coach}\nMember: ${memberName}\n\nTranscript:\n${cleanedText.substring(0, 30000)}`;

  const resp = await fetch(
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL + "/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_completion_tokens: 2000,
      }),
      signal: AbortSignal.timeout(90000),
    },
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${err.substring(0, 200)}`);
  }

  const json = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
  const output = json.choices[0]?.message?.content || "";

  if (output.includes("SKIP_NO_CONTENT")) {
    return { title: "", category: "", topics: "", content: "SKIP_NO_CONTENT" };
  }

  const titleMatch = output.match(/^#\s+(.+)/m);
  const categoryMatch = output.match(/\*\*Category:\*\*\s*(\w+)/);
  const topicsMatch = output.match(/\*\*Topics:\*\*\s*(.+)/);

  return {
    title: titleMatch ? titleMatch[1].trim() : `${topic || memberName} — Coaching Notes`,
    category: categoryMatch ? categoryMatch[1].trim() : "coaching",
    topics: topicsMatch ? topicsMatch[1].trim() : "",
    content: output,
  };
}

let coachingProcessingStatus = {
  running: false,
  total: 0,
  processed: 0,
  skipped: 0,
  errors: 0,
  currentFile: "",
};

router.get("/coaching-status", (_req: Request, res: Response) => {
  res.json({ processing: coachingProcessingStatus });
});

// RETIRED (Task #1533): coaching .docx flat-file mining — superseded by the
// Synthesis Engine (topic index → per-node synthesis). See retiredMining above.
router.post("/process-coaching-transcripts", retiredMining);

router.post("/process-coaching-retry", retiredMining);

async function processCoachingBatch(files: { coach: string; filePath: string; filename: string }[]) {
  const total = files.length;

  // Load the screened source registry once; gate + stamp each draft.
  const sources = await loadMiningSources();

  for (let i = 0; i < total; i++) {
    const file = files[i];
    coachingProcessingStatus.currentFile = `${i + 1}/${total}: ${file.filename}`;

    try {
      console.log(`[Coaching Pipeline] ${i + 1}/${total}: Processing ${file.coach}/${file.filename}`);

      // Skip quarantined / already-mined sources so a re-run doesn't reprocess.
      const sourceName = `${file.coach}/${file.filename.replace(/\.docx$/i, "")}`;
      const decision = decideMining(sourceName, sources);
      if (!decision.mine) {
        console.log(`[Coaching Pipeline] Skip (${decision.skipReason}): ${sourceName}`);
        coachingProcessingStatus.skipped++;
        coachingProcessingStatus.processed++;
        continue;
      }

      const rawText = extractDocxText(file.filePath);
      if (!rawText || rawText.length < 100) {
        console.log(`[Coaching Pipeline] Skipping ${file.filename} — too short (${rawText.length} chars)`);
        coachingProcessingStatus.skipped++;
        coachingProcessingStatus.processed++;
        continue;
      }

      const cleaned = cleanTranscript(rawText);
      const { coach, memberName, topic } = parseCoachingFilename(file.filePath);
      const extracted = await extractCoachingDocument(cleaned, coach, memberName, topic);

      if (extracted.content === "SKIP_NO_CONTENT") {
        console.log(`[Coaching Pipeline] Skipping ${file.filename} — no substantive content`);
        coachingProcessingStatus.skipped++;
        coachingProcessingStatus.processed++;
        continue;
      }

      const staleRefs = detectLegacyRefs(extracted.content);

      await db.insert(kbStagingDocsTable).values({
        title: extracted.title,
        category: extracted.category,
        content: extracted.content,
        tags: extracted.topics,
        sourceVideoTitle: file.filename,
        sourceVideoId: `${file.coach}/${file.filename}`,
        status: "needs_review",
        source: "coaching_call",
        module: file.coach,
        sourceId: decision.source?.id ?? null,
        authorityRole: decision.source?.authorityRole ?? "va",
        originType: originTypeForKind(decision.source?.sourceKind ?? "va_docx"),
        staleReferences: staleRefs.length > 0 ? staleRefs : null,
      });

      if (decision.source) await markSourceMined(decision.source.id);

      coachingProcessingStatus.processed++;
      console.log(`[Coaching Pipeline] Done: ${extracted.title}`);

      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[Coaching Pipeline] Error processing ${file.filename}:`, err);
      coachingProcessingStatus.errors++;
      coachingProcessingStatus.processed++;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  coachingProcessingStatus.running = false;
  console.log(`[Coaching Pipeline] Complete: ${coachingProcessingStatus.processed} processed, ${coachingProcessingStatus.skipped} skipped, ${coachingProcessingStatus.errors} errors`);
}

router.post("/seed-blitz", async (_req: Request, res: Response) => {
  try {
    const existing = await db
      .select({ cnt: count() })
      .from(blitzLessonsTable);

    if (existing[0].cnt > 0) {
      res.json({ message: `Blitz lessons already exist (${existing[0].cnt}). Skipping seed.`, seeded: 0 });
      return;
    }

    const seedPath = path.join(process.cwd(), "src/data/blitz-seed.json");
    if (!fs.existsSync(seedPath)) {
      res.status(404).json({ error: "Seed file not found" });
      return;
    }

    const docs = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
    let inserted = 0;

    for (const doc of docs) {
      await db.insert(blitzLessonsTable).values({
        title: doc.title,
        category: doc.category,
        content: doc.content,
        tags: doc.tags || "",
        sourceVideoTitle: doc.source_video_title,
        sourceVideoId: doc.source_video_id,
        status: doc.status && doc.status !== "pending_review" ? doc.status : "published",
        adminNotes: doc.admin_notes,
        editedContent: doc.edited_content,
        phase: doc.phase,
        module: doc.module,
        lessonId: doc.lesson_id,
        lessonType: doc.lesson_type,
        networkPath: doc.network_path,
        publisherPath: doc.publisher_path,
        blitzOrder: doc.blitz_order,
      });
      inserted++;
    }

    res.json({ message: `Seeded ${inserted} Blitz documents`, seeded: inserted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// ── Upload-based staging doc creation ────────────────────────────────────────
//
// Flow: client requests presigned URL (existing /storage/uploads/request-url),
// PUTs the file directly to GCS, then calls this endpoint with the objectPath.
// We download the file from storage, extract text by type, create a staging doc
// and fire-and-forget the AI triage — consistent with the video pipeline.

const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/aac",
  "audio/m4a", "audio/x-m4a", "audio/webm", "audio/flac",
]);
const VIDEO_MIME_TYPES = new Set([
  "video/mp4", "video/webm", "video/mpeg", "video/quicktime",
  "video/x-msvideo", "video/x-matroska",
]);

function guessAudioMime(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".weba"].includes(ext);
}
function guessVideoMime(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".mp4", ".webm", ".mpeg", ".mpg", ".mov", ".avi", ".mkv"].includes(ext);
}
function guessPdfMime(filename: string): boolean {
  return path.extname(filename).toLowerCase() === ".pdf";
}
function guessDocxMime(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".docx", ".doc"].includes(ext);
}
function guessTextMime(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".txt", ".md", ".markdown"].includes(ext);
}

type FileCategory = "text" | "pdf" | "docx" | "audio" | "video" | "unsupported";

function classifyFile(mimeType: string, originalFilename: string): FileCategory {
  const mime = mimeType.toLowerCase();
  if (AUDIO_MIME_TYPES.has(mime) || guessAudioMime(originalFilename)) return "audio";
  if (VIDEO_MIME_TYPES.has(mime) || guessVideoMime(originalFilename)) return "video";
  if (mime === "application/pdf" || guessPdfMime(originalFilename)) return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword" ||
    guessDocxMime(originalFilename)
  ) return "docx";
  if (mime.startsWith("text/") || guessTextMime(originalFilename)) return "text";
  return "unsupported";
}

router.post("/create-from-upload", async (req: Request, res: Response) => {
  try {
    const { objectPath, title, category, audience, originalFilename, mimeType } = req.body as {
      objectPath?: string;
      title?: string;
      category?: string;
      audience?: string;
      originalFilename?: string;
      mimeType?: string;
    };

    if (!objectPath || !originalFilename || !mimeType) {
      res.status(400).json({ error: "objectPath, originalFilename, and mimeType are required" });
      return;
    }

    const docTitle = (title || path.basename(originalFilename, path.extname(originalFilename))).trim() || originalFilename;
    const docCategory = category || "faq";
    const docAudience = (audience === "admin" ? "admin" : "member") as "admin" | "member";

    const fileType = classifyFile(mimeType, originalFilename);

    // Stage the doc immediately in a "processing" state and kick off the heavy
    // extraction + triage work asynchronously. The frontend polls
    // GET /admin/knowledgebase/staging/:id for live progress until the status
    // is no longer "processing".
    const initialStage =
      fileType === "audio" || fileType === "video"
        ? "Transcribing audio…"
        : "Extracting text…";

    const [inserted] = await db
      .insert(kbStagingDocsTable)
      .values({
        title: docTitle,
        category: docCategory,
        content: `[Processing ${originalFilename}…]`,
        tags: "",
        status: "processing",
        source: "upload",
        adminNotes: `Uploaded ${fileType === "unsupported" ? "file" : fileType}: ${originalFilename}. Source file stored at: ${objectPath}`,
        audience: docAudience,
        sourceObjectPath: objectPath,
        processingStage: initialStage,
        processingError: null,
      })
      .returning();

    // Fire-and-forget the extraction + triage pipeline.
    processUploadInBackground(inserted.id, {
      objectPath,
      originalFilename,
      docTitle,
      fileType,
      mimeType,
    }).catch((err) =>
      console.error("[KB Upload] Background processing error:", err),
    );

    res.json({
      stagingDocId: inserted.id,
      title: inserted.title,
      status: inserted.status,
      processingStage: inserted.processingStage,
      fileType,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[KB Upload] Error:", message);
    res.status(500).json({ error: message });
  }
});

// Manually-entered documents (the "Add Document" form) are routed through the
// same AI analysis as uploads instead of being written straight to the live KB.
// The content is already supplied, so analysis runs synchronously (one AI call)
// and the doc always lands in the human review queue (needs_review) with
// suggested metadata + risk flags. Nothing is ever auto-published.
router.post("/create-from-text", async (req: Request, res: Response) => {
  try {
    const { title, category, content, audience } = req.body as {
      title?: string;
      category?: string;
      content?: string;
      audience?: string;
    };

    if (!title || !title.trim() || !content || !content.trim()) {
      res.status(400).json({ error: "Title and content are required" });
      return;
    }

    const docAudience = (audience === "admin" ? "admin" : "member") as "admin" | "member";

    const [inserted] = await db
      .insert(kbStagingDocsTable)
      .values({
        title: title.trim(),
        category: category || "faq",
        content: content.trim(),
        tags: "",
        status: "processing",
        source: "manual",
        audience: docAudience,
        adminNotes: "Manually entered via the Add Document form.",
        processingStage: "Running AI triage…",
      })
      .returning();

    let action: AutoTriageDocResult["action"] | "needs_review" = "needs_review";
    let summary = "";

    try {
      const result = await runAutoTriageOnDoc(inserted);
      action = result.action;
      summary = result.summary;
    } catch (triageErr) {
      // Analysis is best-effort; on failure the doc still belongs in the human
      // review queue rather than going live unreviewed.
      console.error("[KB Manual] Analysis error:", triageErr);
      await db
        .update(kbStagingDocsTable)
        .set({ status: "needs_review" })
        .where(eq(kbStagingDocsTable.id, inserted.id));
    }

    // Clear the live-progress stage now that triage is complete.
    await db
      .update(kbStagingDocsTable)
      .set({ processingStage: null })
      .where(eq(kbStagingDocsTable.id, inserted.id));

    res.json({
      stagingDocId: inserted.id,
      title: inserted.title,
      action,
      summary,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[KB Manual] Error:", message);
    res.status(500).json({ error: message });
  }
});

interface UploadProcessingContext {
  objectPath: string;
  originalFilename: string;
  docTitle: string;
  fileType: FileCategory;
  mimeType: string;
}

async function setProcessingStage(id: number, stage: string): Promise<void> {
  await db
    .update(kbStagingDocsTable)
    .set({ processingStage: stage })
    .where(eq(kbStagingDocsTable.id, id));
}

async function processUploadInBackground(
  id: number,
  ctx: UploadProcessingContext,
): Promise<void> {
  const { objectPath, originalFilename, docTitle, fileType } = ctx;
  const storageService = new ObjectStorageService();

  try {
    let content = "";
    let adminNotes = "";

    if (fileType === "text") {
      const objectFile = await storageService.getObjectEntityFile(objectPath);
      const [buf] = await objectFile.download();
      content = buf.toString("utf-8");
      adminNotes = `Uploaded text file: ${originalFilename}. Source file stored at: ${objectPath}`;
    } else if (fileType === "pdf") {
      const objectFile = await storageService.getObjectEntityFile(objectPath);
      const [buf] = await objectFile.download();
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      let parsed: { text: string; total: number };
      try {
        parsed = await parser.getText();
      } finally {
        await parser.destroy();
      }
      content = parsed.text;
      adminNotes = `Uploaded PDF: ${originalFilename} (${parsed.total} pages). Source file stored at: ${objectPath}`;
    } else if (fileType === "docx") {
      const objectFile = await storageService.getObjectEntityFile(objectPath);
      const [buf] = await objectFile.download();
      const result = await mammoth.extractRawText({ buffer: buf });
      content = result.value;
      adminNotes = `Uploaded DOCX: ${originalFilename}. Source file stored at: ${objectPath}`;
    } else if (fileType === "audio" || fileType === "video") {
      // Download to tmp, extract audio via ffmpeg, then transcribe via Whisper.
      // Use execFileAsync (not execSync with shell) to avoid shell-injection risk.
      const tmpDir = "/tmp/kb-uploads";
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      // Sanitize: use only a timestamp-based name; ignore user-supplied extension
      // for the download file, always convert output to .mp3
      const safeBase = `kb-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const downloadPath = path.join(tmpDir, safeBase);
      const audioPath = path.join(tmpDir, `${safeBase}.mp3`);

      try {
        const objectFile = await storageService.getObjectEntityFile(objectPath);
        const [buf] = await objectFile.download();
        fs.writeFileSync(downloadPath, buf);

        // Convert any video/audio to a mono 16 kHz mp3 for Whisper
        await execFileAsync("ffmpeg", [
          "-y", "-i", downloadPath,
          ...(fileType === "video" ? ["-vn"] : []),
          "-acodec", "libmp3lame", "-ab", "64k", "-ar", "16000", "-ac", "1",
          audioPath,
        ], { timeout: 300000 });

        const transcript = await transcribeAudio(audioPath);
        const cleaned = cleanTranscript(transcript);

        await setProcessingStage(id, "Extracting key points…");
        const extracted = await extractDocument(cleaned, docTitle);

        content = extracted.content;
        adminNotes = `Uploaded ${fileType}: ${originalFilename} — transcribed via Whisper. Source file stored at: ${objectPath}`;
      } finally {
        try { fs.unlinkSync(downloadPath); } catch {}
        try { fs.unlinkSync(audioPath); } catch {}
      }
    } else {
      // Unsupported type — store reference with a placeholder so admin can add content
      content = `[Unsupported file type: ${originalFilename}]\n\nThis file has been stored but text could not be extracted automatically. Source file retrievable at: ${objectPath}\n\nPlease review and add content manually.`;
      adminNotes = `Uploaded unsupported file type: ${originalFilename} (${ctx.mimeType}). Source file stored at: ${objectPath}. No text extracted.`;
    }

    // Always ensure objectPath appears in adminNotes for text-extraction paths too
    if (!adminNotes.includes(objectPath)) {
      adminNotes += ` Source file stored at: ${objectPath}`;
    }

    if (!content.trim()) {
      content = `[No text extracted from ${originalFilename}]\n\nThe file was stored at ${objectPath} but no text content could be extracted. Please add content manually.`;
    }

    // Persist extracted content; move into AI triage stage (still "processing")
    await db
      .update(kbStagingDocsTable)
      .set({ content, adminNotes, processingStage: "Running AI triage…" })
      .where(eq(kbStagingDocsTable.id, id));

    // Run analysis synchronously on this single doc so the final status is set
    // exactly once. runAutoTriageOnDoc updates the row's status to needs_review
    // (i.e. no longer "processing"); it never auto-publishes.
    const [withContent] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, id));

    try {
      await runAutoTriageOnDoc(withContent);
    } catch (triageErr) {
      // Analysis is best-effort; if it fails the doc still belongs in the
      // human review queue. Never leave it stuck in "processing".
      console.error("[KB Upload] Analysis error:", triageErr);
      await db
        .update(kbStagingDocsTable)
        .set({ status: "needs_review" })
        .where(eq(kbStagingDocsTable.id, id));
    }

    // Clear the live-progress stage now that work is complete. Re-read to make
    // sure we don't clobber the final status that triage just set.
    await db
      .update(kbStagingDocsTable)
      .set({
        processingStage: null,
        status: sql`CASE WHEN ${kbStagingDocsTable.status} = 'processing' THEN 'needs_review' ELSE ${kbStagingDocsTable.status} END`,
      })
      .where(eq(kbStagingDocsTable.id, id));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[KB Upload] Processing failed for doc ${id}:`, message);
    await db
      .update(kbStagingDocsTable)
      .set({
        status: "error",
        processingStage: null,
        processingError: message,
      })
      .where(eq(kbStagingDocsTable.id, id))
      .catch((dbErr) =>
        console.error("[KB Upload] Failed to record processing error:", dbErr),
      );
  }
}

// ── Synthesis Engine (Task #1533) ───────────────────────────────────────────
//
// The taxonomy-driven replacement for flat-file mining. Two phases:
//   1. Topic index — classify every ai_source_documents row into the taxonomy
//      node(s) it materially informs (LLM + lexical fallback).
//   2. Synthesis — per node, consolidate all linked sources into ONE truth-doc
//      draft (create-only, needs_review) with multi-source provenance +
//      corroboration count, then run triage on the new drafts. Nothing
//      auto-publishes — the human gate is unchanged.

/** Build/refresh the topic index (source → node relevance links). Background. */
router.post("/build-topic-index", async (req: Request, res: Response) => {
  try {
    if (isTopicIndexRunning()) {
      res.json({ message: "Topic index build already running", running: true, state: getTopicIndexState() });
      return;
    }
    const force = req.body?.force === true;
    res.json({ message: `Building topic index (${force ? "full re-classify" : "incremental"}) in background.`, running: true });
    buildTopicIndexBackground({ force }).catch((err) =>
      console.error("[TopicIndex] Unhandled background error:", err),
    );
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * Topic-index progress + per-node source counts + the durable last-run report
 * and corpus health split (Task #1794). `lastRun` survives server restarts.
 */
router.get("/topic-index-status", async (_req: Request, res: Response) => {
  try {
    const [nodeCounts, lastRun, health] = await Promise.all([
      getNodeLinkCounts(),
      getLastTopicIndexRun(),
      getTopicIndexHealth(),
    ]);
    res.json({
      ...getTopicIndexState(),
      nodeCounts,
      lastRun,
      health,
      qualityCheckRunning: isQualityCheckRunning(),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * Model-quality spot-check (Task #1794 step 7): re-classify a sample of
 * healthy-LLM sources with the current classifier model (no persistence) and
 * compare node agreement + relevance deltas against the stored links. The
 * report is attached to the latest run row and surfaced via the status
 * endpoint. Background — poll topic-index-status for the result.
 */
router.post("/topic-index-quality-check", async (req: Request, res: Response) => {
  try {
    if (isTopicIndexRunning() || isQualityCheckRunning()) {
      res.status(409).json({ error: "A topic-index run or quality check is already running" });
      return;
    }
    const sampleSize = typeof req.body?.sampleSize === "number"
      ? Math.max(5, Math.min(30, Math.floor(req.body.sampleSize)))
      : 18;
    res.json({ message: `Running model-quality spot-check on ${sampleSize} sources in background.`, running: true });
    runTopicIndexQualitySpotCheck(sampleSize).catch((err) =>
      console.error("[TopicIndex] Quality spot-check failed:", err),
    );
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/** List taxonomy nodes with their linked-source counts (synthesis candidates). */
router.get("/synthesis-nodes", async (_req: Request, res: Response) => {
  try {
    const nodeCounts = await getNodeLinkCounts();
    const nodes = ALL_NODES.map((n) => ({
      slug: n.slug,
      label: n.label,
      root: n.root,
      sourceCount: nodeCounts[n.slug] ?? 0,
    }));
    res.json({ nodes, running: isSynthesisRunning(), state: getSynthesisState() });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/** Synthesis progress + last durable run report (survives restarts). */
router.get("/synthesis-status", async (_req: Request, res: Response) => {
  try {
    const [lastRun, failedNodesPendingRetry] = await Promise.all([
      getLastSynthesisRun(),
      getFailedNodesPendingRetry(),
    ]);
    res.json({ ...getSynthesisState(), lastRun, failedNodesPendingRetry });
  } catch {
    // Never let the durable-report lookup break live progress polling.
    res.json({ ...getSynthesisState(), lastRun: null, failedNodesPendingRetry: [] });
  }
});

/**
 * Selective synthesis (Part 2). Body: { scope, root?, nodes?, minSources? }.
 *   scope: "all" | "shelf" | "covered" | "incremental" | "nodes"
 * Resolves to a concrete node list, then synthesizes just those in the
 * background and triages the new drafts. Defaults to "all" for back-compat.
 */
router.post("/synthesize", async (req: Request, res: Response) => {
  try {
    if (isSynthesisRunning()) {
      res.json({ message: "Synthesis already running", running: true, state: getSynthesisState() });
      return;
    }
    const rawScope = typeof req.body?.scope === "string" ? req.body.scope : "all";
    const validScopes: SynthesisScope[] = ["all", "shelf", "covered", "incremental", "nodes"];
    if (!validScopes.includes(rawScope as SynthesisScope)) {
      res.status(400).json({ error: `Unknown scope: ${rawScope}` });
      return;
    }
    const scope = rawScope as SynthesisScope;
    const root = typeof req.body?.root === "string" ? req.body.root : null;
    if (scope === "shelf" && (!root || !HOME_ROOT_SLUGS.includes(root))) {
      res.status(400).json({ error: `Scope "shelf" requires a valid root (one of: ${HOME_ROOT_SLUGS.join(", ")})` });
      return;
    }
    const nodes = Array.isArray(req.body?.nodes)
      ? req.body.nodes.filter((n: unknown): n is string => typeof n === "string")
      : [];
    if (scope === "nodes" && nodes.length === 0) {
      res.status(400).json({ error: `Scope "nodes" requires a non-empty nodes array` });
      return;
    }
    const minSources = Number.isFinite(req.body?.minSources) ? Number(req.body.minSources) : undefined;

    const targetNodes = await resolveSynthesisScope({ scope, root, nodes, minSources });
    if (targetNodes.length === 0) {
      res.json({ message: "No nodes matched the requested scope; nothing to synthesize.", running: false, targetNodes: [] });
      return;
    }

    res.json({
      message: `Synthesizing ${targetNodes.length} node(s) (scope: ${scope}) in background.`,
      running: true,
      scope,
      targetNodes,
    });
    synthesizeNodesBackground(targetNodes, scope)
      .then(async (createdIds) => {
        if (createdIds.length === 0) return;
        const drafts = await db
          .select()
          .from(kbStagingDocsTable)
          .where(sql`${kbStagingDocsTable.id} = ANY(${createdIds})`);
        await runTriageBackground(drafts);
      })
      .catch((err) => console.error("[Synthesis] Unhandled background error:", err));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/** Depth-aware coverage view: per-node source depth, live docs, advisory depth gaps. */
router.get("/synthesis-coverage", async (_req: Request, res: Response) => {
  try {
    const coverage = await getSynthesisCoverage();
    res.json({ ...coverage, running: isSynthesisRunning(), state: getSynthesisState() });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/** Nodes affected by newly-classified sources since their last synthesis. */
router.get("/synthesis-affected", async (_req: Request, res: Response) => {
  try {
    const affected = await getAffectedNodes();
    res.json({ affected, count: affected.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * Blitz change-monitoring foundation (Task #1564) — DORMANT.
 *
 * Detects when the core-training source material changed since it was last
 * filed, and — for MATERIAL changes — proposes AI-reference-doc revisions
 * through the existing supersede path (synthesizeNode authors an `update` draft
 * against the node's published live doc; the human gate is unchanged).
 *
 * This endpoint is only reachable from a DISABLED "Scan for changes" button:
 * there is no boot hook and no schedule wired to it. It exists so the plumbing
 * is in place and verifiable, without the feature being live.
 */
router.post("/scan-core-training-changes", async (_req: Request, res: Response) => {
  try {
    if (isSynthesisRunning()) {
      res.status(409).json({ error: "A synthesis run is already in progress" });
      return;
    }

    const scan = await scanCoreTrainingSourceChanges();

    // No material change → nothing to propose. Report the scan outcome.
    if (scan.affectedNodes.length === 0) {
      res.json({
        message:
          scan.material.length === 0
            ? `Scanned ${scan.scanned} source(s); ${scan.changed.length} changed, none material — no revisions proposed.`
            : `Scanned ${scan.scanned} source(s); ${scan.material.length} material change(s) but no affected node has a published document to revise.`,
        running: false,
        scanned: scan.scanned,
        changed: scan.changed,
        material: scan.material,
        affectedNodes: scan.affectedNodes,
      });
      return;
    }

    // Reuse the normal synthesis path: it authors an `update` draft for each
    // affected node (target_live_doc_id + update_summary) and triages it, all
    // behind the unchanged human approval gate.
    res.json({
      message: `Scanned ${scan.scanned} source(s); ${scan.material.length} material change(s) — proposing revisions for ${scan.affectedNodes.length} node(s) in background.`,
      running: true,
      scanned: scan.scanned,
      changed: scan.changed,
      material: scan.material,
      affectedNodes: scan.affectedNodes,
    });
    synthesizeNodesBackground(scan.affectedNodes, "core-training-changes")
      .then(async (createdIds) => {
        if (createdIds.length === 0) return;
        const drafts = await db
          .select()
          .from(kbStagingDocsTable)
          .where(sql`${kbStagingDocsTable.id} = ANY(${createdIds})`);
        await runTriageBackground(drafts);
      })
      .catch((err) =>
        console.error("[SourceChangeScan] Unhandled background error:", err),
      );
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/** Synthesize a SINGLE node (synchronous). Triages the new draft if created. */
router.post("/synthesize/:node", async (req: Request, res: Response) => {
  try {
    const node = getParam(req.params.node);
    if (!isValidSynthesisNode(node)) {
      res.status(400).json({ error: `Unknown taxonomy node: ${node}` });
      return;
    }
    if (isSynthesisRunning()) {
      res.status(409).json({ error: "A synthesis run is already in progress" });
      return;
    }
    const result = await synthesizeNode(node);
    const newDraftIds = [
      ...(result.draftId ? [result.draftId] : []),
      ...result.atomicDraftIds,
    ];
    if (newDraftIds.length > 0) {
      const drafts = await db
        .select()
        .from(kbStagingDocsTable)
        .where(inArray(kbStagingDocsTable.id, newDraftIds));
      if (drafts.length > 0) {
        runTriageBackground(drafts).catch((err) =>
          console.error("[Synthesis] Triage error:", err),
        );
      }
    }
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
