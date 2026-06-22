import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

/**
 * Build an OR-style tsquery from a plain search string.
 *
 * Strategy:
 *   1. Run the query through `to_tsvector` so Postgres stems/normalises every
 *      word (e.g. "starting" → "start") and strips stop-words.
 *   2. Collect the resulting lexemes and join them with the tsquery OR operator
 *      `|`, so *any* single-word match surfaces a document instead of requiring
 *      all words to match (the old implicit-AND behaviour of plainto_tsquery).
 *   3. Fall back to `plainto_tsquery` when to_tsvector produces no lexemes
 *      (e.g. the entire query was stop-words), which would otherwise yield NULL.
 *
 * Returns a SQL fragment that evaluates to a tsquery value.
 */
function buildOrTsquery(q: string) {
  return sql`(
    SELECT COALESCE(
      NULLIF(
        (SELECT to_tsquery('english', string_agg(lexeme, ' | '))
         FROM unnest(to_tsvector('english', ${q}))),
        NULL
      ),
      plainto_tsquery('english', ${q})
    )
  )`;
}

/**
 * Weighted tsvector for ranking: title hits (weight A) outrank body hits (B).
 * The existing GIN index covers to_tsvector('english', title || ' ' || content)
 * and is used for the WHERE @@ clause; the weighted vector is computed only for
 * the ORDER BY expression so no index change is needed.
 */
function buildWeightedVector() {
  return sql`(
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', content), 'B')
  )`;
}

/**
 * Trigram-similarity fallback used when the full-text search returns no rows
 * (e.g. a misspelled query whose lexeme matches nothing).  Requires pg_trgm.
 * Ranks by the best of title-similarity, word-similarity-in-title, and
 * word-similarity-in-content so misspelled title terms still surface the
 * correct lesson.
 */
async function trigramFallback(
  q: string,
  category: string | null,
  limit: number,
): Promise<any[]> {
  try {
    const categoryClause = category
      ? sql`AND category = ${category}`
      : sql``;

    const result = await db.execute(
      sql`SELECT
            id,
            title,
            category,
            source_path,
            source_label,
            left(content, 300) AS snippet,
            GREATEST(
              similarity(title, ${q}),
              word_similarity(${q}, title),
              word_similarity(${q}, content)
            ) AS rank
          FROM knowledgebase_docs
          WHERE
            (
              similarity(title, ${q}) > 0.15
              OR word_similarity(${q}, title) > 0.2
              OR word_similarity(${q}, content) > 0.15
            )
            AND audience = 'member'
            AND source_path IS NOT NULL
            ${categoryClause}
          ORDER BY rank DESC
          LIMIT ${limit}`,
    );
    return result.rows as any[];
  } catch {
    return [];
  }
}

router.get("/kb/browse", async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const rawLimit = parseInt(String(req.query.limit ?? "30"), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1 ? 30 : Math.min(rawLimit, 50);
  const category = typeof req.query.category === "string" && req.query.category ? req.query.category : null;

  try {
    let results;
    if (category) {
      results = await db.execute(
        sql`SELECT
              id,
              title,
              category,
              source_path,
              source_label,
              left(content, 200) AS snippet
            FROM knowledgebase_docs
            WHERE
              audience = 'member'
              AND source_path IS NOT NULL
              AND category = ${category}
            ORDER BY title ASC
            LIMIT ${limit}`,
      );
    } else {
      results = await db.execute(
        sql`SELECT
              id,
              title,
              category,
              source_path,
              source_label,
              left(content, 200) AS snippet
            FROM knowledgebase_docs
            WHERE
              audience = 'member'
              AND source_path IS NOT NULL
            ORDER BY category ASC, title ASC
            LIMIT ${limit}`,
      );
    }

    const rows = (results.rows as any[]).map((r) => ({
      id: r.id as number,
      title: r.title as string,
      category: r.category as string,
      sourcePath: (r.source_path as string | null) ?? null,
      sourceLabel: (r.source_label as string | null) ?? null,
      snippet: (r.snippet as string | null) ?? "",
      rank: 0,
    }));

    res.json({ results: rows });
  } catch (err) {
    console.error("[KB Browse] Error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Browse failed" });
  }
});

router.get("/kb/counts", async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const results = await db.execute(
      sql`SELECT category, COUNT(*)::int AS count
            FROM knowledgebase_docs
            WHERE
              audience = 'member'
              AND source_path IS NOT NULL
            GROUP BY category`,
    );

    const counts: Record<string, number> = {};
    for (const r of results.rows as any[]) {
      counts[r.category as string] = Number(r.count);
    }

    res.json({ counts });
  } catch (err) {
    console.error("[KB Counts] Error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Counts failed" });
  }
});

router.get("/kb/search", async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q || q.length < 2) {
    res.json({ results: [] });
    return;
  }

  const rawLimit = parseInt(String(req.query.limit ?? "20"), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 50);

  const category =
    typeof req.query.category === "string" && req.query.category
      ? req.query.category
      : null;

  try {
    const orTsquery = buildOrTsquery(q);
    const weightedVector = buildWeightedVector();
    const categoryClause = category ? sql`AND category = ${category}` : sql``;

    const ftResult = await db.execute(
      sql`SELECT
            id,
            title,
            category,
            source_path,
            source_label,
            ts_headline(
              'english',
              content,
              ${orTsquery},
              'StartSel=[[[HL]]], StopSel=[[[/HL]]], MaxWords=35, MinWords=15, ShortWord=3, HighlightAll=false, MaxFragments=1, FragmentDelimiter=" … "'
            ) AS snippet,
            ts_rank_cd(
              ${weightedVector},
              ${orTsquery}
            ) AS rank
          FROM knowledgebase_docs
          WHERE
            to_tsvector('english', title || ' ' || content) @@ ${orTsquery}
            AND audience = 'member'
            AND source_path IS NOT NULL
            ${categoryClause}
          ORDER BY rank DESC
          LIMIT ${limit}`,
    );

    let rows = ftResult.rows as any[];
    let usedFallback = false;

    if (rows.length === 0) {
      rows = await trigramFallback(q, category, limit);
      usedFallback = rows.length > 0;
    }

    const results = rows.map((r) => ({
      id: r.id as number,
      title: r.title as string,
      category: r.category as string,
      sourcePath: (r.source_path as string | null) ?? null,
      sourceLabel: (r.source_label as string | null) ?? null,
      snippet: (r.snippet as string | null) ?? "",
      rank: parseFloat(r.rank),
    }));

    res.json({ results, usedFallback });
  } catch (err) {
    console.error(
      "[KB Search] Error:",
      err instanceof Error ? err.message : err,
    );
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
