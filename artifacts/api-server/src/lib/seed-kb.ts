import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { knowledgebaseDocsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { scrubPrivateContent } from "./content-privacy-filter";

const KB_DIR = path.join(process.cwd(), "src/knowledge-base");

interface KBDoc {
  title: string;
  category: string;
  content: string;
}

function parseTrainingDocuments(raw: string): KBDoc[] {
  const docs: KBDoc[] = [];
  const sections = raw.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);

  for (const section of sections) {
    if (!section.startsWith("Title:")) continue;

    const lines = section.split("\n");
    const titleLine = lines.find((l) => l.startsWith("Title:"));
    const categoryLine = lines.find((l) => l.startsWith("Category:"));

    if (!titleLine) continue;

    const title = titleLine.replace(/^Title:\s*/, "").trim();
    const category = categoryLine ? categoryLine.replace(/^Category:\s*/, "").trim() : "curriculum";

    const contentStartIdx = lines.findIndex((l) => l.startsWith("#"));
    const content = contentStartIdx >= 0 ? lines.slice(contentStartIdx).join("\n").trim() : section;

    if (title && content) {
      docs.push({ title, category, content: content.slice(0, 6000) });
    }
  }

  return docs;
}

function parseVideoTranscripts(raw: string): KBDoc[] {
  const docs: KBDoc[] = [];
  const sections = raw.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);

  for (const section of sections) {
    if (!section.includes("Title:") && !section.includes("Video ID:")) continue;

    const lines = section.split("\n");
    const titleLine = lines.find((l) => l.startsWith("Title:"));
    if (!titleLine) continue;

    const title = titleLine.replace(/^Title:\s*/, "").trim();
    if (!title) continue;

    const bodyLines = lines.filter(
      (l) => !l.startsWith("Title:") && !l.startsWith("Video ID:")
    );
    const content = bodyLines.join(" ").replace(/\s+/g, " ").trim();

    if (content.length < 50) continue;

    const chunks = chunkText(content, 3000);
    chunks.forEach((chunk, i) => {
      const chunkTitle = chunks.length > 1 ? `${title} (Part ${i + 1})` : title;
      docs.push({
        title: chunkTitle,
        category: "curriculum",
        content: chunk,
      });
    });
  }

  return docs;
}

function parseQAArticles(raw: string): KBDoc[] {
  const docs: KBDoc[] = [];
  const parts = raw.split(/\n### /);

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const lines = part.split("\n");
    const title = lines[0].trim();
    if (!title) continue;

    const rest = lines.slice(1).join("\n");
    const contentMatch = rest.match(/Content:\s*\n([\s\S]*?)(?:\* \* \*|$)/);
    const content = contentMatch
      ? contentMatch[1].trim()
      : rest.replace(/Description:.*\n/, "").trim();

    if (title && content && content.length > 30) {
      docs.push({ title, category: "faq", content: content.slice(0, 6000) });
    }
  }

  return docs;
}

function parseGlossary(raw: string): KBDoc[] {
  const lines = raw.split("\n");
  const terms: string[] = [];

  for (const line of lines) {
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    const term = cells[0];
    const definition = cells[1];

    if (
      !term ||
      !definition ||
      term === "Item" ||
      term === "---" ||
      term.startsWith("80 Digital") ||
      term.startsWith("BTS Glossary")
    ) {
      continue;
    }

    if (definition && definition.length > 3 && definition !== "---") {
      const note = cells[2] && cells[2] !== "---" && cells[2].length > 3 ? ` Note: ${cells[2]}` : "";
      terms.push(`**${term}**: ${definition}${note}`);
    }
  }

  if (terms.length === 0) return [];

  const chunks = chunkTerms(terms, 3000);
  return chunks.map((chunk, i) => ({
    title: chunks.length > 1 ? `BTS Affiliate Marketing Glossary (Part ${i + 1})` : "BTS Affiliate Marketing Glossary",
    category: "glossary",
    content: `Definitions of key affiliate marketing terms used in the BTS program:\n\n${chunk}`,
  }));
}

