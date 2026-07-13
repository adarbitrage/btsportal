import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { knowledgebaseDocsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { scrubPrivateContent } from "./content-privacy-filter";
import { docClassForCategory, TRANSCRIPT_CATEGORIES } from "./kb-taxonomy";

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

  if (allDocs.length === 0) {
    console.log("[seed-kb] No documents parsed, nothing to insert.");
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const doc of allDocs) {
    try {
      // doc_class is derived from the category so transcript-derived rows
      // (coaching / curriculum) can NEVER enter as citable. last_verified is
      // left NULL so even curated rows are held until a human verifies them.
      const result = await db.execute(
        sql`INSERT INTO knowledgebase_docs (title, category, content, doc_class)
            VALUES (${scrubPrivateContent(doc.title)}, ${doc.category}, ${scrubPrivateContent(doc.content)}, ${docClassForCategory(doc.category)})
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
    title: "SOP: How to Add Content to the Knowledge Base",
    category: "sop",
    content: `# SOP: How to Add Content to the Knowledge Base

**Audience:** Internal / Admins only
**Purpose:** A plain-language guide so any team member can add content to the BTS Member Portal Knowledge Base (KB) without needing to touch code.

---

## Overview

The Knowledge Base is the library that powers the AI Assistant chat, the voice assistant, and member-facing search. Content only reaches members after it has been reviewed and approved. There are two main ways to add content, and a third category (private recordings) that is handled separately.

---

## Path 1 — The AI Pipeline (recommended for videos and audio)

**Best for:** Training videos, coaching call recordings, audio content, or any source where you have a recording but not a written document yet.

**Where:** Admin panel → Knowledge Base → AI Pipeline (\`/admin/knowledgebase/pipeline\`)

**How it works:**

1. Go to the AI Pipeline page in the admin panel.
2. Point the pipeline at the video or audio source (upload the file or provide the source details on the page).
3. The system automatically transcribes the audio, removes filler words, and extracts the key teaching content into a structured document.
4. The draft document lands in the **review queue** with a status of "Pending Review."
5. An admin opens the draft, reads it, makes any edits needed, and clicks **Approve** to push it live.
6. Once approved, the document is immediately available in the member Knowledge Base and to the AI Assistant.

**Tips:**
- The pipeline works best on focused, single-topic recordings. Very long or wide-ranging recordings may produce a dense document — that is fine.
- You can re-run the pipeline on the same source if the first result needs a complete redo. Approving a draft is always the final human gate before anything goes live.

---

## Path 2 — Adding a Written Document or Q&A Directly

**Best for:** Written documents, transcripts you already have in text form, FAQ entries, glossary terms, or any content where the text is ready.

**Where:** Admin panel → Knowledge Base → Documents (the main KB management page)

**How it works:**

1. Go to the Knowledge Base management page in the admin panel.
2. Click **Add Document** (or the equivalent button on the page).
3. Fill in:
   - **Title** — clear and descriptive; this is what members and the AI use to identify the article.
   - **Category** — choose the closest match (e.g. FAQ, curriculum, strategy, glossary).
   - **Content** — paste or type the document body. Use plain text or simple headings.
4. Save. The document is immediately live in the Knowledge Base.

**Tips for Q&A and glossary terms:** Frame the title as the question a member would actually ask (e.g. "How do I request a refund?"). This makes it far easier for the AI to find and surface the right answer.

---

## Path 3 — Private Coaching Recordings

Raw 1-on-1 coaching session recordings are handled separately from the paths above. They go through an additional review step to protect member privacy before any content from them enters the Knowledge Base. Do not add private session recordings through the standard AI Pipeline or the direct-document form without first confirming the review has been completed. If you are unsure, check with the admin team.

---

## Key Principles

**Content is reviewed before it goes live.**
Anything from the AI Pipeline stays in a "Pending Review" queue until an admin approves it. Direct documents go live immediately, so review your text before saving.

**Personal information is automatically removed.**
The system automatically strips email addresses, phone numbers, and coach last names from all content before it reaches members or the AI. You do not need to manually redact these — but it is still good practice to avoid including sensitive personal details in the first place.

**Use the words members actually search for.**
The AI Assistant and the voice assistant find content by matching keywords. If a document only uses formal or internal terminology that members would not know, it may not surface when members search. Where possible, include the plain-language phrases members actually use (e.g. "mentee agreement" alongside "Mentee Master Agreement").

---

## What "Done" Looks Like

A piece of content is fully added to the Knowledge Base when:

1. The article is approved and its status shows as **live** (not "pending" or "draft").
2. The title appears in the member-facing Knowledge Base search results.
3. The AI Assistant can find and reference it when asked a relevant question.

If you added content through the AI Pipeline, check the review queue to make sure the draft was approved. If you added a document directly, search for it by title on the member Knowledge Base page to confirm it is visible.`,
  },
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
      // These refund / Agreement / glossary docs are curated (non-transcript),
      // but last_verified stays NULL so they are held as re-verification drafts
      // and are NOT citable until a human verifies them (Task #2 review pass).
      const result = await db.execute(
        sql`INSERT INTO knowledgebase_docs (title, category, content, doc_class)
            VALUES (${scrubPrivateContent(doc.title)}, ${doc.category}, ${scrubPrivateContent(doc.content)}, ${docClassForCategory(doc.category)})
            ON CONFLICT (title) DO UPDATE
              SET content = EXCLUDED.content,
                  category = EXCLUDED.category,
                  doc_class = EXCLUDED.doc_class,
                  updated_at = NOW()
              WHERE knowledgebase_docs.content IS DISTINCT FROM EXCLUDED.content
                 OR knowledgebase_docs.category IS DISTINCT FROM EXCLUDED.category
                 OR knowledgebase_docs.doc_class IS DISTINCT FROM EXCLUDED.doc_class
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
      // Admin-only SOPs are curated (non-transcript). They are excluded from
      // every member-facing path by audience='admin' regardless of doc_class.
      const result = await db.execute(
        sql`INSERT INTO knowledgebase_docs (title, category, content, audience, doc_class)
            VALUES (${doc.title}, ${doc.category}, ${doc.content}, 'admin', ${docClassForCategory(doc.category)})
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

/**
 * Backfill `doc_class` for every legacy row that predates the column. Transcript
 * categories (coaching / curriculum) become `doc_class='transcript'` (excluded
 * from every member-facing retrieval path); everything else becomes `curated`.
 *
 * Only touches rows where `doc_class IS NULL`, so it is idempotent and never
 * clobbers a value a later step or a human set (e.g. a curriculum transcript
 * promoted to a curated truth-doc keeps its curated class). `last_verified` is
 * intentionally left NULL so reclassified curated rows are held as
 * re-verification drafts and are NOT citable yet.
 *
 * Runs on boot (awaited before the server serves) because post-merge only
 * touches the DEV database; production is a separate database the agent cannot
 * write directly, so a freshly-deployed instance applying this on startup is
 * the only way the reclassification reaches prod.
 */
export async function reclassifyKnowledgebaseDocClasses(): Promise<void> {
  const transcriptList = sql.join(
    TRANSCRIPT_CATEGORIES.map((c) => sql`${c}`),
    sql`, `,
  );
  const result = await db.execute(
    sql`UPDATE knowledgebase_docs
        SET doc_class = CASE
              WHEN category IN (${transcriptList}) THEN 'transcript'
              ELSE 'curated'
            END
        WHERE doc_class IS NULL
        RETURNING id`,
  );
  const updated = (result.rows as any[]).length;
  if (updated > 0) {
    console.log(`[seed-kb] reclassifyKnowledgebaseDocClasses: backfilled doc_class on ${updated} row(s).`);
  }
}
