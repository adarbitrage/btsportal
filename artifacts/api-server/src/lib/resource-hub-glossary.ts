import { db, resourceHubGlossaryTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { callLLMWithRetry } from "./kb-synthesis";

/**
 * Resource Hub glossary drafting (Task #2028).
 *
 * Drafts member-facing definitions for glossary terms, grounded in the
 * ai_live_documents corpus (with ai_source_documents as fallback where a term
 * isn't covered by live docs). Definitions are written to status 'draft' and
 * only served to members once a human approves them on the admin review page.
 * Reviewer edits always win: generation NEVER touches approved terms, and a
 * regenerate action is an explicit per-term admin request.
 *
 * Failures are loud (throw) — no silent fallback text, per KB pipeline canon.
 */

const EXCERPT_DOCS_PER_TERM = 3;
const EXCERPT_CHARS = 900;
export const GENERATION_BATCH_SIZE = 8;

interface TermRow {
  id: number;
  term: string;
}

/** Lexical grounding: top excerpts mentioning the term, live docs first. */
async function collectGrounding(term: string): Promise<string> {
  // Strip parentheticals/slashes for matching (e.g. "Conversion (CV)" → "Conversion").
  const bare = term.replace(/\(.*?\)/g, "").split("/")[0].trim();
  const pattern = `%${bare}%`;

  const live = (
    await db.execute(sql`
      SELECT title, content FROM ai_live_documents
      WHERE content ILIKE ${pattern} OR title ILIKE ${pattern}
      ORDER BY (title ILIKE ${pattern}) DESC, length(content) ASC
      LIMIT ${EXCERPT_DOCS_PER_TERM}
    `)
  ).rows as Array<{ title: string; content: string }>;

  let rows = live;
  if (rows.length === 0) {
    rows = (
      await db.execute(sql`
        SELECT title, content FROM ai_source_documents
        WHERE content ILIKE ${pattern} OR title ILIKE ${pattern}
        ORDER BY (title ILIKE ${pattern}) DESC, length(content) ASC
        LIMIT ${EXCERPT_DOCS_PER_TERM}
      `)
    ).rows as Array<{ title: string; content: string }>;
  }

  return rows
    .map((r) => {
      const idx = r.content.toLowerCase().indexOf(bare.toLowerCase());
      const start = Math.max(0, (idx < 0 ? 0 : idx) - Math.floor(EXCERPT_CHARS / 3));
      const excerpt = r.content.slice(start, start + EXCERPT_CHARS).trim();
      return `### ${r.title}\n${excerpt}`;
    })
    .join("\n\n");
}

const SYSTEM_PROMPT = `You write glossary definitions for the BTS (Build Test Scale) member portal — an affiliate-arbitrage training program. Members are beginners learning media buying.

Rules:
- 1-3 sentences per definition. Plain, friendly, concrete. Define the term as it is used INSIDE BTS, grounded in the provided excerpts.
- If the excerpts cover the term, stay faithful to them. If they don't, write a careful general definition of the term as used in affiliate marketing/media buying, and keep it generic — never invent BTS-specific claims, numbers, or tool behaviors.
- Never include member names, coach surnames, emails, phone numbers, or pricing.
- Return STRICT JSON: {"definitions": [{"term": "<term exactly as given>", "definition": "<text>"}]}.`;

/**
 * Draft definitions for up to `limit` draft terms with empty definitions
 * (or exactly the given ids for regeneration). Returns counts + remaining.
 */
export async function generateGlossaryDefinitions(opts: {
  ids?: number[];
  limit?: number;
}): Promise<{ generated: number; remaining: number }> {
  let terms: TermRow[];
  if (opts.ids && opts.ids.length > 0) {
    terms = (
      await db.execute(sql`
        SELECT id, term FROM resource_hub_glossary
        WHERE id = ANY(${sql.raw(`'{${opts.ids.map((n) => Math.floor(n)).join(",")}}'::int[]`)})
          AND status <> 'approved'
        ORDER BY term ASC
      `)
    ).rows as unknown as TermRow[];
  } else {
    const limit = Math.min(opts.limit ?? GENERATION_BATCH_SIZE, GENERATION_BATCH_SIZE);
    terms = (
      await db.execute(sql`
        SELECT id, term FROM resource_hub_glossary
        WHERE status = 'draft' AND definition = ''
        ORDER BY term ASC
        LIMIT ${limit}
      `)
    ).rows as unknown as TermRow[];
  }

  if (terms.length > 0) {
    const sections: string[] = [];
    for (const t of terms) {
      const grounding = await collectGrounding(t.term);
      sections.push(
        `## Term: ${t.term}\n` +
          (grounding
            ? `Excerpts:\n${grounding}`
            : `Excerpts: (none found — write a careful generic definition)`),
      );
    }
    const user =
      `Write glossary definitions for the following ${terms.length} term(s).\n\n` +
      sections.join("\n\n---\n\n");

    const raw = await callLLMWithRetry("glossary-draft", SYSTEM_PROMPT, user, 6000, true);
    let parsed: { definitions?: Array<{ term?: string; definition?: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Glossary generation returned unparseable JSON");
    }
    const byTerm = new Map(
      (parsed.definitions ?? [])
        .filter((d) => typeof d.term === "string" && typeof d.definition === "string" && d.definition.trim())
        .map((d) => [d.term!.trim().toLowerCase(), d.definition!.trim()]),
    );

    for (const t of terms) {
      const def = byTerm.get(t.term.trim().toLowerCase());
      if (!def) {
        console.warn(`[Glossary] model returned no definition for "${t.term}" — left as-is`);
        continue;
      }
      await db
        .update(resourceHubGlossaryTable)
        .set({ definition: def, status: "draft", lastGeneratedAt: new Date() })
        .where(eq(resourceHubGlossaryTable.id, t.id));
    }
  }

  const [{ remaining }] = (
    await db.execute(
      sql`SELECT count(*)::int AS remaining FROM resource_hub_glossary WHERE status = 'draft' AND definition = ''`,
    )
  ).rows as Array<{ remaining: number }>;

  return { generated: terms.length, remaining: Number(remaining) };
}
