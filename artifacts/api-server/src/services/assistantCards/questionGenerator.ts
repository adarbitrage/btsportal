import { db, knowledgebaseDocsTable } from "@workspace/db";
import { sql, inArray } from "drizzle-orm";
import { getAnthropicClient } from "@workspace/integrations-anthropic-ai";
import { verifyQuestionBatch } from "./questionVerifier.js";

const MAX_CONTENT_CHARS = 24000;

const SYSTEM_PROMPT = `You are helping admins of an affiliate marketing mentorship platform (Build, Test, Scale)
curate suggested questions for their AI Assistant.

You will be given:
- A card label and description (the topic area)
- A sample of knowledge base content related to that topic

Your job: generate 40–50 questions a real member would actually ask about this topic.

Rules:
- Each question must be answerable from the provided knowledge base content.
- Phrase questions as a member would naturally type them (casual, first-person).
- Mix difficulty: some basic "how do I..." questions, some intermediate troubleshooting,
  a few advanced strategy questions.
- Avoid yes/no questions — favor "how", "what", "when", "why".
- Avoid duplicate questions or near-duplicates.

Respond ONLY with a JSON array of strings — no preamble, no markdown.`;

export interface GeneratorOptions {
  cardId: number;
  cardLabel: string;
  cardDescription: string;
  kbDocIds?: number[];
  kbTags?: string[];
  targetCount?: number;
}

export interface GeneratedCandidate {
  question_text: string;
  source_kb_doc_ids: number[];
  retrieval_confidence: number;
}

export interface GeneratorResult {
  candidates: GeneratedCandidate[];
  discarded_count: number;
  warning?: string;
}

async function loadKbDocs(
  kbDocIds?: number[],
  kbTags?: string[],
): Promise<Array<{ id: number; title: string; content: string; category: string }>> {
  if (kbDocIds && kbDocIds.length > 0) {
    return db
      .select({
        id: knowledgebaseDocsTable.id,
        title: knowledgebaseDocsTable.title,
        content: knowledgebaseDocsTable.content,
        category: knowledgebaseDocsTable.category,
      })
      .from(knowledgebaseDocsTable)
      .where(inArray(knowledgebaseDocsTable.id, kbDocIds));
  }

  if (kbTags && kbTags.length > 0) {
    const tagsArray = `{${kbTags.join(",")}}`;
    const results = await db.execute(
      sql`SELECT id, title, content, category FROM knowledgebase_docs WHERE category = ANY(${tagsArray}::text[])`,
    );
    return (results.rows as any[]).map((r) => ({
      id: r.id as number,
      title: r.title as string,
      content: r.content as string,
      category: r.category as string,
    }));
  }

  return db
    .select({
      id: knowledgebaseDocsTable.id,
      title: knowledgebaseDocsTable.title,
      content: knowledgebaseDocsTable.content,
      category: knowledgebaseDocsTable.category,
    })
    .from(knowledgebaseDocsTable);
}

function buildKbSample(docs: Array<{ title: string; content: string }>): string {
  let sample = "";
  for (const doc of docs) {
    const docText = `\n\n--- ${doc.title} ---\n${doc.content}`;
    if (sample.length + docText.length > MAX_CONTENT_CHARS) {
      const remaining = MAX_CONTENT_CHARS - sample.length;
      if (remaining > 200) {
        sample += docText.slice(0, remaining);
      }
      break;
    }
    sample += docText;
  }
  return sample.trim();
}

function parseCandidates(rawText: string): string[] {
  try {
    const jsonText = rawText
      .replace(/^```(?:json)?\n?/m, "")
      .replace(/\n?```$/m, "")
      .trim();
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  } catch {
    return [];
  }
}

export async function generateQuestions(options: GeneratorOptions): Promise<GeneratorResult> {
  const { cardLabel, cardDescription, kbDocIds, kbTags, targetCount = 30 } = options;

  const docs = await loadKbDocs(kbDocIds, kbTags);
  const kbSample = buildKbSample(docs);

  const userMessage = [
    `Card topic: ${cardLabel}`,
    cardDescription ? `Description: ${cardDescription}` : null,
    "",
    "Knowledge base content:",
    kbSample || "(no knowledge base documents found for the requested scope)",
    "",
    "Generate 40-50 candidate questions for this card topic.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText = response.content[0].type === "text" ? response.content[0].text : "[]";
  const candidates = parseCandidates(rawText);

  const verifyOpts = kbDocIds && kbDocIds.length > 0
    ? { kbDocIds }
    : kbTags && kbTags.length > 0
    ? { categories: kbTags }
    : undefined;

  const verificationResults = await verifyQuestionBatch(candidates, verifyOpts);

  const passed = verificationResults.filter((r) => r.passed);
  const discardedCount = verificationResults.length - passed.length;

  passed.sort((a, b) => b.retrievalConfidence - a.retrievalConfidence);
  const topCandidates = passed.slice(0, targetCount);

  const result: GeneratorResult = {
    candidates: topCandidates.map((r) => ({
      question_text: r.questionText,
      source_kb_doc_ids: r.sourceKbDocIds,
      retrieval_confidence: r.retrievalConfidence,
    })),
    discarded_count: discardedCount,
  };

  if (verificationResults.length > 0 && discardedCount / verificationResults.length > 0.5) {
    result.warning =
      "More than 50% of generated questions failed RAG verification. The knowledge base may be sparse for this topic.";
  }

  return result;
}
