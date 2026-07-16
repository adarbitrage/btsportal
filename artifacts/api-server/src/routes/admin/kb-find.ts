import { Router, type IRouter } from "express";
import { db, aiLiveDocumentsTable } from "@workspace/db";
import { and, isNull, sql, ilike, or } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac";

// "Find in Knowledge Base" (Task #1925) — admin fact-search over the LIVE
// citable corpus (ai_live_documents, non-deleted rows ONLY). Two modes:
//
//   snippet — did this exact phrase/sentence come from the KB? Exact
//             (case-insensitive) substring match first; fuzzy lexical
//             (tsquery + trigram) fallback when nothing matches verbatim.
//   answer  — paste a whole assistant answer; it is split into individual
//             claims (sentences / bullets) and each claim is searched
//             independently, producing a per-claim checklist.
//
// READ-ONLY over the corpus: this page never edits live docs. The one write
// action ("Send to Review") reuses the existing send-to-review endpoint.
const router: IRouter = Router();

export interface KbFindResult {
  docId: number;
  title: string;
  category: string;
  docClass: string | null;
  homeRoot: string | null;
  node: string | null;
  matchType: "exact" | "fuzzy";
  score: number;
  /** Excerpt with the match wrapped in <mark>…</mark> (HTML-escaped otherwise). */
  excerpt: string;
  /** Plain-text matched passage — carried into the Send-to-Review note. */
  matchedPassage: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ts_headline runs over RAW document content, so any HTML in a live doc would
// otherwise pass straight through to dangerouslySetInnerHTML on the admin
// page (stored XSS). Use non-HTML sentinels for the highlight markers, escape
// everything, then swap the sentinels for <mark> tags.
const MARK_START = "\u0001";
const MARK_END = "\u0002";
const sanitizeHeadline = (s: string) =>
  escapeHtml(s)
    .replaceAll(MARK_START, "<mark>")
    .replaceAll(MARK_END, "</mark>");

/** Build a <mark>-highlighted excerpt around an exact match position. */
function buildExactExcerpt(content: string, index: number, matchLength: number): string {
  const CONTEXT = 160;
  const start = Math.max(0, index - CONTEXT);
  const end = Math.min(content.length, index + matchLength + CONTEXT);
  const before = (start > 0 ? "…" : "") + escapeHtml(content.slice(start, index));
  const match = escapeHtml(content.slice(index, index + matchLength));
  const after = escapeHtml(content.slice(index + matchLength, end)) + (end < content.length ? "…" : "");
  return `${before}<mark>${match}</mark>${after}`;
}

/**
 * Split a whole assistant answer into individually-checkable claims.
 * Bullets and numbered items are claims; prose is split at sentence
 * boundaries. Very short fragments and markdown scaffolding are dropped.
 */
export function splitAnswerIntoClaims(answer: string): string[] {
  const claims: string[] = [];
  const lines = answer.split(/\r?\n/);
  for (const rawLine of lines) {
    // Strip markdown bullets / numbering / headings / emphasis markers.
    const line = rawLine
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/\*\*/g, "")
      .trim();
    if (!line) continue;
    // Split prose lines at sentence boundaries.
    const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
    for (const s of sentences) {
      const claim = s.trim();
      // Skip fragments too short to be a factual claim.
      if (claim.length < 25) continue;
      claims.push(claim);
      if (claims.length >= 40) return claims;
    }
  }
  return claims;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Search one snippet against the live corpus. Exact first, fuzzy fallback. */
export async function findSnippetInLiveCorpus(snippet: string, limit = 5): Promise<KbFindResult[]> {
  const trimmed = snippet.trim();
  if (!trimmed) return [];

  const baseCols = {
    id: aiLiveDocumentsTable.id,
    title: aiLiveDocumentsTable.title,
    content: aiLiveDocumentsTable.content,
    category: aiLiveDocumentsTable.category,
    docClass: aiLiveDocumentsTable.docClass,
    homeRoot: aiLiveDocumentsTable.homeRoot,
    node: aiLiveDocumentsTable.node,
  };

  // 1) Exact (case-insensitive) substring match.
  const pattern = `%${escapeLike(trimmed)}%`;
  const exactRows = await db
    .select(baseCols)
    .from(aiLiveDocumentsTable)
    .where(and(
      isNull(aiLiveDocumentsTable.deletedAt),
      or(ilike(aiLiveDocumentsTable.content, pattern), ilike(aiLiveDocumentsTable.title, pattern)),
    ))
    .limit(limit);

  if (exactRows.length > 0) {
    return exactRows.map((d) => {
      const idx = d.content.toLowerCase().indexOf(trimmed.toLowerCase());
      const inTitle = idx < 0;
      return {
        docId: d.id,
        title: d.title,
        category: d.category,
        docClass: d.docClass,
        homeRoot: d.homeRoot,
        node: d.node,
        matchType: "exact" as const,
        score: 1,
        excerpt: inTitle
          ? `<mark>${escapeHtml(d.title)}</mark>`
          : buildExactExcerpt(d.content, idx, trimmed.length),
        matchedPassage: inTitle ? d.title : d.content.slice(idx, idx + trimmed.length),
      };
    });
  }

  // 2) Fuzzy lexical fallback — OR-of-words tsquery + trigram similarity,
  //    mirroring the admin live-doc list search; ts_headline highlights.
  const orTsquery = sql`(
    SELECT COALESCE(
      NULLIF(
        (SELECT to_tsquery('english', string_agg(lexeme, ' | '))
         FROM unnest(to_tsvector('english', ${trimmed}))),
        NULL
      ),
      plainto_tsquery('english', ${trimmed})
    )
  )`;

  const fuzzyRows = await db
    .select({
      ...baseCols,
      score: sql<number>`GREATEST(
        ts_rank(
          setweight(to_tsvector('english', ${aiLiveDocumentsTable.title}), 'A') ||
            setweight(to_tsvector('english', ${aiLiveDocumentsTable.content}), 'B'),
          ${orTsquery}
        ),
        word_similarity(${trimmed}, ${aiLiveDocumentsTable.content}),
        word_similarity(${trimmed}, ${aiLiveDocumentsTable.title})
      )`.as("score"),
      headline: sql<string>`ts_headline(
        'english',
        ${aiLiveDocumentsTable.content},
        ${orTsquery},
        'StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', MaxWords=60, MinWords=20, MaxFragments=2, FragmentDelimiter=" … "'
      )`.as("headline"),
      plainFragment: sql<string>`ts_headline(
        'english',
        ${aiLiveDocumentsTable.content},
        ${orTsquery},
        'StartSel=, StopSel=, MaxWords=60, MinWords=20, MaxFragments=1'
      )`.as("plain_fragment"),
    })
    .from(aiLiveDocumentsTable)
    .where(and(
      isNull(aiLiveDocumentsTable.deletedAt),
      sql`(
        to_tsvector('english', ${aiLiveDocumentsTable.title} || ' ' || ${aiLiveDocumentsTable.content}) @@ ${orTsquery}
        OR word_similarity(${trimmed}, ${aiLiveDocumentsTable.title}) > 0.2
        OR word_similarity(${trimmed}, ${aiLiveDocumentsTable.content}) > 0.15
      )`,
    ))
    .orderBy(sql`score DESC`)
    .limit(limit);

  return fuzzyRows.map((d) => ({
    docId: d.id,
    title: d.title,
    category: d.category,
    docClass: d.docClass,
    homeRoot: d.homeRoot,
    node: d.node,
    matchType: "fuzzy" as const,
    score: Number(d.score) || 0,
    excerpt: sanitizeHeadline(d.headline),
    matchedPassage: d.plainFragment,
  }));
}

// Snippet mode — one exact-phrase search.
router.post("/admin/kb-find/search", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }
  if (query.length > 2000) {
    res.status(400).json({ error: "Snippet too long (max 2000 characters); use whole-answer mode instead" });
    return;
  }

