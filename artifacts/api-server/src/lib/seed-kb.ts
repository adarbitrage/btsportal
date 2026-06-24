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

/**
 * Internal, admin-only SOP documents. These live in the same
 * `knowledgebase_docs` table as member content but carry `audience='admin'`,
 * so every member-facing retrieval path (AI Assistant chat, voice KB search,
 * RAG retriever, searchTranscripts) excludes them. They surface only in the
 * admin Knowledge Base management page.
 *
 * Inserted verbatim (no privacy scrub) since the body is operator
 * documentation with no member PII. Idempotent via ON CONFLICT (title) DO
 * NOTHING keyed on the UNIQUE title — re-runs neither duplicate nor overwrite.
 */
const INTERNAL_SOP_DOCS: KBDoc[] = [
  {
    title: "SOP: Machine → Portal Product Granting Integration",
    category: "sop",
    content: `# SOP: Machine → Portal Product Granting Integration

**Audience:** Internal / Admins only
**System:** \`POST /api/integrations/grant-product\` (BTS Member Portal API)
**Purpose:** When a purchase happens in an external system ("The Machine" /
checkout), that system calls this endpoint to grant the buyer access to the
corresponding portal products and entitlements.

## 1. Overview
External systems call the grant-product endpoint after a successful purchase.
The endpoint finds-or-creates the member by email, grants them the purchased
product(s), recalculates their entitlements, and triggers onboarding side
effects (welcome email, CRM sync). It is safe to call more than once for the
same order — duplicate calls return the original result and never double-grant.

## 2. Endpoint & Authentication
- **Method / Path:** \`POST /api/integrations/grant-product\`
- **Auth:** API key in the \`Authorization: Bearer bts_live_sk_…\` header.
- **Required scope:** the API key must have the \`integrations:grant_products\`
  permission. A key without this scope receives \`401/403\`.
- Keys are issued and managed by admins. Never share or paste a full key into
  logs, tickets, or chat — only the \`bts_live_sk_\` prefix is safe to reference.

## 3. Request Body
| Field | Required | Notes |
|-------|----------|-------|
| \`externalOrderId\` | yes | Unique order id from the source system. Used for idempotency. |
| \`externalSource\` | yes | Identifier of the calling system (e.g. \`machine\`). |
| \`customer.email\` | yes | Used to find or create the member. |
| \`purchasedAt\` | yes | ISO 8601 timestamp of the purchase. |
| \`productKeys[]\` | one of | The source system's product keys (resilient path — see §4). |
| \`productSlugs[]\` | one of | Exact portal product slugs (strict — must match known slugs). |

Provide **either** \`productKeys\` **or** \`productSlugs\`.

## 4. Product Resolution & Unknown-Key Fallback
- **\`productKeys\` path is resilient:** each key is resolved independently. An
  unknown/unmapped key does NOT fail the request. Instead it is recorded in the
  \`machine_unknown_product_keys\` table (incrementing an occurrence count) and
  falls back to the default front-end product so the buyer still gets access.
- **\`productSlugs\` path is strict:** slugs must match known portal product slugs.
- Admins should periodically review \`machine_unknown_product_keys\` and add a real
  mapping for any recurring key so it grants the correct product instead of the
  fallback.

## 5. What a Successful Grant Does
- Finds the member by email, or creates a new member account if none exists.
- Inserts an active \`user_products\` grant for each resolved product (status
  \`active\`). A partial unique index guarantees at most **one active grant per
  (member, product)**.
- Recalculates the member's entitlement set (the union derived from all active
  products).
- Queues onboarding side effects: a welcome email and a CRM (GHL) sync.

## 6. Idempotency (Safe Retries)
- Idempotency is keyed on \`externalSource\` + \`externalOrderId\` (recorded in
  \`webhook_logs\` as \`\${source}_\${orderId}\`).
- An exact replay of an already-processed order returns the **cached snapshot**
  of the original response. No new rows are written, no duplicate grants occur,
  and no unique-constraint error is raised.

## 7. How to Verify the Integration (Test Procedure)
Use synthetic, clearly-tagged data and clean it up afterward. Never test against
a real customer's email.
1. Mint a temporary API key with the \`integrations:grant_products\` scope.
2. **Valid multi-key grant:** call the endpoint with several known product keys
   for a fresh synthetic email. Expect \`200\`, an active \`user_products\` row per
   product, and the correct combined entitlements.
3. **Unknown-key fallback:** call with an unmapped key. Expect \`200\` (not 404),
   a new row in \`machine_unknown_product_keys\`, and a fallback grant to the
   default front-end product.
4. **Idempotent replay:** repeat the exact first call. Expect \`200\`, the cached
   snapshot returned, no duplicate active grants, and no unique-constraint error.
5. **Clean up:** delete the synthetic member, its grants, side-effect log rows,
   the webhook log entries, the recorded unknown key, and the temporary API key.

## 8. Troubleshooting
- **401 / 403:** missing/invalid API key, or the key lacks
  \`integrations:grant_products\`.
- **Buyer got the wrong (front-end) product:** the source sent an unmapped key —
  check \`machine_unknown_product_keys\` and add the correct mapping.
- **"Nothing happened" on a retry:** expected — idempotency returned the cached
  result from the first call.
- **Buyer missing expected access:** confirm the active \`user_products\` rows and
  that the entitlement set was recalculated; verify the product keys/slugs sent.`,
  },
];

