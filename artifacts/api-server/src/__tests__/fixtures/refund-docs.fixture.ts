import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { scrubPrivateContent } from "../../lib/content-privacy-filter";

// TEST-ONLY (Task #2029): the legacy seed path (seed-kb.ts writing
// knowledgebase_docs) is retired. This fixture parses the SAME source files
// (qa-articles.txt / glossary.txt) and seeds the refund + BTS Agreement
// articles and the glossary DIRECTLY into ai_live_documents — the assistant's
// only retrieval corpus — so the refund-retrieval guard keeps exercising the
// exact production read path.

const KB_DIR = path.join(process.cwd(), "src/knowledge-base");

interface KBDoc {
  title: string;
  category: string;
  content: string;
}

export const BTS_AGREEMENT_KB_TITLES = new Set<string>([
  "What is the BTS Mentee Master Agreement?",
  "What are the Mentorship refund requirements?",
  "How do I request a Mentorship refund?",
  "How do I submit my Profit & Loss Tracker?",
  "How do I request a BTS Deposit refund?",
  "What membership terms does the BTS Mentorship Program offer?",
  "Does BTS guarantee profits or specific results?",
  "What are the intellectual property and confidentiality terms of the BTS Agreement?",
  "What are the governing law and termination terms of the BTS Agreement?",
  "What happens if I miss installment payments or need to cancel my BTS Mentorship?",
  "What are the BTS Agreement's liability, warranty, and other legal terms?",
]);

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


export async function seedRefundLiveDocsForTest(): Promise<void> {
  const docs: KBDoc[] = [];
  const qaRaw = readFile("qa-articles.txt");
  if (qaRaw) {
    docs.push(...parseQAArticles(qaRaw).filter((d) => BTS_AGREEMENT_KB_TITLES.has(d.title)));
  }
  const glossaryRaw = readFile("glossary.txt");
  if (glossaryRaw) docs.push(...parseGlossary(glossaryRaw));
  if (docs.length === 0) throw new Error("refund fixture: no source docs parsed");

  for (const doc of docs) {
    // Curated + verified NOW so the citable gate admits them (mirrors a
    // post-review verified state, as the retired legacy test did via UPDATE).
    await db.execute(
      sql`INSERT INTO ai_live_documents (title, category, content, audience, doc_class, last_verified)
          VALUES (${scrubPrivateContent(doc.title)}, ${doc.category}, ${scrubPrivateContent(doc.content)}, 'member', 'curated', NOW())
          ON CONFLICT (title) DO UPDATE SET
            content = EXCLUDED.content,
            category = EXCLUDED.category,
            doc_class = EXCLUDED.doc_class,
            last_verified = COALESCE(ai_live_documents.last_verified, EXCLUDED.last_verified),
            deleted_at = NULL,
            updated_at = NOW()`,
    );
  }
}