function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxLen;
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > start) end = lastSpace;
    }
    chunks.push(text.slice(start, end).trim());
    start = end + 1;
  }
  return chunks;
}

function chunkTerms(terms: string[], maxLen: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let len = 0;

  for (const term of terms) {
    if (len + term.length > maxLen && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
      len = 0;
    }
    current.push(term);
    len += term.length + 1;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

function readFile(filename: string): string {
  try {
    return fs.readFileSync(path.join(KB_DIR, filename), "utf-8");
  } catch {
    console.warn(`[seed-kb] Could not read ${filename}, skipping.`);
    return "";
  }
}

function parseCoachingTranscripts(raw: string): KBDoc[] {
  const docs: KBDoc[] = [];
  const sections = raw.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);

  for (const section of sections) {
    const titleMatch = section.match(/^##\s+(.+)$/m);
    if (!titleMatch) continue;

    const rawTitle = titleMatch[1].trim();

    const dialogLines: string[] = [];
    for (const line of section.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^\d+$/.test(trimmed)) continue;
      if (/^\d+:\d+:\d+\.\d+\s*-->\s*\d+:\d+:\d+\.\d+/.test(trimmed)) continue;
      if (trimmed === "WEBVTT") continue;
      if (trimmed.startsWith("##")) continue;
      if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,\s+\d{4}/.test(trimmed)) continue;
      if (/\bCentral Time\b|\bEastern Time\b|\bPacific Time\b|\bMountain Time\b/.test(trimmed)) continue;
      if (/^ID:\s*\d/.test(trimmed)) continue;
      dialogLines.push(trimmed);
    }

    const cleanedContent = dialogLines.join(" ").replace(/\s+/g, " ").trim();
    if (cleanedContent.length < 200) continue;

    const chunks = chunkText(cleanedContent, 2500).slice(0, 5);
    chunks.forEach((chunk, i) => {
      const chunkTitle = chunks.length > 1 ? `${rawTitle} (Part ${i + 1})` : rawTitle;
      docs.push({ title: chunkTitle, category: "coaching", content: chunk });
    });
  }

  return docs;
}

export async function seedKnowledgebaseFromFiles(): Promise<void> {
  console.log("[seed-kb] Ingesting BTS knowledge base files...");

  const allDocs: KBDoc[] = [];

  const trainingRaw = readFile("training-documents.txt");
  if (trainingRaw) allDocs.push(...parseTrainingDocuments(trainingRaw));

  const videoRaw = readFile("video-transcripts.txt");
  if (videoRaw) allDocs.push(...parseVideoTranscripts(videoRaw));

  const qaRaw = readFile("qa-articles.txt");
  if (qaRaw) allDocs.push(...parseQAArticles(qaRaw));

  const glossaryRaw = readFile("glossary.txt");
  if (glossaryRaw) allDocs.push(...parseGlossary(glossaryRaw));

  const coachingRaw = readFile("coaching-transcripts.txt");
  if (coachingRaw) allDocs.push(...parseCoachingTranscripts(coachingRaw));

  if (allDocs.length === 0) {
    console.log("[seed-kb] No documents parsed, nothing to insert.");
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const doc of allDocs) {
    try {
      const result = await db.execute(
        sql`INSERT INTO knowledgebase_docs (title, category, content)
            VALUES (${scrubPrivateContent(doc.title)}, ${doc.category}, ${scrubPrivateContent(doc.content)})
            ON CONFLICT (title) DO NOTHING
            RETURNING id`
      );
      if ((result.rows as any[]).length > 0) {
        inserted++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[seed-kb] Error inserting "${doc.title}":`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[seed-kb] Done. Inserted: ${inserted}, Skipped (already exist): ${skipped}, Total parsed: ${allDocs.length}`);
}