/**
 * Titles of the refund + BTS Mentorship Agreement articles that must be
 * force-refreshed from `qa-articles.txt` (NOT just inserted-if-missing). The
 * two refund articles already exist in seeded databases with stale content, so
 * the normal `ON CONFLICT (title) DO NOTHING` seeder can never update them; the
 * Agreement articles are new. Both cases are handled by the upsert in
 * `ensureBtsAgreementKbContent()`.
 */
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

/**
 * Force the BTS Mentorship Agreement / refund KB articles and the affiliate
 * marketing glossary to match the source files, OVERWRITING existing rows.
 *
 * Why this exists alongside `seedKnowledgebaseFromFiles()`:
 *   that seeder inserts with `ON CONFLICT (title) DO NOTHING`, so it can add the
 *   brand-new BTS Agreement articles but can NEVER refresh the two refund
 *   articles or the glossary rows that already exist in a database with stale
 *   content (e.g. the old refund criteria / missing glossary terms). Production
 *   is a SEPARATE database the agent cannot write directly; the only way the
 *   corrected content reaches it is for a freshly-deployed instance to apply
 *   this overwrite on boot.
 *
 * Idempotent: `ON CONFLICT (title) DO UPDATE ... WHERE` the stored content/
 * category actually differs from the source, so a row already in sync is never
 * rewritten and the whole function is a fast no-op once everything matches.
 * Content is scrubbed through the privacy filter exactly like the main seeder.
 */
export async function ensureBtsAgreementKbContent(): Promise<void> {
  const docs: KBDoc[] = [];

  const qaRaw = readFile("qa-articles.txt");
  if (qaRaw) {
    docs.push(
      ...parseQAArticles(qaRaw).filter((d) => BTS_AGREEMENT_KB_TITLES.has(d.title)),
    );
  }

  const glossaryRaw = readFile("glossary.txt");
  if (glossaryRaw) {
    docs.push(...parseGlossary(glossaryRaw));
  }

  if (docs.length === 0) {
    console.log(
      "[seed-kb] ensureBtsAgreementKbContent: no source docs parsed, skipping.",
    );
    return;
  }

  let written = 0;
  let unchanged = 0;

  for (const doc of docs) {
    try {
      const result = await db.execute(
        sql`INSERT INTO knowledgebase_docs (title, category, content)
            VALUES (${scrubPrivateContent(doc.title)}, ${doc.category}, ${scrubPrivateContent(doc.content)})
            ON CONFLICT (title) DO UPDATE
              SET content = EXCLUDED.content,
                  category = EXCLUDED.category,
                  updated_at = NOW()
              WHERE knowledgebase_docs.content IS DISTINCT FROM EXCLUDED.content
                 OR knowledgebase_docs.category IS DISTINCT FROM EXCLUDED.category
            RETURNING id`,
      );
      if ((result.rows as any[]).length > 0) {
        written++;
      } else {
        unchanged++;
      }
    } catch (err) {
      console.error(
        `[seed-kb] ensureBtsAgreementKbContent error on "${doc.title}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[seed-kb] ensureBtsAgreementKbContent done. Written: ${written}, ` +
      `Unchanged: ${unchanged}, Targeted: ${docs.length}.`,
  );
}

export async function seedInternalSops(): Promise<void> {
  let inserted = 0;
  let skipped = 0;

  for (const doc of INTERNAL_SOP_DOCS) {
    try {
      const result = await db.execute(
        sql`INSERT INTO knowledgebase_docs (title, category, content, audience)
            VALUES (${doc.title}, ${doc.category}, ${doc.content}, 'admin')
            ON CONFLICT (title) DO NOTHING
            RETURNING id`
      );
      if ((result.rows as any[]).length > 0) {
        inserted++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[seed-kb] Error inserting internal SOP "${doc.title}":`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[seed-kb] Internal SOPs done. Inserted: ${inserted}, Skipped (already exist): ${skipped}.`);
}