  const results = await findSnippetInLiveCorpus(query, 8);
  res.json({ query, results });
});

// Whole-answer mode, step 1 — extract claims for the selectable checklist.
// No searching happens here; the admin reviews/deselects claims first.
router.post("/admin/kb-find/extract-claims", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const answer = typeof req.body?.answer === "string" ? req.body.answer : "";
  if (!answer.trim()) {
    res.status(400).json({ error: "answer is required" });
    return;
  }
  if (answer.length > 20000) {
    res.status(400).json({ error: "Answer too long (max 20000 characters)" });
    return;
  }
  res.json({ claims: splitAnswerIntoClaims(answer) });
});

// Whole-answer mode, step 2 — check the SELECTED claims. Accepts either an
// explicit claims array (from the checklist) or a raw answer (auto-split).
router.post("/admin/kb-find/check-answer", requirePermission("chat:view"), async (req, res): Promise<void> => {
  let claims: string[];
  if (Array.isArray(req.body?.claims)) {
    claims = req.body.claims
      .filter((c: unknown): c is string => typeof c === "string" && c.trim().length > 0)
      .map((c: string) => c.trim())
      .slice(0, 40);
    if (claims.length === 0) {
      res.status(400).json({ error: "claims must contain at least one non-empty string" });
      return;
    }
    if (claims.some((c) => c.length > 2000)) {
      res.status(400).json({ error: "Each claim must be at most 2000 characters" });
      return;
    }
  } else {
    const answer = typeof req.body?.answer === "string" ? req.body.answer : "";
    if (!answer.trim()) {
      res.status(400).json({ error: "answer or claims is required" });
      return;
    }
    if (answer.length > 20000) {
      res.status(400).json({ error: "Answer too long (max 20000 characters)" });
      return;
    }
    claims = splitAnswerIntoClaims(answer);
  }

  const checked = [];
  for (const claim of claims) {
    const results = await findSnippetInLiveCorpus(claim, 3);
    checked.push({
      claim,
      supported: results.some((r) => r.matchType === "exact" || r.score >= 0.15),
      results,
    });
  }

  res.json({
    claimCount: claims.length,
    supportedCount: checked.filter((c) => c.supported).length,
    claims: checked,
  });
});

// Trace-panel helper: resolve current live-doc status for traced doc ids
// (deleted/missing docs are reported so the admin knows a source vanished).
router.post("/admin/kb-find/doc-status", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const ids: number[] = Array.isArray(req.body?.ids)
    ? req.body.ids.filter((n: unknown) => Number.isInteger(n)).slice(0, 50)
    : [];
  if (ids.length === 0) {
    res.json({ docs: [] });
    return;
  }
  const rows = await db
    .select({
      id: aiLiveDocumentsTable.id,
      title: aiLiveDocumentsTable.title,
      deletedAt: aiLiveDocumentsTable.deletedAt,
    })
    .from(aiLiveDocumentsTable)
    .where(sql`${aiLiveDocumentsTable.id} = ANY(${sql.raw(`'{${ids.join(",")}}'::int[]`)})`);
  res.json({
    docs: ids.map((id) => {
      const row = rows.find((r) => r.id === id);
      return { id, exists: !!row, deleted: !!row?.deletedAt, title: row?.title ?? null };
    }),
  });
});

export default router;
