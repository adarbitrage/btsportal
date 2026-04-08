import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "@workspace/db";
import { kbStagingDocsTable } from "@workspace/db/schema";
import { eq, count } from "drizzle-orm";
import { requireAdmin } from "../../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, "../../knowledge-base");

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

export default router;
