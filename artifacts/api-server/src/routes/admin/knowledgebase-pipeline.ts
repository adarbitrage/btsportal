import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { kbStagingDocsTable } from "@workspace/db/schema";
import { eq, count, and } from "drizzle-orm";
import { requireAdmin } from "../../middleware/auth.js";
import { execSync } from "child_process";
import { matchVideoToCurriculum, type BlitzLesson } from "./blitz-curriculum.js";

const KB_DIR = path.join(process.cwd(), "src/knowledge-base");

const router = Router();
router.use(requireAdmin);

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
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Video title: "${videoTitle}"\n\nTranscript:\n${cleanedText}`,
          },
        ],
        max_tokens: 2000,
        temperature: 0.3,
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

router.post("/process-transcripts", async (req: Request, res: Response) => {
  try {
    const existing = await db
      .select({ cnt: count() })
      .from(kbStagingDocsTable);
    if (existing[0].cnt > 0) {
      res.json({
        message: "Staging table already has documents. Clear first or use process-single.",
        existingCount: existing[0].cnt,
      });
      return;
    }

    const raw = fs.readFileSync(
      path.join(KB_DIR, "video-transcripts.txt"),
      "utf-8",
    );
    const sections = raw
      .split(/\n---\n/)
      .filter(
        (s) => s.trim().length > 50 && /^Title:\s*.+/m.test(s),
      );

    res.json({
      message: `Starting pipeline for ${sections.length} transcripts. Processing in background.`,
      count: sections.length,
    });

    processTranscriptsBackground(sections).catch((err) =>
      console.error("[KB Pipeline] Background error:", err),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.post("/process-single/:index", async (req: Request, res: Response) => {
  try {
    const idx = parseInt(req.params.index);
    const raw = fs.readFileSync(
      path.join(KB_DIR, "video-transcripts.txt"),
      "utf-8",
    );
    const sections = raw
      .split(/\n---\n/)
      .filter(
        (s) => s.trim().length > 50 && /^Title:\s*.+/m.test(s),
      );

    if (idx < 0 || idx >= sections.length) {
      res.status(400).json({ error: `Invalid index. Range: 0-${sections.length - 1}` });
      return;
    }

    const section = sections[idx];
    const videoTitle =
      section.match(/^Title:\s*(.+)/m)?.[1]?.trim() || "Unknown";
    const videoId =
      section.match(/^Video ID:\s*(.+)/m)?.[1]?.trim() || "";
    const transcriptBody = section
      .replace(/^Title:.*\n/m, "")
      .replace(/^Video ID:.*\n/m, "")
      .trim();

    const cleaned = cleanTranscript(transcriptBody);
    const doc = await extractDocument(cleaned, videoTitle);

    const [inserted] = await db
      .insert(kbStagingDocsTable)
      .values({
        title: doc.title,
        category: doc.category,
        content: doc.content,
        tags: doc.topics,
        sourceVideoTitle: videoTitle,
        sourceVideoId: videoId,
        status: "pending_review",
      })
      .returning();

    res.json({ success: true, document: inserted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

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

    try {
      const cleaned = cleanTranscript(transcriptBody);
      const doc = await extractDocument(cleaned, videoTitle);

      await db.insert(kbStagingDocsTable).values({
        title: doc.title,
        category: doc.category,
        content: doc.content,
        tags: doc.topics,
        sourceVideoTitle: videoTitle,
        sourceVideoId: videoId,
        status: "pending_review",
      });

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

  console.log(
    `[KB Pipeline] Complete. Processed: ${processed}, Errors: ${errors}`,
  );
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
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Video title: "${lesson.title}"\n\nTranscript:\n${cleanedText}`,
          },
        ],
        max_tokens: 3000,
        temperature: 0.3,
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
      .select({ status: kbStagingDocsTable.status, cnt: count() })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.source, "blitz"))
      .groupBy(kbStagingDocsTable.status);

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

      await db.insert(kbStagingDocsTable).values({
        title: doc.title,
        category: doc.category,
        content: doc.content,
        tags: doc.topics + (toolsMentioned.length > 0 ? ", " + toolsMentioned.join(", ") : ""),
        sourceVideoTitle: video.title,
        sourceVideoId: video.id,
        status: "pending_review",
        source: "blitz",
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
      .select({ lessonId: kbStagingDocsTable.lessonId })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.source, "blitz"));

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
        content: `Caterpillar: Native ad publisher (internal codename for NewsBreak). Best for long-form native ads with headlines and descriptions. Supports image and video ad formats. Grasshopper: Display ad publisher. Banner-based advertising with various placement options. Crane: Display ad publisher. Similar to Grasshopper with different inventory and audience. Master: Premium publisher for scaling. Available after proving profitability with Caterpillar, Grasshopper, or Crane. Higher traffic volume, requires proven campaign performance.`,
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
        content: `Current asset requirements for Caterpillar (NewsBreak) native ads: Headlines: 90 character limit. Test 5-10 headline variants. Use curiosity-driven, benefit-focused headlines. Images: 960x540 pixels (16:9 aspect ratio). Test static images, GIFs, and short video clips. Dynamic content macros: Use {city} and {state} macros in headlines for geo-personalization. Tips: Front-load the benefit in headlines. Use real-looking images (not stock photos). Test both emotional and logical angles.`,
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
            model: "gpt-4o",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: doc.content },
            ],
            max_tokens: 2000,
            temperature: 0.3,
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

      await db.insert(kbStagingDocsTable).values({
        title: doc.title,
        category: doc.lessonType === "conceptual" ? "curriculum" : "strategy",
        content,
        tags: topicsMatch ? topicsMatch[1].trim() : "",
        sourceVideoTitle: null,
        sourceVideoId: null,
        status: "pending_review",
        source: "blitz",
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

export default router;
